/* eslint-disable max-lines -- the import workbench keeps its state machine and review UI in one lazy chunk */
import { useApolloClient, useQuery } from '@apollo/client/react';
import {
    CATALOG_BROWSER_PARSER_VERSION,
    CATALOG_FIELD_OPTIONS,
    CATALOG_MAPPING_EXCLUDED,
    CATALOG_MAPPING_UNKNOWN,
    createCatalogImportBatches,
    rowsForCatalogTransport,
    type LocalCatalogFile,
} from '@vendure/catalog-management-plugin/browser';
import { print } from 'graphql';
import {
    AlertTriangle,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Download,
    FileSpreadsheet,
    History,
    LoaderCircle,
    Play,
    RotateCcw,
    Upload,
    X,
    XCircle,
} from 'lucide-react';
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type ReactNode,
    type RefObject,
} from 'react';

import { AccessibleDialogSurface } from '../../../components/AccessibleDialogSurface';
import { useConfirmDialog } from '../../../components/confirm-dialog-context';
import {
    APPEND_CATALOG_IMPORT_ROWS_MUTATION,
    BEGIN_CATALOG_IMPORT_MUTATION,
    canExecuteCatalogImport,
    CATALOG_IMPORT_CONTEXT_QUERY,
    CATALOG_IMPORT_JOB_QUERY,
    CATALOG_IMPORT_JOBS_QUERY,
    CATALOG_IMPORT_ROW_PAGE_QUERY,
    EXECUTE_CATALOG_IMPORT_MUTATION,
    FINALIZE_CATALOG_IMPORT_PREVIEW_MUTATION,
    RESOLVE_CATALOG_IMPORT_ROW_MUTATION,
    RESOLVE_CATALOG_IMPORT_ROWS_MUTATION,
    ROLLBACK_CATALOG_IMPORT_MUTATION,
    type CatalogImportAction,
    type CatalogImportJobRecord,
    type CatalogImportResolution,
    type CatalogImportRowRecord,
} from '../../../graphql/catalog-import.graphql';
import { GET_PRODUCTS } from '../../../graphql/catalog.graphql';
import { useAdminPermissions } from '../../../hooks/use-admin-permissions';
import { toUserFacingError } from '../../../utils/user-facing-error';
import { formatDateTime } from '../../Sales/sales-utils';
import { CatalogExportAction } from '../CatalogExportAction';

import { parseCatalogFile } from './catalog-import-file';

type WorkbenchTab = 'IMPORT' | 'HISTORY';
type ActionFilter = 'ALL' | Exclude<CatalogImportAction, 'PENDING'>;
type BusyAction = 'PARSE' | 'PREVIEW' | 'RESOLVE' | 'EXECUTE' | 'ROLLBACK' | 'REPORT' | null;

interface ImportContextData {
    activeChannel: {
        id: string;
        code: string;
        defaultCurrencyCode: string;
        availableCurrencyCodes: string[];
    };
    stockLocations: { items: Array<{ id: string; name: string }> };
}

const PAGE_SIZE = 100;
const primaryButton =
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100 disabled:cursor-not-allowed disabled:opacity-50';
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-100 disabled:text-slate-500';

