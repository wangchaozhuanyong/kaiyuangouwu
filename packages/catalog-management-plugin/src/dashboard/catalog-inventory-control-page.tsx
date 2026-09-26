import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    DashboardRouteDefinition,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { Loader2, RefreshCw, Scale } from 'lucide-react';
import { useState } from 'react';

import { getSystemLabel } from '../../../common/src/display-localization';

import {
    CatalogInventoryOperationRecord,
    CatalogInventoryReconciliationRecord,
    catalogInventoryOperationsQuery,
    catalogInventoryReconciliationQuery,
    resolveCatalogInventoryReconciliationMutation,
} from './catalog-management.graphql';

type ResolutionMode = 'ALIGN_STOCK_TO_LOTS' | 'CREATE_BASELINE_LOT';

interface ResolutionDraft {
    item: CatalogInventoryReconciliationRecord;
    mode: ResolutionMode;
    reason: string;
}

const operationLabels: Record<string, string> = {
    MANUAL_LOT_COUNT: '批次盘点',
    LEGACY_STOCK_ADJUSTMENT: '总库存盘点',
    LOT_TRANSFER: '批次转仓',
    RECONCILIATION: '差异处理',
};
const OPERATION_PAGE_SIZE = 50;

export const catalogInventoryControlRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'catalog',
        id: 'catalog-inventory-control',
        url: '/catalog-inventory-control',
        title: '库存控制台',
        icon: Scale,
        order: 92,
        requiresPermission: ['ReadCatalogOperations'],
    },
    path: '/catalog-inventory-control',
    loader: () => ({ breadcrumb: () => '库存控制台' }),
    component: () => <CatalogInventoryControlPage />,
};

