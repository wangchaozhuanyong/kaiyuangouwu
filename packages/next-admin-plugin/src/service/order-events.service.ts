import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { OrderProcessingChangedEvent, OrderProcessingService } from '@vendure/commerce-fulfillment-plugin';
import {
    EventBus,
    Logger,
    Order,
    OrderPlacedEvent,
    OrderStateTransitionEvent,
    ProcessContext,
    RefundEvent,
    RefundStateTransitionEvent,
    TransactionalConnection,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { In, IsNull, MoreThan, Not } from 'typeorm';

import { listenForOrderEvents, orderEventSocketPath, relayOrderEvent } from './order-event-relay';

export interface AdminOrderEvent {
    version: 1;
    kind: 'order-placed' | 'order-pending';
    id: string;
    orderId: string;
    occurredAt: string;
    store?: { id: string; nameZh?: string; nameEn?: string };
}

interface BufferedOrderEvent {
    payload: AdminOrderEvent;
    channelIds: string[];
    sequence: number;
}

const REMINDER_INTERVAL = 30 * 60 * 1000;
// Matches the Admin's pending fulfillment states, including partially handled orders.
const PENDING_STATES = ['PaymentAuthorized', 'PaymentSettled', 'PartiallyShipped', 'PartiallyDelivered'];
const ORDER_RELATIONS = { lines: true, fulfillments: { lines: true }, salesChannel: true } as const;

function needsProcessing(order: Order): boolean {
    if (order.active || !order.orderPlacedAt || !PENDING_STATES.includes(order.state)) return false;
    // Digital goods may already be delivered while payment remains authorized. Mixed shipped/delivered
    // lines also count as handled; a partially fulfilled quantity must keep its reminder.
    return order.lines.some(line => {
        const handled = order.fulfillments
            .filter(fulfillment => fulfillment.state === 'Shipped' || fulfillment.state === 'Delivered')
            .flatMap(fulfillment => fulfillment.lines)
            .filter(fulfilled => String(fulfilled.orderLineId) === String(line.id))
            .reduce((quantity, fulfilled) => quantity + fulfilled.quantity, 0);
        return line.quantity > handled;
    });
}

@Injectable()
export class OrderEventsService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly subscriptions: Array<{ unsubscribe(): void }> = [];
    private stopped = false;
    private readonly pending = new Map<string, { timer: ReturnType<typeof setTimeout> }>();
    private closeRelay?: () => Promise<void>;
    private readonly instance = randomUUID();
    private sequence = 0;
    private readonly recent: BufferedOrderEvent[] = [];
    private readonly seen = new Set<string>();
    private readonly clients = new Set<{
        channelId: string;
        platformRead: boolean;
        send: (event: AdminOrderEvent) => void;
        close: () => void;
    }>();

    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly processContext: ProcessContext,
        @Optional() private readonly processing?: OrderProcessingService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        const socketPath = orderEventSocketPath();
        if (this.processContext.isServer) {
            this.closeRelay = await listenForOrderEvents(socketPath, (orderId, kind) =>
                kind === 'changed' ? this.refreshOrder(orderId) : this.publishPlacedOrder(orderId),
            );
        }
        // ofType waits for the order transaction to commit; rolled-back orders never reach this handler.
        this.subscriptions.push(
            this.eventBus.ofType(OrderPlacedEvent).subscribe(event => {
                const operation = this.processContext.isWorker
                    ? relayOrderEvent(socketPath, String(event.order.id))
                    : this.publishPlacedOrder(String(event.order.id));
                void operation.catch(() => Logger.error('Unable to deliver new order event', 'OrderEvents'));
            }),
        );
        this.subscriptions.push(
            this.eventBus.ofType(OrderStateTransitionEvent).subscribe(event => {
                if (!event.order.orderPlacedAt) return;
                this.processingChanged(socketPath, String(event.order.id));
            }),
        );
        this.subscriptions.push(
            this.eventBus.ofType(RefundEvent).subscribe(event => {
                if (event.order.orderPlacedAt) this.processingChanged(socketPath, String(event.order.id));
            }),
            this.eventBus.ofType(RefundStateTransitionEvent).subscribe(event => {
                if (event.order.orderPlacedAt) this.processingChanged(socketPath, String(event.order.id));
            }),
            this.eventBus.ofType(OrderProcessingChangedEvent).subscribe(event => {
                this.processingChanged(socketPath, String(event.orderId));
            }),
        );
        // One startup recovery pass restores timers after a restart, without announcing historical orders.
        // There is no recurring scan: once empty, nothing runs until a real order event arrives.
        if (this.processContext.isServer) await this.restorePendingOrders();
    }

    async onApplicationShutdown(): Promise<void> {
        this.stopped = true;
        for (const subscription of this.subscriptions) subscription.unsubscribe();
        for (const entry of this.pending.values()) clearTimeout(entry.timer);
        this.pending.clear();
        for (const client of this.clients) client.close();
        this.clients.clear();
        await this.closeRelay?.();
    }

    subscribe(
        channelId: string,
        lastEventId: string | undefined,
        send: (event: AdminOrderEvent) => void,
        close: () => void,
        platformRead = false,
    ) {
        const client = { channelId, send, close, platformRead };
        this.clients.add(client);
        const prefix = `${this.instance}:`;
        const after = lastEventId?.startsWith(prefix) ? Number(lastEventId.slice(prefix.length)) : NaN;
        const replay =
            Number.isSafeInteger(after) && after >= 0
                ? this.recent.filter(
                      event =>
                          event.sequence > after &&
                          (platformRead || event.channelIds.includes(channelId)) &&
                          (event.payload.kind === 'order-placed' || this.pending.has(event.payload.orderId)),
                  )
                : [];
        return {
            cursor: `${this.instance}:${this.sequence}`,
            replay: replay.map(event => event.payload),
            remove: () => this.clients.delete(client),
        };
    }

    async publishPlacedOrder(orderId: string): Promise<void> {
        if (this.seen.has(orderId)) return;
        // Load the persisted sale owner after commit; management assignments never grant notifications.
        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { id: orderId },
            relations: ORDER_RELATIONS,
        });
        if (
            !order ||
            order.active ||
            !order.orderPlacedAt ||
            order.state === 'Draft' ||
            this.stopped ||
            this.seen.has(orderId)
        )
            return;
        this.seen.add(orderId);
        if (this.seen.size > 2000) {
            const oldest = this.seen.values().next().value;
            if (oldest) this.seen.delete(oldest);
        }
        await this.trackOrder(order);
        if (this.stopped) return;
        this.publish(order, 'order-placed', order.orderPlacedAt);
    }

    async refreshOrder(orderId: string): Promise<void> {
        if (this.stopped) return;
        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { id: orderId },
            relations: ORDER_RELATIONS,
        });
        if (order) await this.trackOrder(order);
        else this.stopReminder(orderId);
    }

    private async restorePendingOrders(): Promise<void> {
        let after: Order['id'] | undefined;
        while (!this.stopped) {
            const orders = await this.connection.rawConnection.getRepository(Order).find({
                where: {
                    ...(after === undefined ? {} : { id: MoreThan(after) }),
                    active: false,
                    orderPlacedAt: Not(IsNull()),
                    ...(this.processing ? {} : { state: In(PENDING_STATES) }),
                },
                relations: ORDER_RELATIONS,
                order: { id: 'ASC' },
                take: 100,
            });
            for (const order of orders) await this.trackOrder(order, true);
            if (orders.length < 100) return;
            after = orders[orders.length - 1].id;
        }
    }

    private async trackOrder(order: Order, restored = false): Promise<void> {
        const orderId = String(order.id);
        if (!order.orderPlacedAt || !(await this.requiresProcessing(order))) {
            this.stopReminder(orderId);
            return;
        }
        if (this.stopped || this.pending.has(orderId)) return;
        // Recovery uses the next 30-minute boundary since placement; it neither floods old alerts nor
        // loses pending orders. Live state transitions never reset an already-running timer.
        const elapsed = Math.max(0, Date.now() - new Date(order.orderPlacedAt).getTime());
        const delay = restored ? REMINDER_INTERVAL - (elapsed % REMINDER_INTERVAL) : REMINDER_INTERVAL;
        this.scheduleReminder(orderId, delay);
    }

    private stopReminder(orderId: string): void {
        const entry = this.pending.get(orderId);
        if (entry) clearTimeout(entry.timer);
        this.pending.delete(orderId);
        // Reconnecting clients must not replay reminders for an order which is already handled.
        for (let i = this.recent.length - 1; i >= 0; i--) {
            if (
                this.recent[i].payload.kind === 'order-pending' &&
                this.recent[i].payload.orderId === orderId
            ) {
                this.recent.splice(i, 1);
            }
        }
    }

    private scheduleReminder(orderId: string, delay = REMINDER_INTERVAL): void {
        if (this.stopped) return;
        const entry = {
            timer: setTimeout(() => {
                void this.remindOrder(orderId, entry).catch(() =>
                    Logger.error('Unable to verify pending order reminder', 'OrderEvents'),
                );
            }, delay),
        };
        entry.timer.unref?.();
        this.pending.set(orderId, entry);
    }

    private async remindOrder(
        orderId: string,
        entry: { timer: ReturnType<typeof setTimeout> },
    ): Promise<void> {
        try {
            // Only the due order is checked. This also catches worker fulfillment changes that do not
            // transition the Order state (for example already-delivered authorized digital orders).
            const order = await this.connection.rawConnection.getRepository(Order).findOne({
                where: { id: orderId },
                relations: ORDER_RELATIONS,
            });
            if (this.stopped || this.pending.get(orderId) !== entry) return;
            const actionable = order && (await this.requiresProcessing(order));
            if (this.stopped || this.pending.get(orderId) !== entry) return;
            if (!order || !actionable) {
                this.stopReminder(orderId);
                return;
            }
            // Retain only the latest reminder per order, so reconnecting does not replay hours of alarms.
            this.stopReminder(orderId);
            this.scheduleReminder(orderId);
            this.publish(order, 'order-pending', new Date());
        } catch (error) {
            // Do not announce an unverified status. Retry this pending order at the next reminder time.
            if (!this.stopped && this.pending.get(orderId) === entry) this.scheduleReminder(orderId);
            throw error;
        }
    }

    private publish(order: Order, kind: AdminOrderEvent['kind'], occurredAt: Date): void {
        const channelIds = order.salesChannelId == null ? [] : [String(order.salesChannelId)];
        const owner = order.salesChannel;
        const fields = owner?.customFields as
            { storefrontNameZh?: string | null; storefrontNameEn?: string | null } | undefined;
        const nameZh = fields?.storefrontNameZh?.trim();
        const nameEn = fields?.storefrontNameEn?.trim();
        const store =
            owner && String(owner.id) === String(order.salesChannelId) && (nameZh || nameEn)
                ? {
                      id: String(owner.id),
                      ...(nameZh ? { nameZh } : {}),
                      ...(nameEn ? { nameEn } : {}),
                  }
                : undefined;
        const payload: AdminOrderEvent = {
            version: 1,
            kind,
            id: `${this.instance}:${++this.sequence}`,
            orderId: String(order.id),
            occurredAt: new Date(occurredAt).toISOString(),
            ...(store ? { store } : {}),
        };
        this.recent.push({ payload, channelIds, sequence: this.sequence });
        if (this.recent.length > 200) this.recent.shift();
        for (const client of this.clients) {
            if (client.platformRead || channelIds.includes(client.channelId)) {
                try {
                    client.send(payload);
                } catch {
                    client.close();
                    this.clients.delete(client);
                }
            }
        }
    }

    private requiresProcessing(order: Order): Promise<boolean> {
        return this.processing
            ? this.processing.needsReminder(order)
            : Promise.resolve(needsProcessing(order));
    }

    private processingChanged(socketPath: string, orderId: string): void {
        if (this.stopped) return;
        // All sources use the same committed-order refresh. A refund or notification retry may
        // change the next task while the Order keeps its existing state.
        const operation = this.processContext.isWorker
            ? relayOrderEvent(socketPath, orderId, 'changed')
            : this.refreshOrder(orderId);
        void operation.catch(() => Logger.error('Unable to update order reminder', 'OrderEvents'));
    }
}
