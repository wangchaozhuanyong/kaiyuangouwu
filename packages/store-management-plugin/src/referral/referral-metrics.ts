export const REFERRAL_METRIC_SETTLED_ORDER_STATES = [
    'PaymentSettled',
    'PartiallyShipped',
    'Shipped',
    'PartiallyDelivered',
    'Delivered',
] as const;

interface MetricRefund {
    state: string;
    total: number;
}

interface MetricPayment {
    state: string;
    amount: number;
    refunds?: MetricRefund[];
}

interface MetricOrder {
    totalWithTax: number;
    payments?: MetricPayment[];
}

export function settledOrderNetTotal(order: MetricOrder): number {
    const settledPayments = (order.payments ?? []).filter(payment => payment.state === 'Settled');
    const settledPaymentTotal = settledPayments.reduce((total, payment) => total + payment.amount, 0);
    if (settledPaymentTotal < order.totalWithTax) return 0;
    const settledRefundTotal = settledPayments
        .flatMap(payment => payment.refunds ?? [])
        .filter(refund => refund.state === 'Settled')
        .reduce((total, refund) => total + refund.total, 0);
    return Math.max(0, Math.min(order.totalWithTax, settledPaymentTotal) - settledRefundTotal);
}
