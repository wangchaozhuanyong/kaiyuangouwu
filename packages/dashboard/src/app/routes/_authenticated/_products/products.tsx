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
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Filter, LayersIcon, ListRestart, PlusIcon } from 'lucide-react';
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
import { getProductLevelFulfillmentType } from './components/product-fulfillment-type.js';
import {
    catalogFilteredProductListDocument,
    productCategoryFilterOptionsDocument,
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
                listQuery={withProductVariantCustomFields(
                    hasAdvancedFilters ? catalogFilteredProductListDocument : productListDocument,
                )}
                title={<Trans>Products</Trans>}
                searchPlaceholder={t`Search product name, URL identifier or SKU`}
                customizeColumns={{
                    name: {
                        header: () => <Trans>Product name</Trans>,
                        cell: ({ row }) => <span>{row.original.name}</span>,
                    },
                    collections: {
                        header: () => <Trans>Category</Trans>,
                        cell: ({ row }) => {
                            const collections = row.original.collections;
                            if (!collections.length) {
                                return (
                                    <span className="text-muted-foreground">
                                        <Trans>Uncategorized</Trans>
                                    </span>
                                );
                            }
                            return (
                                <div className="flex max-w-72 items-center gap-1.5">
                                    <Badge variant="secondary">{collections[0].name}</Badge>
                                    {collections.length > 1 && (
                                        <span className="text-xs text-muted-foreground">
                                            +{collections.length - 1}
                                        </span>
                                    )}
                                </div>
                            );
                        },
                        enableSorting: false,
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
                        meta: { dependencies: ['customFields'] },
                        header: () => <Trans>Product type</Trans>,
                        cell: ({ row }) => {
                            const fulfillmentType = getProductLevelFulfillmentType(row.original.customFields);
                            return (
                                <Badge variant="secondary">
                                    {fulfillmentType === 'physical' && <Trans>Physical product</Trans>}
                                    {fulfillmentType === 'digital' && <Trans>Digital product</Trans>}
                                </Badge>
                            );
                        },
                        enableSorting: false,
                    },
                    sku: {
                        meta: { dependencies: ['variants'] },
                        header: 'SKU',
                        cell: ({ row }) =>
                            compactVariantValues(
                                row.original.variants.map(variant => variant.sku),
                                t,
                            ),
                        enableSorting: false,
                    },
                    barcode: {
                        meta: { dependencies: ['variants'] },
                        header: t`Barcode`,
                        cell: ({ row }) =>
                            compactVariantValues(
                                row.original.variants.map(variant =>
                                    String(
                                        (variant.customFields as Record<string, unknown> | undefined)
                                            ?.barcode ?? '',
                                    ),
                                ),
                                t,
                            ),
                        enableSorting: false,
                    },
                    sellingPrice: {
                        meta: { dependencies: ['variants'] },
                        header: t`Selling price`,
                        cell: ({ row }) => {
                            const variant = row.original.variants[0];
                            if (!variant) return '—';
                            const amount = new Intl.NumberFormat('zh-CN', {
                                style: 'currency',
                                currency: variant.currencyCode,
                            }).format(variant.price / 100);
                            return row.original.variants.length > 1 ? t`${amount} and up` : amount;
                        },
                        enableSorting: false,
                    },
                    availableStock: {
                        meta: { dependencies: ['variants'] },
                        header: t`Available stock`,
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
                    collectionId: {
                        header: '',
                        cell: () => null,
                        enableSorting: false,
                        enableHiding: false,
                        enableColumnFilter: false,
                    },
                }}
                facetedFilters={{
                    collectionId: {
                        title: t`Category`,
                        optionsFn: async () => {
                            const collections: Array<{ id: string; name: string }> = [];
                            for (let skip = 0; ; skip += 100) {
                                const result = await api.query(productCategoryFilterOptionsDocument, {
                                    options: { take: 100, skip, sort: { name: 'ASC' } },
                                });
                                collections.push(...result.collections.items);
                                if (collections.length >= result.collections.totalItems) break;
                            }
                            return collections.map(collection => ({
                                label: collection.name,
                                value: collection.id,
                            }));
                        },
                    },
                    facetValueId: {
                        title: t`Facet values`,
                        component: FacetValueFacetedFilter,
                    },
                }}
                transformVariables={variables => {
                    return {
                        options: {
                            ...variables.options,
                            filterOperator: 'AND',
                            filter: variables.options?.filter ?? {},
                        },
                        ...(hasAdvancedFilters ? { catalogFilter: summaryFilter } : {}),
                    } as typeof variables;
                }}
                transformQueryKey={queryKey => [
                    ...queryKey,
                    'catalog-advanced-filter',
                    hasAdvancedFilters,
                    summaryFilter,
                ]}
                defaultSort={[{ id: 'updatedAt', desc: true }]}
                defaultColumnOrder={[
                    'featuredAsset',
                    'name',
                    'sku',
                    'barcode',
                    'collections',
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
                    collections: true,
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
                    <CatalogAdvancedFilterAction value={advancedFilters} onApply={setAdvancedFilters} />
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

function compactVariantValues(values: string[], t: Translate): string {
    const unique = [...new Set(values.map(value => value.trim()).filter(Boolean))];
    if (unique.length === 0) return '—';
    if (unique.length === 1) return unique[0];
    return t`${unique[0]} and ${unique.length} total`;
}

function CatalogAdvancedFilterAction({
    value,
    onApply,
}: Readonly<{
    value: CatalogAdvancedFilters;
    onApply: (value: CatalogAdvancedFilters) => void;
}>) {
    const { t } = useLingui();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(value);
    const activeCount = Object.keys(catalogSummaryFilterInput(value)).length;
    const update = (next: Partial<CatalogAdvancedFilters>) => setDraft(current => ({ ...current, ...next }));
    const apply = () => {
        try {
            validateAdvancedFilters(draft, t);
            onApply({ ...draft });
            setOpen(false);
        } catch (filterError) {
            toast.error(filterError instanceof Error ? filterError.message : t`Invalid filter criteria`);
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
                <Filter />
                <Trans>Advanced filters</Trans>
                {activeCount > 0 && <Badge variant="secondary">{activeCount}</Badge>}
            </Button>
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-[640px]">
                    <SheetHeader>
                        <SheetTitle>
                            <Trans>Product advanced filters</Trans>
                        </SheetTitle>
                        <SheetDescription>
                            <Trans>
                                Name, SKU, barcode, price, cost, margin, stock and shelf life are calculated
                                for the current store.
                            </Trans>
                        </SheetDescription>
                    </SheetHeader>
                    <div className="grid flex-1 content-start gap-5 py-6 sm:grid-cols-2">
                        <FilterField label={t`Name / SKU / barcode`} className="sm:col-span-2">
                            <Input
                                value={draft.text}
                                onChange={event => update({ text: event.target.value })}
                                placeholder={t`Enter any keyword`}
                            />
                        </FilterField>
                        <FilterField label={t`Product group`}>
                            <Input
                                value={draft.category}
                                onChange={event => update({ category: event.target.value })}
                            />
                        </FilterField>
                        <FilterField label={t`Brand`}>
                            <Input
                                value={draft.brand}
                                onChange={event => update({ brand: event.target.value })}
                            />
                        </FilterField>
                        <FilterField label={t`Product status`}>
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
                                    <SelectItem value="ALL">
                                        <Trans>All</Trans>
                                    </SelectItem>
                                    <SelectItem value="ENABLED">
                                        <Trans>Enabled</Trans>
                                    </SelectItem>
                                    <SelectItem value="DISABLED">
                                        <Trans>Disabled</Trans>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </FilterField>
                        <FilterField label={t`Expiring within (days)`}>
                            <Input
                                type="number"
                                min="0"
                                step="1"
                                value={draft.expiringWithinDays}
                                onChange={event => update({ expiringWithinDays: event.target.value })}
                                placeholder={t`For example: 30`}
                            />
                        </FilterField>
                        <RangeFields
                            label={t`Selling price`}
                            minimum={draft.minimumSellingPrice}
                            maximum={draft.maximumSellingPrice}
                            step="0.01"
                            onMinimum={minimumSellingPrice => update({ minimumSellingPrice })}
                            onMaximum={maximumSellingPrice => update({ maximumSellingPrice })}
                        />
                        <RangeFields
                            label={t`Purchase cost`}
                            minimum={draft.minimumPurchaseCost}
                            maximum={draft.maximumPurchaseCost}
                            step="0.001"
                            onMinimum={minimumPurchaseCost => update({ minimumPurchaseCost })}
                            onMaximum={maximumPurchaseCost => update({ maximumPurchaseCost })}
                        />
                        <RangeFields
                            label={t`Margin (%)`}
                            minimum={draft.minimumMargin}
                            maximum={draft.maximumMargin}
                            step="0.1"
                            allowNegative
                            onMinimum={minimumMargin => update({ minimumMargin })}
                            onMaximum={maximumMargin => update({ maximumMargin })}
                        />
                        <RangeFields
                            label={t`Available stock`}
                            minimum={draft.minimumAvailableStock}
                            maximum={draft.maximumAvailableStock}
                            step="1"
                            allowNegative
                            onMinimum={minimumAvailableStock => update({ minimumAvailableStock })}
                            onMaximum={maximumAvailableStock => update({ maximumAvailableStock })}
                        />
                        <div className="flex items-center justify-between rounded-lg border p-4 sm:col-span-2">
                            <div>
                                <Label htmlFor="catalog-low-stock-filter">
                                    <Trans>Low stock only</Trans>
                                </Label>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    <Trans>Available stock is at or below the reorder level</Trans>
                                </p>
                            </div>
                            <Switch
                                id="catalog-low-stock-filter"
                                checked={draft.lowStock}
                                onCheckedChange={lowStock => update({ lowStock })}
                            />
                        </div>
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
                            <Trans>Clear filters</Trans>
                        </Button>
                        <Button onClick={apply}>
                            <Trans>Apply filters</Trans>
                        </Button>
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
    const { t } = useLingui();
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
                    placeholder={t`Minimum`}
                />
                <Input
                    type="number"
                    min={allowNegative ? undefined : '0'}
                    step={step}
                    value={maximum}
                    onChange={event => onMaximum(event.target.value)}
                    placeholder={t`Maximum`}
                />
            </div>
        </div>
    );
}

type Translate = ReturnType<typeof useLingui>['t'];

function validateAdvancedFilters(value: CatalogAdvancedFilters, t: Translate): void {
    for (const [key, label, integer, nonNegative] of [
        ['minimumSellingPrice', t`Minimum selling price`, false, true],
        ['maximumSellingPrice', t`Maximum selling price`, false, true],
        ['minimumPurchaseCost', t`Minimum purchase cost`, false, true],
        ['maximumPurchaseCost', t`Maximum purchase cost`, false, true],
        ['minimumMargin', t`Minimum margin`, false, false],
        ['maximumMargin', t`Maximum margin`, false, false],
        ['minimumAvailableStock', t`Minimum available stock`, true, false],
        ['maximumAvailableStock', t`Maximum available stock`, true, false],
        ['expiringWithinDays', t`Expiring within days`, true, true],
    ] as const) {
        const raw = value[key].trim();
        if (!raw) continue;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
            throw new Error(t`${label} has an invalid format`);
        }
        if (nonNegative && parsed < 0) throw new Error(t`${label} cannot be negative`);
    }
    for (const [minimumKey, maximumKey, label] of [
        ['minimumSellingPrice', 'maximumSellingPrice', t`Selling price`],
        ['minimumPurchaseCost', 'maximumPurchaseCost', t`Purchase cost`],
        ['minimumMargin', 'maximumMargin', t`Margin`],
        ['minimumAvailableStock', 'maximumAvailableStock', t`Available stock`],
    ] as const) {
        const minimum = optionalFilterNumber(value[minimumKey]);
        const maximum = optionalFilterNumber(value[maximumKey]);
        if (minimum != null && maximum != null && minimum > maximum) {
            throw new Error(t`${label} maximum cannot be lower than minimum`);
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
