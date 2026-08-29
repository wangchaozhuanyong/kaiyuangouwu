import { FacetValueFacetedFilter } from '@/vdb/components/data-table/data-table-facet-value-faceted-filter.js';
import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { EntityEditorSheet } from '@/vdb/components/shared/entity-editor-sheet.js';
import { RichTextDescriptionCell } from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { DropdownMenuItem } from '@/vdb/components/ui/dropdown-menu.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '@/vdb/components/ui/sheet.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { DEFAULT_CHANNEL_CODE, NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { PageActionBarRight } from '@/vdb/framework/layout-engine/page-layout.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Filter, LayersIcon, ListRestart, Loader2, PlusIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AssignAllProductsDialog } from './components/assign-all-products-dialog.js';
import { isAssignAllProductsAvailable } from './components/assign-all-products.js';
import {
    AssignFacetValuesToProductsBulkAction,
    AssignProductsToChannelBulkAction,
    DeleteProductsBulkAction,
    DisableProductsBulkAction,
    DuplicateProductsBulkAction,
    EnableProductsBulkAction,
    RemoveProductsFromChannelBulkAction,
} from './components/product-bulk-actions.js';
import { getProductFulfillmentType } from './components/product-fulfillment-type.js';
import {
    catalogProductSummariesDocument,
    productListDocument,
    reindexDocument,
    withProductVariantCustomFields,
} from './products.graphql.js';
import { ProductEditor } from './products_.$id.js';

export const Route = createFileRoute('/_authenticated/_products/products')({
    component: ProductListPage,
    loader: () => ({ breadcrumb: () => <Trans>Products</Trans> }),
    validateSearch: (search: Record<string, unknown>) => ({
        ...search,
        editor: typeof search.editor === 'string' && search.editor ? search.editor : undefined,
    }),
});

interface CatalogAdvancedFilters {
    text: string;
    category: string;
    brand: string;
    enabled: 'ALL' | 'ENABLED' | 'DISABLED';
    minimumSellingPrice: string;
    maximumSellingPrice: string;
    minimumPurchaseCost: string;
    maximumPurchaseCost: string;
    minimumMargin: string;
    maximumMargin: string;
    minimumAvailableStock: string;
    maximumAvailableStock: string;
    lowStock: boolean;
    expiringWithinDays: string;
}

const emptyAdvancedFilters: CatalogAdvancedFilters = {
    text: '',
    category: '',
    brand: '',
    enabled: 'ALL',
    minimumSellingPrice: '',
    maximumSellingPrice: '',
    minimumPurchaseCost: '',
    maximumPurchaseCost: '',
    minimumMargin: '',
    maximumMargin: '',
    minimumAvailableStock: '',
    maximumAvailableStock: '',
    lowStock: false,
    expiringWithinDays: '',
};

function ProductListPage() {
    const { t } = useLingui();
    const { activeChannel, channels } = useChannel();
    const routeSearch = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const [assignAllDialogOpen, setAssignAllDialogOpen] = useState(false);
    const [selectedProductName, setSelectedProductName] = useState<string>();
    const [advancedFilters, setAdvancedFilters] = useState<CatalogAdvancedFilters>(emptyAdvancedFilters);
    const listRefresher = useRef<(() => void) | undefined>(undefined);
    const selectedProduct = routeSearch.editor
        ? { id: routeSearch.editor, name: selectedProductName }
        : undefined;
    const canAssignAllProducts = isAssignAllProductsAvailable(activeChannel, channels, DEFAULT_CHANNEL_CODE);
    const summaryFilter = useMemo(() => catalogSummaryFilterInput(advancedFilters), [advancedFilters]);
    const hasAdvancedFilters = Object.keys(summaryFilter).length > 0;
    const summaryQuery = useQuery({
        queryKey: ['catalog-product-summaries', activeChannel?.id, summaryFilter],
        queryFn: () =>
            api.query<{
                catalogProductSummaries: {
                    items: Array<{ productId: string }>;
                    totalItems: number;
                };
            }>(catalogProductSummariesDocument, { filter: summaryFilter }),
        enabled: hasAdvancedFilters && Boolean(activeChannel?.id),
    });
    const filteredProductIds = hasAdvancedFilters
        ? (summaryQuery.data?.catalogProductSummaries.items.map(item => item.productId) ?? [])
        : null;
    const AssignAllProductsDropdownItem = useCallback(
        () => (
            <DropdownMenuItem onClick={() => setAssignAllDialogOpen(true)}>
                <LayersIcon />
                <Trans>Assign all products</Trans>
            </DropdownMenuItem>
        ),
        [],
    );
    const reindexMutation = useMutation({
        mutationFn: () => api.mutate(reindexDocument, {}),
        onSuccess: () => {
            toast.success(t`Search index rebuild started`);
        },
        onError: () => {
            toast.error(t`Search index rebuild could not be started`);
        },
    });

    const handleRebuildSearchIndex = () => {
        reindexMutation.mutate();
    };
    const openProductEditor = (id: string, name?: string) => {
        setSelectedProductName(name);
        void navigate({ search: (previous: Record<string, unknown>) => ({ ...previous, editor: id }) });
    };
    const closeProductEditor = () => {
        setSelectedProductName(undefined);
        void navigate({
            search: (previous: Record<string, unknown>) => ({ ...previous, editor: undefined }),
            replace: true,
        });
    };

    return (
        <>
            <ListPage
                pageId="product-list"
                listQuery={withProductVariantCustomFields(productListDocument)}
                title={<Trans>Products</Trans>}
                searchPlaceholder={t`Search product name, URL identifier or SKU`}
                customizeColumns={{
                    name: {
                        header: () => <Trans>Product name</Trans>,
                        cell: ({ row }) => <span>{row.original.name}</span>,
                    },
                    enabled: {
                        header: () => <Trans>Sales status</Trans>,
                    },
                    description: {
                        cell: RichTextDescriptionCell,
                    },
                    channels: {
                        header: () => <Trans>Published stores</Trans>,
                        cell: ({ row }) => (
                            <div className="flex max-w-80 flex-wrap gap-1.5">
                                {row.original.channels.map(channel => (
                                    <Badge variant="secondary" key={channel.id}>
                                        <ChannelCodeLabel code={channel.code} />
                                    </Badge>
                                ))}
                            </div>
                        ),
                    },
                    variants: {
                        // Loaded only as a dependency of the product-type column; the raw JSON is not useful here.
                        meta: { disabled: true },
                    },
                }}
                onSearchTermChange={searchTerm => {
                    return searchTerm
                        ? {
                              _or: [
                                  { name: { contains: searchTerm } },
                                  { slug: { contains: searchTerm } },
                                  { sku: { contains: searchTerm } },
                              ],
                          }
                        : {};
                }}
                additionalColumns={{
                    fulfillmentType: {
                        meta: { dependencies: ['variants'] },
                        header: () => <Trans>Product type</Trans>,
                        cell: ({ row }) => {
                            const fulfillmentType = getProductFulfillmentType(row.original.variants);
                            return (
                                <Badge variant={fulfillmentType === 'mixed' ? 'outline' : 'secondary'}>
                                    {fulfillmentType === 'physical' && <Trans>Physical product</Trans>}
                                    {fulfillmentType === 'digital' && <Trans>Digital product</Trans>}
                                    {fulfillmentType === 'mixed' && <Trans>Mixed product</Trans>}
                                </Badge>
                            );
                        },
                        enableSorting: false,
                    },
                    sku: {
                        meta: { dependencies: ['variants'] },
                        header: 'SKU',
                        cell: ({ row }) =>
                            compactVariantValues(row.original.variants.map(variant => variant.sku)),
                        enableSorting: false,
                    },
                    barcode: {
                        meta: { dependencies: ['variants'] },
                        header: '条码',
                        cell: ({ row }) =>
                            compactVariantValues(
                                row.original.variants.map(variant =>
                                    String(
                                        (variant.customFields as Record<string, unknown> | undefined)
                                            ?.barcode ?? '',
                                    ),
                                ),
                            ),
                        enableSorting: false,
                    },
                    sellingPrice: {
                        meta: { dependencies: ['variants'] },
                        header: '售价',
                        cell: ({ row }) => {
                            const variant = row.original.variants[0];
                            if (!variant) return '—';
                            const amount = new Intl.NumberFormat('zh-CN', {
                                style: 'currency',
                                currency: variant.currencyCode,
                            }).format(variant.price / 100);
                            return row.original.variants.length > 1 ? `${amount} 起` : amount;
                        },
                        enableSorting: false,
                    },
                    availableStock: {
                        meta: { dependencies: ['variants'] },
                        header: '可用库存',
                        cell: ({ row }) =>
                            row.original.variants.reduce(
                                (total, variant) =>
                                    total +
                                    variant.stockLevels.reduce(
                                        (variantTotal, level) =>
                                            variantTotal + level.stockOnHand - level.stockAllocated,
                                        0,
                                    ),
                                0,
                            ),
                        enableSorting: false,
                    },
                    facetValueId: {
                        header: '',
                        cell: () => null,
                        enableSorting: false,
                        enableHiding: false,
                        enableColumnFilter: false,
                    },
                }}
                facetedFilters={{
                    facetValueId: {
                        title: t`Facet values`,
                        component: FacetValueFacetedFilter,
                    },
                }}
                transformVariables={variables => {
                    const filter = variables.options?.filter ?? {};
                    return {
                        options: {
                            ...variables.options,
                            filterOperator: 'AND',
                            filter:
                                filteredProductIds == null
                                    ? filter
                                    : {
                                          _and: [filter, { id: { in: filteredProductIds } }],
                                      },
                        },
                    };
                }}
                transformQueryKey={queryKey => [
                    ...queryKey,
                    'catalog-advanced-filter',
                    hasAdvancedFilters,
                    summaryQuery.isFetching,
                    filteredProductIds?.join(',') ?? '',
                ]}
                defaultSort={[{ id: 'updatedAt', desc: true }]}
                defaultColumnOrder={[
                    'featuredAsset',
                    'name',
                    'sku',
                    'barcode',
                    'fulfillmentType',
                    'sellingPrice',
                    'availableStock',
                    'enabled',
                    'channels',
                    'slug',
                    'updatedAt',
                ]}
                defaultVisibility={{
                    featuredAsset: true,
                    name: true,
                    sku: true,
                    barcode: true,
                    fulfillmentType: true,
                    sellingPrice: true,
                    availableStock: true,
                    enabled: true,
                    channels: true,
                    slug: true,
                    updatedAt: true,
                }}
                route={Route}
                registerRefresher={refresher => {
                    listRefresher.current = refresher;
                }}
                primaryRowAction={{
                    label: <Trans>Edit</Trans>,
                    onClick: row => openProductEditor(row.original.id, row.original.name),
                }}
                bulkActions={[
                    [
                        { component: EnableProductsBulkAction, order: 10 },
                        { component: DisableProductsBulkAction, order: 20 },
                        { component: AssignProductsToChannelBulkAction, order: 100 },
                        { component: RemoveProductsFromChannelBulkAction, order: 200 },
                        { component: AssignFacetValuesToProductsBulkAction, order: 300 },
                        { component: DuplicateProductsBulkAction, order: 400 },
                    ],
                    [{ component: DeleteProductsBulkAction }],
                ]}
            >
                {canAssignAllProducts && (
                    <ActionBarItem
                        itemId="assign-all-products-button"
                        requiresPermission={['UpdateCatalog', 'UpdateProduct']}
                    >
                        <Button variant="outline" onClick={() => setAssignAllDialogOpen(true)}>
                            <LayersIcon />
                            <Trans>Assign all products</Trans>
                        </Button>
                    </ActionBarItem>
                )}
                {canAssignAllProducts && (
                    <PageActionBarRight
                        dropdownMenuItems={[
                            {
                                component: AssignAllProductsDropdownItem,
                                requiresPermission: ['UpdateCatalog', 'UpdateProduct'],
                            },
                        ]}
                    />
                )}
                <ActionBarItem
                    itemId="catalog-advanced-filter-button"
                    requiresPermission={['ReadCatalogOperations', 'ReadCatalogImport']}
                >
                    <CatalogAdvancedFilterAction
                        value={advancedFilters}
                        resultCount={summaryQuery.data?.catalogProductSummaries.totalItems}
                        loading={summaryQuery.isFetching}
                        error={summaryQuery.error}
                        onApply={setAdvancedFilters}
                    />
                </ActionBarItem>
                <ActionBarItem itemId="rebuild-index-button" requiresPermission={['UpdateCatalog']}>
                    <Button variant="outline" onClick={handleRebuildSearchIndex}>
                        <ListRestart />
                        <Trans>Rebuild search index</Trans>
                    </Button>
                </ActionBarItem>
                <ActionBarItem itemId="create-button" requiresPermission={['CreateProduct', 'CreateCatalog']}>
                    <Button onClick={() => openProductEditor(NEW_ENTITY_PATH)}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        <Trans>Create product</Trans>
                    </Button>
                </ActionBarItem>
            </ListPage>
            <AssignAllProductsDialog
                open={assignAllDialogOpen}
                onOpenChange={setAssignAllDialogOpen}
                onSuccess={() => listRefresher.current?.()}
            />
            <EntityEditorSheet
                open={Boolean(selectedProduct)}
                size="workbench"
                title={
                    selectedProduct?.id === NEW_ENTITY_PATH
                        ? t`Create product`
                        : selectedProduct?.name || t`Edit product`
                }
                description={t`Manage product information, specifications, prices, inventory and batches without leaving the product list`}
                loadingLabel={t`Loading product...`}
                onOpenChange={open => {
                    if (!open) closeProductEditor();
                }}
            >
                {({ setDirty, requestClose }) =>
                    selectedProduct ? (
                        <ProductEditor
                            key={selectedProduct.id}
                            productId={selectedProduct.id}
                            presentation="sheet"
                            onDirtyChange={setDirty}
                            onRequestClose={requestClose}
                            onSaved={(_behavior, productId) => {
                                listRefresher.current?.();
                                if (selectedProduct.id === NEW_ENTITY_PATH) {
                                    void navigate({
                                        search: (previous: Record<string, unknown>) => ({
                                            ...previous,
                                            editor: productId,
                                        }),
                                        replace: true,
                                    });
                                }
                            }}
                        />
                    ) : null
                }
            </EntityEditorSheet>
        </>
    );
}

function compactVariantValues(values: string[]): string {
    const unique = [...new Set(values.map(value => value.trim()).filter(Boolean))];
    if (unique.length === 0) return '—';
    if (unique.length === 1) return unique[0];
    return `${unique[0]} 等 ${unique.length} 项`;
}

function CatalogAdvancedFilterAction({
    value,
    resultCount,
    loading,
    error,
    onApply,
}: Readonly<{
    value: CatalogAdvancedFilters;
    resultCount?: number;
    loading: boolean;
    error: unknown;
    onApply: (value: CatalogAdvancedFilters) => void;
}>) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(value);
    const activeCount = Object.keys(catalogSummaryFilterInput(value)).length;
    const update = (next: Partial<CatalogAdvancedFilters>) => setDraft(current => ({ ...current, ...next }));
    const apply = () => {
        try {
            validateAdvancedFilters(draft);
            onApply({ ...draft });
            setOpen(false);
        } catch (filterError) {
            toast.error(filterError instanceof Error ? filterError.message : '筛选条件无效');
        }
    };
    return (
        <>
            <Button
                variant={activeCount > 0 ? 'secondary' : 'outline'}
                onClick={() => {
                    setDraft(value);
                    setOpen(true);
                }}
            >
                {loading ? <Loader2 className="animate-spin" /> : <Filter />}
                高级筛选
                {activeCount > 0 && <Badge variant="secondary">{activeCount}</Badge>}
            </Button>
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-[640px]">
                    <SheetHeader>
                        <SheetTitle>商品高级筛选</SheetTitle>
                        <SheetDescription>
                            名称、SKU、条码、价格、成本、毛利、库存和效期均在当前门店内计算。
                        </SheetDescription>
                    </SheetHeader>
                    <div className="grid flex-1 content-start gap-5 py-6 sm:grid-cols-2">
                        <FilterField label="名称 / SKU / 条码" className="sm:col-span-2">
                            <Input
                                value={draft.text}
                                onChange={event => update({ text: event.target.value })}
                                placeholder="输入任一关键字"
                            />
                        </FilterField>
                        <FilterField label="分类">
                            <Input
                                value={draft.category}
                                onChange={event => update({ category: event.target.value })}
                            />
                        </FilterField>
                        <FilterField label="品牌">
                            <Input
                                value={draft.brand}
                                onChange={event => update({ brand: event.target.value })}
                            />
                        </FilterField>
                        <FilterField label="商品状态">
                            <Select
                                value={draft.enabled}
                                onValueChange={next =>
                                    next && update({ enabled: next as CatalogAdvancedFilters['enabled'] })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">全部</SelectItem>
                                    <SelectItem value="ENABLED">启用</SelectItem>
                                    <SelectItem value="DISABLED">停用</SelectItem>
                                </SelectContent>
                            </Select>
                        </FilterField>
                        <FilterField label="临期范围（天）">
                            <Input
                                type="number"
                                min="0"
                                step="1"
                                value={draft.expiringWithinDays}
                                onChange={event => update({ expiringWithinDays: event.target.value })}
                                placeholder="例如 30"
                            />
                        </FilterField>
                        <RangeFields
                            label="销售价"
                            minimum={draft.minimumSellingPrice}
                            maximum={draft.maximumSellingPrice}
                            step="0.01"
                            onMinimum={minimumSellingPrice => update({ minimumSellingPrice })}
                            onMaximum={maximumSellingPrice => update({ maximumSellingPrice })}
                        />
                        <RangeFields
                            label="进货成本"
                            minimum={draft.minimumPurchaseCost}
                            maximum={draft.maximumPurchaseCost}
                            step="0.001"
                            onMinimum={minimumPurchaseCost => update({ minimumPurchaseCost })}
                            onMaximum={maximumPurchaseCost => update({ maximumPurchaseCost })}
                        />
                        <RangeFields
                            label="毛利率（%）"
                            minimum={draft.minimumMargin}
                            maximum={draft.maximumMargin}
                            step="0.1"
                            allowNegative
                            onMinimum={minimumMargin => update({ minimumMargin })}
                            onMaximum={maximumMargin => update({ maximumMargin })}
                        />
                        <RangeFields
                            label="可用库存"
                            minimum={draft.minimumAvailableStock}
                            maximum={draft.maximumAvailableStock}
                            step="1"
                            allowNegative
                            onMinimum={minimumAvailableStock => update({ minimumAvailableStock })}
                            onMaximum={maximumAvailableStock => update({ maximumAvailableStock })}
                        />
                        <div className="flex items-center justify-between rounded-lg border p-4 sm:col-span-2">
                            <div>
                                <Label htmlFor="catalog-low-stock-filter">仅看低库存</Label>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    可用库存小于或等于预警下限
                                </p>
                            </div>
                            <Switch
                                id="catalog-low-stock-filter"
                                checked={draft.lowStock}
                                onCheckedChange={lowStock => update({ lowStock })}
                            />
                        </div>
                        {error != null && (
                            <p className="text-sm text-destructive sm:col-span-2">
                                筛选查询失败：{error instanceof Error ? error.message : String(error)}
                            </p>
                        )}
                        {activeCount > 0 && resultCount != null && (
                            <p className="text-sm text-muted-foreground sm:col-span-2">
                                当前条件匹配 {resultCount} 个商品。
                            </p>
                        )}
                    </div>
                    <SheetFooter className="border-t pt-4">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setDraft(emptyAdvancedFilters);
                                onApply(emptyAdvancedFilters);
                                setOpen(false);
                            }}
                        >
                            清空筛选
                        </Button>
                        <Button onClick={apply}>应用筛选</Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </>
    );
}

