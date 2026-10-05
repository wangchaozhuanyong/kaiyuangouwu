import { AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { type OrderProcessingSummary } from './sales-utils';

export type OrderRefundScope = 'ITEMS' | 'SHIPPING' | 'COMPENSATION';

export function OrderRefundScopeFields({
    summary,
    scope,
    quantities,
    onScopeChange,
    onQuantityChange,
}: {
    summary: OrderProcessingSummary;
    scope: OrderRefundScope;
    quantities: Record<string, number>;
    onScopeChange: (scope: OrderRefundScope) => void;
    onQuantityChange: (lineId: string, quantity: number) => void;
}) {
    return (
        <div className="space-y-3">
            <AdminField className="block text-xs font-semibold text-slate-700" label={<>退款用途</>}>
                {' '}
                <AdminSelect
                    value={scope}
                    onChange={event => onScopeChange(event.target.value as OrderRefundScope)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm"
                >
                    <option value="ITEMS">按商品份数退款</option>
                    {summary.kind !== 'DIGITAL' && summary.refundableShippingAmount > 0 && (
                        <option value="SHIPPING">实物运费退款</option>
                    )}
                    <option value="COMPENSATION">金额补偿（保留商品交付）</option>
                </AdminSelect>
            </AdminField>
            {scope === 'ITEMS' && (
                <fieldset className="space-y-2">
                    <legend className="mb-2 text-xs font-semibold text-slate-700">选择退款商品与份数</legend>
                    {summary.lines
                        .filter(line => line.refundableQuantity > 0)
                        .map(line => (
                            <AdminField
                                key={line.orderLineId}
                                className="flex items-center justify-between gap-3 text-xs text-slate-700"
                                label={
                                    <>
                                        <span>
                                            {line.productName} · 最多 {line.refundableQuantity} 份
                                        </span>
                                    </>
                                }
                            >
                                {' '}
                                <AdminInput
                                    aria-label={`${line.productName}退款份数`}
                                    type="number"
                                    min={0}
                                    max={line.refundableQuantity}
                                    step={1}
                                    value={quantities[line.orderLineId] ?? 0}
                                    onChange={event =>
                                        onQuantityChange(line.orderLineId, Number(event.target.value))
                                    }
                                    className="w-20 rounded-lg border border-slate-300 px-2 py-2"
                                />
                            </AdminField>
                        ))}
                    {!summary.lines.some(line => line.refundableQuantity > 0) && (
                        <p className="text-xs text-slate-500">
                            没有可按份数退款的商品，请核实记录或选择金额补偿。
                        </p>
                    )}
                    <p className="text-xs text-slate-500">
                        退款中的对应份数暂停交付，退款成功后失效；实际退款金额在下方填写。
                    </p>
                </fieldset>
            )}
            {scope === 'SHIPPING' && (
                <p className="text-xs text-slate-500">只退本单实物运费，不撤销商品交付权益。</p>
            )}
            {scope === 'COMPENSATION' && (
                <p className="text-xs text-slate-500">金额补偿不减少商品份数，也不撤销已发布交付内容。</p>
            )}
        </div>
    );
}
