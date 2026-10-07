import { isControlledTestPaymentMethod } from '@vendure/common/lib/controlled-test-payment';
import { effectiveRefundLines, Order, OrderLine } from '@vendure/core';

/** Pending refunds suspend only their selected quantities; failed refunds restore access. */
export function digitalDeliverableQuantity(order: Order, line: OrderLine): number {
    if (
        order.active ||
        ['Cancelled', 'Modifying', 'ArrangingAdditionalPayment'].includes(order.state) ||
        line.quantity <= 0
    )
        return 0;
    if (
        !Array.isArray(order.payments) ||
        order.payments.some(
            payment =>
                isControlledTestPaymentMethod(payment.method) ||
                payment.metadata?.public?.testPayment === true ||
                !['Authorized', 'Settled', 'Declined', 'Cancelled'].includes(payment.state) ||
                payment.metadata?.manualReview?.required,
        )
    )
        return 0;
    const payments = order.payments.filter(
        payment =>
            payment.state === 'Settled' &&
            !payment.metadata?.public?.testPayment &&
            !payment.method?.startsWith('controlled-test-payment'),
    );
    if (!payments.length) return 0;
    const refunds = payments.flatMap(payment => payment.refunds ?? []);
    const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (Number.isFinite(order.totalWithTax) && paid < order.totalWithTax) return 0;
    const quantity = effectiveRefundLines(refunds)
        .filter(item => String(item.orderLineId) === String(line.id))
        .reduce((sum, item) => sum + item.quantity, 0);
    const placed = line.orderPlacedQuantity > 0 ? line.orderPlacedQuantity : line.quantity;
    return Math.max(0, Math.min(line.quantity, placed - quantity));
}
