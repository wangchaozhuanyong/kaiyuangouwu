import { useMutation } from '@apollo/client/react';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';

import {
    parseOrderExpenseArrayBuffer,
    type LocalOrderExpenseFile,
} from '@vendure/catalog-management-plugin/browser';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import {
    IMPORT_CATALOG_ORDER_PROFIT_EXPENSES_MUTATION,
    type CatalogOrderProfitExpenseImportResult,
} from '../../graphql/catalog-operations.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';

export function OrderExpenseImportDialog({
    currencyCode,
    onClose,
    onImported,
}: {
    currencyCode: string;
    onClose: () => void;
    onImported: () => Promise<unknown> | unknown;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [preview, setPreview] = useState<LocalOrderExpenseFile | null>(null);
    const [parsing, setParsing] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<
        CatalogOrderProfitExpenseImportResult['importCatalogOrderProfitExpenses'] | null
    >(null);
    const [runImport, importState] = useMutation<CatalogOrderProfitExpenseImportResult>(
        IMPORT_CATALOG_ORDER_PROFIT_EXPENSES_MUTATION,
    );

    const parseFile = async (file?: File) => {
        if (!file) return;
        setParsing(true);
        setError('');
        setResult(null);
        setPreview(null);
        setConfirmed(false);
        try {
            setPreview(await parseOrderExpenseArrayBuffer(await file.arrayBuffer(), file.name));
        } catch (parseError) {
            setError(toUserFacingError(parseError, '费用文件解析失败'));
        } finally {
            setParsing(false);
        }
    };

    const executeImport = async () => {
        if (!preview || preview.errors.length > 0 || preview.rows.length === 0 || !confirmed) return;
        setError('');
        try {
            const response = await runImport({
                variables: {
                    input: {
                        currencyCode,
                        filename: preview.filename,
                        fileHash: preview.fileHash,
                        rows: preview.rows,
                    },
                },
            });
            const imported = response.data?.importCatalogOrderProfitExpenses;
            if (!imported) throw new Error('后端未返回导入结果');
            setResult(imported);
            await onImported();
        } catch (mutationError) {
            setError(toUserFacingError(mutationError, '订单费用导入失败'));
        }
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[1px]">
            <AccessibleDialogSurface
                accessibleName="批量导入订单经营费用"
                onRequestClose={onClose}
                className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
                <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                    <div>
                        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                            批量导入订单经营费用
                            <FeatureHelpButton topic="sales.order-expenses" title="批量导入订单经营费用" />
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                            目标币种 {currencyCode}
                            。文件在浏览器本地解析，只有通过验证的订单号和费用数据会发送给后端。
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="关闭费用导入"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </header>

                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            disabled={parsing || importState.loading}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                            {parsing ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Upload className="h-3.5 w-3.5" />
                            )}
                            选择费用文件
                        </button>
                        <button
                            type="button"
                            onClick={() => downloadExpenseTemplate(currencyCode)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                            <Download className="h-3.5 w-3.5" /> 下载 CSV 模板
                        </button>
                        <input
                            ref={inputRef}
                            type="file"
                            accept=".numbers,.xlsx,.xls,.csv"
                            className="hidden"
                            onChange={event => void parseFile(event.target.files?.[0])}
                        />
                    </div>

                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] leading-5 text-blue-900">
                        支持列：“订单号”、“实际物流成本”、“支付手续费”、“备注”。金额按 {currencyCode}{' '}
                        主币单位填写，最多 3 位小数。留空不会覆盖原值；没有费用必须明确填 0。
                    </div>

                    {error && (
                        <div
                            role="alert"
                            className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"
                        >
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                        </div>
                    )}
                    {result && (
                        <div
                            role="status"
                            className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"
                        >
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                            导入完成：共 {result.totalRows} 行，新建 {result.createdCount} 条费用记录，更新{' '}
                            {result.updatedCount} 条。
                        </div>
                    )}

                    {preview && (
                        <>
                            <div className="grid gap-2 sm:grid-cols-4">
                                <Metric label="源文件行" value={preview.sourceRowCount} />
                                <Metric label="可导入行" value={preview.rows.length} />
                                <Metric
                                    label="错误行"
                                    value={preview.errors.length}
                                    danger={preview.errors.length > 0}
                                />
                                <Metric
                                    label="已识别列"
                                    value={`${preview.mappedHeaders}/${preview.headers.length}`}
                                />
                            </div>
                            <p className="text-[11px] text-slate-500">
                                {preview.filename} · {preview.sheetName} · 文件摘要{' '}
                                {preview.fileHash.slice(0, 12)}…
                            </p>
                            {preview.unknownHeaders.length > 0 && (
                                <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                                    未使用列：{preview.unknownHeaders.join('、')}
                                </div>
                            )}
                            {preview.errors.length > 0 && (
                                <div className="max-h-36 overflow-y-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700">
                                    {preview.errors.slice(0, 30).map(item => (
                                        <div key={`${item.rowNumber}-${item.message}`}>{item.message}</div>
                                    ))}
                                    {preview.errors.length > 30 && (
                                        <div>其余 {preview.errors.length - 30} 条错误未展示</div>
                                    )}
                                </div>
                            )}
                            {preview.rows.length > 0 && (
                                <div className="overflow-x-auto rounded-xl border border-slate-200">
                                    <table className="w-full min-w-[760px] text-left text-xs">
                                        <thead className="bg-slate-50 text-slate-500">
                                            <tr>
                                                <th className="px-3 py-2">行</th>
                                                <th className="px-3 py-2">订单号</th>
                                                <th className="px-3 py-2">实际物流成本</th>
                                                <th className="px-3 py-2">支付手续费</th>
                                                <th className="px-3 py-2">备注</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {preview.rows.slice(0, 20).map(row => (
                                                <tr key={row.rowNumber}>
                                                    <td className="px-3 py-2 font-mono">{row.rowNumber}</td>
                                                    <td className="px-3 py-2 font-mono font-bold">
                                                        {row.orderCode}
                                                    </td>
                                                    <td className="px-3 py-2 font-mono">
                                                        {formatPreviewMoney(
                                                            row.carrierShippingCostMicrounits,
                                                            currencyCode,
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 font-mono">
                                                        {formatPreviewMoney(
                                                            row.paymentFeeMicrounits,
                                                            currencyCode,
                                                        )}
                                                    </td>
                                                    <td
                                                        className="max-w-64 truncate px-3 py-2"
                                                        title={row.note}
                                                    >
                                                        {row.note || '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {preview.rows.length > 20 && (
                                        <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                                            仅展示前 20 行，实际将导入 {preview.rows.length} 行。
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
                    <label className="flex items-start gap-2 text-[11px] leading-5 text-slate-600">
                        <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={event => setConfirmed(event.target.checked)}
                            disabled={!preview || preview.errors.length > 0 || result != null}
                            className="mt-1"
                        />
                        <span>我已核对当前店铺、{currencyCode} 币种和订单号，确认写入费用记录。</span>
                    </label>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700"
                        >
                            {result ? '完成' : '取消'}
                        </button>
                        {!result && (
                            <button
                                type="button"
                                onClick={() => void executeImport()}
                                disabled={
                                    !preview ||
                                    preview.errors.length > 0 ||
                                    preview.rows.length === 0 ||
                                    !confirmed ||
                                    importState.loading
                                }
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                            >
                                {importState.loading && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                                确认导入 {preview?.rows.length ?? 0} 行
                            </button>
                        )}
                    </div>
                </footer>
            </AccessibleDialogSurface>
        </div>
    );
}

function Metric({
    label,
    value,
    danger = false,
}: {
    label: string;
    value: number | string;
    danger?: boolean;
}) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[10px] text-slate-500">{label}</div>
            <div className={`mt-1 text-lg font-bold ${danger ? 'text-rose-600' : 'text-slate-900'}`}>
                {value}
            </div>
        </div>
    );
}

function formatPreviewMoney(value: number | undefined, currencyCode: string): string {
    if (value === undefined) return '保留原值';
    try {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: 2,
            maximumFractionDigits: 3,
        }).format(value / 1_000);
    } catch {
        return `${currencyCode} ${(value / 1_000).toFixed(3)}`;
    }
}

function downloadExpenseTemplate(currencyCode: string): void {
    const content = `\uFEFF订单号,实际物流成本,支付手续费,备注\nT-1001,0,0,${currencyCode}金额示例\n`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `订单经营费用导入模板-${currencyCode}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}
