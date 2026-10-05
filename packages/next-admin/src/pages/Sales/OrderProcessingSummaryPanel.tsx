import { AdminButton } from '../../components/AdminControls';
import { formatMoney, getDigitalNotificationLabel, type OrderProcessingSummary } from './sales-utils';

export function OrderProcessingSummaryPanel({
    summary,
    currencyCode,
    canOperate,
    busy,
    onAction,
}: {
    summary?: OrderProcessingSummary | null;
    currencyCode: string;
    canOperate: boolean;
    busy: boolean;
    onAction: (action: NonNullable<OrderProcessingSummary['nextAction']>) => void;
}) {
    if (!summary)
        return (
            <p role="status" className="rounded-lg bg-slate-100 p-4 text-sm text-slate-600">
                订单处理结果尚未取得，请刷新核实后操作。
            </p>
        );
    const action = summary.nextAction;
    return (
        <section aria-label="订单处理进度" className="space-y-4 rounded-xl bg-white p-4 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                        {summary.isTestOrder ? '模拟订单 · 无真实资金退款' : '本单处理进度'}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        {summary.blockedReason ||
                            action?.reason ||
                            (summary.needsProcessing
                                ? '按下一步处理本单，完成结果以服务端记录为准。'
                                : '当前没有需要人工处理的待办。')}
                    </p>
                </div>
                {action && (
                    <AdminButton
                        type="button"
                        disabled={!canOperate || !summary.canManage || !action.enabled || busy}
                        title={action.reason || summary.blockedReason || undefined}
                        onClick={() => onAction(action)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                    >
                        {action.label}
                    </AdminButton>
                )}
            </div>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                    ['付款', summary.paymentLabel],
                    ['交付', summary.fulfillmentLabel],
                    ['售后', summary.afterSalesLabel],
                    ['通知', getDigitalNotificationLabel(summary.lines)],
                ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-slate-50 p-3">
                        <dt className="text-xs text-slate-500">{label}</dt>
                        <dd className="mt-1 text-sm font-semibold text-slate-900">{value || '结果待核实'}</dd>
                    </div>
                ))}
            </dl>
            <p className="text-xs text-slate-500">
                实际已结算 {formatMoney(summary.settledAmount, currencyCode)} · 退款处理中{' '}
                {formatMoney(summary.pendingRefundAmount, currencyCode)} · 已成功退款{' '}
                {formatMoney(summary.refundedAmount, currencyCode)} · 可退{' '}
                {formatMoney(summary.refundableAmount, currencyCode)}
            </p>
            <p className="text-xs text-slate-500">
                邮件已送出表示发送渠道已接收；买家收件和实际领取需查看对应记录。
            </p>
        </section>
    );
}
