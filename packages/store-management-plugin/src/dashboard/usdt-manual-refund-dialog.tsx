import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    Textarea,
    api,
    toast,
    useMutation,
} from '@vendure/dashboard';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import {
    RecordStoreUsdtManualRefundResult,
    StorePaymentDetailRecord,
    StoreUsdtManualRefundMutationInput,
    StoreUsdtManualRefundRecord,
    recordStoreUsdtManualRefundMutation,
} from './store-currency.graphql';

const TRON_TRANSACTION_PATTERN = /^[a-fA-F0-9]{64}$/u;
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;

export function UsdtManualRefundDialog({
    payment,
    onRecorded,
}: {
    payment: StorePaymentDetailRecord;
    onRecorded: () => void | Promise<void>;
}) {
    const remainingAmount = Math.max(0, payment.amount - payment.refundedAmount);
    const [open, setOpen] = useState(false);
    const [fiatAmount, setFiatAmount] = useState(formatMajorInput(remainingAmount));
    const [usdtAmount, setUsdtAmount] = useState('');
    const [recipientAddress, setRecipientAddress] = useState('');
    const [transactionId, setTransactionId] = useState('');
    const [reason, setReason] = useState('');
    const mutation = useMutation({
        mutationFn: (input: StoreUsdtManualRefundMutationInput) =>
            api.mutate<RecordStoreUsdtManualRefundResult>(recordStoreUsdtManualRefundMutation, { input }),
        onSuccess: async result => {
            toast.success(
                `退款已登记：${formatMoney(result.recordStoreUsdtManualRefund.currencyCode, result.recordStoreUsdtManualRefund.amount)}`,
            );
            setOpen(false);
            resetForm(
                remainingAmount,
                setFiatAmount,
                setUsdtAmount,
                setRecipientAddress,
                setTransactionId,
                setReason,
            );
            await onRecorded();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const available =
        payment.paymentMethodCode === 'usdt-trc20' &&
        payment.paymentState === 'Settled' &&
        remainingAmount > 0;

    const submit = () => {
        const amount = parseMajorMoney(fiatAmount);
        if (!amount || amount > remainingAmount) {
            toast.error(
                `退款金额必须大于 0，且不能超过 ${formatMoney(payment.currencyCode, remainingAmount)}`,
            );
            return;
        }
        const normalizedUsdt = usdtAmount.trim();
        if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/u.test(normalizedUsdt) || Number(normalizedUsdt) <= 0) {
            toast.error('实际退款 USDT 必须大于 0，且最多保留 6 位小数');
            return;
        }
        const normalizedTransaction = transactionId.trim();
        const normalizedRecipient = recipientAddress.trim();
        if (!TRON_ADDRESS_PATTERN.test(normalizedRecipient)) {
            toast.error('请输入客户实际收到退款的 TRON 主网地址');
            return;
        }
        if (!TRON_TRANSACTION_PATTERN.test(normalizedTransaction)) {
            toast.error('请输入 64 位 TRON 交易哈希');
            return;
        }
        const normalizedReason = reason.trim();
        if (normalizedReason.length < 2) {
            toast.error('请填写至少 2 个字符的退款原因');
            return;
        }
        mutation.mutate({
            paymentId: payment.id,
            amount,
            usdtAmount: normalizedUsdt,
            recipientAddress: normalizedRecipient,
            transactionId: normalizedTransaction,
            reason: normalizedReason,
        });
    };

    return (
        <>
            <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!available}
                onClick={() => {
                    setFiatAmount(formatMajorInput(remainingAmount));
                    setOpen(true);
                }}
            >
                <RotateCcw className="size-4" />
                {remainingAmount > 0 ? '登记 USDT 退款' : '已全额退款'}
            </Button>
            <Dialog open={open} onOpenChange={nextOpen => !mutation.isPending && setOpen(nextOpen)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>登记 USDT 人工退款</DialogTitle>
                        <DialogDescription>
                            仅在链上退款已经成功后登记。系统会核验官方 USDT 转账、数量、付款与收款 地址，并在
                            Vendure 中建立已结算退款；保存后将立即扣减收款统计。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="rounded-lg bg-muted/40 p-3 text-sm">
                            <strong>订单 {payment.orderCode}</strong>
                            <p className="mb-0 mt-1 text-muted-foreground">
                                支付 {formatMoney(payment.currencyCode, payment.amount)} · 已退{' '}
                                {formatMoney(payment.currencyCode, payment.refundedAmount)} · 可退{' '}
                                {formatMoney(payment.currencyCode, remainingAmount)}
                            </p>
                        </div>
                        <RefundField
                            id={`refund-fiat-${payment.id}`}
                            label={`原订单退款金额（${payment.currencyCode}）`}
                        >
                            <Input
                                id={`refund-fiat-${payment.id}`}
                                type="number"
                                min="0.01"
                                max={(remainingAmount / 100).toFixed(2)}
                                step="0.01"
                                value={fiatAmount}
                                onChange={event => setFiatAmount(event.target.value)}
                            />
                        </RefundField>
                        <RefundField id={`refund-usdt-${payment.id}`} label="实际转出 USDT 数量">
                            <Input
                                id={`refund-usdt-${payment.id}`}
                                type="number"
                                min="0.000001"
                                step="0.000001"
                                placeholder="例如 12.345678"
                                value={usdtAmount}
                                onChange={event => setUsdtAmount(event.target.value)}
                            />
                        </RefundField>
                        <RefundField id={`refund-tx-${payment.id}`} label="TRON 退款交易哈希">
                            <Input
                                id={`refund-tx-${payment.id}`}
                                autoComplete="off"
                                spellCheck={false}
                                maxLength={64}
                                placeholder="64 位交易哈希"
                                value={transactionId}
                                onChange={event => setTransactionId(event.target.value)}
                            />
                        </RefundField>
                        <RefundField id={`refund-recipient-${payment.id}`} label="客户退款收款地址">
                            <Input
                                id={`refund-recipient-${payment.id}`}
                                autoComplete="off"
                                spellCheck={false}
                                maxLength={34}
                                placeholder="T..."
                                value={recipientAddress}
                                onChange={event => setRecipientAddress(event.target.value)}
                            />
                        </RefundField>
                        <RefundField id={`refund-reason-${payment.id}`} label="退款原因">
                            <Textarea
                                id={`refund-reason-${payment.id}`}
                                rows={3}
                                maxLength={500}
                                placeholder="说明退款原因和人工核对情况"
                                value={reason}
                                onChange={event => setReason(event.target.value)}
                            />
                        </RefundField>
                        <p className="mb-0 text-xs leading-5 text-muted-foreground">
                            系统会验证官方 USDT 合约的 Transfer 事件、准确数量、客户收款地址，以及
                            平台审核过的退款付款钱包。此页面只登记已完成的链上转账，不持有私钥。
                        </p>
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={mutation.isPending}
                            onClick={() => setOpen(false)}
                        >
                            取消
                        </Button>
                        <Button type="button" disabled={mutation.isPending} onClick={submit}>
                            {mutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            确认登记已退款
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export function UsdtManualRefundList({ refunds }: { refunds: StoreUsdtManualRefundRecord[] }) {
    if (!refunds.length) {
        return <p className="text-sm text-muted-foreground">暂无已登记的 USDT 人工退款。</p>;
    }
    return (
        <div className="grid max-h-[32rem] gap-3 overflow-y-auto pr-1">
            {refunds.map(refund => (
                <article key={refund.id} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto]">
                    <div className="min-w-0 space-y-1 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <strong>
                                {refund.channelCode} · 订单 {refund.orderCode}
                            </strong>
                            <Badge>{refund.state === 'Settled' ? '已结算退款' : refund.state}</Badge>
                            <Badge variant="outline">{refund.network}</Badge>
                        </div>
                        <p className="break-all text-muted-foreground">退款交易：{refund.transactionId}</p>
                        <p className="break-all text-muted-foreground">
                            付款：{refund.fromAddress} · 收款：{refund.toAddress}
                        </p>
                        <p className="text-muted-foreground">
                            区块 {refund.blockNumber} · 操作人用户 ID {refund.operatorUserId}
                        </p>
                        <p className="text-muted-foreground">原因：{refund.reason}</p>
                        <p className="text-xs text-muted-foreground">
                            退款 ID {refund.id} · 支付 ID {refund.paymentId} · {formatDate(refund.createdAt)}
                        </p>
                    </div>
                    <div className="text-left sm:text-right">
                        <strong className="block text-lg tabular-nums">₮{refund.usdtAmount}</strong>
                        <span className="text-sm text-muted-foreground">
                            {formatMoney(refund.currencyCode, refund.amount)}
                        </span>
                    </div>
                </article>
            ))}
        </div>
    );
}

function RefundField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <Label htmlFor={id}>{label}</Label>
            {children}
        </div>
    );
}

function parseMajorMoney(value: string): number | null {
    const normalized = value.trim();
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/u.test(normalized)) return null;
    const amount = Math.round(Number(normalized) * 100);
    return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function formatMajorInput(amount: number): string {
    return (amount / 100).toFixed(2);
}

function resetForm(
    remainingAmount: number,
    setFiatAmount: (value: string) => void,
    setUsdtAmount: (value: string) => void,
    setRecipientAddress: (value: string) => void,
    setTransactionId: (value: string) => void,
    setReason: (value: string) => void,
): void {
    setFiatAmount(formatMajorInput(remainingAmount));
    setUsdtAmount('');
    setRecipientAddress('');
    setTransactionId('');
    setReason('');
}

function formatMoney(currencyCode: string, amount: number): string {
    return `${currencyCode} ${(amount / 100).toFixed(2)}`;
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(new Date(value));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
