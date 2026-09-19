import { Order } from './types';

export interface UsdtPaymentReceipt {
    amount: number;
    network: string;
    transactionId: string | null;
}

export function usdtPaymentReceipt(order: Pick<Order, 'payments'>): UsdtPaymentReceipt | null {
    const payment = order.payments?.find(
        item => item.method === 'usdt-trc20' && (item.state === 'Settled' || item.state === 'Authorized'),
    );
    if (!payment || !payment.metadata || typeof payment.metadata !== 'object') return null;
    const publicMetadata = (payment.metadata as Record<string, unknown>).public;
    if (!publicMetadata || typeof publicMetadata !== 'object') return null;
    const metadata = publicMetadata as Record<string, unknown>;
    const amount = metadata.usdtAmount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
    return {
        amount,
        network: typeof metadata.network === 'string' ? metadata.network : 'TRC20',
        transactionId:
            typeof metadata.transactionId === 'string'
                ? metadata.transactionId
                : payment.transactionId?.replace(/^tron:/, '') || null,
    };
}

export function formatUsdtPaymentAmount(receipt: UsdtPaymentReceipt): string {
    return `₮${receipt.amount.toFixed(6)}`;
}
