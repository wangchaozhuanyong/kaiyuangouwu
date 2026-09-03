import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import {
    EventBus,
    Fulfillment,
    FulfillmentEvent,
    FulfillmentStateTransitionEvent,
    OrderPlacedEvent,
    PaymentStateTransitionEvent,
    ProductVariant,
    ProductVariantService,
    RefundStateTransitionEvent,
    StockMovementEvent,
    TransactionalConnection,
} from '@vendure/core';

import { AdminNotificationConfigService } from './admin-notification-config.service';
import { AdminNotificationRequestedEvent } from './admin-notification-requested.event';
import { AdminNotificationService } from './admin-notification.service';
import { type NotificationSeverity } from './department-notification-router';

const LOGGER_CTX = 'AdminNotificationEvents';

@Injectable()
export class AdminNotificationEventSubscriber implements OnApplicationBootstrap, OnApplicationShutdown {
    private subscriptions: Array<{ unsubscribe(): void }> = [];

    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly productVariantService: ProductVariantService,
        private readonly configService: AdminNotificationConfigService,
        private readonly notifications: AdminNotificationService,
    ) {}

    onApplicationBootstrap(): void {
        this.subscriptions.push(
            this.eventBus
                .ofType(OrderPlacedEvent)
                .subscribe(event => this.run(() => this.onOrderPlaced(event))),
            this.eventBus
                .ofType(PaymentStateTransitionEvent)
                .subscribe(event => this.run(() => this.onPaymentTransition(event))),
            this.eventBus
                .ofType(FulfillmentEvent)
                .subscribe(event => this.run(() => this.onFulfillmentCreated(event))),
            this.eventBus
                .ofType(FulfillmentStateTransitionEvent)
                .subscribe(event => this.run(() => this.onFulfillmentTransition(event))),
            this.eventBus
                .ofType(RefundStateTransitionEvent)
                .subscribe(event => this.run(() => this.onRefundTransition(event))),
            this.eventBus
                .ofType(StockMovementEvent)
                .subscribe(event => this.run(() => this.onStockMovement(event))),
            this.eventBus
                .ofType(AdminNotificationRequestedEvent)
                .subscribe(event => this.run(() => this.onRequestedNotification(event))),
        );
    }

    onApplicationShutdown(): void {
        for (const subscription of this.subscriptions) subscription.unsubscribe();
        this.subscriptions = [];
    }

    private async onOrderPlaced(event: OrderPlacedEvent): Promise<void> {
        const { order } = event;
        await this.notifications.enqueueOneOff(event.ctx, {
            eventType: 'commerce.order.placed',
            category: 'ORDER',
            severity: 'P3',
            sourceType: 'Order',
            sourceId: String(order.id),
            dedupKey: `commerce.order.placed:${order.id}`,
            title: `新订单 ${order.code}`,
            payload: orderPayload(event.ctx.channelId, order),
        });
    }

    private async onPaymentTransition(event: PaymentStateTransitionEvent): Promise<void> {
        const mapped = paymentEvent(event.toState, event.payment.errorMessage);
        if (!mapped) return;
        await this.notifications.enqueueOneOff(event.ctx, {
            eventType: mapped.eventType,
            category: 'PAYMENT',
            severity: mapped.severity,
            sourceType: 'Payment',
            sourceId: String(event.payment.id),
            dedupKey: `${mapped.eventType}:${event.payment.id}`,
            title: `${mapped.title} · 订单 ${event.order.code}`,
            payload: {
                ...orderPayload(event.ctx.channelId, event.order),
                paymentId: String(event.payment.id),
                paymentMethod: event.payment.method,
                amount: money(event.payment.amount, event.order.currencyCode),
                fromState: event.fromState,
                toState: event.toState,
                ...(event.payment.errorMessage ? { error: event.payment.errorMessage } : {}),
            },
        });
    }

    private async onFulfillmentCreated(event: FulfillmentEvent): Promise<void> {
        const orders = event.input?.orders ?? [];
        for (const order of orders) {
            await this.notifications.enqueueOneOff(event.ctx, {
                eventType: 'commerce.fulfillment.created',
                category: 'FULFILLMENT',
                severity: 'P2',
                sourceType: 'Fulfillment',
                sourceId: String(event.entity.id),
                dedupKey: `commerce.fulfillment.created:${event.entity.id}:${order.id}`,
                title: `订单 ${order.code} 已创建履约`,
                payload: {
                    ...orderPayload(event.ctx.channelId, order),
                    fulfillmentId: String(event.entity.id),
                    toState: event.entity.state,
                },
            });
        }
    }

    private async onFulfillmentTransition(event: FulfillmentStateTransitionEvent): Promise<void> {
        const mapped = fulfillmentEvent(event.toState);
        if (!mapped) return;
        const fulfillment = await this.connection.getEntityOrThrow(
            event.ctx,
            Fulfillment,
            event.fulfillment.id,
            {
                relations: ['orders'],
            },
        );
        for (const order of fulfillment.orders ?? []) {
            await this.notifications.enqueueOneOff(event.ctx, {
                eventType: mapped.eventType,
                category: 'FULFILLMENT',
                severity: mapped.severity,
                sourceType: 'Fulfillment',
                sourceId: String(fulfillment.id),
                dedupKey: `${mapped.eventType}:${fulfillment.id}:${order.id}`,
                title: `${mapped.title} · 订单 ${order.code}`,
                payload: {
                    ...orderPayload(event.ctx.channelId, order),
                    fulfillmentId: String(fulfillment.id),
                    fromState: event.fromState,
                    toState: event.toState,
                    ...(fulfillment.trackingCode ? { trackingCode: fulfillment.trackingCode } : {}),
                },
            });
        }
    }

    private async onRefundTransition(event: RefundStateTransitionEvent): Promise<void> {
        const mapped = refundEvent(event.toState);
        if (!mapped) return;
        await this.notifications.enqueueOneOff(event.ctx, {
            eventType: mapped.eventType,
            category: 'REFUND',
            severity: mapped.severity,
            sourceType: 'Refund',
            sourceId: String(event.refund.id),
            dedupKey: `${mapped.eventType}:${event.refund.id}`,
            title: `${mapped.title} · 订单 ${event.order.code}`,
            payload: {
                ...orderPayload(event.ctx.channelId, event.order),
                refundId: String(event.refund.id),
                amount: money(event.refund.total, event.order.currencyCode),
                paymentMethod: event.refund.method,
                fromState: event.fromState,
                toState: event.toState,
                ...(event.refund.reason ? { reason: event.refund.reason } : {}),
            },
        });
    }

    private async onStockMovement(event: StockMovementEvent): Promise<void> {
        const config = await this.configService.get();
        if (!config.enabled || !config.notifyInventoryEvents) return;
        const variantIds = [
            ...new Set(
                event.stockMovements.map(item => String(item.productVariant?.id ?? '')).filter(Boolean),
            ),
        ];
        for (const variantId of variantIds) {
            const variant = await this.connection.getEntityOrThrow(event.ctx, ProductVariant, variantId, {
                relations: ['product'],
            });
            const saleableStock = await this.productVariantService.getSaleableStockLevel(event.ctx, variant);
            if (saleableStock === Number.MAX_SAFE_INTEGER) continue;
            const fingerprint = `inventory.variant.low:${event.ctx.channelId}:${variant.id}`;
            if (saleableStock <= config.inventoryLowThreshold) {
                await this.notifications.upsertIncident(event.ctx, {
                    eventType: 'inventory.variant.low',
                    category: 'INVENTORY',
                    severity: saleableStock <= 0 ? 'P0' : 'P1',
                    sourceType: 'ProductVariant',
                    sourceId: String(variant.id),
                    fingerprint,
                    title: `${variant.sku} 可售库存不足`,
                    payload: {
                        channelId: String(event.ctx.channelId),
                        variantId: String(variant.id),
                        sku: variant.sku,
                        variantName: variant.name,
                        saleableStock,
                        threshold: config.inventoryLowThreshold,
                        adminPath: `/catalog/products/${variant.productId}`,
                    },
                });
            } else {
                await this.notifications.resolveIncident(event.ctx, fingerprint, {
                    saleableStock,
                    threshold: config.inventoryLowThreshold,
                });
            }
        }
    }

    private async onRequestedNotification(event: AdminNotificationRequestedEvent): Promise<void> {
        const { mode = 'ONE_OFF', ...notification } = event.notification;
        if (mode === 'INCIDENT_FIRING') {
            await this.notifications.upsertIncident(event.ctx, notification);
            return;
        }
        if (mode === 'INCIDENT_RESOLVED') {
            if (!notification.fingerprint) throw new Error('恢复事件必须提供 fingerprint');
            await this.notifications.resolveIncident(
                event.ctx,
                notification.fingerprint,
                notification.payload,
            );
            return;
        }
        await this.notifications.enqueueOneOff(event.ctx, notification);
    }

    private run(operation: () => Promise<void>): void {
        void operation().catch(error => {
            Logger.error(`通知事件写入失败：${safeError(error)}`, undefined, LOGGER_CTX);
        });
    }
}

