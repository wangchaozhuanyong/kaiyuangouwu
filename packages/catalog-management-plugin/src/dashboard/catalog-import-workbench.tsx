import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    Input,
    Label,
    Progress,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Skeleton,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import {
    AlertTriangle,
    CheckCircle2,
    Download,
    FileSpreadsheet,
    History,
    Loader2,
    Play,
    RotateCcw,
    Upload,
    XCircle,
} from 'lucide-react';
import { ChangeEvent, useEffect, useRef, useState } from 'react';

import {
    CATALOG_BROWSER_PARSER_VERSION,
    CATALOG_FIELD_OPTIONS,
    CATALOG_MAPPING_EXCLUDED,
    CATALOG_MAPPING_UNKNOWN,
    type LocalCatalogFile,
    rowsForCatalogTransport,
} from './catalog-local-file';
import { parseCatalogFileLocally } from './catalog-local-file-client';
import {
    CatalogImportJobRecord,
    CatalogImportRowRecord,
    appendCatalogImportRowsMutation,
    beginCatalogImportMutation,
    catalogImportJobQuery,
    catalogImportJobsQuery,
    catalogImportRowsQuery,
    executeCatalogImportMutation,
    finalizeCatalogImportPreviewMutation,
    resolveCatalogImportRowMutation,
    resolveCatalogImportRowsMutation,
    rollbackCatalogImportMutation,
    stockLocationsQuery,
} from './catalog-management.graphql';

type ActionFilter = 'ALL' | Exclude<CatalogImportRowRecord['action'], 'PENDING'>;

export function CatalogImportAction() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="outline" onClick={() => setOpen(true)}>
                <Upload className="mr-2 size-4" />
                批量导入
            </Button>
            <CatalogImportWorkbench open={open} onOpenChange={setOpen} />
        </>
    );
}

