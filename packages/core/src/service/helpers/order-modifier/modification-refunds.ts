import {
    AdministratorRefundInput,
    OrderLineInput,
    RefundOrderInput,
    RefundReasonType,
} from '@vendure/common/lib/generated-types';
import { createHash } from 'crypto';

import { UserInputError } from '../../../common/error/errors';
const quantityGroup = Symbol('trusted-modification-quantity-refund');
export interface ModificationQuantityRefundGroup {
    key?: string;
    anchor?: boolean;
    modificationKey?: string;
}
type GroupedInput = RefundOrderInput & { [quantityGroup]?: ModificationQuantityRefundGroup };
/** Only the internal modification builder can attach this symbol; API input cannot. */
export function modificationQuantityRefundGroup(input: RefundOrderInput) {
    return (input as GroupedInput)[quantityGroup];
}

/** A committed later edit has a different order version; a rolled-back retry keeps the same one. */
export function prepareModificationRefunds(
    sources: AdministratorRefundInput[],
    orderVersion: { id: string; updatedAt: Date; totalWithTax: number },
    note?: string | null,
): RefundOrderInput[] {
    return sources.map((source, index) => {
        const suppliedKey = source.idempotencyKey?.trim();
        if (suppliedKey != null && !/^[A-Za-z0-9:_-]{1,128}$/u.test(suppliedKey))
            throw new UserInputError('退款请求编号格式无效');
        const key =
            suppliedKey ??
            `modify:${createHash('sha256')
                .update(
                    JSON.stringify({
                        orderId: orderVersion.id,
                        updatedAt: orderVersion.updatedAt.toISOString(),
                        totalWithTax: orderVersion.totalWithTax,
                        paymentId: String(source.paymentId),
                        index,
                    }),
                )
                .digest('hex')}`;
        return {
            lines: [],
            adjustment: 0,
            shipping: 0,
            paymentId: source.paymentId,
            amount: source.amount,
            reason: source.reason || note || undefined,
            idempotencyKey: key,
            afterSalesId: source.afterSalesId,
        };
    });
}

function purposeRequestKey(sourceKey: string | null | undefined, purpose: string) {
    return sourceKey
        ? `modify:${createHash('sha256').update(`${sourceKey}:${purpose}`).digest('hex')}`
        : undefined;
}

/** Assemble independent refund purposes before calling any payment provider. */
export function buildModificationRefunds(
    refunds: RefundOrderInput[],
    amountToRefund: number,
    shippingReduction: number,
): RefundOrderInput[] {
    const sources = refunds.map(refund => ({
        ...refund,
        amount: refund.amount ?? (refunds.length === 1 ? amountToRefund : 0),
    }));
    if (
        sources.some(source => !Number.isSafeInteger(source.amount) || source.amount <= 0) ||
        sources.reduce((sum, source) => sum + source.amount, 0) !== amountToRefund
    ) {
        throw new UserInputError('退款分配总额必须等于本次订单减价金额');
    }
    const reduced = new Map<string, OrderLineInput>();
    // The old modifier copied the same quantity changes into every source.
    // They describe one order modification, so retain them once.
    for (const line of refunds[0]?.lines ?? []) {
        const id = String(line.orderLineId);
        const previous = reduced.get(id);
        reduced.set(id, {
            orderLineId: line.orderLineId,
            quantity: (previous?.quantity ?? 0) + line.quantity,
        });
    }
    const shippingAmount = Math.min(amountToRefund, Math.max(0, shippingReduction));
    const itemOrAdjustmentAmount = amountToRefund - shippingAmount;
    let itemSource =
        reduced.size && itemOrAdjustmentAmount > 0
            ? sources.findIndex(source => source.amount >= itemOrAdjustmentAmount)
            : -1;
    const splitItems = reduced.size > 0 && itemOrAdjustmentAmount > 0 && itemSource < 0;
    if (splitItems)
        itemSource = sources.reduce(
            (best, source, index) => (source.amount > sources[best].amount ? index : best),
            0,
        );
    const groupKey = splitItems
        ? `modify-items:${createHash('sha256')
              .update(
                  JSON.stringify(
                      sources.map(source => [source.paymentId, source.amount, source.idempotencyKey]),
                  ),
              )
              .digest('hex')}`
        : undefined;
    let shippingRemaining = shippingAmount;
    let itemsRemaining = reduced.size ? itemOrAdjustmentAmount : 0;
    const result: RefundOrderInput[] = [];
    const indexed = [...sources.entries()].sort(
        (a, b) => Number(b[0] === itemSource) - Number(a[0] === itemSource),
    );
    for (const [index, source] of indexed) {
        let available = source.amount;
        const base = { ...source, lines: [] as OrderLineInput[], shipping: 0, adjustment: 0 };
        if (itemsRemaining > 0 && (index === itemSource || splitItems)) {
            const itemAmount = Math.min(available, itemsRemaining);
            result.push({
                ...base,
                amount: itemAmount,
                reasonType: RefundReasonType.Items,
                lines: index === itemSource ? [...reduced.values()] : [],
                ...(groupKey ? { [quantityGroup]: { key: groupKey, anchor: index === itemSource } } : {}),
                idempotencyKey: purposeRequestKey(source.idempotencyKey, 'items'),
            });
            available -= itemAmount;
            itemsRemaining -= itemAmount;
        }
        const shipping = Math.min(available, shippingRemaining);
        if (shipping > 0) {
            result.push({
                ...base,
                amount: shipping,
                shipping,
                reasonType: RefundReasonType.Shipping,
                idempotencyKey: purposeRequestKey(source.idempotencyKey, 'shipping'),
            });
            shippingRemaining -= shipping;
            available -= shipping;
        }
        if (available > 0)
            result.push({
                ...base,
                amount: available,
                reasonType: RefundReasonType.Compensation,
                idempotencyKey: purposeRequestKey(source.idempotencyKey, 'compensation'),
            });
    }
    if (result.length > 1) {
        const modificationKey = `modify-refunds:${createHash('sha256')
            .update(
                JSON.stringify(
                    sources.map(source => [source.paymentId, source.amount, source.idempotencyKey]),
                ),
            )
            .digest('hex')}`;
        for (const request of result) {
            const grouped = request as GroupedInput;
            grouped[quantityGroup] = { ...grouped[quantityGroup], modificationKey };
        }
    }
    return result;
}