export function CatalogImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const client = useApolloClient();
    const requestConfirmation = useConfirmDialog();
    const { permissions } = useAdminPermissions();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const refreshedJobRef = useRef<string | null>(null);
    const [tab, setTab] = useState<WorkbenchTab>('IMPORT');
    const [file, setFile] = useState<File | null>(null);
    const [localPreview, setLocalPreview] = useState<LocalCatalogFile | null>(null);
    const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
    const [mappingDirty, setMappingDirty] = useState(false);
    const [stockLocationId, setStockLocationId] = useState('');
    const [currencyCode, setCurrencyCode] = useState('');
    const [clearBlankFields, setClearBlankFields] = useState(false);
    const [transferProgress, setTransferProgress] = useState(0);
    const [transferStage, setTransferStage] = useState('');
    const [receivedRows, setReceivedRows] = useState(0);
    const [jobId, setJobId] = useState<string | null>(null);
    const [actionFilter, setActionFilter] = useState<ActionFilter>('ALL');
    const [rowPage, setRowPage] = useState(0);
    const [targetVariantByRow, setTargetVariantByRow] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<BusyAction>(null);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');

    const isSuperAdmin = permissions.includes('SuperAdmin');
    const hasPermission = (permission: string) => isSuperAdmin || permissions.includes(permission);
    const canUpdate = hasPermission('UpdateCatalogImport');
    const canRollback = hasPermission('DeleteCatalogImport');

    const contextQuery = useQuery<ImportContextData>(CATALOG_IMPORT_CONTEXT_QUERY, {
        skip: !open,
        fetchPolicy: 'cache-and-network',
    });
    const historyQuery = useQuery<{
        catalogImportJobs: { items: CatalogImportJobRecord[]; totalItems: number };
    }>(CATALOG_IMPORT_JOBS_QUERY, {
        variables: { skip: 0, take: 50 },
        skip: !open,
        fetchPolicy: 'cache-and-network',
    });
    const jobQuery = useQuery<{ catalogImportJob: CatalogImportJobRecord }>(CATALOG_IMPORT_JOB_QUERY, {
        variables: { id: jobId },
        skip: !jobId,
        fetchPolicy: 'network-only',
        notifyOnNetworkStatusChange: true,
    });
    const { startPolling, stopPolling } = jobQuery;
    const rowsQuery = useQuery<{
        catalogImportRowPage: { items: CatalogImportRowRecord[]; totalItems: number };
    }>(CATALOG_IMPORT_ROW_PAGE_QUERY, {
        variables: {
            jobId,
            action: actionFilter === 'ALL' ? null : actionFilter,
            skip: rowPage * PAGE_SIZE,
            take: PAGE_SIZE,
        },
        skip: !jobId,
        fetchPolicy: 'network-only',
        notifyOnNetworkStatusChange: true,
    });

    const activeChannel = contextQuery.data?.activeChannel;
    const locations = useMemo(
        () => contextQuery.data?.stockLocations.items ?? [],
        [contextQuery.data?.stockLocations.items],
    );
    const effectiveStockLocationId = locations.some(location => location.id === stockLocationId)
        ? stockLocationId
        : (locations[0]?.id ?? '');
    const effectiveCurrencyCode = activeChannel?.availableCurrencyCodes.includes(currencyCode)
        ? currencyCode
        : (activeChannel?.defaultCurrencyCode ?? '');
    const job = jobQuery.data?.catalogImportJob;
    const rows = rowsQuery.data?.catalogImportRowPage.items ?? [];
    const totalRows = rowsQuery.data?.catalogImportRowPage.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    const running = job?.state === 'QUEUED' || job?.state === 'RUNNING';
    const canExecute = canExecuteCatalogImport(job, canUpdate);

    useEffect(() => {
        if (running) startPolling(1_500);
        else stopPolling();
        return () => stopPolling();
    }, [running, startPolling, stopPolling]);

    useEffect(() => {
        if (!job || !['COMPLETED', 'COMPLETED_WITH_ERRORS', 'ROLLED_BACK'].includes(job.state)) return;
        if (refreshedJobRef.current === `${job.id}:${job.state}`) return;
        refreshedJobRef.current = `${job.id}:${job.state}`;
        void Promise.all([
            client.refetchQueries({ include: [GET_PRODUCTS] }),
            historyQuery.refetch(),
            rowsQuery.refetch(),
        ]).catch(() => undefined);
    }, [client, historyQuery, job, rowsQuery]);

    const resetWorkbench = () => {
        setFile(null);
        setLocalPreview(null);
        setFieldMapping({});
        setMappingDirty(false);
        setTransferProgress(0);
        setTransferStage('');
        setReceivedRows(0);
        setJobId(null);
        setActionFilter('ALL');
        setRowPage(0);
        setTargetVariantByRow({});
        setClearBlankFields(false);
        setNotice('');
        setActionError('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleLocalParse = async () => {
        if (!file) return;
        setBusy('PARSE');
        setActionError('');
        try {
            const result = await parseCatalogFile(
                file,
                Object.keys(fieldMapping).length > 0 ? fieldMapping : undefined,
            );
            setLocalPreview(result);
            setFieldMapping(result.fieldMapping);
            setMappingDirty(false);
            setNotice('文件已在浏览器本地解析，尚未发送或写入商品数据');
        } catch (error) {
            setActionError(toUserFacingError(error, '文件解析失败'));
        } finally {
            setBusy(null);
        }
    };

    const handleCreatePreview = async () => {
        if (!localPreview || !activeChannel || !effectiveStockLocationId || !effectiveCurrencyCode) return;
        if (clearBlankFields) {
            const confirmation = await requestConfirmation({
                title: '启用空白字段清除模式？',
                description:
                    '文件中已提供但留空的商品描述、品牌、标签、条码、规格、单位、保质期、库存预警值和供货商将在确认执行后被清除。',
                confirmLabel: '生成高风险预览',
                tone: 'warning',
            });
            if (!confirmation) return;
        }
        setBusy('PREVIEW');
        setActionError('');
        setTransferProgress(0);
        setTransferStage('创建导入任务');
        setReceivedRows(0);
        try {
            let beginResult;
            try {
                beginResult = await client.mutate<{
                    beginCatalogImport: CatalogImportJobRecord;
                }>({
                    mutation: BEGIN_CATALOG_IMPORT_MUTATION,
                    variables: {
                        input: {
                            context: {
                                channelId: activeChannel.id,
                                stockLocationId: effectiveStockLocationId,
                                currencyCode: effectiveCurrencyCode,
                                clearBlankFields,
                            },
                            source: {
                                filename: localPreview.filename,
                                mimetype: localPreview.mimetype || 'application/octet-stream',
                                byteSize: localPreview.byteSize,
                                fileHash: localPreview.fileHash,
                                sheetName: localPreview.sheetName,
                                detectedHeaders: localPreview.headers,
                                fieldMapping: localPreview.fieldMapping,
                                parserVersion: CATALOG_BROWSER_PARSER_VERSION,
                            },
                            totalRows: localPreview.rows.length,
                        },
                    },
                });
            } catch (error) {
                throw new Error(`创建任务阶段：${toUserFacingError(error, '请重试')}`);
            }
            let currentJob = requiredData(beginResult.data?.beginCatalogImport, '创建导入任务失败');
            if (currentJob.state === 'RECEIVING') {
                const transportRows = rowsForCatalogTransport(localPreview.rows);
                const batches = createCatalogImportBatches(currentJob.id, transportRows, {
                    operationName: 'NextAdminAppendCatalogImportRows',
                    query: print(APPEND_CATALOG_IMPORT_ROWS_MUTATION),
                });
                setTransferStage('接收数据');
                setReceivedRows(currentJob.receivedRows);
                for (let index = 0; index < batches.length; index++) {
                    try {
                        const appendResult = await client.mutate<{
                            appendCatalogImportRows: CatalogImportJobRecord;
                        }>({
                            mutation: APPEND_CATALOG_IMPORT_ROWS_MUTATION,
                            variables: { input: { jobId: currentJob.id, rows: batches[index] } },
                        });
                        currentJob = requiredData(
                            appendResult.data?.appendCatalogImportRows,
                            '提交导入数据失败',
                        );
                        setReceivedRows(currentJob.receivedRows);
                        setTransferProgress(
                            Math.round((currentJob.receivedRows / Math.max(transportRows.length, 1)) * 100),
                        );
                    } catch (error) {
                        throw new Error(
                            `接收阶段：第 ${index + 1}/${batches.length} 批失败；已接收 ${currentJob.receivedRows}/${transportRows.length}。可重新选择同一文件继续。${toUserFacingError(error, '请重试')}`,
                        );
                    }
                }
                setTransferStage('生成数据库差异预览');
                let finalizeResult;
                try {
                    finalizeResult = await client.mutate<{
                        finalizeCatalogImportPreview: CatalogImportJobRecord;
                    }>({
                        mutation: FINALIZE_CATALOG_IMPORT_PREVIEW_MUTATION,
                        variables: { id: currentJob.id },
                    });
                } catch (error) {
                    throw new Error(
                        `生成预览阶段：已接收 ${currentJob.receivedRows}/${localPreview.rows.length}。${toUserFacingError(error, '请重试')}`,
                    );
                }
                currentJob = requiredData(
                    finalizeResult.data?.finalizeCatalogImportPreview,
                    '生成数据库差异预览失败',
                );
            }
            setJobId(currentJob.id);
            setRowPage(0);
            setActionFilter('ALL');
            setNotice('数据库差异预览已生成，尚未写入商品数据');
            await historyQuery.refetch();
        } catch (error) {
            setActionError(toUserFacingError(error, '生成数据库差异预览失败'));
        } finally {
            setBusy(null);
        }
    };

    const refetchJobAndRows = async () => {
        await Promise.all([jobQuery.refetch(), rowsQuery.refetch(), historyQuery.refetch()]);
    };

    const resolveRow = async (
        rowId: string,
        resolution: CatalogImportResolution,
        targetVariantId?: string,
    ) => {
        if (!canUpdate) return;
        setBusy('RESOLVE');
        setActionError('');
        try {
            await client.mutate({
                mutation: RESOLVE_CATALOG_IMPORT_ROW_MUTATION,
                variables: { input: { rowId, resolution, targetVariantId: targetVariantId || null } },
            });
            await refetchJobAndRows();
            setRowPage(0);
            setNotice('导入行处理结果已保存');
        } catch (error) {
            setActionError(toUserFacingError(error, '处理导入行失败'));
        } finally {
            setBusy(null);
        }
    };

    const resolveAllRows = async (resolution: 'APPLY' | 'SKIP') => {
        if (!canUpdate) return;
        setBusy('RESOLVE');
        setActionError('');
        try {
            const allRows: CatalogImportRowRecord[] = [];
            let expectedTotal = Number.POSITIVE_INFINITY;
            for (let skip = 0; skip < expectedTotal; skip += 500) {
                const result = await client.query<{
                    catalogImportRowPage: { items: CatalogImportRowRecord[]; totalItems: number };
                }>({
                    query: CATALOG_IMPORT_ROW_PAGE_QUERY,
                    variables: { jobId, action: null, skip, take: 500 },
                    fetchPolicy: 'network-only',
                });
                const page = requiredData(result.data?.catalogImportRowPage, '无法读取待处理行');
                expectedTotal = page.totalItems;
                allRows.push(...page.items);
                if (page.items.length === 0) break;
            }
            const candidates = allRows.filter(row => {
                if (resolution === 'SKIP') {
                    return ['CONFLICT', 'WARNING', 'ERROR'].includes(row.action);
                }
                const safeAction = row.plannedChanges?.safeAction;
                return (
                    ['WARNING', 'ERROR'].includes(row.action) &&
                    ['CREATE', 'UPDATE'].includes(String(safeAction))
                );
            });
            if (candidates.length === 0) {
                setNotice('当前任务没有可批量处理的记录');
                return;
            }
            const retryCount = candidates.filter(row => row.action === 'ERROR').length;
            const riskCount = candidates.filter(row => row.action === 'WARNING').length;
            const applyTitle =
                retryCount > 0 && riskCount > 0
                    ? `确认 ${riskCount} 条风险并重试 ${retryCount} 条错误记录？`
                    : retryCount > 0
                      ? `确认重试全部 ${retryCount} 条错误记录？`
                      : `统一确认全部 ${riskCount} 条风险记录？`;
            const applyDescription =
                retryCount > 0
                    ? '警告行会按文件原值确认，可重试错误行会重新加入后台执行；系统将记录确认人和时间。'
                    : '将按文件原值导入已标记的负库存、价格倒挂等风险数据，并记录确认人和时间。';
            const confirmation = await requestConfirmation({
                title:
                    resolution === 'APPLY' ? applyTitle : `确认跳过全部 ${candidates.length} 条待处理记录？`,
                description: resolution === 'APPLY' ? applyDescription : '这些记录不会写入商品、价格或库存。',
                confirmLabel:
                    resolution === 'APPLY'
                        ? retryCount > 0
                            ? '确认并重试'
                            : '确认全部风险'
                        : '确认全部跳过',
                tone: 'warning',
            });
            if (!confirmation) return;
            for (let index = 0; index < candidates.length; index += 500) {
                await client.mutate({
                    mutation: RESOLVE_CATALOG_IMPORT_ROWS_MUTATION,
                    variables: {
                        input: {
                            rowIds: candidates.slice(index, index + 500).map(row => row.id),
                            resolution,
                        },
                    },
                });
            }
            await refetchJobAndRows();
            setRowPage(0);
            setNotice(`全部 ${candidates.length} 条待处理记录已批量处理`);
        } catch (error) {
            setActionError(toUserFacingError(error, '批量处理失败'));
        } finally {
            setBusy(null);
        }
    };

    const executeImport = async () => {
        if (!job || !canExecute) return;
        const confirmation = await requestConfirmation({
            title: `确认执行 ${job.totalRows} 行商品导入？`,
            description: job.clearBlankFields
                ? '已启用空白字段清除模式。执行后将写入商品、SKU、价格、库存、批次和供货商数据。'
                : '只有预览中已确认的新增和更新项会被写入，无变化和跳过项不会修改。',
            confirmLabel: '确认执行',
            tone: 'warning',
        });
        if (!confirmation) return;
        setBusy('EXECUTE');
        setActionError('');
        try {
            await client.mutate({ mutation: EXECUTE_CATALOG_IMPORT_MUTATION, variables: { id: job.id } });
            await refetchJobAndRows();
            setNotice('导入任务已进入后台队列，可安全关闭弹窗后从历史恢复查看');
        } catch (error) {
            setActionError(toUserFacingError(error, '启动导入任务失败'));
        } finally {
            setBusy(null);
        }
    };

    const rollbackImport = async () => {
        if (!job || !canRollback) return;
        const confirmation = await requestConfirmation({
            title: '回滚本次商品导入？',
            description:
                '系统会先检查商品和 SKU 在导入后是否被再次修改。发现后续修改时会停止回滚，不会覆盖新数据。导入新建的商品或 SKU 只会被禁用，不会物理删除。',
            confirmLabel: '检查并回滚',
            tone: 'danger',
        });
        if (!confirmation) return;
        setBusy('ROLLBACK');
        setActionError('');
        try {
            await client.mutate({ mutation: ROLLBACK_CATALOG_IMPORT_MUTATION, variables: { id: job.id } });
            await refetchJobAndRows();
            setNotice('本次导入已回滚');
        } catch (error) {
            setActionError(toUserFacingError(error, '回滚失败，未安全覆盖后续修改'));
        } finally {
            setBusy(null);
        }
    };

    const downloadReport = async () => {
        if (!job) return;
        setBusy('REPORT');
        setActionError('');
        try {
            const reportRows: CatalogImportRowRecord[] = [];
            let expectedTotal = Number.POSITIVE_INFINITY;
            for (let skip = 0; skip < expectedTotal; skip += 500) {
                const result = await client.query<{
                    catalogImportRowPage: { items: CatalogImportRowRecord[]; totalItems: number };
                }>({
                    query: CATALOG_IMPORT_ROW_PAGE_QUERY,
                    variables: { jobId: job.id, action: null, skip, take: 500 },
                    fetchPolicy: 'network-only',
                });
                const page = result.data?.catalogImportRowPage;
                if (!page) {
                    throw new Error('导入报告数据为空');
                }
                expectedTotal = page.totalItems;
                reportRows.push(...page.items);
                if (page.items.length === 0) break;
            }
            downloadImportReport(job, reportRows);
            setNotice(`已下载 ${reportRows.length} 行导入报告`);
        } catch (error) {
            setActionError(toUserFacingError(error, '下载导入报告失败'));
        } finally {
            setBusy(null);
        }
    };

    const closeAllowed = busy === null;
    if (!open) return null;
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm sm:p-5"
            onMouseDown={event => {
                if (event.target === event.currentTarget && closeAllowed) onClose();
            }}
        >
            <AccessibleDialogSurface
                accessibleName="商品安全导入中心"
                onRequestClose={() => closeAllowed && onClose()}
                className="flex h-[96vh] w-full max-w-[1680px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl sm:h-[92vh]"
            >
                <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
                    <div>
                        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                            <FileSpreadsheet className="h-5 w-5 text-blue-600" />
                            商品安全导入中心
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                            先本地解析和预览差异，只有点击“确认执行”后才会写入数据库。
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={!closeAllowed}
                        aria-label="关闭商品导入工作区"
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </header>

                <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-5 py-2 sm:px-6">
                    <TabButton active={tab === 'IMPORT'} onClick={() => setTab('IMPORT')}>
                        <Upload className="h-3.5 w-3.5" /> 导入工作区
                    </TabButton>
                    <TabButton active={tab === 'HISTORY'} onClick={() => setTab('HISTORY')}>
                        <History className="h-3.5 w-3.5" /> 导入历史
                    </TabButton>
                </div>

                <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                    {notice && (
                        <Message kind="success" onClose={() => setNotice('')}>
                            {notice}
                        </Message>
                    )}
                    {actionError && (
                        <Message kind="error" onClose={() => setActionError('')}>
                            {actionError}
                        </Message>
                    )}
                    {!canUpdate && (
                        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
                            当前角色可创建和查看导入预览，但没有 <code>UpdateCatalogImport</code>{' '}
                            权限，无法处理冲突或确认执行。
                        </div>
                    )}

                    {tab === 'HISTORY' ? (
                        <ImportHistory
                            jobs={historyQuery.data?.catalogImportJobs.items ?? []}
                            loading={historyQuery.loading && !historyQuery.data}
                            error={
                                historyQuery.error
                                    ? toUserFacingError(historyQuery.error, '导入历史加载失败')
                                    : ''
                            }
                            onRetry={() => void historyQuery.refetch()}
                            onOpenJob={id => {
                                setJobId(id);
                                setActionFilter('ALL');
                                setRowPage(0);
                                setTab('IMPORT');
                            }}
                        />
                    ) : !jobId ? (
                        <UploadPanel
                            contextLoading={contextQuery.loading && !contextQuery.data}
                            contextError={
                                contextQuery.error
                                    ? toUserFacingError(contextQuery.error, '导入上下文加载失败')
                                    : ''
                            }
                            channelCode={activeChannel?.code ?? ''}
                            availableCurrencyCodes={activeChannel?.availableCurrencyCodes ?? []}
                            locations={locations}
                            stockLocationId={effectiveStockLocationId}
                            currencyCode={effectiveCurrencyCode}
                            file={file}
                            preview={localPreview}
                            fieldMapping={fieldMapping}
                            mappingDirty={mappingDirty}
                            clearBlankFields={clearBlankFields}
                            transferProgress={transferProgress}
                            transferStage={transferStage}
                            receivedRows={receivedRows}
                            busy={busy}
                            fileInputRef={fileInputRef}
                            onRetryContext={() => void contextQuery.refetch()}
                            onFileChange={event => {
                                setFile(event.target.files?.[0] ?? null);
                                setLocalPreview(null);
                                setFieldMapping({});
                                setMappingDirty(false);
                                setTransferProgress(0);
                                setTransferStage('');
                                setReceivedRows(0);
                                setActionError('');
                            }}
                            onStockLocationChange={setStockLocationId}
                            onCurrencyCodeChange={setCurrencyCode}
                            onClearBlankFieldsChange={setClearBlankFields}
                            onFieldMappingChange={(header, value) => {
                                setFieldMapping(current => ({ ...current, [header]: value }));
                                setMappingDirty(true);
                            }}
                            onParse={() => void handleLocalParse()}
                            onCreatePreview={() => void handleCreatePreview()}
                            onDownloadTemplate={downloadTemplate}
                        />
                    ) : jobQuery.loading && !job ? (
                        <LoadingState label="正在读取导入任务" />
                    ) : jobQuery.error || !job ? (
                        <ErrorState
                            message={toUserFacingError(jobQuery.error, '导入任务加载失败')}
                            onRetry={() => void jobQuery.refetch()}
                        />
                    ) : (
                        <JobWorkspace
                            job={job}
                            rows={rows}
                            totalRows={totalRows}
                            rowPage={rowPage}
                            totalPages={totalPages}
                            actionFilter={actionFilter}
                            rowsLoading={rowsQuery.loading && !rowsQuery.data}
                            rowsError={
                                rowsQuery.error ? toUserFacingError(rowsQuery.error, '预览行加载失败') : ''
                            }
                            busy={busy}
                            running={running}
                            canUpdate={canUpdate}
                            canRollback={canRollback}
                            canExecute={canExecute}
                            targetVariantByRow={targetVariantByRow}
                            onReset={resetWorkbench}
                            onDownloadReport={() => void downloadReport()}
                            onExecute={() => void executeImport()}
                            onRollback={() => void rollbackImport()}
                            onRetryRows={() => void rowsQuery.refetch()}
                            onFilterChange={filter => {
                                setActionFilter(filter);
                                setRowPage(0);
                            }}
                            onPageChange={setRowPage}
                            onTargetVariantChange={(rowId, value) =>
                                setTargetVariantByRow(current => ({ ...current, [rowId]: value }))
                            }
                            onResolve={(rowId, resolution, targetVariantId) =>
                                void resolveRow(rowId, resolution, targetVariantId)
                            }
                            onBatchApply={() => void resolveAllRows('APPLY')}
                            onBatchSkip={() => void resolveAllRows('SKIP')}
                        />
                    )}
                </main>
            </AccessibleDialogSurface>
        </div>
    );
}

