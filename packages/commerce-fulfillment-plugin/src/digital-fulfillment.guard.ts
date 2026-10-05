import { isControlledTestPaymentMethod } from '@vendure/common/lib/controlled-test-payment';
import type { ID } from '@vendure/common/lib/shared-types';
import { effectiveRefundLines } from '@vendure/core';

export interface DigitalFulfillmentStatusMetadata {
    orderLineId: ID;
    eligibleQuantity: number;
    readyQuantity: number;
    state: string;
}

export interface DigitalFulfillmentLineSource {
    id: ID;
    quantity: number;
    orderPlacedQuantity: number;
    customFields?: { fulfillmentTypeSnapshot?: unknown; digitalDeliveryModeSnapshot?: unknown };
    productVariant?: { customFields?: { fulfillmentType?: unknown; digitalDeliveryMode?: unknown } };
}

export interface DigitalFulfillmentSource {
    id: ID;
    state: string;
    handlerCode: string;
    lines: ReadonlyArray<{ orderLineId: ID; quantity: number }>;
}

export interface DigitalFulfillmentOrderSource {
    active: boolean;
    orderPlacedAt?: Date | null;
    state: string;
    totalWithTax: number;
    lines: readonly DigitalFulfillmentLineSource[];
    payments?: ReadonlyArray<{
        state: string;
        amount: number;
        method: string;
        metadata?: { public?: { testPayment?: unknown } };
        refunds?: ReadonlyArray<{
            state: string;
            metadata?: Record<string, any>;
            lines?: ReadonlyArray<{ orderLineId: ID; quantity: number }>;
        }>;
    }>;
    fulfillments?: ReadonlyArray<{
        id: ID;
        state: string;
        lines?: ReadonlyArray<{ orderLineId: ID; quantity: number }>;
    }>;
}

export const DIGITAL_FULFILLMENT_HANDLER_BY_MODE = {
    file_download: 'digital-fulfillment',
    manual_service: 'manual-service-fulfillment',
    auto_card: 'auto-card-fulfillment',
} as const;

const PAID_ORDER_STATES = new Set([
    'PaymentSettled',
    'PartiallyShipped',
    'Shipped',
    'PartiallyDelivered',
    'Delivered',
]);
const RESERVED_FULFILLMENT_STATES = new Set(['Created', 'Pending', 'Shipped', 'Delivered']);
const isQuantity = (value: number) => Number.isSafeInteger(value) && value >= 0;
const isLoadedArray = <T>(value: readonly T[] | undefined): value is readonly T[] => Array.isArray(value);

/**
 * The caller must hold the order mutation lock and load both order and metadata after acquiring it.
 * Metadata is the private delivery services' projection, never client input or fulfillment metadata.
 * Ready counts published/assigned content; email success and customer claiming are separate concerns.
 */
