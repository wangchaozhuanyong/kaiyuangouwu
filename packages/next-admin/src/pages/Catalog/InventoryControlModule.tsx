import { useMutation, useQuery } from '@apollo/client/react';
import { AlertTriangle, RefreshCw, Scale, X } from 'lucide-react';
import { useState } from 'react';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    CATALOG_INVENTORY_OPERATIONS_QUERY,
    CATALOG_INVENTORY_RECONCILIATION_QUERY,
    RESOLVE_CATALOG_INVENTORY_RECONCILIATION_MUTATION,
    type CatalogInventoryOperationRecord,
    type CatalogInventoryReconciliationRecord,
} from '../../graphql/catalog-operations.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';

const PAGE_SIZE = 50;
const operationLabels: Record<string, string> = {
    MANUAL_LOT_COUNT: '批次盘点',
    LEGACY_STOCK_ADJUSTMENT: '总库存盘点',
    LOT_TRANSFER: '批次转仓',
    RECONCILIATION: '差异处理',
};

interface ResolutionDraft {
    item: CatalogInventoryReconciliationRecord;
    mode: 'ALIGN_STOCK_TO_LOTS' | 'CREATE_BASELINE_LOT';
    reason: string;
}

export function InventoryControlModule() {
    const [page, setPage] = useState(0);
    const [draft, setDraft] = useState<ResolutionDraft | null>(null);
    const [error, setError] = useState('');
    const reconciliation = useQuery<{
        catalogInventoryReconciliation: {
            items: CatalogInventoryReconciliationRecord[];
            totalItems: number;
        };
    }>(CATALOG_INVENTORY_RECONCILIATION_QUERY, { fetchPolicy: 'cache-and-network' });
    const operations = useQuery<{
        catalogInventoryOperations: { items: CatalogInventoryOperationRecord[]; totalItems: number };
    }>(CATALOG_INVENTORY_OPERATIONS_QUERY, {
        variables: { skip: page * PAGE_SIZE, take: PAGE_SIZE },
        fetchPolicy: 'cache-and-network',
    });
    const [resolve, resolveState] = useMutation(RESOLVE_CATALOG_INVENTORY_RECONCILIATION_MUTATION);
    const differences = reconciliation.data?.catalogInventoryReconciliation.items ?? [];
    const ledger = operations.data?.catalogInventoryOperations.items ?? [];
    const ledgerTotal = operations.data?.catalogInventoryOperations.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(ledgerTotal / PAGE_SIZE));
    const refresh = () => void Promise.all([reconciliation.refetch(), operations.refetch()]);
    const submit = async () => {
        if (!draft?.reason.trim()) return;
        setError('');
        try {
            await resolve({
                variables: {
                    input: {
                        productVariantId: draft.item.productVariantId,
                        stockLocationId: draft.item.stockLocationId,
                        expectedDifference: draft.item.difference,
                        mode: draft.mode,
                        idempotencyKey: crypto.randomUUID(),
                        reason: draft.reason.trim(),
                    },
                },
            });
            setDraft(null);
            await Promise.all([reconciliation.refetch(), operations.refetch()]);
        } catch (cause) {
            setError(toUserFacingError(cause, '库存差异处理失败'));
        }
    };
    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Scale className="h-5 w-5 text-blue-600" /> 库存控制台
                            <FeatureHelpButton topic="catalog.inventory" title="库存控制台" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            对齐批次总数与平台库存，查看手工盘点、转仓与差异处理证据。
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label="刷新库存控制台"
                        onClick={refresh}
                        className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600"
                    >
                        <RefreshCw
                            className={`h-4 w-4 ${reconciliation.loading || operations.loading ? 'animate-spin' : ''}`}
                        />
                    </button>
                </div>
            </header>
            <main className="flex-1 space-y-5 overflow-auto p-5 sm:p-8">
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-100 p-4">
                        <h2 className="flex items-center gap-2 text-sm font-bold">
                            批次与总库存对账
                            <FeatureHelpButton topic="catalog.inventory" title="库存对账" />
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                            处理前会再次校验差异，避免用旧数据覆盖新库存。
                        </p>
                    </div>
                    {reconciliation.loading && !reconciliation.data ? (
                        <State label="正在对账…" />
                    ) : reconciliation.error ? (
                        <State label="对账加载失败" error />
                    ) : differences.length === 0 ? (
                        <State label="当前批次数量与平台库存一致" />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-left text-xs">
                                <thead className="bg-slate-50">
                                    <tr>
                                        {['SKU', '仓库', '批次合计', '总库存', '差异', '操作'].map(label => (
                                            <th key={label} className="px-4 py-3">
                                                {label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {differences.map(item => (
                                        <tr key={item.id}>
                                            <td className="px-4 py-3">
                                                <strong>{item.variantName}</strong>
                                                <small className="ml-2 font-mono">{item.sku}</small>
                                            </td>
                                            <td className="px-4 py-3">{item.stockLocationName}</td>
                                            <td className="px-4 py-3">{item.lotQuantity}</td>
                                            <td className="px-4 py-3">{item.stockOnHand}</td>
                                            <td className="px-4 py-3 font-bold text-rose-700">
                                                {signed(item.difference)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setError('');
                                                        setDraft({
                                                            item,
                                                            mode: item.canCreateBaselineLot
                                                                ? 'CREATE_BASELINE_LOT'
                                                                : 'ALIGN_STOCK_TO_LOTS',
                                                            reason: '',
                                                        });
                                                    }}
                                                    className="font-bold text-blue-700"
                                                >
                                                    处理差异
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-100 p-4">
                        <h2 className="flex items-center gap-2 text-sm font-bold">
                            库存审计流水
                            <FeatureHelpButton topic="catalog.inventory" title="库存审计流水" />
                        </h2>
                    </div>
                    {operations.loading && !operations.data ? (
                        <State label="正在读取流水…" />
                    ) : operations.error ? (
                        <State label="库存流水加载失败" error />
                    ) : ledger.length === 0 ? (
                        <State label="暂无手工库存操作流水" />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[980px] text-left text-xs">
                                <thead className="bg-slate-50">
                                    <tr>
                                        {['流水', '类型', 'SKU / 仓库', '数量变化', '原因', '时间'].map(
                                            label => (
                                                <th key={label} className="px-4 py-3">
                                                    {label}
                                                </th>
                                            ),
                                        )}
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {ledger.map(operation => (
                                        <tr key={operation.id}>
                                            <td className="px-4 py-3 font-mono">{operation.code}</td>
                                            <td className="px-4 py-3">
                                                {operationLabels[operation.type] ?? operation.type}
                                            </td>
                                            <td className="px-4 py-3">
                                                {operation.lines.map(line => (
                                                    <div key={line.id}>
                                                        {line.variant.sku} · {line.stockLocation.name}
                                                        {line.inventoryLot
                                                            ? ` · ${line.inventoryLot.lotCode}`
                                                            : ''}
                                                    </div>
                                                ))}
                                            </td>
                                            <td className="px-4 py-3 font-mono">
                                                {operation.lines.map(line => (
                                                    <div key={line.id}>{signed(line.quantityDelta)}</div>
                                                ))}
                                            </td>
                                            <td className="max-w-sm px-4 py-3">{operation.reason}</td>
                                            <td className="px-4 py-3">
                                                {new Date(operation.postedAt).toLocaleString('zh-CN')}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div className="flex items-center justify-end gap-2 border-t px-4 py-3 text-xs">
                        <button
                            type="button"
                            disabled={page === 0}
                            onClick={() => setPage(value => value - 1)}
                            className="rounded border px-3 py-1.5 disabled:opacity-30"
                        >
                            上一页
                        </button>
                        <span>
                            {page + 1} / {totalPages}
                        </span>
                        <button
                            type="button"
                            disabled={page + 1 >= totalPages}
                            onClick={() => setPage(value => value + 1)}
                            className="rounded border px-3 py-1.5 disabled:opacity-30"
                        >
                            下一页
                        </button>
                    </div>
                </section>
            </main>
            {draft && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
                    onClick={() => !resolveState.loading && setDraft(null)}
                >
                    <AccessibleDialogSurface
                        accessibleName="处理库存差异"
                        onRequestClose={() => setDraft(null)}
                        onClick={event => event.stopPropagation()}
                        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
                    >
                        <div className="flex items-center justify-between border-b pb-3">
                            <h2 className="flex items-center gap-2 text-base font-bold">
                                处理库存差异
                                <FeatureHelpButton topic="catalog.inventory" title="处理库存差异" />
                            </h2>
                            <button type="button" onClick={() => setDraft(null)} aria-label="关闭">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <p className="mt-4 text-xs text-slate-500">
                            {draft.item.sku} · {draft.item.stockLocationName}，当前差异{' '}
                            {signed(draft.item.difference)}
                        </p>
                        <label className="mt-4 block text-xs font-bold">
                            处理方式
                            <select
                                value={draft.mode}
                                onChange={event =>
                                    setDraft({
                                        ...draft,
                                        mode: event.target.value as ResolutionDraft['mode'],
                                    })
                                }
                                className={inputClass}
                            >
                                <option value="ALIGN_STOCK_TO_LOTS">以批次为准，调整总库存</option>
                                {draft.item.canCreateBaselineLot && (
                                    <option value="CREATE_BASELINE_LOT">以总库存为准，建立期初批次</option>
                                )}
                            </select>
                        </label>
                        <label className="mt-4 block text-xs font-bold">
                            处理原因
                            <input
                                value={draft.reason}
                                onChange={event => setDraft({ ...draft, reason: event.target.value })}
                                className={inputClass}
                                placeholder="必填：盘点单号或差异说明"
                            />
                        </label>
                        {error && (
                            <div
                                role="alert"
                                className="mt-4 flex gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700"
                            >
                                <AlertTriangle className="h-4 w-4" />
                                {error}
                            </div>
                        )}
                        <div className="mt-5 flex justify-end gap-2 border-t pt-4">
                            <button
                                type="button"
                                onClick={() => setDraft(null)}
                                disabled={resolveState.loading}
                                className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => void submit()}
                                disabled={resolveState.loading || !draft.reason.trim()}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                            >
                                {resolveState.loading ? '处理中…' : '确认处理'}
                            </button>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}

function State({ label, error }: { label: string; error?: boolean }) {
    return (
        <div className={`p-12 text-center text-sm ${error ? 'text-rose-700' : 'text-slate-500'}`}>
            {label}
        </div>
    );
}

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal';
const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