function UploadPanel({
    contextLoading,
    contextError,
    channelCode,
    availableCurrencyCodes,
    locations,
    stockLocationId,
    currencyCode,
    file,
    preview,
    fieldMapping,
    mappingDirty,
    clearBlankFields,
    transferProgress,
    transferStage,
    receivedRows,
    busy,
    fileInputRef,
    onRetryContext,
    onFileChange,
    onStockLocationChange,
    onCurrencyCodeChange,
    onClearBlankFieldsChange,
    onFieldMappingChange,
    onParse,
    onCreatePreview,
    onDownloadTemplate,
}: {
    contextLoading: boolean;
    contextError: string;
    channelCode: string;
    availableCurrencyCodes: string[];
    locations: Array<{ id: string; name: string }>;
    stockLocationId: string;
    currencyCode: string;
    file: File | null;
    preview: LocalCatalogFile | null;
    fieldMapping: Record<string, string>;
    mappingDirty: boolean;
    clearBlankFields: boolean;
    transferProgress: number;
    transferStage: string;
    receivedRows: number;
    busy: BusyAction;
    fileInputRef: RefObject<HTMLInputElement | null>;
    onRetryContext: () => void;
    onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onStockLocationChange: (value: string) => void;
    onCurrencyCodeChange: (value: string) => void;
    onClearBlankFieldsChange: (value: boolean) => void;
    onFieldMappingChange: (header: string, value: string) => void;
    onParse: () => void;
    onCreatePreview: () => void;
    onDownloadTemplate: () => void;
}) {
    if (contextLoading) return <LoadingState label="正在读取当前店铺、仓库和币种" />;
    if (contextError) return <ErrorState message={contextError} onRetry={onRetryContext} />;
    const parsing = busy === 'PARSE';
    const submitting = busy === 'PREVIEW';
    const locked = busy !== null;
    const canCreatePreview = Boolean(
        preview &&
        preview.errors.length === 0 &&
        preview.unknownHeaders.length === 0 &&
        !mappingDirty &&
        stockLocationId &&
        currencyCode &&
        !locked,
    );
    return (
        <div className="mx-auto max-w-5xl space-y-5">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-800">
                <strong>隐私保护：</strong>文件在当前浏览器 Worker
                中解析，原始文件和原始单元格不会上传。确认后只提交标准化商品字段。
            </div>
            <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3">
                <label className="space-y-2 md:col-span-3">
                    <span className="text-xs font-bold text-slate-700">商品资料文件</span>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".numbers,.xlsx,.xls,.csv"
                        onChange={onFileChange}
                        disabled={locked}
                        className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-blue-700`}
                    />
                    <span className="block text-[11px] text-slate-500">
                        支持 Numbers、Excel 和 CSV；单个文件最大 20MB，最多 20,000 行。
                    </span>
                </label>
                <label className="space-y-2">
                    <span className="text-xs font-bold text-slate-700">目标店铺</span>
                    <input className={inputClass} value={channelCode} disabled />
                </label>
                <label className="space-y-2">
                    <span className="text-xs font-bold text-slate-700">目标仓库</span>
                    <select
                        className={inputClass}
                        value={stockLocationId}
                        onChange={event => onStockLocationChange(event.target.value)}
                        disabled={locked}
                    >
                        <option value="">请选择仓库</option>
                        {locations.map(location => (
                            <option key={location.id} value={location.id}>
                                {location.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="space-y-2">
                    <span className="text-xs font-bold text-slate-700">目标币种</span>
                    <select
                        className={inputClass}
                        value={currencyCode}
                        onChange={event => onCurrencyCodeChange(event.target.value)}
                        disabled={locked}
                    >
                        <option value="">请选择币种</option>
                        {availableCurrencyCodes.map(code => (
                            <option key={code} value={code}>
                                {code}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 md:col-span-3">
                    <input
                        type="checkbox"
                        checked={clearBlankFields}
                        onChange={event => onClearBlankFieldsChange(event.target.checked)}
                        disabled={locked}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600"
                    />
                    <span>
                        <span className="block text-xs font-bold text-rose-800">
                            空白字段清除模式（高风险）
                        </span>
                        <span className="mt-1 block text-[11px] leading-5 text-rose-700">
                            默认关闭。只对文件中实际存在的列生效；SKU、价格、成本和库存不会因空值被清除。
                        </span>
                    </span>
                </label>
                {file && (
                    <div className="rounded-lg bg-slate-100 p-3 text-xs text-slate-700 md:col-span-3">
                        已选择：<strong>{file.name}</strong> · {formatBytes(file.size)}
                    </div>
                )}
                {preview && (
                    <>
                        <LocalPreviewSummary preview={preview} />
                        <FieldMappingEditor
                            preview={preview}
                            mapping={fieldMapping}
                            dirty={mappingDirty}
                            disabled={locked}
                            onChange={onFieldMappingChange}
                        />
                    </>
                )}
                {(parsing || submitting) && (
                    <ProgressBar
                        label={
                            parsing
                                ? '本地解析'
                                : `${transferStage || '准备接收'} · 已接收 ${receivedRows}/${preview?.rows.length ?? 0}`
                        }
                        value={transferProgress}
                        className="md:col-span-3"
                    />
                )}
                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4 md:col-span-3">
                    <button
                        type="button"
                        className={secondaryButton}
                        onClick={onDownloadTemplate}
                        disabled={locked}
                    >
                        <Download className="h-3.5 w-3.5" /> 下载标准模板
                    </button>
                    <button
                        type="button"
                        className={preview ? secondaryButton : primaryButton}
                        disabled={!file || locked}
                        onClick={onParse}
                    >
                        {parsing && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                        {mappingDirty ? '应用映射并重新预检' : preview ? '重新本地预检' : '浏览器本地预检'}
                    </button>
                    {preview && (
                        <button
                            type="button"
                            className={primaryButton}
                            disabled={!canCreatePreview}
                            onClick={onCreatePreview}
                        >
                            {submitting && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                            生成数据库差异预览
                        </button>
                    )}
                </div>
            </section>
        </div>
    );
}

function LocalPreviewSummary({ preview }: { preview: LocalCatalogFile }) {
    const metrics = [
        ['有效行', preview.rows.length, false],
        ['解析错误', preview.errors.length, preview.errors.length > 0],
        ['标识冲突组', preview.duplicateGroups, preview.duplicateGroups > 0],
        ['冲突行', preview.duplicateRows, preview.duplicateRows > 0],
        ['同名多 SKU 组', preview.multiSkuGroups, false],
        ['独立 SKU 行', preview.multiSkuRows, false],
        ['完全重复将跳过', preview.exactDuplicateRows, false],
        ['风险警告', preview.warningRows, preview.warningRows > 0],
        ['未知列', preview.unknownHeaders.length, preview.unknownHeaders.length > 0],
    ] as const;
    return (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 md:col-span-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {metrics.map(([label, value, danger]) => (
                    <div key={label} className="rounded-lg border border-blue-100 bg-white p-3">
                        <div className="text-[11px] text-slate-500">{label}</div>
                        <div
                            className={`mt-1 text-lg font-bold ${danger ? 'text-rose-600' : 'text-slate-900'}`}
                        >
                            {value}
                        </div>
                    </div>
                ))}
            </div>
            <p className="text-[11px] text-blue-800">
                {preview.sheetName} · {preview.headers.length} 列 · 文件摘要 {preview.fileHash.slice(0, 12)}…
            </p>
            {preview.unknownHeaders.length > 0 && (
                <InlineAlert>
                    未知列：{preview.unknownHeaders.join('、')}。请映射到系统字段或明确排除。
                </InlineAlert>
            )}
            {preview.errors.length > 0 && (
                <InlineAlert>
                    {preview.errors.slice(0, 8).map(error => (
                        <div key={`${error.rowNumber}-${error.message}`}>{error.message}</div>
                    ))}
                    {preview.errors.length > 8 && <div>其余 {preview.errors.length - 8} 条错误未显示</div>}
                </InlineAlert>
            )}
        </div>
    );
}

function FieldMappingEditor({
    preview,
    mapping,
    dirty,
    disabled,
    onChange,
}: {
    preview: LocalCatalogFile;
    mapping: Record<string, string>;
    dirty: boolean;
    disabled: boolean;
    onChange: (header: string, value: string) => void;
}) {
    return (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4 md:col-span-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-xs font-bold text-slate-800">字段映射</h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                        可修正自动识别结果；同一系统字段只能映射一次。
                    </p>
                </div>
                {dirty && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700">
                        需重新预检
                    </span>
                )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {preview.headers.filter(Boolean).map(header => (
                    <label key={header} className="space-y-1">
                        <span className="text-[11px] font-bold text-slate-700">{header}</span>
                        <select
                            className={inputClass}
                            value={mapping[header] || CATALOG_MAPPING_UNKNOWN}
                            onChange={event => onChange(header, event.target.value)}
                            disabled={disabled}
                        >
                            <option value={CATALOG_MAPPING_UNKNOWN} disabled>
                                未解决（阻止预览）
                            </option>
                            <option value={CATALOG_MAPPING_EXCLUDED}>明确排除此列</option>
                            {CATALOG_FIELD_OPTIONS.map(option => {
                                const used = Object.entries(mapping).some(
                                    ([mappedHeader, value]) =>
                                        mappedHeader !== header && value === option.value,
                                );
                                return (
                                    <option key={option.value} value={option.value} disabled={used}>
                                        {option.label}
                                    </option>
                                );
                            })}
                        </select>
                    </label>
                ))}
            </div>
        </div>
    );
}

function JobWorkspace({
    job,
    rows,
    totalRows,
    rowPage,
    totalPages,
    actionFilter,
    rowsLoading,
    rowsError,
    busy,
    running,
    canUpdate,
    canRollback,
    canExecute,
    targetVariantByRow,
    onReset,
    onDownloadReport,
    onExecute,
    onRollback,
    onRetryRows,
    onFilterChange,
    onPageChange,
    onTargetVariantChange,
    onResolve,
    onBatchApply,
    onBatchSkip,
}: {
    job: CatalogImportJobRecord;
    rows: CatalogImportRowRecord[];
    totalRows: number;
    rowPage: number;
    totalPages: number;
    actionFilter: ActionFilter;
    rowsLoading: boolean;
    rowsError: string;
    busy: BusyAction;
    running: boolean;
    canUpdate: boolean;
    canRollback: boolean;
    canExecute: boolean;
    targetVariantByRow: Record<string, string>;
    onReset: () => void;
    onDownloadReport: () => void;
    onExecute: () => void;
    onRollback: () => void;
    onRetryRows: () => void;
    onFilterChange: (filter: ActionFilter) => void;
    onPageChange: (page: number) => void;
    onTargetVariantChange: (rowId: string, value: string) => void;
    onResolve: (rowId: string, resolution: CatalogImportResolution, targetVariantId?: string) => void;
    onBatchApply: () => void;
    onBatchSkip: () => void;
}) {
    const terminal = ['COMPLETED', 'ROLLED_BACK'].includes(job.state);
    const batchApplyCount = job.warningCount + job.errorCount;
    const batchApplyLabel =
        job.errorCount > 0 && job.warningCount > 0
            ? `确认风险并重试 ${batchApplyCount}`
            : job.errorCount > 0
              ? `批量确认重试 ${job.errorCount}`
              : `统一确认全部风险 ${job.warningCount || ''}`;
    return (
        <div className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-bold text-slate-900">{job.originalFilename}</h3>
                            <StateBadge state={job.state} />
                            {job.clearBlankFields && (
                                <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-bold text-rose-700">
                                    空白清除
                                </span>
                            )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                            {job.stockLocation.name} · {job.currencyCode} · {formatBytes(job.byteSize)} ·
                            创建于 {formatDateTime(job.createdAt)}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={secondaryButton}
                            onClick={onReset}
                            disabled={busy !== null}
                        >
                            选择其他文件
                        </button>
                        <button
                            type="button"
                            className={secondaryButton}
                            onClick={onDownloadReport}
                            disabled={busy !== null}
                        >
                            {busy === 'REPORT' ? (
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Download className="h-3.5 w-3.5" />
                            )}
                            下载报告
                        </button>
                        {canRollback && ['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(job.state) && (
                            <button
                                type="button"
                                className={secondaryButton}
                                onClick={onRollback}
                                disabled={busy !== null}
                            >
                                {busy === 'ROLLBACK' ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                )}
                                安全回滚
                            </button>
                        )}
                        {!terminal && (
                            <button
                                type="button"
                                className={primaryButton}
                                onClick={onExecute}
                                disabled={!canExecute || busy !== null || running}
                            >
                                {busy === 'EXECUTE' || running ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Play className="h-3.5 w-3.5" />
                                )}
                                确认执行
                            </button>
                        )}
                        {['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(job.state) && (
                            <CatalogExportAction />
                        )}
                    </div>
                </div>
                <ImportSummary job={job} />
                {job.state === 'RECEIVING' && (
                    <ProgressBar
                        label={`接收数据 · 已接收 ${job.receivedRows}/${job.totalRows}`}
                        value={job.progress}
                        className="mt-4"
                    />
                )}
                {running && <ProgressBar label="后台导入中" value={job.progress} className="mt-4" />}
                {job.errorMessage && <InlineAlert className="mt-4">{job.errorMessage}</InlineAlert>}
            </section>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap gap-1.5">
                        {(
                            [
                                'ALL',
                                'CREATE',
                                'UPDATE',
                                'SKIP_UNCHANGED',
                                'CONFLICT',
                                'WARNING',
                                'ERROR',
                            ] as ActionFilter[]
                        ).map(filter => (
                            <button
                                key={filter}
                                type="button"
                                onClick={() => onFilterChange(filter)}
                                disabled={busy !== null}
                                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${actionFilter === filter ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}
                            >
                                {actionLabel(filter)}
                            </button>
                        ))}
                    </div>
                    {canUpdate && (
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                className={secondaryButton}
                                disabled={batchApplyCount === 0 || busy !== null}
                                onClick={onBatchApply}
                            >
                                {batchApplyLabel}
                            </button>
                            <button
                                type="button"
                                className={secondaryButton}
                                disabled={
                                    job.conflictCount + job.warningCount + job.errorCount === 0 ||
                                    busy !== null
                                }
                                onClick={onBatchSkip}
                            >
                                批量跳过全部 {job.conflictCount + job.warningCount + job.errorCount || ''}
                            </button>
                        </div>
                    )}
                </div>
                {rowsLoading ? (
                    <LoadingState label="正在读取预览行" />
                ) : rowsError ? (
                    <ErrorState message={rowsError} onRetry={onRetryRows} />
                ) : rows.length === 0 ? (
                    <div className="p-12 text-center text-xs text-slate-500">当前筛选下没有导入行</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1160px] text-left text-xs">
                            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                                <tr>
                                    <th className="p-3">行号</th>
                                    <th className="p-3">结果</th>
                                    <th className="p-3">名称</th>
                                    <th className="p-3">分类</th>
                                    <th className="p-3">规格 / 单位</th>
                                    <th className="p-3">销售价 / 进货价 / 库存量</th>
                                    <th className="p-3">说明与处理</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {rows.map(row => (
                                    <ImportRow
                                        key={row.id}
                                        row={row}
                                        canUpdate={canUpdate}
                                        busy={busy !== null}
                                        targetVariantId={targetVariantByRow[row.id] ?? ''}
                                        onTargetVariantChange={value => onTargetVariantChange(row.id, value)}
                                        onResolve={(resolution, targetVariantId) =>
                                            onResolve(row.id, resolution, targetVariantId)
                                        }
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-500">
                    <span>
                        共 {totalRows} 行，第 {Math.min(rowPage + 1, totalPages)} / {totalPages} 页
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className={secondaryButton}
                            disabled={busy !== null || rowPage === 0}
                            onClick={() => onPageChange(Math.max(0, rowPage - 1))}
                        >
                            <ChevronLeft className="h-3.5 w-3.5" /> 上一页
                        </button>
                        <button
                            type="button"
                            className={secondaryButton}
                            disabled={busy !== null || rowPage + 1 >= totalPages}
                            onClick={() => onPageChange(rowPage + 1)}
                        >
                            下一页 <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}

function ImportRow({
    row,
    canUpdate,
    busy,
    targetVariantId,
    onTargetVariantChange,
    onResolve,
}: {
    row: CatalogImportRowRecord;
    canUpdate: boolean;
    busy: boolean;
    targetVariantId: string;
    onTargetVariantChange: (value: string) => void;
    onResolve: (resolution: CatalogImportResolution, targetVariantId?: string) => void;
}) {
    const data = row.normalizedData;
    const safeAction = String(row.plannedChanges?.safeAction ?? '');
    return (
        <tr className="align-top text-slate-700 hover:bg-slate-50">
            <td className="p-3 font-mono">{row.rowNumber}</td>
            <td className="p-3">
                <ActionBadge action={row.action} />
            </td>
            <td className="min-w-48 p-3">
                <strong className="text-slate-900">{displayValue(data.name)}</strong>
                <div className="mt-1 font-mono text-[10px] text-slate-400">
                    {displayValue(data.sku, '无 SKU')}
                </div>
            </td>
            <td className="p-3">{displayValue(data.category)}</td>
            <td className="p-3">
                {[displayValue(data.specification, ''), displayValue(data.primaryUnit, '')]
                    .filter(Boolean)
                    .join(' / ') || '—'}
            </td>
            <td className="whitespace-nowrap p-3">
                销售价 {displayValue(data.sellingPrice, '—')} / 进货价 {displayValue(data.purchaseCost, '—')}
                <div className="mt-1 text-slate-500">库存量 {displayValue(data.stockOnHand, '—')}</div>
            </td>
            <td className="min-w-80 p-3">
                <p className="mb-2 leading-5 text-slate-500">{row.message || '—'}</p>
                {canUpdate && row.action === 'WARNING' && (
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className={primaryButton}
                            disabled={busy}
                            onClick={() => onResolve('APPLY')}
                        >
                            确认应用
                        </button>
                        <button
                            type="button"
                            className={secondaryButton}
                            disabled={busy}
                            onClick={() => onResolve('SKIP')}
                        >
                            跳过
                        </button>
                    </div>
                )}
                {canUpdate && row.action === 'ERROR' && !row.appliedAt && (
                    <div className="flex gap-2">
                        {['CREATE', 'UPDATE'].includes(safeAction) && (
                            <button
                                type="button"
                                className={primaryButton}
                                disabled={busy}
                                onClick={() => onResolve('APPLY')}
                            >
                                确认重试
                            </button>
                        )}
                        <button
                            type="button"
                            className={secondaryButton}
                            disabled={busy}
                            onClick={() => onResolve('SKIP')}
                        >
                            标记跳过
                        </button>
                    </div>
                )}
                {canUpdate && row.action === 'CONFLICT' && (
                    <div className="space-y-2">
                        <div className="flex gap-2">
                            <button
                                type="button"
                                className={primaryButton}
                                disabled={busy}
                                onClick={() => onResolve('CREATE_NEW')}
                            >
                                作为新 SKU
                            </button>
                            <button
                                type="button"
                                className={secondaryButton}
                                disabled={busy}
                                onClick={() => onResolve('SKIP')}
                            >
                                跳过
                            </button>
                        </div>
                        <div className="flex gap-2">
                            <input
                                className={inputClass}
                                value={targetVariantId}
                                onChange={event => onTargetVariantChange(event.target.value)}
                                placeholder="目标 SKU ID"
                                aria-label={`第 ${row.rowNumber} 行目标 SKU ID`}
                                disabled={busy}
                            />
                            <button
                                type="button"
                                className={secondaryButton}
                                disabled={busy || !targetVariantId.trim()}
                                onClick={() => onResolve('UPDATE_EXISTING', targetVariantId.trim())}
                            >
                                更新该 SKU
                            </button>
                        </div>
                    </div>
                )}
            </td>
        </tr>
    );
}

function ImportSummary({ job }: { job: CatalogImportJobRecord }) {
    const cards = [
        ['总行数', job.totalRows, false],
        ['已接收', job.receivedRows, false],
        ['新增', job.createdCount, false],
        ['修改', job.updatedCount, false],
        ['跳过', job.skippedCount, false],
        ['冲突', job.conflictCount, job.conflictCount > 0],
        ['警告', job.warningCount, job.warningCount > 0],
        ['错误', job.errorCount, job.errorCount > 0],
    ] as const;
    return (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {cards.map(([label, value, danger]) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[10px] text-slate-500">{label}</div>
                    <div className={`mt-1 text-lg font-bold ${danger ? 'text-rose-600' : 'text-slate-900'}`}>
                        {value}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ImportHistory({
    jobs,
    loading,
    error,
    onRetry,
    onOpenJob,
}: {
    jobs: CatalogImportJobRecord[];
    loading: boolean;
    error: string;
    onRetry: () => void;
    onOpenJob: (id: string) => void;
}) {
    if (loading) return <LoadingState label="正在读取导入历史" />;
    if (error) return <ErrorState message={error} onRetry={onRetry} />;
    if (jobs.length === 0)
        return (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-16 text-center text-xs text-slate-500">
                还没有商品导入记录
            </div>
        );
    return (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                    <tr>
                        <th className="p-3">文件</th>
                        <th className="p-3">仓库 / 币种</th>
                        <th className="p-3">状态</th>
                        <th className="p-3">结果</th>
                        <th className="p-3">时间</th>
                        <th className="p-3 text-right">操作</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {jobs.map(job => (
                        <tr key={job.id} className="hover:bg-slate-50">
                            <td className="p-3">
                                <strong className="text-slate-900">{job.originalFilename}</strong>
                                <div className="mt-1 font-mono text-[10px] text-slate-400">
                                    {job.fileHash.slice(0, 12)}…
                                </div>
                            </td>
                            <td className="p-3">
                                {job.stockLocation.name} / {job.currencyCode}
                            </td>
                            <td className="p-3">
                                <StateBadge state={job.state} />
                                {job.state === 'RECEIVING' && (
                                    <div className="mt-1 text-[10px] text-slate-500">
                                        已接收 {job.receivedRows}/{job.totalRows}
                                    </div>
                                )}
                            </td>
                            <td className="p-3">
                                新增 {job.createdCount} · 修改 {job.updatedCount} · 错误 {job.errorCount}
                            </td>
                            <td className="p-3">{formatDateTime(job.createdAt)}</td>
                            <td className="p-3 text-right">
                                <button
                                    type="button"
                                    className={secondaryButton}
                                    onClick={() => onOpenJob(job.id)}
                                >
                                    查看详情
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${active ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
        >
            {children}
        </button>
    );
}

function StateBadge({ state }: { state: CatalogImportJobRecord['state'] }) {
    const tone = ['COMPLETED'].includes(state)
        ? 'bg-emerald-100 text-emerald-700'
        : ['FAILED', 'COMPLETED_WITH_ERRORS'].includes(state)
          ? 'bg-rose-100 text-rose-700'
          : state === 'ROLLED_BACK'
            ? 'bg-slate-200 text-slate-700'
            : ['QUEUED', 'RUNNING'].includes(state)
              ? 'bg-blue-100 text-blue-700'
              : 'bg-amber-100 text-amber-700';
    return (
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${tone}`}>{stateLabel(state)}</span>
    );
}

