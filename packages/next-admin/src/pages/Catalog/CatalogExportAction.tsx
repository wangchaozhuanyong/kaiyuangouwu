import { useApolloClient } from '@apollo/client/react';
import {
    downloadCatalogBlob,
    exportCatalogRowsLocally,
    type CatalogExportFormat,
    type CatalogExportRowRecord,
} from '@vendure/catalog-management-plugin/browser';
import { AlertTriangle, Download, FileSpreadsheet, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    CATALOG_EXPORT_CONTEXT_QUERY,
    CATALOG_EXPORT_ROWS_QUERY,
    CATALOG_INTEGRITY_SUMMARY_QUERY,
} from '../../graphql/catalog-operations.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';

interface IntegritySummary {
    totalProducts: number;
    totalVariants: number;
    productsWithoutVariants: number;
    variantsWithoutCategory: number;
    variantsWithoutCost: number;
}

export function CatalogExportAction() {
    const client = useApolloClient();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [summary, setSummary] = useState<IntegritySummary | null>(null);
    const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
    const [stockLocationId, setStockLocationId] = useState('');
    const [error, setError] = useState('');

    const inspect = async () => {
        setOpen(true);
        setError('');
        try {
            const [result, context] = await Promise.all([
                client.query<{ catalogIntegritySummary: IntegritySummary }>({
                    query: CATALOG_INTEGRITY_SUMMARY_QUERY,
                    fetchPolicy: 'network-only',
                }),
                client.query<{ stockLocations: { items: Array<{ id: string; name: string }> } }>({
                    query: CATALOG_EXPORT_CONTEXT_QUERY,
                    fetchPolicy: 'network-only',
                }),
            ]);
            if (!result.data?.catalogIntegritySummary) {
                throw new Error('商品完整性接口未返回统计数据');
            }
            setSummary(result.data.catalogIntegritySummary);
            const nextLocations = context.data?.stockLocations.items ?? [];
            setLocations(nextLocations);
            setStockLocationId(current =>
                nextLocations.some(location => location.id === current)
                    ? current
                    : (nextLocations[0]?.id ?? ''),
            );
        } catch (cause) {
            setError(toUserFacingError(cause, '商品完整性检查失败，当前暂停导出'));
        }
    };

    const exportRows = async (format: CatalogExportFormat) => {
        setLoading(true);
        setError('');
        setProgress(0);
        try {
            const rows: CatalogExportRowRecord[] = [];
            let totalItems = Number.POSITIVE_INFINITY;
            for (let skip = 0; skip < totalItems; skip += 500) {
                const page = await client.query<{
                    catalogExportRows: { items: CatalogExportRowRecord[]; totalItems: number };
                }>({
                    query: CATALOG_EXPORT_ROWS_QUERY,
                    variables: { skip, take: 500 },
                    fetchPolicy: 'network-only',
                });
                const exportPage = page.data?.catalogExportRows;
                if (!exportPage) throw new Error('商品导出接口未返回分页数据');
                totalItems = exportPage.totalItems;
                rows.push(...exportPage.items);
                setProgress(Math.round((rows.length / Math.max(totalItems, 1)) * 80));
                if (!exportPage.items.length) break;
            }
            if (!stockLocationId) throw new Error('请选择默认回导仓库');
            const output = await exportCatalogRowsLocally(rows, format, stockLocationId);
            setProgress(100);
            const date = new Date().toISOString().slice(0, 10);
            downloadCatalogBlob(output.blob, `商品回导主表-${date}.${output.extension}`);
        } catch (cause) {
            setError(toUserFacingError(cause, '商品报表生成失败，请稍后重试'));
        } finally {
            setLoading(false);
        }
    };

    const hasGaps = Boolean(
        summary &&
        (summary.productsWithoutVariants || summary.variantsWithoutCategory || summary.variantsWithoutCost),
    );

    return (
        <>
            <button
                type="button"
                onClick={() => void inspect()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
                <Download className="h-4 w-4" /> 导出可回导商品表
            </button>
            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
                    <AccessibleDialogSurface
                        accessibleName="导出可回导商品表"
                        onRequestClose={() => !loading && setOpen(false)}
                        className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                                    <FileSpreadsheet className="h-5 w-5 text-blue-600" /> 导出可回导商品表
                                    <FeatureHelpButton topic="catalog.products" title="导出可回导商品表" />
                                </h2>
                                <p className="mt-1 text-xs text-slate-500">
                                    文件在当前浏览器生成；服务器只返回结构化商品数据。
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                disabled={loading}
                                aria-label="关闭"
                                className="rounded-lg p-2 text-slate-500 disabled:opacity-40"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="mt-5 space-y-4">
                            <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900">
                                <ShieldCheck className="h-5 w-5 shrink-0" />
                                <p>
                                    XLSX 保留全部仓库的库存明细；CSV 按下方所选仓库导出一行一个
                                    SKU，两者都可再次导入。
                                </p>
                            </div>
                            <label className="block space-y-2">
                                <span className="text-xs font-bold text-slate-700">默认回导仓库</span>
                                <select
                                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                                    value={stockLocationId}
                                    onChange={event => setStockLocationId(event.target.value)}
                                    disabled={loading}
                                >
                                    <option value="">请选择仓库</option>
                                    {locations.map(location => (
                                        <option key={location.id} value={location.id}>
                                            {location.name}
                                        </option>
                                    ))}
                                </select>
                                <span className="block text-[11px] text-slate-500">
                                    主表的库存量和上下限来自该仓库；库存是绝对值。
                                </span>
                            </label>
                            {!summary && !error && (
                                <p className="py-6 text-center text-sm text-slate-500" role="status">
                                    正在检查商品完整性…
                                </p>
                            )}
                            {summary && (
                                <div className="grid gap-3 sm:grid-cols-4">
                                    <Metric label="商品" value={summary.totalProducts} />
                                    <Metric label="SKU" value={summary.totalVariants} />
                                    <Metric label="缺分类" value={summary.variantsWithoutCategory} />
                                    <Metric label="缺成本" value={summary.variantsWithoutCost} />
                                </div>
                            )}
                            {hasGaps && summary && (
                                <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                                    <AlertTriangle className="h-5 w-5 shrink-0" />
                                    <p>
                                        {summary.productsWithoutVariants} 个商品没有 SKU、
                                        {summary.variantsWithoutCategory} 个 SKU 缺分类、
                                        {summary.variantsWithoutCost} 个 SKU
                                        缺成本。报表仍可导出，但请先补齐后再作为完整经营数据使用。
                                    </p>
                                </div>
                            )}
                            {error && (
                                <div
                                    className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
                                    role="alert"
                                >
                                    {error}
                                </div>
                            )}
                            {loading && (
                                <div className="space-y-2" role="status">
                                    <div className="flex justify-between text-xs text-slate-500">
                                        <span>正在读取完整数据并生成文件</span>
                                        <span>{progress}%</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                        <div
                                            className="h-full bg-blue-600 transition-[width]"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </div>
                            )}
                            <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
                                <ExportButton
                                    disabled={!summary || !stockLocationId || loading}
                                    onClick={() => void exportRows('xlsx')}
                                >
                                    导出可回导 XLSX
                                </ExportButton>
                                <ExportButton
                                    disabled={!summary || !stockLocationId || loading}
                                    onClick={() => void exportRows('csv')}
                                    secondary
                                >
                                    导出可回导 CSV
                                </ExportButton>
                            </div>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </>
    );
}

function Metric({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border border-slate-200 p-3">
            <span className="text-xs text-slate-500">{label}</span>
            <strong className="mt-1 block text-lg text-slate-900">{value}</strong>
        </div>
    );
}

function ExportButton({
    disabled,
    onClick,
    secondary = false,
    children,
}: {
    disabled: boolean;
    onClick: () => void;
    secondary?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={`rounded-lg px-4 py-2.5 text-xs font-bold disabled:opacity-40 ${secondary ? 'border border-slate-300 bg-white text-slate-700' : 'bg-blue-600 text-white'}`}
        >
            {children}
        </button>
    );
}
