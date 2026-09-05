import { useMutation, useQuery } from '@apollo/client/react';
import { AlertCircle, Calculator, Check, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';

import {
    CATALOG_ORDER_PROFIT_EXPENSE_QUERY,
    SAVE_CATALOG_ORDER_PROFIT_EXPENSE_MUTATION,
    type CatalogOrderProfitExpenseQueryResult,
    type CatalogOrderProfitExpenseRecord,
} from '../../graphql/catalog-operations.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { expenseInputToMicrounits, expenseMicrounitsToInput } from './order-profit-expense';

interface SaveResult {
    saveCatalogOrderProfitExpense: CatalogOrderProfitExpenseRecord;
}

export function OrderProfitExpensePanel({
    orderId,
    currencyCode,
    canRead,
    canUpdate,
}: {
    orderId: string;
    currencyCode: string;
    canRead: boolean;
    canUpdate: boolean;
}) {
    const query = useQuery<CatalogOrderProfitExpenseQueryResult>(CATALOG_ORDER_PROFIT_EXPENSE_QUERY, {
        variables: { orderId },
        skip: !canRead,
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [saveExpense, saveState] = useMutation<SaveResult>(SAVE_CATALOG_ORDER_PROFIT_EXPENSE_MUTATION);
    const [carrierCost, setCarrierCost] = useState('');
    const [paymentFee, setPaymentFee] = useState('');
    const [note, setNote] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const expense = query.data?.catalogOrderProfitExpense;

    /* oxlint-disable react/set-state-in-effect -- query data initializes the editable expense draft. */
    useEffect(() => {
        if (!query.data) return;
        setCarrierCost(expenseMicrounitsToInput(expense?.carrierShippingCostMicrounits));
        setPaymentFee(expenseMicrounitsToInput(expense?.paymentFeeMicrounits));
        setNote(expense?.note ?? '');
    }, [expense, query.data]);
    /* oxlint-enable react/set-state-in-effect */

    const handleSave = async () => {
        setError('');
        setMessage('');
        try {
            const response = await saveExpense({
                variables: {
                    input: {
                        orderId,
                        carrierShippingCostMicrounits: expenseInputToMicrounits(
                            carrierCost,
                            '承运商实际物流成本',
                        ),
                        paymentFeeMicrounits: expenseInputToMicrounits(paymentFee, '支付手续费'),
                        note: note.trim() || null,
                        expectedUpdatedAt: expense?.updatedAt ?? null,
                    },
                },
            });
            const saved = response.data?.saveCatalogOrderProfitExpense;
            if (!saved) throw new Error('后端未返回费用记录');
            await query.refetch();
            setMessage('经营费用已保存，利润报表将重新核算');
        } catch (mutationError) {
            setError(toUserFacingError(mutationError, '经营费用保存失败'));
        }
    };

    return (
        <section className="rounded-xl border border-emerald-200 bg-white p-5 shadow-2xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Calculator className="h-4 w-4 text-emerald-600" />
                        订单经营费用
                        <FeatureHelpButton topic="sales.order-expenses" title="订单经营费用" />
                    </h2>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">
                        录入财务实际发生额。没有费用时请明确填 0；留空代表尚未核算，不会生成假净利润。
                    </p>
                </div>
                {expense && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                        {expense.source === 'IMPORT' ? '批量导入' : '人工录入'} ·{' '}
                        {new Date(expense.updatedAt).toLocaleString('zh-CN')}
                    </span>
                )}
            </div>

            {!canRead ? (
                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                    当前账号没有查看成本与利润的权限。
                </div>
            ) : query.loading && !query.data ? (
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> 正在读取经营费用
                </div>
            ) : query.error ? (
                <div
                    role="alert"
                    className="mt-4 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700"
                >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {toUserFacingError(query.error, '经营费用加载失败')}
                </div>
            ) : (
                <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <ExpenseField
                            label="承运商实际物流成本"
                            value={carrierCost}
                            currencyCode={currencyCode}
                            disabled={!canUpdate || saveState.loading}
                            onChange={setCarrierCost}
                        />
                        <ExpenseField
                            label="支付手续费"
                            value={paymentFee}
                            currencyCode={currencyCode}
                            disabled={!canUpdate || saveState.loading}
                            onChange={setPaymentFee}
                        />
                    </div>
                    <label className="mt-3 block text-[11px] font-semibold text-slate-600">
                        <span>财务备注</span>
                        <textarea
                            value={note}
                            onChange={event => setNote(event.target.value)}
                            disabled={!canUpdate || saveState.loading}
                            maxLength={500}
                            rows={2}
                            placeholder="例：对账单批次、承运商单号或手续费依据"
                            className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
                        />
                    </label>
                    {error && (
                        <div role="alert" className="mt-3 text-xs font-semibold text-rose-600">
                            {error}
                        </div>
                    )}
                    {message && (
                        <div
                            role="status"
                            className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-emerald-700"
                        >
                            <Check className="h-3.5 w-3.5" /> {message}
                        </div>
                    )}
                    {canUpdate && (
                        <div className="mt-4 flex justify-end">
                            <button
                                type="button"
                                onClick={() => void handleSave()}
                                disabled={saveState.loading}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                                {saveState.loading ? (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Save className="h-3.5 w-3.5" />
                                )}
                                保存经营费用
                            </button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

function ExpenseField({
    label,
    value,
    currencyCode,
    disabled,
    onChange,
}: {
    label: string;
    value: string;
    currencyCode: string;
    disabled: boolean;
    onChange: (value: string) => void;
}) {
    return (
        <label className="text-[11px] font-semibold text-slate-600">
            <span>{label}</span>
            <div className="mt-1 flex overflow-hidden rounded-lg border border-slate-300 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100">
                <span className="flex items-center border-r border-slate-200 bg-slate-50 px-2.5 font-mono text-[10px] text-slate-500">
                    {currencyCode}
                </span>
                <input
                    inputMode="decimal"
                    value={value}
                    onChange={event => onChange(event.target.value)}
                    disabled={disabled}
                    placeholder="未核算；0 元请填 0"
                    className="min-w-0 flex-1 px-3 py-2 font-mono text-xs outline-none disabled:bg-slate-50"
                />
            </div>
        </label>
    );
}
