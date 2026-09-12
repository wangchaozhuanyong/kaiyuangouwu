import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import {
    EventBus,
    Logger,
    Order,
    OrderPlacedEvent,
    OrderStateTransitionEvent,
    ProcessContext,
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
}

interface BufferedOrderEvent {
    payload: AdminOrderEvent;
    channelIds: string[];
    sequence: number;
}

const REMINDER_INTERVAL = 30 * 60 * 1000;
// Matches the Admin's pending fulfillment states, including partially handled orders.
const PENDING_STATES = ['PaymentAuthorized', 'PaymentSettled', 'PartiallyShipped', 'PartiallyDelivered'];
const ORDER_RELATIONS = { channels: true, lines: true, fulfillments: { lines: true } } as const;

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
        send: (event: AdminOrderEvent) => void;
        close: () => void;
    }>();

    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly processContext: ProcessContext,
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
                const operation = this.processContext.isWorker
                    ? relayOrderEvent(socketPath, String(event.order.id), 'changed')
                    : this.refreshOrder(String(event.order.id));
                void operation.catch(() => Logger.error('Unable to update order reminder', 'OrderEvents'));
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
    ) {
        const client = { channelId, send, close };
        this.clients.add(client);
        const prefix = `${this.instance}:`;
        const after = lastEventId?.startsWith(prefix) ? Number(lastEventId.slice(prefix.length)) : NaN;
        const replay =
            Number.isSafeInteger(after) && after >= 0
                ? this.recent.filter(
                      event =>
                          event.sequence > after &&
                          event.channelIds.includes(channelId) &&
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
        // Load only when an actual placement event arrives, also resolving all assigned seller Channels.
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
        this.trackOrder(order);
        this.publish(order, 'order-placed', order.orderPlacedAt);
    }

    async refreshOrder(orderId: string): Promise<void> {
        if (this.stopped) return;
        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { id: orderId },
            relations: ORDER_RELATIONS,
        });
        if (order) this.trackOrder(order);
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
                    state: In(PENDING_STATES),
                },
                relations: ORDER_RELATIONS,
                order: { id: 'ASC' },
                take: 100,
            });
            for (const order of orders) this.trackOrder(order, true);
            if (orders.length < 100) return;
            after = orders[orders.length - 1].id;
        }
    }

    private trackOrder(order: Order, restored = false): void {
        const orderId = String(order.id);
        if (!order.orderPlacedAt || !needsProcessing(order)) {
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
            if (!order || !needsProcessing(order)) {
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
        const channelIds = order.channels.map(channel => String(channel.id));
        const payload: AdminOrderEvent = {
            version: 1,
            kind,
            id: `${this.instance}:${++this.sequence}`,
            orderId: String(order.id),
            occurredAt: new Date(occurredAt).toISOString(),
        };
        this.recent.push({ payload, channelIds, sequence: this.sequence });
        if (this.recent.length > 200) this.recent.shift();
        for (const client of this.clients) {
            if (channelIds.includes(client.channelId)) {
                try {
                    client.send(payload);
                } catch {
                    client.close();
                    this.clients.delete(client);
                }
            }
        }
    }
}
