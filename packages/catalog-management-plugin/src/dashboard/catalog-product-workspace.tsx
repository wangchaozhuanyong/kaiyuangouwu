import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    Input,
    Label,
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
    api,
    toast,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { AlertTriangle, Boxes, CalendarClock, Loader2, Plus, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
    CatalogVariantCreationContextRecord,
    CatalogWorkspaceRecord,
    CatalogWorkspaceVariantRecord,
    catalogProductVariantCreationContextQuery,
    catalogProductWorkspaceQuery,
    createCatalogProductVariantMutation,
    saveCatalogInventoryLotMutation,
} from './catalog-management.graphql';

interface VariantDraft {
    id: string;
    enabled: boolean;
    sku: string;
    barcode: string;
    specification: string;
    saleUnit: string;
    purchaseUnit: string;
    packageQuantity: string;
    shelfLifeDays: string;
    sellingPrice: string;
    purchaseCost: string;
    stockOnHand: string;
    minimumStock: string;
    maximumStock: string;
}

interface LotDraft {
    id?: string;
    productVariantId: string;
    stockLocationId: string;
    lotCode: string;
    manufacturedAt: string;
    expiresAt: string;
    quantityOnHand: string;
    purchaseCost: string;
}

interface NewVariantDraft {
    name: string;
    enabled: boolean;
    sku: string;
    optionIds: Record<string, string>;
    barcode: string;
    specification: string;
    saleUnit: string;
    purchaseUnit: string;
    packageQuantity: string;
    shelfLifeDays: string;
    sellingPrice: string;
    purchaseCost: string;
    stockOnHand: string;
    minimumStock: string;
    maximumStock: string;
}

const WORKSPACE_DIRTY_EVENT = 'catalog-product-workspace-dirty';
const WORKSPACE_COLLECT_EVENT = 'catalog-product-workspace-collect';
const WORKSPACE_COMMITTED_EVENT = 'catalog-product-workspace-committed';

interface WorkspaceCollectRequest {
    productId: string;
    register: (operation: Record<string, unknown>) => void;
    fail: (error: unknown) => void;
}

