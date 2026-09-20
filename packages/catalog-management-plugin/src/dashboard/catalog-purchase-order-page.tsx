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
    Sheet,
    SheetContent,
    SheetDescription,
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
    Textarea,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { ClipboardCheck, Loader2, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
    CatalogPurchaseOrderRecord,
    CatalogPurchaseOrderStatus,
    CatalogSupplierRecord,
    cancelCatalogPurchaseOrderMutation,
    catalogPurchaseOrderQuery,
    catalogPurchaseOrdersQuery,
    catalogPurchaseVariantsQuery,
    catalogSuppliersQuery,
    closeCatalogPurchaseOrderMutation,
    createCatalogPurchaseOrderMutation,
    disputeCatalogPurchasePaymentMutation,
    receiveCatalogPurchaseOrderMutation,
    recordCatalogPurchasePaymentMutation,
    returnCatalogPurchaseOrderMutation,
    stockLocationsQuery,
    submitCatalogPurchaseOrderMutation,
} from './catalog-management.graphql';

const PAGE_SIZE = 50;
const statusLabel: Record<CatalogPurchaseOrderStatus, string> = {
    DRAFT: '草稿',
    SUBMITTED: '已提交',
    PARTIALLY_RECEIVED: '部分收货',
    RECEIVED: '已收货',
    VARIANCE_REVIEW: '待处理差异',
    CLOSED: '已结案',
    CANCELLED: '已取消',
};

interface VariantChoice {
    id: string;
    name: string;
    sku: string;
    customFields?: { purchaseUnit?: string | null } | null;
}

interface OrderDraft {
    supplierId: string;
    stockLocationId: string;
    expectedAt: string;
    notes: string;
    lines: Array<{ variantId: string; quantity: string; unitCost: string }>;
}

type ActionMode = 'RECEIVE' | 'RETURN' | 'PAY' | 'CLOSE' | 'CANCEL' | 'DISPUTE' | null;

export const catalogPurchaseOrderRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'catalog',
        id: 'catalog-purchase-orders',
        url: '/catalog-purchase-orders',
        title: '采购与收货',
        icon: ClipboardCheck,
        order: 91,
        requiresPermission: ['ReadCatalogSupplier', 'ReadCatalogOperations'],
    },
    path: '/catalog-purchase-orders',
    loader: () => ({ breadcrumb: () => '采购与收货' }),
    component: () => <CatalogPurchaseOrderPage />,
};