function CatalogImportWorkbench({
    open,
    onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
    const { activeChannel } = useChannel();
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [localPreview, setLocalPreview] = useState<LocalCatalogFile | null>(null);
    const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
    const [mappingDirty, setMappingDirty] = useState(false);
    const [transferProgress, setTransferProgress] = useState(0);
    const [stockLocationId, setStockLocationId] = useState('');
    const [currencyCode, setCurrencyCode] = useState('');
    const [clearBlankFields, setClearBlankFields] = useState(false);
    const [jobId, setJobId] = useState<string | null>(null);
    const [actionFilter, setActionFilter] = useState<ActionFilter>('ALL');
    const [targetVariantByRow, setTargetVariantByRow] = useState<Record<string, string>>({});

    const locationsQuery = useQuery({
        queryKey: ['catalog-import-stock-locations', activeChannel?.id],
        queryFn: () =>
            api.query<{ stockLocations: { items: Array<{ id: string; name: string }> } }>(
                stockLocationsQuery,
            ),
        enabled: open && Boolean(activeChannel?.id),
    });
    const locations = locationsQuery.data?.stockLocations.items ?? [];
    useEffect(() => {
        if (!stockLocationId && locations[0]) setStockLocationId(locations[0].id);
    }, [locations, stockLocationId]);
    useEffect(() => {
        if (!activeChannel) return;
        if (!activeChannel.availableCurrencyCodes.some(code => code === currencyCode)) {
            setCurrencyCode(activeChannel.defaultCurrencyCode);
        }
    }, [activeChannel, currencyCode]);

    const historyQuery = useQuery({
        queryKey: ['catalog-import-history', activeChannel?.id],
        queryFn: () =>
            api.query<{ catalogImportJobs: { items: CatalogImportJobRecord[]; totalItems: number } }>(
                catalogImportJobsQuery,
                { skip: 0, take: 30 },
            ),
        enabled: open && Boolean(activeChannel?.id),
    });
    const jobQuery = useQuery({
        queryKey: ['catalog-import-job', jobId],
        queryFn: () =>
            api.query<{ catalogImportJob: CatalogImportJobRecord }>(catalogImportJobQuery, { id: jobId }),
        enabled: open && Boolean(jobId),
        refetchInterval: query => {
            const state = query.state.data?.catalogImportJob.state;
            return state === 'QUEUED' || state === 'RUNNING' ? 1_500 : false;
        },
    });
    const job = jobQuery.data?.catalogImportJob;
    const rowsQuery = useQuery({
        queryKey: ['catalog-import-rows', jobId, actionFilter],
        queryFn: () =>
            api.query<{ catalogImportRows: CatalogImportRowRecord[] }>(catalogImportRowsQuery, {
                jobId,
                action: actionFilter === 'ALL' ? null : actionFilter,
            }),
        enabled: open && Boolean(jobId),
    });
    const rows = rowsQuery.data?.catalogImportRows ?? [];

    const localParseMutation = useMutation({
        mutationFn: () => {
            if (!file) throw new Error('请选择商品资料文件');
            return parseCatalogFileLocally(file, Object.keys(fieldMapping).length ? fieldMapping : undefined);
        },
        onSuccess: result => {
            setLocalPreview(result);
            setFieldMapping(result.fieldMapping);
            setMappingDirty(false);
            toast.success('文件已在浏览器本地解析，尚未发送任何商品数据');
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const previewMutation = useMutation({
        mutationFn: async () => {
            if (!localPreview || !activeChannel || !stockLocationId) {
                throw new Error('请先完成浏览器本地预检并选择目标仓库');
            }
            if (localPreview.errors.length > 0) throw new Error('请先修正本地解析错误');
            if (localPreview.unknownHeaders.length > 0) {
                throw new Error(`存在 ${localPreview.unknownHeaders.length} 个未解决列，请先映射或明确排除`);
            }
            setTransferProgress(0);
            const started = await api.mutate<{ beginCatalogImport: CatalogImportJobRecord }>(
                beginCatalogImportMutation,
                {
                    input: {
                        context: {
                            channelId: activeChannel.id,
                            stockLocationId,
                            currencyCode,
                            clearBlankFields,
                        },
                        source: {
                            filename: localPreview.filename,
                            mimetype: localPreview.mimetype,
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
            );
            let receivingJob = started.beginCatalogImport;
            if (receivingJob.state !== 'RECEIVING') return receivingJob;
            const transportRows = rowsForCatalogTransport(localPreview.rows);
            for (let index = 0; index < transportRows.length; index += 500) {
                const batch = transportRows.slice(index, index + 500);
                const appended = await api.mutate<{ appendCatalogImportRows: CatalogImportJobRecord }>(
                    appendCatalogImportRowsMutation,
                    { input: { jobId: receivingJob.id, rows: batch } },
                );
                receivingJob = appended.appendCatalogImportRows;
                setTransferProgress(Math.round(((index + batch.length) / transportRows.length) * 100));
            }
            const finalized = await api.mutate<{
                finalizeCatalogImportPreview: CatalogImportJobRecord;
            }>(finalizeCatalogImportPreviewMutation, { id: receivingJob.id });
            return finalized.finalizeCatalogImportPreview;
        },
        onSuccess: async result => {
            setJobId(result.id);
            setActionFilter('ALL');
            toast.success('数据库差异预览已生成，尚未写入商品');
            await queryClient.invalidateQueries({ queryKey: ['catalog-import-history'] });
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const resolveMutation = useMutation({
        mutationFn: (input: { rowId: string; resolution: string; targetVariantId?: string }) =>
            api.mutate(resolveCatalogImportRowMutation, { input }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['catalog-import-rows', jobId] }),
                queryClient.invalidateQueries({ queryKey: ['catalog-import-job', jobId] }),
            ]);
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const batchResolveMutation = useMutation({
        mutationFn: async (input: { rowIds: string[]; resolution: 'APPLY' | 'SKIP' }) => {
            for (let index = 0; index < input.rowIds.length; index += 500) {
                await api.mutate(resolveCatalogImportRowsMutation, {
                    input: {
                        rowIds: input.rowIds.slice(index, index + 500),
                        resolution: input.resolution,
                    },
                });
            }
        },
        onSuccess: async () => {
            toast.success('批量处理已完成');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['catalog-import-rows', jobId] }),
                queryClient.invalidateQueries({ queryKey: ['catalog-import-job', jobId] }),
            ]);
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const executeMutation = useMutation({
        mutationFn: () => api.mutate(executeCatalogImportMutation, { id: jobId }),
        onSuccess: async () => {
            toast.success('导入任务已进入后台队列');
            await queryClient.invalidateQueries({ queryKey: ['catalog-import-job', jobId] });
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const rollbackMutation = useMutation({
        mutationFn: () => api.mutate(rollbackCatalogImportMutation, { id: jobId }),
        onSuccess: async () => {
            toast.success('导入已安全回滚');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['catalog-import-job', jobId] }),
                queryClient.invalidateQueries({ queryKey: ['catalog-import-history'] }),
            ]);
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const unresolved = (job?.conflictCount ?? 0) + (job?.warningCount ?? 0);
    const canExecute = job?.state === 'PREVIEW_READY' && unresolved === 0;
    const running = job?.state === 'QUEUED' || job?.state === 'RUNNING';

    const reset = () => {
        setFile(null);
        setLocalPreview(null);
        setFieldMapping({});
        setMappingDirty(false);
        setTransferProgress(0);
        setJobId(null);
        setActionFilter('ALL');
        setTargetVariantByRow({});
        setClearBlankFields(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[96vw] sm:max-w-[1600px]"
                data-catalog-management-version="v2-browser-local"
            >
                <SheetHeader className="border-b px-6 py-4">
                    <SheetTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="size-5" />
                        商品安全导入中心
                    </SheetTitle>
                    <SheetDescription>
                        先解析和预览差异；只有点击“确认执行”后才会写入商品、价格和库存。
                    </SheetDescription>
                </SheetHeader>

                <Tabs defaultValue="import" className="flex min-h-0 flex-1 flex-col">
                    <div className="border-b px-6 py-3">
                        <TabsList>
                            <TabsTrigger value="import">导入工作区</TabsTrigger>
                            <TabsTrigger value="history">
                                <History className="mr-1 size-4" /> 导入历史
                            </TabsTrigger>
                        </TabsList>
                    </div>
                    <TabsContent value="import" className="m-0 min-h-0 flex-1 overflow-y-auto p-6">
                        {!jobId ? (
                            <UploadPanel
                                file={file}
                                stockLocationId={stockLocationId}
                                locations={locations}
                                channelCode={activeChannel?.code ?? ''}
                                currencyCode={currencyCode}
                                clearBlankFields={clearBlankFields}
                                availableCurrencyCodes={activeChannel?.availableCurrencyCodes ?? []}
                                localPreview={localPreview}
                                fieldMapping={fieldMapping}
                                mappingDirty={mappingDirty}
                                localPending={localParseMutation.isPending}
                                submitPending={previewMutation.isPending}
                                transferProgress={transferProgress}
                                fileInputRef={fileInputRef}
                                onFileChange={event => {
                                    setFile(event.target.files?.[0] ?? null);
                                    setLocalPreview(null);
                                    setFieldMapping({});
                                    setMappingDirty(false);
                                    setTransferProgress(0);
                                }}
                                onStockLocationChange={setStockLocationId}
                                onCurrencyCodeChange={setCurrencyCode}
                                onClearBlankFieldsChange={setClearBlankFields}
                                onFieldMappingChange={(header, field) => {
                                    setFieldMapping(current => ({ ...current, [header]: field }));
                                    setMappingDirty(true);
                                }}
                                onLocalPreview={() => localParseMutation.mutate()}
                                onSubmitPreview={() => {
                                    if (
                                        clearBlankFields &&
                                        !window.confirm(
                                            '已启用空白清除模式。文件中已提供但留空的描述、品牌、标签、条码、规格、单位、保质期和库存预警值将在执行时清除。确认创建预览吗？',
                                        )
                                    ) {
                                        return;
                                    }
                                    previewMutation.mutate();
                                }}
                                onDownloadTemplate={() => void downloadTemplate()}
                            />
                        ) : jobQuery.isLoading || !job ? (
                            <LoadingPreview />
                        ) : (
                            <div className="space-y-5">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <h3 className="text-lg font-semibold">{job.originalFilename}</h3>
                                        <p className="text-sm text-muted-foreground">
                                            {job.stockLocation.name} · {job.currencyCode} ·{' '}
                                            {formatBytes(job.byteSize)}
                                        </p>
                                        {job.clearBlankFields && (
                                            <Badge variant="destructive" className="mt-2">
                                                空白清除模式
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="outline" onClick={reset} disabled={running}>
                                            选择其他文件
                                        </Button>
                                        <Button variant="outline" onClick={() => void downloadReport(job)}>
                                            <Download className="mr-2 size-4" /> 下载报告
                                        </Button>
                                        {['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(job.state) && (
                                            <Button
                                                variant="outline"
                                                disabled={rollbackMutation.isPending}
                                                onClick={() => rollbackMutation.mutate()}
                                            >
                                                <RotateCcw className="mr-2 size-4" /> 安全回滚
                                            </Button>
                                        )}
                                        <Button
                                            disabled={!canExecute || executeMutation.isPending}
                                            onClick={() => {
                                                if (
                                                    job.clearBlankFields &&
                                                    !window.confirm(
                                                        '即将执行空白字段清除。请确认已检查完所有预览差异。',
                                                    )
                                                ) {
                                                    return;
                                                }
                                                executeMutation.mutate();
                                            }}
                                        >
                                            {executeMutation.isPending || running ? (
                                                <Loader2 className="mr-2 size-4 animate-spin" />
                                            ) : (
                                                <Play className="mr-2 size-4" />
                                            )}
                                            确认执行
                                        </Button>
                                    </div>
                                </div>

                                <ImportSummary job={job} />
                                {running && (
                                    <div className="space-y-2 rounded-lg border p-4" role="status">
                                        <div className="flex justify-between text-sm">
                                            <span>后台导入中</span>
                                            <span>{job.progress}%</span>
                                        </div>
                                        <Progress value={job.progress} />
                                    </div>
                                )}
                                {job.errorMessage && (
                                    <Alert variant="destructive">
                                        <XCircle className="size-4" />
                                        <AlertDescription>{job.errorMessage}</AlertDescription>
                                    </Alert>
                                )}
                                {unresolved > 0 && (
                                    <Alert>
                                        <AlertTriangle className="size-4" />
                                        <AlertDescription>
                                            还有 {unresolved}{' '}
                                            行冲突或警告。请逐行选择处理方式，全部处理后才能执行。
                                        </AlertDescription>
                                    </Alert>
                                )}

                                <div className="flex flex-wrap gap-2" aria-label="按导入结果筛选">
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
                                    ).map(action => (
                                        <Button
                                            key={action}
                                            size="sm"
                                            variant={actionFilter === action ? 'default' : 'outline'}
                                            onClick={() => setActionFilter(action)}
                                        >
                                            {actionLabel(action)}
                                        </Button>
                                    ))}
                                    {rows.some(row => row.action === 'WARNING') && (
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            disabled={batchResolveMutation.isPending}
                                            onClick={() => {
                                                const warningIds = rows
                                                    .filter(row => row.action === 'WARNING')
                                                    .map(row => row.id);
                                                if (
                                                    window.confirm(
                                                        `确认继续应用当前列表中的 ${warningIds.length} 条警告吗？`,
                                                    )
                                                ) {
                                                    batchResolveMutation.mutate({
                                                        rowIds: warningIds,
                                                        resolution: 'APPLY',
                                                    });
                                                }
                                            }}
                                        >
                                            批量确认警告
                                        </Button>
                                    )}
                                    {rows.some(row =>
                                        ['CONFLICT', 'WARNING', 'ERROR'].includes(row.action),
                                    ) && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={batchResolveMutation.isPending}
                                            onClick={() => {
                                                const unresolvedIds = rows
                                                    .filter(row =>
                                                        ['CONFLICT', 'WARNING', 'ERROR'].includes(row.action),
                                                    )
                                                    .map(row => row.id);
                                                if (
                                                    window.confirm(
                                                        `确认跳过当前列表中的 ${unresolvedIds.length} 条待处理记录吗？`,
                                                    )
                                                ) {
                                                    batchResolveMutation.mutate({
                                                        rowIds: unresolvedIds,
                                                        resolution: 'SKIP',
                                                    });
                                                }
                                            }}
                                        >
                                            批量跳过待处理行
                                        </Button>
                                    )}
                                </div>

                                <div className="overflow-x-auto rounded-lg border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>行</TableHead>
                                                <TableHead>结果</TableHead>
                                                <TableHead>商品</TableHead>
                                                <TableHead>分类</TableHead>
                                                <TableHead>规格 / 单位</TableHead>
                                                <TableHead>价格 / 库存</TableHead>
                                                <TableHead>说明与处理</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {rows.map(row => (
                                                <ImportRow
                                                    key={row.id}
                                                    row={row}
                                                    targetVariantId={targetVariantByRow[row.id] ?? ''}
                                                    onTargetVariantChange={value =>
                                                        setTargetVariantByRow(current => ({
                                                            ...current,
                                                            [row.id]: value,
                                                        }))
                                                    }
                                                    onResolve={(resolution, targetVariantId) =>
                                                        resolveMutation.mutate({
                                                            rowId: row.id,
                                                            resolution,
                                                            ...(targetVariantId ? { targetVariantId } : {}),
                                                        })
                                                    }
                                                />
                                            ))}
                                            {rows.length === 0 && (
                                                <TableRow>
                                                    <TableCell
                                                        colSpan={7}
                                                        className="py-10 text-center text-muted-foreground"
                                                    >
                                                        当前筛选没有记录
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        )}
                    </TabsContent>
                    <TabsContent value="history" className="m-0 min-h-0 flex-1 overflow-y-auto p-6">
                        <ImportHistory
                            jobs={historyQuery.data?.catalogImportJobs.items ?? []}
                            loading={historyQuery.isLoading}
                            onOpenJob={id => setJobId(id)}
                        />
                    </TabsContent>
                </Tabs>
                <SheetFooter className="border-t px-6 py-3 text-xs text-muted-foreground">
                    默认不会用空白单元格清除已有值；数字 0 会正常更新；所有写入均保留导入审计记录。
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

function UploadPanel({
    file,
    stockLocationId,
    locations,
    channelCode,
    currencyCode,
    clearBlankFields,
    availableCurrencyCodes,
    localPreview,
    fieldMapping,
    mappingDirty,
    localPending,
    submitPending,
    transferProgress,
    fileInputRef,
    onFileChange,
    onStockLocationChange,
    onCurrencyCodeChange,
    onClearBlankFieldsChange,
    onFieldMappingChange,
    onLocalPreview,
    onSubmitPreview,
    onDownloadTemplate,
}: Readonly<{
    file: File | null;
    stockLocationId: string;
    locations: Array<{ id: string; name: string }>;
    channelCode: string;
    currencyCode: string;
    clearBlankFields: boolean;
    availableCurrencyCodes: string[];
    localPreview: LocalCatalogFile | null;
    fieldMapping: Record<string, string>;
    mappingDirty: boolean;
    localPending: boolean;
    submitPending: boolean;
    transferProgress: number;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onStockLocationChange: (value: string) => void;
    onCurrencyCodeChange: (value: string) => void;
    onClearBlankFieldsChange: (value: boolean) => void;
    onFieldMappingChange: (header: string, field: string) => void;
    onLocalPreview: () => void;
    onSubmitPreview: () => void;
    onDownloadTemplate: () => void;
}>) {
    return (
        <div className="mx-auto max-w-3xl space-y-6">
            <Alert>
                <CheckCircle2 className="size-4" />
                <AlertDescription>
                    支持 Numbers、Excel 和
                    CSV。文件只在当前浏览器中解析，原文件不会上传到服务器；确认后仅提交标准化商品字段。
                </AlertDescription>
            </Alert>
            <div className="grid gap-5 rounded-xl border p-6 md:grid-cols-3">
                <div className="space-y-2 md:col-span-3">
                    <Label htmlFor="catalog-import-file">商品资料文件</Label>
                    <Input
                        ref={fileInputRef}
                        id="catalog-import-file"
                        type="file"
                        accept=".numbers,.xlsx,.xls,.csv"
                        onChange={onFileChange}
                    />
                    <p className="text-xs text-muted-foreground">单个文件最大 20MB，最多 20,000 行。</p>
                </div>
                <div className="space-y-2">
                    <Label>目标门店（Dashboard 当前门店）</Label>
                    <Input value={channelCode} disabled />
                </div>
                <div className="space-y-2">
                    <Label>目标仓库</Label>
                    <Select
                        value={stockLocationId}
                        onValueChange={value => value && onStockLocationChange(value)}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="请选择仓库" />
                        </SelectTrigger>
                        <SelectContent>
                            {locations.map(location => (
                                <SelectItem key={location.id} value={location.id}>
                                    {location.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>目标币种</Label>
                    <Select
                        value={currencyCode}
                        onValueChange={value => value && onCurrencyCodeChange(value)}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="请选择币种" />
                        </SelectTrigger>
                        <SelectContent>
                            {availableCurrencyCodes.map(code => (
                                <SelectItem key={code} value={code}>
                                    {code}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-start justify-between gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4 md:col-span-3">
                    <div className="space-y-1">
                        <Label htmlFor="catalog-clear-blank-fields" className="text-destructive">
                            空白字段清除模式（高风险）
                        </Label>
                        <p className="text-xs leading-5 text-muted-foreground">
                            默认关闭。开启后，仅对文件中实际存在的列生效；留空的描述、品牌、标签、条码、规格、单位、保质期、库存预警值和供货商会被清除。SKU、价格、成本和库存数不会被空值清除。
                        </p>
                    </div>
                    <Switch
                        id="catalog-clear-blank-fields"
                        checked={clearBlankFields}
                        onCheckedChange={onClearBlankFieldsChange}
                        aria-label="启用空字段清除模式"
                    />
                </div>
                {file && (
                    <div className="rounded-lg bg-muted p-3 text-sm md:col-span-3">
                        已选择：{file.name} · {formatBytes(file.size)}
                    </div>
                )}
                {localPreview && <LocalPreviewSummary preview={localPreview} />}
                {localPreview && (
                    <FieldMappingEditor
                        headers={localPreview.headers}
                        mapping={fieldMapping}
                        dirty={mappingDirty}
                        onChange={onFieldMappingChange}
                    />
                )}
                {submitPending && transferProgress > 0 && (
                    <div className="space-y-2 md:col-span-3" role="status">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>正在分批提交标准化商品字段</span>
                            <span>{transferProgress}%</span>
                        </div>
                        <Progress value={transferProgress} />
                    </div>
                )}
                <div className="flex flex-wrap justify-end gap-2 md:col-span-3">
                    <Button variant="outline" onClick={onDownloadTemplate}>
                        <Download className="mr-2 size-4" /> 下载标准模板
                    </Button>
                    <Button
                        variant={localPreview ? 'outline' : 'default'}
                        disabled={!file || localPending || submitPending}
                        onClick={onLocalPreview}
                    >
                        {localPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                        {mappingDirty
                            ? '应用字段映射并重新预检'
                            : localPreview
                              ? '重新本地预检'
                              : '浏览器本地预检'}
                    </Button>
                    {localPreview && (
                        <Button
                            disabled={
                                localPreview.errors.length > 0 ||
                                localPreview.unknownHeaders.length > 0 ||
                                mappingDirty ||
                                !stockLocationId ||
                                !currencyCode ||
                                submitPending
                            }
                            onClick={onSubmitPreview}
                        >
                            {submitPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                            生成数据库差异预览
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

function FieldMappingEditor({
    headers,
    mapping,
    dirty,
    onChange,
}: Readonly<{
    headers: string[];
    mapping: Record<string, string>;
    dirty: boolean;
    onChange: (header: string, field: string) => void;
}>) {
    return (
        <div className="space-y-3 rounded-lg border p-4 md:col-span-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h3 className="text-sm font-medium">字段映射</h3>
                    <p className="text-xs text-muted-foreground">
                        可修正自动识别结果；同一系统字段只能映射一次。
                    </p>
                </div>
                {dirty && <Badge variant="secondary">需重新本地预检</Badge>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {headers.filter(Boolean).map(header => (
                    <div key={header} className="space-y-1">
                        <Label className="text-xs">{header}</Label>
                        <Select
                            value={mapping[header] || CATALOG_MAPPING_UNKNOWN}
                            onValueChange={value => {
                                if (value) onChange(header, value);
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={CATALOG_MAPPING_UNKNOWN} disabled>
                                    未解决（阻止预览）
                                </SelectItem>
                                <SelectItem value={CATALOG_MAPPING_EXCLUDED}>明确排除此列</SelectItem>
                                {CATALOG_FIELD_OPTIONS.map(option => {
                                    const usedByAnotherHeader = Object.entries(mapping).some(
                                        ([mappedHeader, field]) =>
                                            mappedHeader !== header && field === option.value,
                                    );
                                    return (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                            disabled={usedByAnotherHeader}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                    </div>
                ))}
            </div>
        </div>
    );
}

function LocalPreviewSummary({ preview }: Readonly<{ preview: LocalCatalogFile }>) {
    return (
        <div
            className="grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 md:col-span-3 sm:grid-cols-2 lg:grid-cols-5"
            data-catalog-local-preview="ready"
        >
            <LocalMetric label="有效行" value={preview.rows.length} />
            <LocalMetric
                label="解析错误"
                value={preview.errors.length}
                destructive={preview.errors.length > 0}
            />
            <LocalMetric
                label="重复冲突组"
                value={preview.duplicateGroups}
                destructive={preview.duplicateGroups > 0}
            />
            <LocalMetric
                label="冲突行"
                value={preview.duplicateRows}
                destructive={preview.duplicateRows > 0}
            />
            <LocalMetric label="风险警告" value={preview.warningRows} destructive={preview.warningRows > 0} />
            <LocalMetric label="已映射列" value={preview.mappedHeaders} />
            <LocalMetric label="明确排除列" value={preview.excludedHeaders.length} />
            <LocalMetric
                label="未知列"
                value={preview.unknownHeaders.length}
                destructive={preview.unknownHeaders.length > 0}
            />
            <div className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">
                {preview.sheetName} · 共 {preview.headers.length} 列（已映射 {preview.mappedHeaders}、明确排除{' '}
                {preview.excludedHeaders.length}、未知 {preview.unknownHeaders.length}）· 文件摘要{' '}
                {preview.fileHash.slice(0, 12)}…
            </div>
            {preview.unknownHeaders.length > 0 && (
                <Alert variant="destructive" className="sm:col-span-2 lg:col-span-5">
                    <AlertTriangle className="size-4" />
                    <AlertDescription>
                        未知列：{preview.unknownHeaders.join('、')}。请映射到系统字段或选择“明确排除此列”。
                    </AlertDescription>
                </Alert>
            )}
            {preview.errors.length > 0 && (
                <Alert variant="destructive" className="sm:col-span-2 lg:col-span-5">
                    <XCircle className="size-4" />
                    <AlertDescription>
                        {preview.errors.slice(0, 5).map(error => (
                            <div key={`${error.rowNumber}-${error.message}`}>{error.message}</div>
                        ))}
                        {preview.errors.length > 5 && (
                            <div>其余 {preview.errors.length - 5} 条错误未显示</div>
                        )}
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
}

function LocalMetric({
    label,
    value,
    destructive = false,
}: Readonly<{ label: string; value: number; destructive?: boolean }>) {
    return (
        <div className="rounded-md bg-background p-3 shadow-sm">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div
                className={
                    destructive ? 'mt-1 text-xl font-semibold text-destructive' : 'mt-1 text-xl font-semibold'
                }
            >
                {value}
            </div>
        </div>
    );
}

function ImportSummary({ job }: Readonly<{ job: CatalogImportJobRecord }>) {
    const cards = [
        ['总行数', job.totalRows, 'outline'],
        ['新增', job.createdCount, 'default'],
        ['修改', job.updatedCount, 'secondary'],
        ['跳过', job.skippedCount, 'outline'],
        ['冲突', job.conflictCount, job.conflictCount ? 'destructive' : 'outline'],
        ['警告', job.warningCount, job.warningCount ? 'destructive' : 'outline'],
        ['错误', job.errorCount, job.errorCount ? 'destructive' : 'outline'],
    ] as const;
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {cards.map(([label, value, variant]) => (
                <div key={label} className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="mt-1 flex items-center justify-between text-xl font-semibold">
                        {value}
                        <Badge variant={variant}>{label}</Badge>
                    </div>
                </div>
            ))}
        </div>
    );
}

function ImportRow({
    row,
    targetVariantId,
    onTargetVariantChange,
    onResolve,
}: Readonly<{
    row: CatalogImportRowRecord;
    targetVariantId: string;
    onTargetVariantChange: (value: string) => void;
    onResolve: (resolution: string, targetVariantId?: string) => void;
}>) {
    const data = row.normalizedData;
    const name = displayValue(data.name);
    const category = displayValue(data.category);
    const specification = displayValue(data.specification);
    const unit = displayValue(data.primaryUnit);
    return (
        <TableRow>
            <TableCell>{row.rowNumber}</TableCell>
            <TableCell>
                <Badge variant={actionVariant(row.action)}>{actionLabel(row.action)}</Badge>
            </TableCell>
            <TableCell className="min-w-44 font-medium">{name}</TableCell>
            <TableCell>{category}</TableCell>
            <TableCell>{[specification, unit].filter(Boolean).join(' / ') || '—'}</TableCell>
            <TableCell className="whitespace-nowrap text-sm">
                售 {displayValue(data.sellingPrice, '—')} · 成本 {displayValue(data.purchaseCost, '—')}
                <br />
                库存 {displayValue(data.stockOnHand, '—')}
            </TableCell>
            <TableCell className="min-w-72">
                <p className="mb-2 text-sm text-muted-foreground">{row.message || '—'}</p>
                {row.action === 'WARNING' && (
                    <div className="flex gap-2">
                        <Button size="sm" onClick={() => onResolve('APPLY')}>
                            确认应用
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onResolve('SKIP')}>
                            跳过
                        </Button>
                    </div>
                )}
                {row.action === 'CONFLICT' && (
                    <div className="space-y-2">
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => onResolve('CREATE_NEW')}>
                                作为新 SKU
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => onResolve('SKIP')}>
                                跳过
                            </Button>
                        </div>
                        <div className="flex gap-2">
                            <Input
                                aria-label="目标 SKU ID"
                                value={targetVariantId}
                                placeholder="或填写目标 SKU ID"
                                onChange={event => onTargetVariantChange(event.target.value)}
                            />
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={!targetVariantId.trim()}
                                onClick={() => onResolve('UPDATE_EXISTING', targetVariantId.trim())}
                            >
                                更新该 SKU
                            </Button>
                        </div>
                    </div>
                )}
                {row.action === 'ERROR' && !row.appliedAt && (
                    <Button size="sm" variant="outline" onClick={() => onResolve('SKIP')}>
                        标记跳过
                    </Button>
                )}
            </TableCell>
        </TableRow>
    );
}

function ImportHistory({
    jobs,
    loading,
    onOpenJob,
}: Readonly<{ jobs: CatalogImportJobRecord[]; loading: boolean; onOpenJob: (id: string) => void }>) {
    if (loading) return <LoadingPreview />;
    if (jobs.length === 0)
        return <div className="py-16 text-center text-muted-foreground">还没有导入记录</div>;
    return (
        <div className="overflow-x-auto rounded-lg border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>文件</TableHead>
                        <TableHead>仓库</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>结果</TableHead>
                        <TableHead>时间</TableHead>
                        <TableHead />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {jobs.map(job => (
                        <TableRow key={job.id}>
                            <TableCell className="font-medium">{job.originalFilename}</TableCell>
                            <TableCell>{job.stockLocation.name}</TableCell>
                            <TableCell>
                                <Badge variant={job.state === 'FAILED' ? 'destructive' : 'outline'}>
                                    {stateLabel(job.state)}
                                </Badge>
                            </TableCell>
                            <TableCell>
                                新增 {job.createdCount} · 修改 {job.updatedCount} · 跳过 {job.skippedCount}
                            </TableCell>
                            <TableCell>{new Date(job.createdAt).toLocaleString()}</TableCell>
                            <TableCell>
                                <Button size="sm" variant="outline" onClick={() => onOpenJob(job.id)}>
                                    查看
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

function LoadingPreview() {
    return (
        <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-80 w-full" />
        </div>
    );
}

function downloadTemplate(): void {
    const rows = [
        [
            '名称（必填）',
            '分类（必填）',
            '门店编码',
            '仓库编码',
            '币种',
            'SKU',
            '条码',
            '规格',
            '销售单位',
            '采购单位',
            '包装换算',
            '库存量',
            '进货价（必填）',
            '销售价（必填）',
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

async function downloadReport(job: CatalogImportJobRecord): Promise<void> {
    try {
        const result = await api.query<{ catalogImportRows: CatalogImportRowRecord[] }>(
            catalogImportRowsQuery,
            { jobId: job.id, action: null },
        );
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
            ['行号', '结果', '处理选择', '商品名称', '分类', 'SKU', '说明', '应用时间'],
            ...result.catalogImportRows.map(row => [
                String(row.rowNumber),
                row.action,
                row.resolution ?? '',
                displayValue(row.normalizedData.name),
                displayValue(row.normalizedData.category),
                displayValue(row.normalizedData.sku),
                row.message ?? '',
                row.appliedAt ?? '',
            ]),
        ]
            .map(row => row.map(csvCell).join(','))
            .join('\r\n');
        const safeName = job.originalFilename.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
        downloadCsv(content, `${safeName || '商品导入'}-导入报告.csv`);
    } catch (error) {
        toast.error(errorMessage(error));
    }
}

function csvCell(value: string): string {
    const safe = /^[=+\-@]/u.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/gu, '""')}"`;
}

function downloadCsv(content: string, filename: string): void {
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function actionLabel(action: ActionFilter | 'PENDING'): string {
    return {
        ALL: '全部',
        PENDING: '接收中',
        CREATE: '新增',
        UPDATE: '修改',
        SKIP_UNCHANGED: '跳过',
        CONFLICT: '冲突',
        WARNING: '警告',
        ERROR: '错误',
    }[action];
}

function actionVariant(
    action: CatalogImportRowRecord['action'],
): 'default' | 'secondary' | 'outline' | 'destructive' {
    if (action === 'CONFLICT' || action === 'WARNING' || action === 'ERROR') return 'destructive';
    if (action === 'CREATE') return 'default';
    if (action === 'UPDATE') return 'secondary';
    return 'outline';
}

function stateLabel(state: CatalogImportJobRecord['state']): string {
    return {
        RECEIVING: '接收数据中',
        PREVIEW_READY: '待确认',
        QUEUED: '排队中',
        RUNNING: '执行中',
        COMPLETED: '已完成',
        COMPLETED_WITH_ERRORS: '部分完成',
        FAILED: '失败',
        ROLLED_BACK: '已回滚',
    }[state];
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function displayValue(value: unknown, fallback = ''): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}