export function guardDigitalFulfillment(
    order: DigitalFulfillmentOrderSource,
    current: DigitalFulfillmentSource,
    statuses: readonly DigitalFulfillmentStatusMetadata[],
    toState: 'Pending' | 'Delivered',
): string | void {
    if (order.state === 'Cancelled') return '订单已取消，停止数字交付';
    if (order.state === 'Modifying' || order.state === 'ArrangingAdditionalPayment')
        return '请先结束订单修改并完成补款，再处理数字交付';
    if (order.active || !order.orderPlacedAt || !PAID_ORDER_STATES.has(order.state))
        return '订单尚未完成实际付款，不能创建数字交付';
    if (
        !['Pending', 'Delivered'].includes(toState) ||
        !(toState === 'Pending' ? ['Created', 'Pending'] : ['Pending']).includes(current.state)
    )
        return '数字履约状态已变化，请刷新后重试';
    if (!isLoadedArray(order.payments)) return '订单收款记录未加载完整，请刷新后重试';
    const funding = order.payments.filter(
        payment =>
            payment.state === 'Settled' &&
            !isControlledTestPaymentMethod(payment.method) &&
            payment.metadata?.public?.testPayment !== true,
    );
    if (!funding.length)
        return order.payments.some(
            payment =>
                payment.state === 'Settled' &&
                (isControlledTestPaymentMethod(payment.method) ||
                    payment.metadata?.public?.testPayment === true),
        )
            ? '模拟付款不能用于真实数字交付'
            : '请先确认足额实际收款，再处理数字交付';
    if (!isQuantity(order.totalWithTax) || funding.some(payment => !isQuantity(payment.amount)))
        return '订单收款金额记录异常，请核对后再处理数字交付';
    const paid = funding.reduce((sum, payment) => sum + payment.amount, 0);
    if (!Number.isSafeInteger(paid) || paid < order.totalWithTax) return '订单实际收款金额不足，请先处理补款';
    if (funding.some(payment => !isLoadedArray(payment.refunds)))
        return '订单退款记录未加载完整，请刷新后重试';
    const refunds = funding.flatMap(payment => payment.refunds ?? []);
    const activeGroups = new Set(
        refunds
            .filter(refund => ['Pending', 'Settled'].includes(refund.state))
            .map(refund => refund.metadata?.refundRequest?.quantityGroup?.key)
            .filter(Boolean),
    );
    if (
        refunds.some(
            refund =>
                (['Pending', 'Settled'].includes(refund.state) ||
                    activeGroups.has(refund.metadata?.refundRequest?.quantityGroup?.key)) &&
                !isLoadedArray(refund.lines),
        )
    )
        return '订单退款份数记录未加载完整，请刷新后重试';
    if (!current.lines?.length) return '数字履约没有有效商品明细';
    if (!isLoadedArray(order.fulfillments)) return '订单履约占用记录未加载完整，请刷新后重试';

    const requested = new Map<string, number>();
    const sourceLines = new Map<string, DigitalFulfillmentLineSource>();
    for (const item of current.lines) {
        if (!isQuantity(item.quantity) || item.quantity === 0) return '数字交付份数必须是正整数';
        const key = String(item.orderLineId);
        const matches = order.lines.filter(lineValue => String(lineValue.id) === key);
        if (matches.length !== 1) return '数字履约明细不属于该订单，请核对订单归属';
        const line = matches[0];
        const type =
            line.customFields?.fulfillmentTypeSnapshot ?? line.productVariant?.customFields?.fulfillmentType;
        if (type !== 'digital') return '实物明细或缺少交付类型的明细不能使用数字履约';
        const mode =
            line.customFields?.digitalDeliveryModeSnapshot ??
            line.productVariant?.customFields?.digitalDeliveryMode;
        const handler =
            typeof mode === 'string' &&
            Object.prototype.hasOwnProperty.call(DIGITAL_FULFILLMENT_HANDLER_BY_MODE, mode)
                ? DIGITAL_FULFILLMENT_HANDLER_BY_MODE[
                      mode as keyof typeof DIGITAL_FULFILLMENT_HANDLER_BY_MODE
                  ]
                : undefined;
        if (!handler) return '商品缺少有效数字交付方式，请核对后再处理';
        if (handler !== current.handlerCode) return '数字履约处理器与商品交付方式不匹配，请使用对应交付流程';
        const quantity = (requested.get(key) ?? 0) + item.quantity;
        if (!Number.isSafeInteger(quantity)) return '数字交付合计份数无效';
        requested.set(key, quantity);
        sourceLines.set(key, line);
    }

    for (const [key, quantity] of requested) {
        const line = sourceLines.get(key);
        if (!line) return '数字履约明细未加载完整，请刷新后重试';
        if (!isQuantity(line.quantity) || !isQuantity(line.orderPlacedQuantity))
            return '历史订单缺少有效商品数量，请核对后再处理数字交付';
        const refundedLines = effectiveRefundLines(refunds).filter(item => String(item.orderLineId) === key);
        if (refundedLines.some(item => !isQuantity(item.quantity) || item.quantity === 0))
            return '退款份数记录异常，请核对后再处理数字交付';
        const refunded = refundedLines.reduce((sum, item) => sum + item.quantity, 0);
        if (!Number.isSafeInteger(refunded)) return '退款合计份数记录异常，请核对后再处理数字交付';
        const eligible = Math.max(
            0,
            Math.min(line.quantity, (line.orderPlacedQuantity || line.quantity) - refunded),
        );
        const metadata = statuses.filter(statusValue => String(statusValue.orderLineId) === key);
        if (metadata.length !== 1) return '数字交付成品记录缺失或重复，请先通过对应数字交付流程准备成品';
        const status = metadata[0];
        if (!isQuantity(status.eligibleQuantity) || status.eligibleQuantity !== eligible)
            return '数字交付资格已变化，请刷新并核对退款份数';
        if (!isQuantity(status.readyQuantity) || status.readyQuantity > eligible)
            return '数字交付成品份数记录异常，请核对后再处理';
        if (status.state !== 'READY' || status.readyQuantity === 0)
            return '数字商品成品尚未准备好，不能标记为已履约';
        let reserved = 0;
        for (const other of order.fulfillments) {
            if (String(other.id) === String(current.id) || other.state === 'Cancelled') continue;
            if (!isLoadedArray(other.lines)) return '其它履约份数记录未加载完整，请刷新后重试';
            const references = other.lines.filter(item => String(item.orderLineId) === key);
            if (references.length && !RESERVED_FULFILLMENT_STATES.has(other.state))
                return '其它履约状态异常，请核对后再处理数字交付';
            if (references.some(item => !isQuantity(item.quantity) || item.quantity === 0))
                return '其它履约份数记录异常，请核对后再处理数字交付';
            reserved += references.reduce((sum, item) => sum + item.quantity, 0);
            if (!Number.isSafeInteger(reserved)) return '其它履约合计份数记录异常';
        }
        if (quantity > Math.max(0, status.readyQuantity - reserved))
            return '数字交付份数超过有效成品剩余份数，请核对退款和已有履约记录';
    }
}
