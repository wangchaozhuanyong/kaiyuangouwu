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
    CatalogImportJobRecord,
    CatalogImportRowRecord,
    catalogImportJobQuery,
    catalogImportJobsQuery,
    catalogImportRowsQuery,
    catalogStandardImportTemplateQuery,
    createCatalogImportPreviewMutation,
    executeCatalogImportMutation,
    resolveCatalogImportRowMutation,
    rollbackCatalogImportMutation,
    stockLocationsQuery,
} from './catalog-management.graphql';

type ActionFilter = 'ALL' | CatalogImportRowRecord['action'];

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
    const [stockLocationId, setStockLocationId] = useState('');
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

    const previewMutation = useMutation({
        mutationFn: () => {
            if (!file || !activeChannel || !stockLocationId) throw new Error('请选择文件和目标仓库');
            return api.mutate<{ createCatalogImportPreview: CatalogImportJobRecord }>(
                createCatalogImportPreviewMutation,
                {
                    file,
                    input: {
                        channelId: activeChannel.id,
                        stockLocationId,
                        currencyCode: activeChannel.defaultCurrencyCode,
                    },
                },
            );
        },
        onSuccess: async result => {
            setJobId(result.createCatalogImportPreview.id);
            setActionFilter('ALL');
            toast.success('文件解析完成，尚未写入商品');
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
        setJobId(null);
        setActionFilter('ALL');
        setTargetVariantByRow({});
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[96vw] sm:max-w-[1600px]">
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
                                currencyCode={activeChannel?.defaultCurrencyCode ?? ''}
                                isPending={previewMutation.isPending}
                                fileInputRef={fileInputRef}
                                onFileChange={event => setFile(event.target.files?.[0] ?? null)}
                                onStockLocationChange={setStockLocationId}
                                onPreview={() => previewMutation.mutate()}
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
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="outline" onClick={reset} disabled={running}>
                                            选择其他文件
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
                                            onClick={() => executeMutation.mutate()}
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
                    空白单元格不会清空已有值；数字 0 会正常更新；所有写入均保留导入审计记录。
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

function UploadPanel({
    file,
    stockLocationId,
    locations,
    currencyCode,
    isPending,
    fileInputRef,
    onFileChange,
    onStockLocationChange,
    onPreview,
    onDownloadTemplate,
}: Readonly<{
    file: File | null;
    stockLocationId: string;
    locations: Array<{ id: string; name: string }>;
    currencyCode: string;
    isPending: boolean;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onStockLocationChange: (value: string) => void;
    onPreview: () => void;
    onDownloadTemplate: () => void;
}>) {
    return (
        <div className="mx-auto max-w-3xl space-y-6">
            <Alert>
                <CheckCircle2 className="size-4" />
                <AlertDescription>
                    支持 Numbers、Excel 和 CSV。上传只创建预览，不会自动新增或修改商品。
                </AlertDescription>
            </Alert>
            <div className="grid gap-5 rounded-xl border p-6 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
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
                    <Input value={currencyCode} disabled />
                </div>
                {file && (
                    <div className="rounded-lg bg-muted p-3 text-sm md:col-span-2">
                        已选择：{file.name} · {formatBytes(file.size)}
                    </div>
                )}
                <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
                    <Button variant="outline" onClick={onDownloadTemplate}>
                        <Download className="mr-2 size-4" /> 下载标准模板
                    </Button>
                    <Button disabled={!file || !stockLocationId || isPending} onClick={onPreview}>
                        {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                        解析并预览
                    </Button>
                </div>
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

async function downloadTemplate(): Promise<void> {
    try {
        const result = await api.query<{ catalogStandardImportTemplate: string }>(
            catalogStandardImportTemplateQuery,
        );
        const blob = new Blob([`\uFEFF${result.catalogStandardImportTemplate}`], {
            type: 'text/csv;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = '商品导入标准模板.csv';
        anchor.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        toast.error(errorMessage(error));
    }
}

function actionLabel(action: ActionFilter): string {
    return {
        ALL: '全部',
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
