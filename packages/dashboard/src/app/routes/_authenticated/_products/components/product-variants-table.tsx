import { Money } from '@/vdb/components/data-display/money.js';
import {
    PaginatedListDataTable,
    PaginatedListRefresherRegisterFn,
} from '@/vdb/components/shared/paginated-list-data-table.js';
import { StockLevelLabel } from '@/vdb/components/shared/stock-level-label.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { useLingui } from '@lingui/react/macro';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { useState } from 'react';
import {
    AssignFacetValuesToProductVariantsBulkAction,
    AssignProductVariantsToChannelBulkAction,
    DeleteProductVariantsBulkAction,
    DisableProductVariantsBulkAction,
    EnableProductVariantsBulkAction,
    RemoveProductVariantsFromChannelBulkAction,
} from '../../_product-variants/components/product-variant-bulk-actions.js';
import { ProductVariantEditorSheet } from '../../_product-variants/components/product-variant-editor-sheet.js';
import { productVariantListDocument } from '../products.graphql.js';

interface ProductVariantsTableProps {
    productId: string;
    registerRefresher?: PaginatedListRefresherRegisterFn;
    fromProductDetailPage?: boolean;
    digitalInventory?: boolean;
}

export function ProductVariantsTable({
    productId,
    registerRefresher,
    fromProductDetailPage,
    digitalInventory = false,
}: ProductVariantsTableProps) {
    const { pageId } = usePage();
    const { setTableSettings } = useUserSettings();
    const { formatCurrencyName } = useLocalFormat();
    const { t } = useLingui();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sorting, setSorting] = useState<SortingState>([]);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);
    const [selectedVariant, setSelectedVariant] = useState<{ id: string; name: string }>();

    return (
        <>
            <PaginatedListDataTable
                registerRefresher={registerRefresher}
                listQuery={productVariantListDocument}
                transformVariables={variables => ({
                    ...variables,
                    productId,
                })}
                defaultVisibility={{
                    featuredAsset: true,
                    name: true,
                    enabled: true,
                    price: true,
                    priceWithTax: true,
                    stockLevels: true,
                }}
                bulkActions={[
                    [
                        {
                            component: EnableProductVariantsBulkAction,
                            order: 10,
                        },
                        {
                            component: DisableProductVariantsBulkAction,
                            order: 20,
                        },
                        {
                            component: AssignProductVariantsToChannelBulkAction,
                            order: 100,
                        },
                        {
                            component: RemoveProductVariantsFromChannelBulkAction,
                            order: 200,
                        },
                        {
                            component: AssignFacetValuesToProductVariantsBulkAction,
                            order: 300,
                        },
                    ],
                    [
                        {
                            component: DeleteProductVariantsBulkAction,
                        },
                    ],
                ]}
                customizeColumns={{
                    name: {
                        header: t`Variant name`,
                        cell: ({ row: { original } }) => <span>{original.name}</span>,
                    },
                    currencyCode: {
                        cell: ({ row: { original } }) => formatCurrencyName(original.currencyCode, 'full'),
                    },
                    price: {
                        meta: {
                            dependencies: ['currencyCode'],
                        },
                        cell: ({ row: { original } }) => (
                            <Money value={original.price} currency={original.currencyCode} />
                        ),
                    },
                    priceWithTax: {
                        meta: {
                            dependencies: ['currencyCode'],
                        },
                        cell: ({ row: { original } }) => (
                            <Money value={original.priceWithTax} currency={original.currencyCode} />
                        ),
                    },
                    stockLevels: {
                        header: digitalInventory ? t`Digital stock` : t`Stock`,
                        cell: ({ row: { original } }) => (
                            <StockLevelLabel stockLevels={original.stockLevels} />
                        ),
                    },
                }}
                page={page}
                itemsPerPage={pageSize}
                sorting={sorting}
                columnFilters={filters}
                onPageChange={(_, page, perPage) => {
                    setPage(page);
                    setPageSize(perPage);
                }}
                onSortChange={(_, sorting) => {
                    setSorting(sorting);
                }}
                onFilterChange={(_, filters) => {
                    setFilters(filters);
                }}
                onColumnVisibilityChange={(_, columnVisibility) => {
                    if (pageId) {
                        setTableSettings(pageId, 'columnVisibility', columnVisibility);
                    }
                }}
                primaryRowAction={{
                    label: t`Edit`,
                    onClick: row => setSelectedVariant({ id: row.original.id, name: row.original.name }),
                }}
            />
            <ProductVariantEditorSheet
                open={Boolean(selectedVariant)}
                variantId={selectedVariant?.id}
                variantName={selectedVariant?.name}
                linkSearch={fromProductDetailPage ? { from: 'product' } : undefined}
                onOpenChange={open => {
                    if (!open) {
                        setSelectedVariant(undefined);
                    }
                }}
            />
        </>
    );
}