export function CatalogProductWorkspace({
    context,
}: Readonly<{ context: { entity?: { id?: string; updatedAt?: string } } }>) {
    const productId = context.entity?.id;
    const productUpdatedAt = context.entity?.updatedAt;
    const queryClient = useQueryClient();
    const queryKey = ['catalog-product-workspace', productId];
    const workspaceQuery = useQuery({
        queryKey,
        queryFn: () => api.query<CatalogWorkspaceRecord>(catalogProductWorkspaceQuery, { productId }),
        enabled: Boolean(productId),
    });
    const creationContextQuery = useQuery({
        queryKey: ['catalog-product-variant-creation-context', productId, productUpdatedAt],
        queryFn: () =>
            api.query<CatalogVariantCreationContextRecord>(catalogProductVariantCreationContextQuery, {
                productId,
            }),
        enabled: Boolean(productId),
    });
    const workspace = workspaceQuery.data?.catalogProductWorkspace;
    const creationContext = creationContextQuery.data?.product;
    const [stockLocationId, setStockLocationId] = useState('');
    const [drafts, setDrafts] = useState<Record<string, VariantDraft>>({});
    const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
    const [lotDraft, setLotDraft] = useState<LotDraft | null>(null);
    const [newVariantDraft, setNewVariantDraft] = useState<NewVariantDraft | null>(null);
    const newVariantIsDirty = useMemo(
        () =>
            newVariantDraft != null &&
            JSON.stringify(newVariantDraft) !== JSON.stringify(emptyNewVariant(creationContext?.name ?? '')),
        [creationContext?.name, newVariantDraft],
    );

    useEffect(() => {
        if (!workspace || dirtyIds.size > 0) return;
        const locationId = stockLocationId || workspace.stockLocations[0]?.id || '';
        if (!stockLocationId && locationId) setStockLocationId(locationId);
        setDrafts(
            Object.fromEntries(workspace.variants.map(variant => [variant.id, toDraft(variant, locationId)])),
        );
    }, [dirtyIds.size, stockLocationId, workspace]);

    useEffect(() => {
        if (dirtyIds.size === 0 && !newVariantIsDirty) return;
        const warn = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirtyIds.size, newVariantIsDirty]);

    const lotMutation = useMutation({
        mutationFn: (draft: LotDraft) => {
            if (!workspace) throw new Error('商品数据尚未加载');
            const quantity = requiredInteger(draft.quantityOnHand, '批次数量');
            const cost = draft.purchaseCost.trim()
                ? Math.round(requiredNumber(draft.purchaseCost, '批次成本') * 1_000)
                : null;
            return api.mutate(saveCatalogInventoryLotMutation, {
                input: {
                    ...(draft.id ? { id: draft.id } : {}),
                    productVariantId: draft.productVariantId,
                    stockLocationId: draft.stockLocationId,
                    lotCode: draft.lotCode.trim(),
                    manufacturedAt: draft.manufacturedAt || null,
                    expiresAt: draft.expiresAt || null,
                    quantityOnHand: quantity,
                    purchaseCostMicrounits: cost,
                    currencyCode: workspace.currencyCode,
                },
            });
        },
        onSuccess: async () => {
            setLotDraft(null);
            toast.success('库存批次已保存，并生成对应库存调整流水');
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const createVariantMutation = useMutation({
        mutationFn: (draft: NewVariantDraft) => {
            if (!productId || !workspace || !stockLocationId || !creationContext) {
                throw new Error('新增 SKU 所需数据尚未加载');
            }
            const optionIds = creationContext.optionGroups.map(group => draft.optionIds[group.id]);
            if (optionIds.some(optionId => !optionId)) throw new Error('每个规格都必须选择一个值');
            if (!draft.name.trim()) throw new Error('SKU 名称不能为空');
            if (!draft.sku.trim()) throw new Error('SKU 编码不能为空');
            const sellingPrice = Math.round(requiredNumber(draft.sellingPrice, '销售价') * 100);
            const purchaseCostMicrounits = draft.purchaseCost.trim()
                ? Math.round(requiredNumber(draft.purchaseCost, '进货价') * 1_000)
                : null;
            const minimumStock = optionalInteger(draft.minimumStock, '库存下限');
            const maximumStock = optionalInteger(draft.maximumStock, '库存上限');
            if (minimumStock != null && maximumStock != null && maximumStock < minimumStock) {
                throw new Error('库存上限不能小于库存下限');
            }
            return api.mutate(createCatalogProductVariantMutation, {
                input: {
                    productId,
                    stockLocationId,
                    name: draft.name.trim(),
                    sku: draft.sku.trim(),
                    optionIds,
                    enabled: draft.enabled,
                    barcode: draft.barcode,
                    specification: draft.specification,
                    saleUnit: draft.saleUnit,
                    purchaseUnit: draft.purchaseUnit,
                    packageQuantity: requiredNumber(draft.packageQuantity, '包装换算'),
                    shelfLifeDays: optionalInteger(draft.shelfLifeDays, '保质期'),
                    sellingPrice,
                    purchaseCostMicrounits,
                    currencyCode: workspace.currencyCode,
                    stockOnHand: requiredInteger(draft.stockOnHand, '库存'),
                    minimumStock,
                    maximumStock,
                },
            });
        },
        onSuccess: async () => {
            setNewVariantDraft(null);
            toast.success('SKU 已创建，价格、成本、库存策略已同步保存');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey }),
                queryClient.invalidateQueries({
                    queryKey: ['catalog-product-variant-creation-context', productId],
                }),
            ]);
        },
        onError: error => toast.error(errorMessage(error)),
    });

    useEffect(() => {
        if (!productId) return;
        window.dispatchEvent(
            new CustomEvent(WORKSPACE_DIRTY_EVENT, {
                detail: { productId, isDirty: dirtyIds.size > 0 || newVariantIsDirty },
            }),
        );
    }, [dirtyIds.size, newVariantIsDirty, productId]);

    useEffect(() => {
        if (!productId) return;
        const handleCollectRequest = (event: Event) => {
            const detail = (event as CustomEvent<WorkspaceCollectRequest>).detail;
            if (detail?.productId !== productId) return;
            try {
                if (newVariantIsDirty) throw new Error('请先创建或取消正在编辑的新 SKU');
                if (dirtyIds.size === 0) return;
                if (!workspace || !stockLocationId) throw new Error('请选择仓库');
                for (const id of dirtyIds) {
                    const draft = drafts[id];
                    if (draft) {
                        detail.register(
                            variantOperationInput(draft, stockLocationId, workspace.currencyCode),
                        );
                    }
                }
            } catch (error) {
                toast.error(errorMessage(error));
                detail.fail(error);
            }
        };
        window.addEventListener(WORKSPACE_COLLECT_EVENT, handleCollectRequest);
        return () => window.removeEventListener(WORKSPACE_COLLECT_EVENT, handleCollectRequest);
    }, [dirtyIds, drafts, newVariantIsDirty, productId, stockLocationId, workspace]);

    useEffect(() => {
        const handleCommitted = (event: Event) => {
            const detail = (event as CustomEvent<{ productId: string }>).detail;
            if (detail?.productId !== productId) return;
            setDirtyIds(new Set());
            void queryClient.invalidateQueries({ queryKey });
        };
        window.addEventListener(WORKSPACE_COMMITTED_EVENT, handleCommitted);
        return () => window.removeEventListener(WORKSPACE_COMMITTED_EVENT, handleCommitted);
    }, [productId, queryClient, queryKey]);

    useEffect(() => {
        return () => {
            if (!productId) return;
            window.dispatchEvent(
                new CustomEvent(WORKSPACE_DIRTY_EVENT, {
                    detail: { productId, isDirty: false },
                }),
            );
        };
    }, [productId]);

    const selectedLots = useMemo(
        () =>
            workspace?.variants.flatMap(variant =>
                variant.lots
                    .filter(lot => lot.stockLocationId === stockLocationId)
                    .map(lot => ({ ...lot, variantName: variant.name, sku: variant.sku })),
            ) ?? [],
        [stockLocationId, workspace],
    );

    if (!productId) return null;
    if (workspaceQuery.isLoading || !workspace) {
        return (
            <div className="space-y-3" aria-busy="true">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }
    if (workspaceQuery.error) {
        return (
            <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertDescription>
                    商品工作台加载失败。{' '}
                    <Button size="sm" variant="outline" onClick={() => void workspaceQuery.refetch()}>
                        重试
                    </Button>
                </AlertDescription>
            </Alert>
        );
    }

    const updateDraft = (id: string, values: Partial<VariantDraft>) => {
        setDrafts(current => ({ ...current, [id]: { ...current[id], ...values } }));
        setDirtyIds(current => new Set(current).add(id));
    };
    const changeStockLocation = (nextId: string) => {
        if (dirtyIds.size > 0 && !window.confirm('切换仓库会放弃尚未保存的库存编辑，是否继续？')) return;
        setStockLocationId(nextId);
        setDirtyIds(new Set());
        setDrafts(
            Object.fromEntries(workspace.variants.map(variant => [variant.id, toDraft(variant, nextId)])),
        );
    };
    const openNewVariant = () => {
        if (!creationContext || !stockLocationId) return;
        setNewVariantDraft(emptyNewVariant(creationContext.name));
    };
    const closeNewVariant = () => {
        if (!newVariantDraft) return;
        const initial = emptyNewVariant(creationContext?.name ?? '');
        if (
            JSON.stringify(newVariantDraft) !== JSON.stringify(initial) &&
            !window.confirm('放弃尚未保存的 SKU？')
        ) {
            return;
        }
        setNewVariantDraft(null);
    };

    return (
        <div className="space-y-7">
            <div
                className={[
                    'sticky top-0 z-10 -mx-1 flex flex-col gap-3 border-b bg-background/95',
                    'px-1 pb-4 pt-1 backdrop-blur md:flex-row md:items-end md:justify-between',
                ].join(' ')}
            >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="space-y-1">
                        <Label>当前仓库</Label>
                        <Select
                            value={stockLocationId}
                            onValueChange={value => value && changeStockLocation(value)}
                        >
                            <SelectTrigger className="w-full sm:w-64">
                                <SelectValue placeholder="选择仓库" />
                            </SelectTrigger>
                            <SelectContent>
                                {workspace.stockLocations.map(location => (
                                    <SelectItem key={location.id} value={location.id}>
                                        {location.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <p className="pb-2 text-xs text-muted-foreground">
                        成本显示三位小数；毛利自动计算；仓库切换只影响库存和预警列。
                    </p>
                </div>
                <Button type="submit" disabled={dirtyIds.size === 0}>
                    <Save className="mr-2 size-4" />
                    统一保存{dirtyIds.size ? `（${dirtyIds.size}）` : ''}
                </Button>
            </div>

            <section id="catalog-sku-workspace" className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <Boxes className="size-5" />
                        <div>
                            <h3 className="font-semibold">规格、单位、价格与库存</h3>
                            <p className="text-sm text-muted-foreground">在同一张表内完成高频 SKU 设置。</p>
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={
                            !stockLocationId ||
                            creationContextQuery.isLoading ||
                            !creationContext?.optionGroups.length
                        }
                        title={
                            creationContext?.optionGroups.length
                                ? '在当前商品中新增 SKU'
                                : '请先在上方为商品添加规格模板'
                        }
                        onClick={openNewVariant}
                    >
                        <Plus className="mr-2 size-4" /> 新增 SKU
                    </Button>
                </div>
                {creationContextQuery.error && (
                    <Alert variant="destructive">
                        <AlertTriangle className="size-4" />
                        <AlertDescription>SKU 新增上下文加载失败，请刷新后重试。</AlertDescription>
                    </Alert>
                )}
                <div className="overflow-x-auto rounded-lg border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="min-w-40">SKU / 状态</TableHead>
                                <TableHead className="min-w-36">条码</TableHead>
                                <TableHead className="min-w-36">规格</TableHead>
                                <TableHead className="min-w-28">销售单位</TableHead>
                                <TableHead className="min-w-28">采购单位</TableHead>
                                <TableHead className="min-w-24">换算</TableHead>
                                <TableHead className="min-w-28">进货价</TableHead>
                                <TableHead className="min-w-28">销售价</TableHead>
                                <TableHead className="min-w-24">毛利率</TableHead>
                                <TableHead className="min-w-24">库存</TableHead>
                                <TableHead className="min-w-24">下限</TableHead>
                                <TableHead className="min-w-24">上限</TableHead>
                                <TableHead className="min-w-24">保质期</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {workspace.variants.map(variant => {
                                const draft = drafts[variant.id] ?? toDraft(variant, stockLocationId);
                                const margin = draftMargin(draft);
                                return (
                                    <TableRow
                                        key={variant.id}
                                        className={dirtyIds.has(variant.id) ? 'bg-primary/5' : undefined}
                                    >
                                        <TableCell>
                                            <Input
                                                value={draft.sku}
                                                onChange={e =>
                                                    updateDraft(variant.id, { sku: e.target.value })
                                                }
                                            />
                                            <div className="mt-2 flex items-center gap-2">
                                                <Switch
                                                    checked={draft.enabled}
                                                    onCheckedChange={enabled =>
                                                        updateDraft(variant.id, { enabled })
                                                    }
                                                />
                                                <span className="text-xs">
                                                    {draft.enabled ? '启用' : '停用'}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                value={draft.barcode}
                                                onChange={e =>
                                                    updateDraft(variant.id, { barcode: e.target.value })
                                                }
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                value={draft.specification}
                                                onChange={e =>
                                                    updateDraft(variant.id, { specification: e.target.value })
                                                }
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                value={draft.saleUnit}
                                                onChange={e =>
                                                    updateDraft(variant.id, { saleUnit: e.target.value })
                                                }
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                value={draft.purchaseUnit}
                                                onChange={e =>
                                                    updateDraft(variant.id, { purchaseUnit: e.target.value })
                                                }
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <NumericInput
                                                value={draft.packageQuantity}
                                                onChange={value =>
                                                    updateDraft(variant.id, { packageQuantity: value })
                                                }
                                                step="0.001"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <NumericInput
                                                value={draft.purchaseCost}
                                                onChange={value =>
                                                    updateDraft(variant.id, { purchaseCost: value })
                                                }
                                                step="0.001"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <NumericInput
                                                value={draft.sellingPrice}
                                                onChange={value =>
                                                    updateDraft(variant.id, { sellingPrice: value })
                                                }
                                                step="0.01"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={
                                                    margin != null && margin < 0 ? 'destructive' : 'secondary'
                                                }
                                            >
                                                {margin == null ? '—' : `${(margin * 100).toFixed(1)}%`}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <NumericInput
                                                value={draft.stockOnHand}
                                                onChange={value =>
                                                    updateDraft(variant.id, { stockOnHand: value })
                                                }
                                                step="1"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <NumericInput
                                                value={draft.minimumStock}
                                                onChange={value =>
                                                    updateDraft(variant.id, { minimumStock: value })
                                                }
                                                step="1"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <NumericInput
                                                value={draft.maximumStock}
                                                onChange={value =>
                                                    updateDraft(variant.id, { maximumStock: value })
                                                }
                                                step="1"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <NumericInput
                                                value={draft.shelfLifeDays}
                                                onChange={value =>
                                                    updateDraft(variant.id, { shelfLifeDays: value })
                                                }
                                                step="1"
                                            />
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </section>

            <section id="catalog-inventory-lots" className="space-y-3 border-t pt-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <CalendarClock className="size-5" />
                        <div>
                            <h3 className="font-semibold">批次与效期</h3>
                            <p className="text-sm text-muted-foreground">
                                按到期日期升序展示，便于先进先出拣货和临期处理。
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="outline"
                        disabled={!workspace.variants[0] || !stockLocationId}
                        onClick={() => setLotDraft(emptyLot(workspace.variants[0].id, stockLocationId))}
                    >
                        <Plus className="mr-2 size-4" /> 新增批次
                    </Button>
                </div>
                {selectedLots.length === 0 ? (
                    <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                        当前仓库还没有批次记录
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>批次号</TableHead>
                                    <TableHead>生产日期</TableHead>
                                    <TableHead>到期日期</TableHead>
                                    <TableHead>剩余数量</TableHead>
                                    <TableHead>状态</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {selectedLots.map(lot => (
                                    <TableRow key={lot.id}>
                                        <TableCell>
                                            {lot.variantName}
                                            <div className="text-xs text-muted-foreground">{lot.sku}</div>
                                        </TableCell>
                                        <TableCell>{lot.lotCode}</TableCell>
                                        <TableCell>{dateLabel(lot.manufacturedAt)}</TableCell>
                                        <TableCell>
                                            {dateLabel(lot.expiresAt)}
                                            {lot.daysUntilExpiry != null && (
                                                <div className="text-xs text-muted-foreground">
                                                    {lot.daysUntilExpiry} 天
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>{lot.quantityOnHand}</TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={
                                                    lot.state === 'EXPIRED'
                                                        ? 'destructive'
                                                        : lot.daysUntilExpiry != null &&
                                                            lot.daysUntilExpiry <= 30
                                                          ? 'secondary'
                                                          : 'outline'
                                                }
                                            >
                                                {lotStateLabel(lot.state, lot.daysUntilExpiry)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    setLotDraft({
                                                        id: lot.id,
                                                        productVariantId: lot.productVariantId,
                                                        stockLocationId: lot.stockLocationId,
                                                        lotCode: lot.lotCode,
                                                        manufacturedAt: dateInput(lot.manufacturedAt),
                                                        expiresAt: dateInput(lot.expiresAt),
                                                        quantityOnHand: String(lot.quantityOnHand),
                                                        purchaseCost:
                                                            lot.purchaseCostMicrounits == null
                                                                ? ''
                                                                : (
                                                                      lot.purchaseCostMicrounits / 1_000
                                                                  ).toFixed(3),
                                                    })
                                                }
                                            >
                                                编辑
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </section>

            <LotEditor
                draft={lotDraft}
                variants={workspace.variants}
                stockLocations={workspace.stockLocations}
                pending={lotMutation.isPending}
                onChange={setLotDraft}
                onClose={() => setLotDraft(null)}
                onSave={() => lotDraft && lotMutation.mutate(lotDraft)}
            />
            <NewVariantEditor
                draft={newVariantDraft}
                productName={creationContext?.name ?? ''}
                optionGroups={creationContext?.optionGroups ?? []}
                currencyCode={workspace.currencyCode}
                pending={createVariantMutation.isPending}
                onChange={setNewVariantDraft}
                onClose={closeNewVariant}
                onSave={() => newVariantDraft && createVariantMutation.mutate(newVariantDraft)}
            />
        </div>
    );
}

function NewVariantEditor({
    draft,
    productName,
    optionGroups,
    currencyCode,
    pending,
    onChange,
    onClose,
    onSave,
}: Readonly<{
    draft: NewVariantDraft | null;
    productName: string;
    optionGroups: Array<{
        id: string;
        name: string;
        options: Array<{ id: string; name: string }>;
    }>;
    currencyCode: string;
    pending: boolean;
    onChange: (draft: NewVariantDraft | null) => void;
    onClose: () => void;
    onSave: () => void;
}>) {
    if (!draft) return null;
    const update = (values: Partial<NewVariantDraft>) => onChange({ ...draft, ...values });
    const selectedOptionCount = Object.values(draft.optionIds).filter(Boolean).length;
    const margin = calculateDraftMargin(draft.sellingPrice, draft.purchaseCost);
    return (
        <Sheet open onOpenChange={open => !open && onClose()}>
            <SheetContent
                className="flex w-full flex-col overflow-y-auto sm:max-w-[640px]"
                data-catalog-option-validation="catalog-product-option-validation"
            >
                <SheetHeader>
                    <SheetTitle>新增 SKU</SheetTitle>
                    <SheetDescription>
                        在 {productName} 下创建规格、价格、成本和当前仓库库存，保存后仍停留在本商品。
                    </SheetDescription>
                </SheetHeader>
                <div className="grid flex-1 content-start gap-4 py-6 sm:grid-cols-2">
                    <Field label="SKU 名称" className="sm:col-span-2">
                        <Input
                            value={draft.name}
                            onChange={event => update({ name: event.target.value })}
                            placeholder="例如：商品名 红色 / 大号"
                        />
                    </Field>
                    {optionGroups.map(group => (
                        <Field key={group.id} label={group.name}>
                            <Select
                                value={draft.optionIds[group.id] ?? ''}
                                onValueChange={optionId =>
                                    optionId &&
                                    update({
                                        optionIds: { ...draft.optionIds, [group.id]: optionId },
                                    })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={`选择${group.name}`} />
                                </SelectTrigger>
                                <SelectContent>
                                    {group.options.map(option => (
                                        <SelectItem key={option.id} value={option.id}>
                                            {option.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                    ))}
                    <Field label="SKU 编码">
                        <Input value={draft.sku} onChange={event => update({ sku: event.target.value })} />
                    </Field>
                    <Field label="条码">
                        <Input
                            value={draft.barcode}
                            onChange={event => update({ barcode: event.target.value })}
                        />
                    </Field>
                    <Field label="规格说明">
                        <Input
                            value={draft.specification}
                            onChange={event => update({ specification: event.target.value })}
                        />
                    </Field>
                    <Field label="销售单位">
                        <Input
                            value={draft.saleUnit}
                            onChange={event => update({ saleUnit: event.target.value })}
                        />
                    </Field>
                    <Field label="采购单位">
                        <Input
                            value={draft.purchaseUnit}
                            onChange={event => update({ purchaseUnit: event.target.value })}
                        />
                    </Field>
                    <Field label="包装换算">
                        <NumericInput
                            value={draft.packageQuantity}
                            onChange={packageQuantity => update({ packageQuantity })}
                            step="0.001"
                        />
                    </Field>
                    <Field label={`销售价（${currencyCode}）`}>
                        <NumericInput
                            value={draft.sellingPrice}
                            onChange={sellingPrice => update({ sellingPrice })}
                            step="0.01"
                        />
                    </Field>
                    <Field label={`进货价（${currencyCode}）`}>
                        <NumericInput
                            value={draft.purchaseCost}
                            onChange={purchaseCost => update({ purchaseCost })}
                            step="0.001"
                        />
                    </Field>
                    <Field label="毛利率">
                        <div className="flex h-9 items-center">
                            <Badge variant={margin != null && margin < 0 ? 'destructive' : 'secondary'}>
                                {margin == null ? '—' : `${(margin * 100).toFixed(1)}%`}
                            </Badge>
                        </div>
                    </Field>
                    <Field label="当前库存">
                        <NumericInput
                            value={draft.stockOnHand}
                            onChange={stockOnHand => update({ stockOnHand })}
                            step="1"
                        />
                    </Field>
                    <Field label="库存下限">
                        <NumericInput
                            value={draft.minimumStock}
                            onChange={minimumStock => update({ minimumStock })}
                            step="1"
                        />
                    </Field>
                    <Field label="库存上限">
                        <NumericInput
                            value={draft.maximumStock}
                            onChange={maximumStock => update({ maximumStock })}
                            step="1"
                        />
                    </Field>
                    <Field label="保质期（天）">
                        <NumericInput
                            value={draft.shelfLifeDays}
                            onChange={shelfLifeDays => update({ shelfLifeDays })}
                            step="1"
                        />
                    </Field>
                    <div className="flex items-center justify-between rounded-lg border p-4 sm:col-span-2">
                        <div>
                            <Label htmlFor="catalog-new-variant-enabled">销售状态</Label>
                            <p className="mt-1 text-xs text-muted-foreground">
                                停用后 SKU 不会在当前门店销售。
                            </p>
                        </div>
                        <Switch
                            id="catalog-new-variant-enabled"
                            checked={draft.enabled}
                            onCheckedChange={enabled => update({ enabled })}
                        />
                    </div>
                </div>
                <SheetFooter className="border-t pt-4">
                    <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                        取消
                    </Button>
                    <Button
                        type="button"
                        disabled={
                            pending ||
                            !draft.name.trim() ||
                            !draft.sku.trim() ||
                            selectedOptionCount !== optionGroups.length
                        }
                        onClick={onSave}
                    >
                        {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                        创建 SKU
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

function LotEditor({
    draft,
    variants,
    stockLocations,
    pending,
    onChange,
    onClose,
    onSave,
}: Readonly<{
    draft: LotDraft | null;
    variants: CatalogWorkspaceVariantRecord[];
    stockLocations: Array<{ id: string; name: string }>;
    pending: boolean;
    onChange: (draft: LotDraft | null) => void;
    onClose: () => void;
    onSave: () => void;
}>) {
    if (!draft) return null;
    const update = (values: Partial<LotDraft>) => onChange({ ...draft, ...values });
    return (
        <Sheet open onOpenChange={open => !open && onClose()}>
            <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-[640px]">
                <SheetHeader>
                    <SheetTitle>{draft.id ? '编辑库存批次' : '新增库存批次'}</SheetTitle>
                    <SheetDescription>保存数量变化时会生成库存调整流水，不会静默覆盖库存。</SheetDescription>
                </SheetHeader>
                <div className="grid flex-1 content-start gap-4 py-6 sm:grid-cols-2">
                    <Field label="SKU">
                        <Select
                            value={draft.productVariantId}
                            onValueChange={value => value && update({ productVariantId: value })}
                            disabled={Boolean(draft.id)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {variants.map(variant => (
                                    <SelectItem key={variant.id} value={variant.id}>
                                        {variant.name} · {variant.sku}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label="仓库">
                        <Select
                            value={draft.stockLocationId}
                            onValueChange={value => value && update({ stockLocationId: value })}
                            disabled={Boolean(draft.id)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {stockLocations.map(location => (
                                    <SelectItem key={location.id} value={location.id}>
                                        {location.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label="批次号">
                        <Input value={draft.lotCode} onChange={e => update({ lotCode: e.target.value })} />
                    </Field>
                    <Field label="批次数量">
                        <NumericInput
                            value={draft.quantityOnHand}
                            onChange={value => update({ quantityOnHand: value })}
                            step="1"
                        />
                    </Field>
                    <Field label="生产日期">
                        <Input
                            type="date"
                            value={draft.manufacturedAt}
                            onChange={e => update({ manufacturedAt: e.target.value })}
                        />
                    </Field>
                    <Field label="到期日期">
                        <Input
                            type="date"
                            value={draft.expiresAt}
                            onChange={e => update({ expiresAt: e.target.value })}
                        />
                    </Field>
                    <Field label="批次进货价">
                        <NumericInput
                            value={draft.purchaseCost}
                            onChange={value => update({ purchaseCost: value })}
                            step="0.001"
                        />
                    </Field>
                </div>
                <SheetFooter className="border-t pt-4">
                    <Button variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={pending || !draft.lotCode.trim()} onClick={onSave}>
                        {pending && <Loader2 className="mr-2 size-4 animate-spin" />}保存批次
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

function NumericInput({
    value,
    onChange,
    step,
}: Readonly<{ value: string; onChange: (value: string) => void; step: string }>) {
    return (
        <Input
            type="number"
            min="0"
            step={step}
            value={value}
            onChange={event => onChange(event.target.value)}
        />
    );
}

function Field({
    label,
    className,
    children,
}: Readonly<{ label: string; className?: string; children: React.ReactNode }>) {
    return (
        <div className={`space-y-2 ${className ?? ''}`}>
            <Label>{label}</Label>
            {children}
        </div>
    );
}

function emptyNewVariant(productName: string): NewVariantDraft {
    return {
        name: productName,
        enabled: true,
        sku: '',
        optionIds: {},
        barcode: '',
        specification: '',
        saleUnit: '',
        purchaseUnit: '',
        packageQuantity: '1',
        shelfLifeDays: '',
        sellingPrice: '0',
        purchaseCost: '',
        stockOnHand: '0',
        minimumStock: '',
        maximumStock: '',
    };
}

function toDraft(variant: CatalogWorkspaceVariantRecord, stockLocationId: string): VariantDraft {
    const stock = variant.stockLevels.find(level => level.stockLocationId === stockLocationId);
    return {
        id: variant.id,
        enabled: variant.enabled,
        sku: variant.sku,
        barcode: variant.barcode,
        specification: variant.specification,
        saleUnit: variant.saleUnit,
        purchaseUnit: variant.purchaseUnit,
        packageQuantity: String(variant.packageQuantity || 1),
        shelfLifeDays: variant.shelfLifeDays == null ? '' : String(variant.shelfLifeDays),
        sellingPrice: (variant.sellingPrice / 100).toFixed(2),
        purchaseCost:
            variant.purchaseCostMicrounits == null ? '' : (variant.purchaseCostMicrounits / 1_000).toFixed(3),
        stockOnHand: String(stock?.stockOnHand ?? 0),
        minimumStock: stock?.minimumStock == null ? '' : String(stock.minimumStock),
        maximumStock: stock?.maximumStock == null ? '' : String(stock.maximumStock),
    };
}

function emptyLot(productVariantId: string, stockLocationId: string): LotDraft {
    return {
        productVariantId,
        stockLocationId,
        lotCode: '',
        manufacturedAt: '',
        expiresAt: '',
        quantityOnHand: '0',
        purchaseCost: '',
    };
}

function validateDraft(draft: VariantDraft): void {
    if (!draft.sku.trim()) throw new Error('SKU 不能为空');
    const min = optionalInteger(draft.minimumStock, '库存下限');
    const max = optionalInteger(draft.maximumStock, '库存上限');
    if (min != null && max != null && max < min) throw new Error('库存上限不能小于库存下限');
    if (requiredNumber(draft.packageQuantity, '包装换算') <= 0) throw new Error('包装换算必须大于 0');
}

function variantOperationInput(
    draft: VariantDraft,
    stockLocationId: string,
    currencyCode: string,
): Record<string, unknown> {
    validateDraft(draft);
    return {
        productVariantId: draft.id,
        stockLocationId,
        sku: draft.sku.trim(),
        enabled: draft.enabled,
        barcode: draft.barcode,
        specification: draft.specification,
        saleUnit: draft.saleUnit,
        purchaseUnit: draft.purchaseUnit,
        packageQuantity: requiredNumber(draft.packageQuantity, '包装换算'),
        shelfLifeDays: optionalInteger(draft.shelfLifeDays, '保质期'),
        sellingPrice: Math.round(requiredNumber(draft.sellingPrice, '销售价') * 100),
        ...(draft.purchaseCost.trim()
            ? {
                  purchaseCostMicrounits: Math.round(requiredNumber(draft.purchaseCost, '进货价') * 1_000),
              }
            : {}),
        currencyCode,
        stockOnHand: requiredInteger(draft.stockOnHand, '库存'),
        minimumStock: optionalInteger(draft.minimumStock, '库存下限'),
        maximumStock: optionalInteger(draft.maximumStock, '库存上限'),
    };
}

function draftMargin(draft: VariantDraft): number | null {
    return calculateDraftMargin(draft.sellingPrice, draft.purchaseCost);
}

function calculateDraftMargin(sellingPrice: string, purchaseCost: string): number | null {
    const price = Number(sellingPrice);
    const cost = Number(purchaseCost);
    return Number.isFinite(price) && Number.isFinite(cost) && price > 0 ? (price - cost) / price : null;
}

function requiredNumber(value: string, label: string): number {
    const parsed = Number(value);
    if (!value.trim() || !Number.isFinite(parsed) || parsed < 0) throw new Error(`${label}必须是非负数字`);
    return parsed;
}

function requiredInteger(value: string, label: string): number {
    const parsed = requiredNumber(value, label);
    if (!Number.isInteger(parsed)) throw new Error(`${label}必须是整数`);
    return parsed;
}

function optionalInteger(value: string, label: string): number | null {
    if (!value.trim()) return null;
    return requiredInteger(value, label);
}

function dateInput(value: string | null): string {
    return value ? value.slice(0, 10) : '';
}

function dateLabel(value: string | null): string {
    return value ? new Date(value).toLocaleDateString() : '—';
}

function lotStateLabel(state: string, daysUntilExpiry: number | null): string {
    if (state === 'EXPIRED') return '已过期';
    if (state === 'DEPLETED') return '已用完';
    if (daysUntilExpiry != null && daysUntilExpiry <= 30) return '临期';
    return '正常';
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