function CatalogPurchaseOrderPage() {
    const { activeChannel } = useChannel();
    const [text, setText] = useState('');
    const [status, setStatus] = useState<CatalogPurchaseOrderStatus | 'ALL'>('ALL');
    const [exceptionsOnly, setExceptionsOnly] = useState(false);
    const [skip, setSkip] = useState(0);
    const [createOpen, setCreateOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const query = useQuery({
        queryKey: ['catalog-purchase-orders', activeChannel?.id, text, status, exceptionsOnly, skip],
        queryFn: () =>
            api.query<{
                catalogPurchaseOrders: { items: CatalogPurchaseOrderRecord[]; totalItems: number };
            }>(catalogPurchaseOrdersQuery, {
                options: {
                    skip,
                    take: PAGE_SIZE,
                    text: text.trim() || null,
                    status: status === 'ALL' ? null : status,
                    exceptionsOnly,
                },
            }),
        enabled: Boolean(activeChannel?.id),
    });
    const result = query.data?.catalogPurchaseOrders;

    return (
        <Page pageId="catalog-purchase-orders">
            <PageTitle>采购与收货</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" size="icon" onClick={() => void query.refetch()}>
                        <RefreshCw className={`size-4 ${query.isFetching ? 'animate-spin' : ''}`} />
                        <span className="sr-only">刷新</span>
                    </Button>
                    <Button onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-2 size-4" />
                        新建采购单
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="catalog-purchase-order-list"
                    title="采购执行台"
                    description="采购单、分批收货、差异处理、应付对账与批次库存在同一条审计链中。"
                >
                    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                        <Input
                            className="lg:max-w-sm"
                            placeholder="搜索采购单号或供货商"
                            value={text}
                            onChange={event => {
                                setText(event.target.value);
                                setSkip(0);
                            }}
                        />
                        <Select
                            value={status}
                            onValueChange={value => {
                                setStatus(value as typeof status);
                                setSkip(0);
                            }}
                        >
                            <SelectTrigger className="lg:w-48">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">全部状态</SelectItem>
                                {Object.entries(statusLabel).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                            <Switch
                                checked={exceptionsOnly}
                                onCheckedChange={value => {
                                    setExceptionsOnly(value);
                                    setSkip(0);
                                }}
                            />
                            只看异常队列
                        </label>
                    </div>
                    {query.isPending ? (
                        <div className="space-y-3">
                            <Skeleton className="h-12" />
                            <Skeleton className="h-12" />
                        </div>
                    ) : query.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription>采购单加载失败，请刷新后重试。</AlertDescription>
                        </Alert>
                    ) : !result?.items.length ? (
                        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                            当前筛选下没有采购单
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>采购单</TableHead>
                                        <TableHead>供货商</TableHead>
                                        <TableHead>状态</TableHead>
                                        <TableHead>收货进度</TableHead>
                                        <TableHead>应付</TableHead>
                                        <TableHead>预计到货</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {result.items.map(order => (
                                        <TableRow
                                            key={order.id}
                                            className="cursor-pointer"
                                            onClick={() => setSelectedId(order.id)}
                                        >
                                            <TableCell className="font-medium">{order.code}</TableCell>
                                            <TableCell>{order.supplier.name}</TableCell>
                                            <TableCell>
                                                <OrderStatus order={order} />
                                            </TableCell>
                                            <TableCell>
                                                {order.lines.reduce(
                                                    (sum, line) => sum + line.receivedQuantity,
                                                    0,
                                                )}{' '}
                                                /{' '}
                                                {order.lines.reduce(
                                                    (sum, line) => sum + line.orderedQuantity,
                                                    0,
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {money(order.outstandingMicrounits, order.currencyCode)}
                                            </TableCell>
                                            <TableCell>
                                                {order.expectedAt ? date(order.expectedAt) : '—'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                        <span>共 {result?.totalItems ?? 0} 张采购单</span>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={!skip}
                                onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
                            >
                                上一页
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={skip + PAGE_SIZE >= (result?.totalItems ?? 0)}
                                onClick={() => setSkip(skip + PAGE_SIZE)}
                            >
                                下一页
                            </Button>
                        </div>
                    </div>
                </PageBlock>
            </PageLayout>
            <CreateOrderDialog
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                onSaved={async id => {
                    setCreateOpen(false);
                    await query.refetch();
                    setSelectedId(id);
                }}
            />
            <OrderDetailSheet
                id={selectedId}
                onClose={() => setSelectedId(null)}
                onChanged={() => query.refetch()}
            />
        </Page>
    );
}

function CreateOrderDialog({
    open,
    onClose,
    onSaved,
}: Readonly<{ open: boolean; onClose: () => void; onSaved: (id: string) => void | Promise<void> }>) {
    const { activeChannel } = useChannel();
    const [draft, setDraft] = useState<OrderDraft>(() => emptyDraft());
    const suppliers = useQuery({
        queryKey: ['purchase-create-suppliers', activeChannel?.id],
        queryFn: () =>
            api.query<{ catalogSuppliers: { items: CatalogSupplierRecord[] } }>(catalogSuppliersQuery, {
                options: { take: 200, enabled: true },
            }),
        enabled: open,
    });
    const locations = useQuery({
        queryKey: ['purchase-create-locations', activeChannel?.id],
        queryFn: () =>
            api.query<{ stockLocations: { items: Array<{ id: string; name: string }> } }>(
                stockLocationsQuery,
            ),
        enabled: open,
    });
    const variants = useQuery({
        queryKey: ['purchase-create-variants', activeChannel?.id],
        queryFn: () =>
            api.query<{ productVariants: { items: VariantChoice[] } }>(catalogPurchaseVariantsQuery, {
                options: { take: 200 },
            }),
        enabled: open,
    });
    const save = useMutation({
        mutationFn: () =>
            api.mutate<{ createCatalogPurchaseOrder: CatalogPurchaseOrderRecord }>(
                createCatalogPurchaseOrderMutation,
                {
                    input: {
                        supplierId: draft.supplierId,
                        stockLocationId: draft.stockLocationId,
                        currencyCode: activeChannel?.defaultCurrencyCode,
                        expectedAt: draft.expectedAt
                            ? new Date(`${draft.expectedAt}T12:00:00`).toISOString()
                            : null,
                        notes: draft.notes,
                        lines: draft.lines.map(line => ({
                            productVariantId: line.variantId,
                            orderedQuantity: Number(line.quantity),
                            unitCostMicrounits: Math.round(Number(line.unitCost) * 1000),
                        })),
                    },
                },
            ),
        onSuccess: result => {
            toast.success('采购单草稿已创建');
            setDraft(emptyDraft());
            return onSaved(result.createCatalogPurchaseOrder.id);
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const choices = variants.data?.productVariants.items ?? [];
    const valid = Boolean(
        draft.supplierId &&
        draft.stockLocationId &&
        draft.lines.length &&
        draft.lines.every(line => line.variantId && Number(line.quantity) > 0 && Number(line.unitCost) >= 0),
    );
    return (
        <Dialog open={open} onOpenChange={value => !value && onClose()}>
            <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>新建采购单</DialogTitle>
                    <DialogDescription>
                        先保存草稿，确认后再提交。数量按库存单位记录，收货时生成批次。
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4 sm:grid-cols-2">
                    <Field label="供货商">
                        <Select
                            value={draft.supplierId}
                            onValueChange={supplierId => setDraft({ ...draft, supplierId: supplierId ?? '' })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="选择供货商" />
                            </SelectTrigger>
                            <SelectContent>
                                {(suppliers.data?.catalogSuppliers.items ?? []).map(item => (
                                    <SelectItem key={item.id} value={item.id}>
                                        {item.name} · {item.code}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label="收货仓库">
                        <Select
                            value={draft.stockLocationId}
                            onValueChange={stockLocationId =>
                                setDraft({ ...draft, stockLocationId: stockLocationId ?? '' })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="选择仓库" />
                            </SelectTrigger>
                            <SelectContent>
                                {(locations.data?.stockLocations.items ?? []).map(item => (
                                    <SelectItem key={item.id} value={item.id}>
                                        {item.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label="预计到货日">
                        <Input
                            type="date"
                            value={draft.expectedAt}
                            onChange={event => setDraft({ ...draft, expectedAt: event.target.value })}
                        />
                    </Field>
                    <Field label="内部备注">
                        <Input
                            value={draft.notes}
                            onChange={event => setDraft({ ...draft, notes: event.target.value })}
                        />
                    </Field>
                    <div className="space-y-3 sm:col-span-2">
                        <div className="flex items-center justify-between">
                            <Label>SKU 明细</Label>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                    setDraft({
                                        ...draft,
                                        lines: [
                                            ...draft.lines,
                                            { variantId: '', quantity: '1', unitCost: '0' },
                                        ],
                                    })
                                }
                            >
                                <Plus className="mr-1 size-3" />
                                添加 SKU
                            </Button>
                        </div>
                        {draft.lines.map((line, index) => (
                            <div
                                key={index}
                                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_120px_150px_36px]"
                            >
                                <Select
                                    value={line.variantId}
                                    onValueChange={variantId =>
                                        setDraft({
                                            ...draft,
                                            lines: draft.lines.map((item, i) =>
                                                i === index ? { ...item, variantId: variantId ?? '' } : item,
                                            ),
                                        })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="选择 SKU" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {choices
                                            .filter(
                                                choice =>
                                                    choice.id === line.variantId ||
                                                    !draft.lines.some(
                                                        (item, i) =>
                                                            i !== index && item.variantId === choice.id,
                                                    ),
                                            )
                                            .map(choice => (
                                                <SelectItem key={choice.id} value={choice.id}>
                                                    {choice.name} · {choice.sku}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                                <Input
                                    type="number"
                                    min="1"
                                    step="1"
                                    aria-label="采购数量"
                                    value={line.quantity}
                                    onChange={event =>
                                        setDraft({
                                            ...draft,
                                            lines: draft.lines.map((item, i) =>
                                                i === index
                                                    ? { ...item, quantity: event.target.value }
                                                    : item,
                                            ),
                                        })
                                    }
                                />
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    aria-label="单价"
                                    value={line.unitCost}
                                    onChange={event =>
                                        setDraft({
                                            ...draft,
                                            lines: draft.lines.map((item, i) =>
                                                i === index
                                                    ? { ...item, unitCost: event.target.value }
                                                    : item,
                                            ),
                                        })
                                    }
                                />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="删除 SKU"
                                    onClick={() =>
                                        setDraft({
                                            ...draft,
                                            lines: draft.lines.filter((_, i) => i !== index),
                                        })
                                    }
                                >
                                    <Trash2 className="size-4" />
                                </Button>
                            </div>
                        ))}
                        <p className="text-xs text-muted-foreground">
                            从左到右：SKU、库存单位数量、含税单价（
                            {activeChannel?.defaultCurrencyCode ?? '门店币种'}）。
                        </p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
                        {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}保存草稿
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function OrderDetailSheet({
    id,
    onClose,
    onChanged,
}: Readonly<{ id: string | null; onClose: () => void; onChanged: () => void | Promise<unknown> }>) {
    const [mode, setMode] = useState<ActionMode>(null);
    const detail = useQuery({
        queryKey: ['catalog-purchase-order', id],
        queryFn: () =>
            api.query<{ catalogPurchaseOrder: CatalogPurchaseOrderRecord }>(catalogPurchaseOrderQuery, {
                id,
            }),
        enabled: Boolean(id),
    });
    const order = detail.data?.catalogPurchaseOrder;
    const mutate = useMutation({
        mutationFn: ({
            document,
            variables,
        }: {
            document: Parameters<typeof api.mutate>[0];
            variables: Record<string, unknown>;
        }) => api.mutate(document, variables),
        onSuccess: async () => {
            toast.success('采购单已更新');
            setMode(null);
            await detail.refetch();
            await onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    return (
        <Sheet open={Boolean(id)} onOpenChange={value => !value && onClose()}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-4xl">
                <SheetHeader>
                    <SheetTitle>{order?.code ?? '采购单'}</SheetTitle>
                    <SheetDescription>
                        {order ? `${order.supplier.name} · ${order.stockLocation.name}` : '正在加载采购单'}
                    </SheetDescription>
                </SheetHeader>
                {detail.isPending || !order ? (
                    <Skeleton className="mt-6 h-80" />
                ) : (
                    <div className="space-y-6 py-6">
                        <div className="flex flex-wrap items-center gap-2">
                            <OrderStatus order={order} />
                            <Badge variant="outline">{paymentLabel(order.paymentStatus)}</Badge>
                            {order.overdue && <Badge variant="destructive">逾期未收齐</Badge>}
                        </div>
                        <div className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-4">
                            <Metric
                                label="采购总额"
                                value={money(order.totalMicrounits, order.currencyCode)}
                            />
                            <Metric
                                label="退供贷项"
                                value={money(order.returnCreditMicrounits, order.currencyCode)}
                            />
                            <Metric label="已付" value={money(order.paidMicrounits, order.currencyCode)} />
                            <Metric
                                label="待付"
                                value={money(order.outstandingMicrounits, order.currencyCode)}
                            />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {order.status === 'DRAFT' && (
                                <Button
                                    onClick={() =>
                                        mutate.mutate({
                                            document: submitCatalogPurchaseOrderMutation,
                                            variables: { id: order.id },
                                        })
                                    }
                                >
                                    提交采购单
                                </Button>
                            )}
                            {['SUBMITTED', 'PARTIALLY_RECEIVED'].includes(order.status) && (
                                <Button onClick={() => setMode('RECEIVE')}>登记收货</Button>
                            )}
                            {order.lines.some(
                                line => line.returnableQuantity > 0 && line.returnableLots.length > 0,
                            ) && (
                                <Button variant="outline" onClick={() => setMode('RETURN')}>
                                    登记退供
                                </Button>
                            )}
                            {['RECEIVED', 'VARIANCE_REVIEW'].includes(order.status) && (
                                <Button onClick={() => setMode('CLOSE')}>结案</Button>
                            )}
                            {!['DRAFT', 'CANCELLED'].includes(order.status) &&
                                order.outstandingMicrounits > 0 && (
                                    <Button variant="outline" onClick={() => setMode('PAY')}>
                                        记录付款
                                    </Button>
                                )}
                            {!['DRAFT', 'CANCELLED'].includes(order.status) && (
                                <Button variant="outline" onClick={() => setMode('DISPUTE')}>
                                    标记付款争议
                                </Button>
                            )}
                            {['DRAFT', 'SUBMITTED'].includes(order.status) && (
                                <Button variant="destructive" onClick={() => setMode('CANCEL')}>
                                    取消采购单
                                </Button>
                            )}
                        </div>
                        <div>
                            <h3 className="mb-2 text-sm font-semibold">SKU 与收货差异</h3>
                            <div className="overflow-x-auto rounded-lg border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>SKU</TableHead>
                                            <TableHead>订购</TableHead>
                                            <TableHead>到货</TableHead>
                                            <TableHead>合格</TableHead>
                                            <TableHead>不合格</TableHead>
                                            <TableHead>待收</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {order.lines.map(line => (
                                            <TableRow key={line.id}>
                                                <TableCell>
                                                    <div className="font-medium">{line.variant.name}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {line.variant.sku}
                                                    </div>
                                                </TableCell>
                                                <TableCell>{line.orderedQuantity}</TableCell>
                                                <TableCell>{line.receivedQuantity}</TableCell>
                                                <TableCell>{line.acceptedQuantity}</TableCell>
                                                <TableCell
                                                    className={
                                                        line.rejectedQuantity ? 'text-destructive' : ''
                                                    }
                                                >
                                                    {line.rejectedQuantity}
                                                </TableCell>
                                                <TableCell>{line.outstandingQuantity}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                        <div>
                            <h3 className="mb-2 text-sm font-semibold">审计记录</h3>
                            <div className="space-y-2">
                                {order.events.map(event => (
                                    <div key={event.id} className="rounded-lg border p-3 text-sm">
                                        <div className="flex justify-between gap-4">
                                            <span className="font-medium">{event.summary}</span>
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {dateTime(event.createdAt)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                {order && (
                    <OrderActionDialog
                        key={`${order.id}:${order.updatedAt}:${mode ?? 'NONE'}`}
                        order={order}
                        mode={mode}
                        pending={mutate.isPending}
                        onClose={() => setMode(null)}
                        onSubmit={(document, variables) => mutate.mutate({ document, variables })}
                    />
                )}
            </SheetContent>
        </Sheet>
    );
}

function OrderActionDialog({
    order,
    mode,
    pending,
    onClose,
    onSubmit,
}: Readonly<{
    order: CatalogPurchaseOrderRecord;
    mode: ActionMode;
    pending: boolean;
    onClose: () => void;
    onSubmit: (document: Parameters<typeof api.mutate>[0], variables: Record<string, unknown>) => void;
}>) {
    const receivable = useMemo(() => order.lines.filter(line => line.outstandingQuantity > 0), [order]);
    const [note, setNote] = useState('');
    const [reference, setReference] = useState('');
    const [amount, setAmount] = useState('');
    const [receiptReference, setReceiptReference] = useState('');
    const [supplierAcknowledgement, setSupplierAcknowledgement] = useState('');
    const [receiptLines, setReceiptLines] = useState(() =>
        receivable.map(line => ({
            id: line.id,
            received: String(line.outstandingQuantity),
            accepted: String(line.outstandingQuantity),
            rejected: '0',
            lotCode: `${order.code}-${line.variant.sku}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
            rejectionReason: '',
        })),
    );
    const [returnLines, setReturnLines] = useState(() =>
        order.lines
            .filter(line => line.returnableQuantity > 0 && line.returnableLots.length > 0)
            .map(line => ({
                id: line.id,
                inventoryLotId: line.returnableLots[0].id,
                quantity: '0',
                reason: '',
            })),
    );
    if (!mode) return null;
    const submit = () => {
        if (mode === 'RECEIVE')
            onSubmit(receiveCatalogPurchaseOrderMutation, {
                input: {
                    purchaseOrderId: order.id,
                    idempotencyKey: crypto.randomUUID(),
                    supplierDeliveryReference: receiptReference || null,
                    notes: note,
                    lines: receiptLines
                        .filter(line => Number(line.received) > 0)
                        .map(line => ({
                            purchaseOrderLineId: line.id,
                            receivedQuantity: Number(line.received),
                            acceptedQuantity: Number(line.accepted),
                            rejectedQuantity: Number(line.rejected),
                            lotCode: line.lotCode || null,
                            rejectionReason: line.rejectionReason || null,
                        })),
                },
            });
        if (mode === 'RETURN')
            onSubmit(returnCatalogPurchaseOrderMutation, {
                input: {
                    purchaseOrderId: order.id,
                    idempotencyKey: crypto.randomUUID(),
                    supplierAcknowledgementReference: supplierAcknowledgement,
                    notes: note,
                    lines: returnLines
                        .filter(line => Number(line.quantity) > 0)
                        .map(line => ({
                            purchaseOrderLineId: line.id,
                            inventoryLotId: line.inventoryLotId,
                            quantity: Number(line.quantity),
                            reason: line.reason,
                        })),
                },
            });
        if (mode === 'PAY')
            onSubmit(recordCatalogPurchasePaymentMutation, {
                input: {
                    purchaseOrderId: order.id,
                    amountMicrounits: Math.round(Number(amount) * 1000),
                    reference,
                    note,
                },
            });
        if (mode === 'CLOSE') onSubmit(closeCatalogPurchaseOrderMutation, { id: order.id, note });
        if (mode === 'CANCEL') onSubmit(cancelCatalogPurchaseOrderMutation, { id: order.id, note });
        if (mode === 'DISPUTE') onSubmit(disputeCatalogPurchasePaymentMutation, { id: order.id, note });
    };
    const valid =
        mode === 'RECEIVE'
            ? receiptLines.some(line => Number(line.received) > 0) &&
              receiptLines.every(
                  line =>
                      Number(line.received) === Number(line.accepted) + Number(line.rejected) &&
                      (Number(line.accepted) === 0 || line.lotCode.trim()) &&
                      (Number(line.rejected) === 0 || line.rejectionReason.trim()),
              )
            : mode === 'RETURN'
              ? Boolean(supplierAcknowledgement.trim()) &&
                returnLines.some(line => Number(line.quantity) > 0) &&
                returnLines
                    .filter(line => Number(line.quantity) > 0)
                    .every(line => Boolean(line.inventoryLotId && line.reason.trim()))
              : mode === 'PAY'
                ? Number(amount) > 0 &&
                  Number(amount) * 1000 <= order.outstandingMicrounits &&
                  Boolean(reference.trim())
                : mode === 'CLOSE'
                  ? order.status !== 'VARIANCE_REVIEW' || Boolean(note.trim())
                  : Boolean(note.trim());
    return (
        <Dialog open onOpenChange={value => !value && onClose()}>
            <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{modeTitle(mode)}</DialogTitle>
                    <DialogDescription>
                        {mode === 'RECEIVE'
                            ? '合格数量会立即增加批次库存；不合格数量只记录差异，不入库。'
                            : mode === 'RETURN'
                              ? '退供会从指定批次扣减库存并冲减应付；已付超额会自动进入付款争议。'
                              : '操作会写入采购单审计记录。'}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-3">
                    {mode === 'RECEIVE' && (
                        <>
                            <Field label="供货商送货单号">
                                <Input
                                    value={receiptReference}
                                    onChange={event => setReceiptReference(event.target.value)}
                                />
                            </Field>
                            {receiptLines.map((line, index) => {
                                const source = order.lines.find(item => item.id === line.id);
                                return (
                                    <div key={line.id} className="space-y-2 rounded-lg border p-3">
                                        <div className="font-medium">
                                            {source?.variant.name} · {source?.variant.sku}
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-3">
                                            <Field label="到货">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    value={line.received}
                                                    onChange={event =>
                                                        setReceiptLines(
                                                            receiptLines.map((item, i) =>
                                                                i === index
                                                                    ? {
                                                                          ...item,
                                                                          received: event.target.value,
                                                                      }
                                                                    : item,
                                                            ),
                                                        )
                                                    }
                                                />
                                            </Field>
                                            <Field label="合格">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    value={line.accepted}
                                                    onChange={event =>
                                                        setReceiptLines(
                                                            receiptLines.map((item, i) =>
                                                                i === index
                                                                    ? {
                                                                          ...item,
                                                                          accepted: event.target.value,
                                                                      }
                                                                    : item,
                                                            ),
                                                        )
                                                    }
                                                />
                                            </Field>
                                            <Field label="不合格">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    value={line.rejected}
                                                    onChange={event =>
                                                        setReceiptLines(
                                                            receiptLines.map((item, i) =>
                                                                i === index
                                                                    ? {
                                                                          ...item,
                                                                          rejected: event.target.value,
                                                                      }
                                                                    : item,
                                                            ),
                                                        )
                                                    }
                                                />
                                            </Field>
                                        </div>
                                        <Field label="合格品批次号">
                                            <Input
                                                value={line.lotCode}
                                                onChange={event =>
                                                    setReceiptLines(
                                                        receiptLines.map((item, i) =>
                                                            i === index
                                                                ? { ...item, lotCode: event.target.value }
                                                                : item,
                                                        ),
                                                    )
                                                }
                                            />
                                        </Field>
                                        {Number(line.rejected) > 0 && (
                                            <Field label="不合格原因">
                                                <Input
                                                    value={line.rejectionReason}
                                                    onChange={event =>
                                                        setReceiptLines(
                                                            receiptLines.map((item, i) =>
                                                                i === index
                                                                    ? {
                                                                          ...item,
                                                                          rejectionReason: event.target.value,
                                                                      }
                                                                    : item,
                                                            ),
                                                        )
                                                    }
                                                />
                                            </Field>
                                        )}
                                    </div>
                                );
                            })}
                        </>
                    )}
                    {mode === 'RETURN' && (
                        <>
                            <Field label="供货商退货确认号">
                                <Input
                                    value={supplierAcknowledgement}
                                    onChange={event => setSupplierAcknowledgement(event.target.value)}
                                />
                            </Field>
                            {returnLines.map((line, index) => {
                                const source = order.lines.find(item => item.id === line.id);
                                return (
                                    <div key={line.id} className="space-y-2 rounded-lg border p-3">
                                        <div className="font-medium">
                                            {source?.variant.name} · {source?.variant.sku}
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <Field label="原收货批次">
                                                <Select
                                                    value={line.inventoryLotId}
                                                    onValueChange={inventoryLotId =>
                                                        setReturnLines(
                                                            returnLines.map((item, i) =>
                                                                i === index
                                                                    ? {
                                                                          ...item,
                                                                          inventoryLotId:
                                                                              inventoryLotId ?? '',
                                                                      }
                                                                    : item,
                                                            ),
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {source?.returnableLots.map(lot => (
                                                            <SelectItem key={lot.id} value={lot.id}>
                                                                {lot.lotCode} · 可用 {lot.quantityOnHand}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </Field>
                                            <Field label="退供数量">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    max={source?.returnableQuantity}
                                                    value={line.quantity}
                                                    onChange={event =>
                                                        setReturnLines(
                                                            returnLines.map((item, i) =>
                                                                i === index
                                                                    ? {
                                                                          ...item,
                                                                          quantity: event.target.value,
                                                                      }
                                                                    : item,
                                                            ),
                                                        )
                                                    }
                                                />
                                            </Field>
                                        </div>
                                        <Field label="退供原因">
                                            <Input
                                                value={line.reason}
                                                onChange={event =>
                                                    setReturnLines(
                                                        returnLines.map((item, i) =>
                                                            i === index
                                                                ? { ...item, reason: event.target.value }
                                                                : item,
                                                        ),
                                                    )
                                                }
                                            />
                                        </Field>
                                    </div>
                                );
                            })}
                        </>
                    )}
                    {mode === 'PAY' && (
                        <>
                            <Field label={`付款金额（${order.currencyCode}）`}>
                                <Input
                                    type="number"
                                    min="0.001"
                                    step="0.001"
                                    max={order.outstandingMicrounits / 1000}
                                    value={amount}
                                    onChange={event => setAmount(event.target.value)}
                                />
                            </Field>
                            <Field label="付款凭证号">
                                <Input
                                    value={reference}
                                    onChange={event => setReference(event.target.value)}
                                />
                            </Field>
                        </>
                    )}
                    <Field label={mode === 'CLOSE' ? '差异处理 / 结案说明' : '备注与处理说明'}>
                        <Textarea rows={4} value={note} onChange={event => setNote(event.target.value)} />
                    </Field>
                    {mode === 'CANCEL' && (
                        <Alert variant="destructive">
                            <TriangleAlert className="size-4" />
                            <AlertDescription>只能取消没有任何收货记录的采购单。</AlertDescription>
                        </Alert>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        返回
                    </Button>
                    <Button
                        variant={mode === 'CANCEL' ? 'destructive' : 'default'}
                        disabled={!valid || pending}
                        onClick={submit}
                    >
                        {pending && <Loader2 className="mr-2 size-4 animate-spin" />}确认
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function OrderStatus({ order }: Readonly<{ order: CatalogPurchaseOrderRecord }>) {
    return (
        <div className="flex items-center gap-2">
            <Badge
                variant={
                    order.status === 'VARIANCE_REVIEW' || order.overdue
                        ? 'destructive'
                        : order.status === 'CLOSED'
                          ? 'secondary'
                          : 'default'
                }
            >
                {statusLabel[order.status]}
            </Badge>
            {order.hasVariance && order.status !== 'VARIANCE_REVIEW' && (
                <TriangleAlert className="size-4 text-destructive" />
            )}
        </div>
    );
}
function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
    return (
        <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 font-medium">{value}</div>
        </div>
    );
}
function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            {children}
        </div>
    );
}
function emptyDraft(): OrderDraft {
    return {
        supplierId: '',
        stockLocationId: '',
        expectedAt: '',
        notes: '',
        lines: [{ variantId: '', quantity: '1', unitCost: '0' }],
    };
}
function money(microunits: number, currency: string): string {
    return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 3,
    }).format(microunits / 1000);
}
function date(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value));
}
function dateTime(value: string): string {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
    );
}
function paymentLabel(value: CatalogPurchaseOrderRecord['paymentStatus']): string {
    return { UNPAID: '未付', PARTIALLY_PAID: '部分已付', PAID: '已付清', DISPUTED: '付款争议' }[value];
}
function modeTitle(mode: Exclude<ActionMode, null>): string {
    return {
        RECEIVE: '登记收货',
        RETURN: '登记退供',
        PAY: '记录付款',
        CLOSE: '采购单结案',
        CANCEL: '取消采购单',
        DISPUTE: '标记付款争议',
    }[mode];
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '采购操作失败';
}