function FilterField({
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

function RangeFields({
    label,
    minimum,
    maximum,
    step,
    allowNegative = false,
    onMinimum,
    onMaximum,
}: Readonly<{
    label: string;
    minimum: string;
    maximum: string;
    step: string;
    allowNegative?: boolean;
    onMinimum: (value: string) => void;
    onMaximum: (value: string) => void;
}>) {
    return (
        <div className="space-y-2 sm:col-span-2">
            <Label>{label}</Label>
            <div className="grid grid-cols-2 gap-3">
                <Input
                    type="number"
                    min={allowNegative ? undefined : '0'}
                    step={step}
                    value={minimum}
                    onChange={event => onMinimum(event.target.value)}
                    placeholder="最低"
                />
                <Input
                    type="number"
                    min={allowNegative ? undefined : '0'}
                    step={step}
                    value={maximum}
                    onChange={event => onMaximum(event.target.value)}
                    placeholder="最高"
                />
            </div>
        </div>
    );
}

function validateAdvancedFilters(value: CatalogAdvancedFilters): void {
    for (const [key, label, integer, nonNegative] of [
        ['minimumSellingPrice', '最低售价', false, true],
        ['maximumSellingPrice', '最高售价', false, true],
        ['minimumPurchaseCost', '最低成本', false, true],
        ['maximumPurchaseCost', '最高成本', false, true],
        ['minimumMargin', '最低毛利率', false, false],
        ['maximumMargin', '最高毛利率', false, false],
        ['minimumAvailableStock', '最低可用库存', true, false],
        ['maximumAvailableStock', '最高可用库存', true, false],
        ['expiringWithinDays', '临期天数', true, true],
    ] as const) {
        const raw = value[key].trim();
        if (!raw) continue;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
            throw new Error(`${label}格式无效`);
        }
        if (nonNegative && parsed < 0) throw new Error(`${label}不能为负数`);
    }
    for (const [minimumKey, maximumKey, label] of [
        ['minimumSellingPrice', 'maximumSellingPrice', '售价'],
        ['minimumPurchaseCost', 'maximumPurchaseCost', '成本'],
        ['minimumMargin', 'maximumMargin', '毛利率'],
        ['minimumAvailableStock', 'maximumAvailableStock', '可用库存'],
    ] as const) {
        const minimum = optionalFilterNumber(value[minimumKey]);
        const maximum = optionalFilterNumber(value[maximumKey]);
        if (minimum != null && maximum != null && minimum > maximum) {
            throw new Error(`${label}上限不能小于下限`);
        }
    }
}

function catalogSummaryFilterInput(value: CatalogAdvancedFilters): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    for (const key of ['text', 'category', 'brand'] as const) {
        const text = value[key].trim();
        if (text) input[key] = text;
    }
    if (value.enabled !== 'ALL') input.enabled = value.enabled === 'ENABLED';
    addScaledFilter(input, 'minimumSellingPrice', value.minimumSellingPrice, 100);
    addScaledFilter(input, 'maximumSellingPrice', value.maximumSellingPrice, 100);
    addScaledFilter(input, 'minimumPurchaseCostMicrounits', value.minimumPurchaseCost, 1_000);
    addScaledFilter(input, 'maximumPurchaseCostMicrounits', value.maximumPurchaseCost, 1_000);
    addScaledFilter(input, 'minimumMargin', value.minimumMargin, 0.01);
    addScaledFilter(input, 'maximumMargin', value.maximumMargin, 0.01);
    addScaledFilter(input, 'minimumAvailableStock', value.minimumAvailableStock, 1);
    addScaledFilter(input, 'maximumAvailableStock', value.maximumAvailableStock, 1);
    addScaledFilter(input, 'expiringWithinDays', value.expiringWithinDays, 1);
    if (value.lowStock) input.lowStock = true;
    return input;
}

function addScaledFilter(input: Record<string, unknown>, key: string, raw: string, factor: number): void {
    const parsed = optionalFilterNumber(raw);
    if (parsed != null) input[key] = Math.round(parsed * factor * 1_000_000) / 1_000_000;
}

function optionalFilterNumber(value: string): number | null {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