function CatalogInventoryControlPage() {
    const { activeChannel } = useChannel();
    const [draft, setDraft] = useState<ResolutionDraft | null>(null);
    const [operationSkip, setOperationSkip] = useState(0);
    const reconciliation = useQuery({
        queryKey: ['catalog-inventory-reconciliation', activeChannel?.id],
        queryFn: () =>
            api.query<{
                catalogInventoryReconciliation: {
                    items: CatalogInventoryReconciliationRecord[];
                    totalItems: number;
                };
            }>(catalogInventoryReconciliationQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const operations = useQuery({
        queryKey: ['catalog-inventory-operations', activeChannel?.id, operationSkip],
        queryFn: () =>
            api.query<{
                catalogInventoryOperations: {
                    items: CatalogInventoryOperationRecord[];
                    totalItems: number;
                };
            }>(catalogInventoryOperationsQuery, {
                skip: operationSkip,
                take: OPERATION_PAGE_SIZE,
            }),
        enabled: Boolean(activeChannel?.id),
    });
    const resolve = useMutation({
        mutationFn: (value: ResolutionDraft) =>
            api.mutate(resolveCatalogInventoryReconciliationMutation, {
                input: {
                    productVariantId: value.item.productVariantId,
                    stockLocationId: value.item.stockLocationId,
                    expectedDifference: value.item.difference,
                    mode: value.mode,
                    idempotencyKey: crypto.randomUUID(),
                    reason: value.reason.trim(),
                },
            }),
        onSuccess: async () => {
            setDraft(null);
            toast.success('库存差异已处理并记录审计流水');
            await Promise.all([reconciliation.refetch(), operations.refetch()]);
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const rows = reconciliation.data?.catalogInventoryReconciliation.items ?? [];
    const ledger = operations.data?.catalogInventoryOperations.items ?? [];
    const ledgerTotal = operations.data?.catalogInventoryOperations.totalItems ?? 0;
    const refresh = () => void Promise.all([reconciliation.refetch(), operations.refetch()]);

    return (
        <Page pageId="catalog-inventory-control">
            <PageTitle>库存控制台</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" size="icon" onClick={refresh}>
                        <RefreshCw
                            className={`size-4 ${reconciliation.isFetching || operations.isFetching ? 'animate-spin' : ''}`}
                        />
                        <span className="sr-only">刷新</span>
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="catalog-inventory-reconciliation"
                    title="批次与总库存对账"
                    description="只检查已启用批次的 SKU；处理时会校验差异未变化，并强制留下原因。"
                >
                    {reconciliation.isPending ? (
                        <LoadingRows />
                    ) : reconciliation.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription>库存对账加载失败，请刷新重试。</AlertDescription>
                        </Alert>
                    ) : rows.length === 0 ? (
                        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                            当前批次数量与平台总库存一致
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>SKU</TableHead>
                                        <TableHead>仓库</TableHead>
                                        <TableHead>批次合计</TableHead>
                                        <TableHead>总库存</TableHead>
                                        <TableHead>差异</TableHead>
                                        <TableHead className="text-right">处理</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map(item => (
                                        <TableRow key={item.id}>
                                            <TableCell>
                                                <div className="font-medium">{item.variantName}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {item.sku}
                                                </div>
                                            </TableCell>
                                            <TableCell>{item.stockLocationName}</TableCell>
                                            <TableCell>{item.lotQuantity}</TableCell>
                                            <TableCell>{item.stockOnHand}</TableCell>
                                            <TableCell>
                                                <Badge variant="destructive">{signed(item.difference)}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    size="sm"
                                                    onClick={() =>
                                                        setDraft({
                                                            item,
                                                            mode: item.canCreateBaselineLot
                                                                ? 'CREATE_BASELINE_LOT'
                                                                : 'ALIGN_STOCK_TO_LOTS',
                                                            reason: '',
                                                        })
                                                    }
                                                >
                                                    处理差异
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </PageBlock>

                <PageBlock
                    column="full"
                    blockId="catalog-inventory-ledger"
                    title="库存审计流水"
                    description="批次盘点、总库存调整、转仓与差异处理都保留操作前后数量和原因。"
                >
                    {operations.isPending ? (
                        <LoadingRows />
                    ) : operations.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription>库存流水加载失败，请刷新重试。</AlertDescription>
                        </Alert>
                    ) : ledger.length === 0 ? (
                        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                            暂无手工库存操作流水
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>流水</TableHead>
                                        <TableHead>类型</TableHead>
                                        <TableHead>SKU / 仓库</TableHead>
                                        <TableHead>数量变化</TableHead>
                                        <TableHead>原因</TableHead>
                                        <TableHead>时间</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {ledger.map(operation => (
                                        <TableRow key={operation.id}>
                                            <TableCell
                                                data-business-reference="inventory-operation"
                                                className="font-mono text-xs"
                                            >
                                                {operation.code}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline">
                                                    {getSystemLabel(
                                                        operation.type,
                                                        operationLabels,
                                                        'zh',
                                                        'type',
                                                    )}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {operation.lines.map(line => (
                                                    <div key={line.id} className="text-sm">
                                                        {line.variant.sku} · {line.stockLocation.name}
                                                        {line.inventoryLot
                                                            ? ` · ${line.inventoryLot.lotCode}`
                                                            : ''}
                                                    </div>
                                                ))}
                                            </TableCell>
                                            <TableCell>
                                                {operation.lines.map(line => (
                                                    <div key={line.id} className="font-mono text-sm">
                                                        {signed(line.quantityDelta)}
                                                    </div>
                                                ))}
                                            </TableCell>
                                            <TableCell className="max-w-sm whitespace-normal">
                                                {operation.reason}
                                            </TableCell>
                                            <TableCell>{formatDate(operation.postedAt)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                    {ledgerTotal > OPERATION_PAGE_SIZE && (
                        <div className="mt-4 flex items-center justify-end gap-3 text-sm text-muted-foreground">
                            <span>
                                {operationSkip + 1}–
                                {Math.min(operationSkip + OPERATION_PAGE_SIZE, ledgerTotal)} / {ledgerTotal}
                            </span>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={operationSkip === 0 || operations.isFetching}
                                onClick={() =>
                                    setOperationSkip(value => Math.max(0, value - OPERATION_PAGE_SIZE))
                                }
                            >
                                上一页
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                    operationSkip + OPERATION_PAGE_SIZE >= ledgerTotal ||
                                    operations.isFetching
                                }
                                onClick={() => setOperationSkip(value => value + OPERATION_PAGE_SIZE)}
                            >
                                下一页
                            </Button>
                        </div>
                    )}
                </PageBlock>
            </PageLayout>
            <ResolutionDialog
                draft={draft}
                pending={resolve.isPending}
                onChange={setDraft}
                onClose={() => setDraft(null)}
                onSubmit={() => draft && resolve.mutate(draft)}
            />
        </Page>
    );
}

function ResolutionDialog({
    draft,
    pending,
    onChange,
    onClose,
    onSubmit,
}: Readonly<{
    draft: ResolutionDraft | null;
    pending: boolean;
    onChange: (draft: ResolutionDraft | null) => void;
    onClose: () => void;
    onSubmit: () => void;
}>) {
    if (!draft) return null;
    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>处理库存差异</DialogTitle>
                    <DialogDescription>
                        {draft.item.sku} · {draft.item.stockLocationName}，当前差异{' '}
                        {signed(draft.item.difference)}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label>处理方式</Label>
                        <Select
                            value={draft.mode}
                            onValueChange={mode => mode && onChange({ ...draft, mode })}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALIGN_STOCK_TO_LOTS">
                                    以批次为准，调整平台总库存
                                </SelectItem>
                                {draft.item.canCreateBaselineLot && (
                                    <SelectItem value="CREATE_BASELINE_LOT">
                                        以总库存为准，建立期初批次
                                    </SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="inventory-reconciliation-reason">处理原因</Label>
                        <Input
                            id="inventory-reconciliation-reason"
                            value={draft.reason}
                            placeholder="必填：盘点单号或差异说明"
                            onChange={event => onChange({ ...draft, reason: event.target.value })}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        取消
                    </Button>
                    <Button onClick={onSubmit} disabled={pending || !draft.reason.trim()}>
                        {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                        确认处理
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function LoadingRows() {
    return (
        <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
        </div>
    );
}

function signed(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '操作失败，请重试';
}