function orderPayload(channelId: unknown, order: OrderPlacedEvent['order']) {
    return {
        channelId: String(channelId),
        orderId: String(order.id),
        orderCode: order.code,
        currencyCode: order.currencyCode,
        amount: money(order.totalWithTax, order.currencyCode),
        customerEmail: order.customer?.emailAddress ?? null,
        adminPath: `/sales/orders/${order.id}`,
    };
}

function paymentEvent(
    state: string,
    errorMessage?: string | null,
): { eventType: string; title: string; severity: NotificationSeverity } | null {
    if (state === 'Authorized')
        return { eventType: 'commerce.payment.authorized', title: '支付已授权', severity: 'P2' };
    if (state === 'Settled')
        return { eventType: 'commerce.payment.settled', title: '支付成功', severity: 'P2' };
    if (state === 'Declined' && /INVALID_USDT_PAYMENT_PROOF|凭证无效|凭证.*过期/iu.test(errorMessage ?? '')) {
        return {
            eventType: 'commerce.payment.proof_mismatch',
            title: '支付凭证完整性校验失败',
            severity: 'P0',
        };
    }
    if (state === 'Declined')
        return { eventType: 'commerce.payment.declined', title: '支付被拒绝', severity: 'P1' };
    if (state === 'Error')
        return { eventType: 'commerce.payment.failed', title: '支付处理失败', severity: 'P1' };
    if (state === 'Cancelled')
        return { eventType: 'commerce.payment.cancelled', title: '支付已取消', severity: 'P2' };
    return null;
}

function fulfillmentEvent(
    state: string,
): { eventType: string; title: string; severity: NotificationSeverity } | null {
    if (state === 'Shipped')
        return { eventType: 'commerce.fulfillment.shipped', title: '订单已发货', severity: 'P2' };
    if (state === 'Delivered')
        return { eventType: 'commerce.fulfillment.delivered', title: '订单已送达', severity: 'P2' };
    if (state === 'Cancelled')
        return { eventType: 'commerce.fulfillment.cancelled', title: '履约已取消', severity: 'P1' };
    return null;
}

function refundEvent(
    state: string,
): { eventType: string; title: string; severity: NotificationSeverity } | null {
    if (state === 'Pending')
        return { eventType: 'commerce.refund.pending', title: '退款处理中', severity: 'P1' };
    if (state === 'Settled')
        return { eventType: 'commerce.refund.settled', title: '退款完成', severity: 'P2' };
    if (state === 'Failed') return { eventType: 'commerce.refund.failed', title: '退款失败', severity: 'P1' };
    return null;
}

function money(amount: number, currencyCode: string): string {
    return `${(amount / 100).toFixed(2)} ${currencyCode}`;
}

function safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 500);
}