function ActionBadge({ action }: { action: CatalogImportAction }) {
    const tone = ['CONFLICT', 'WARNING', 'ERROR'].includes(action)
        ? 'bg-rose-100 text-rose-700'
        : action === 'CREATE'
          ? 'bg-emerald-100 text-emerald-700'
          : action === 'UPDATE'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-slate-100 text-slate-600';
    return (
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${tone}`}>
            {actionLabel(action)}
        </span>
    );
}

function Message({
    kind,
    onClose,
    children,
}: {
    kind: 'success' | 'error';
    onClose: () => void;
    children: ReactNode;
}) {
    const Icon = kind === 'success' ? CheckCircle2 : XCircle;
    return (
        <div
            className={`mb-4 flex items-start justify-between gap-3 rounded-xl border p-3 text-xs ${kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
            role={kind === 'error' ? 'alert' : 'status'}
        >
            <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{children}</span>
            </div>
            <button type="button" onClick={onClose} aria-label="关闭提示">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}

function InlineAlert({ children, className = '' }: { children: ReactNode; className?: string }) {
    return (
        <div
            className={`flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800 ${className}`}
            role="alert"
        >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>{children}</div>
        </div>
    );
}

function ProgressBar({ label, value, className = '' }: { label: string; value: number; className?: string }) {
    return (
        <div
            className={`space-y-2 rounded-lg border border-blue-100 bg-blue-50 p-3 ${className}`}
            role="status"
        >
            <div className="flex justify-between text-[11px] font-bold text-blue-800">
                <span>{label}</span>
                <span>{value}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-blue-100">
                <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                />
            </div>
        </div>
    );
}

function LoadingState({ label }: { label: string }) {
    return (
        <div className="flex items-center justify-center gap-2 p-16 text-xs text-slate-500" role="status">
            <LoaderCircle className="h-5 w-5 animate-spin text-blue-600" />
            {label}
        </div>
    );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center">
            <XCircle className="mx-auto h-7 w-7 text-rose-500" />
            <p className="mt-3 text-xs text-rose-800">{message}</p>
            <button type="button" className={`${secondaryButton} mt-4`} onClick={onRetry}>
                重试
            </button>
        </div>
    );
}

function requiredData<T>(value: T | null | undefined, message: string): T {
    if (value == null) throw new Error(message);
    return value;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function displayValue(value: unknown, fallback = '—') {
    if (value == null || value === '') return fallback;
    if (Array.isArray(value)) return value.join('、') || fallback;
    return String(value);
}

function actionLabel(action: ActionFilter | CatalogImportAction) {
    return (
        {
            ALL: '全部',
            PENDING: '接收中',
            CREATE: '新增',
            UPDATE: '修改',
            SKIP_UNCHANGED: '跳过',
            CONFLICT: '冲突',
            WARNING: '警告',
            ERROR: '错误',
        } as const
    )[action];
}

function stateLabel(state: CatalogImportJobRecord['state']) {
    return (
        {
            RECEIVING: '接收数据',
            PREVIEW_READY: '待确认',
            QUEUED: '排队中',
            RUNNING: '执行中',
            COMPLETED: '已完成',
            COMPLETED_WITH_ERRORS: '部分完成',
            FAILED: '失败待处理',
            ROLLED_BACK: '已回滚',
        } as const
    )[state];
}

function downloadTemplate() {
    const rows = [
        [
            '名称',
            '分类',
            '门店',
            '仓库',
            '币种',
            'SKU',
            '条码',
            '规格',
            '销售单位',
            '采购单位',
            '包装换算',
            '库存量',
            '进货价',
            '销售价',
            '库存上限',
            '库存下限',
            '品牌',
            '生产日期',
            '保质期',
            '批次号',
            '商品状态',
            '商品描述',
            '标签',
            '创建日期',
            '供货商',
        ],
        [
            '示例商品',
            '示例分类',
            '',
            '',
            '',
            'SKU-001',
            '',
            '500ml',
            '瓶',
            '箱',
            '12',
            '10',
            '3.125',
            '5.00',
            '100',
            '10',
            '',
            '',
            '365',
            '',
            '启用',
            '',
            '',
            '',
            '示例供货商',
        ],
    ];
    downloadCsv(rows.map(row => row.map(csvCell).join(',')).join('\r\n'), '商品导入标准模板.csv');
}

function downloadImportReport(job: CatalogImportJobRecord, rows: CatalogImportRowRecord[]) {
    const headerAudit = (job.detectedHeaders ?? []).map(header => {
        const mapping = job.fieldMapping?.[header] ?? CATALOG_MAPPING_UNKNOWN;
        return [
            header,
            mapping === CATALOG_MAPPING_EXCLUDED
                ? 'EXCLUDED'
                : mapping === CATALOG_MAPPING_UNKNOWN
                  ? 'UNKNOWN'
                  : 'MAPPED',
            mapping.startsWith('__') ? '' : mapping,
        ];
    });
    const content = [
        ['原始表头', '处理状态', '系统字段'],
        ...headerAudit,
        [],
        ['行号', '结果', '处理选择', '名称', '分类', 'SKU', '说明', '应用时间'],
        ...rows.map(row => [
            String(row.rowNumber),
            row.action,
            row.resolution ?? '',
            displayValue(row.normalizedData.name, ''),
            displayValue(row.normalizedData.category, ''),
            displayValue(row.normalizedData.sku, ''),
            row.message ?? '',
            row.appliedAt ?? '',
        ]),
    ]
        .map(row => row.map(value => csvCell(String(value))).join(','))
        .join('\r\n');
    const safeName = job.originalFilename.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
    downloadCsv(content, `${safeName || '商品导入'}-导入报告.csv`);
}

function csvCell(value: string) {
    const safe = /^[=+\-@]/u.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/gu, '""')}"`;
}

function downloadCsv(content: string, filename: string) {
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}
