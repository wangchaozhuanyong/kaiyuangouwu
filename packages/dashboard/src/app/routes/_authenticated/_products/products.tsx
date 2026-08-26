import { FacetValueFacetedFilter } from '@/vdb/components/data-table/data-table-facet-value-faceted-filter.js';
import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { RichTextDescriptionCell } from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { DropdownMenuItem } from '@/vdb/components/ui/dropdown-menu.js';
import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { PageActionBarRight } from '@/vdb/framework/layout-engine/page-layout.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { LayersIcon, ListRestart, PlusIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { AssignAllProductsDialog } from './components/assign-all-products-dialog.js';
import { isAssignAllProductsAvailable } from './components/assign-all-products.js';
import {
    AssignFacetValuesToProductsBulkAction,
    AssignProductsToChannelBulkAction,
    DeleteProductsBulkAction,
    DuplicateProductsBulkAction,
    RemoveProductsFromChannelBulkAction,
} from './components/product-bulk-actions.js';
import { getProductFulfillmentType } from './components/product-fulfillment-type.js';
import { productListDocument, reindexDocument, withProductVariantCustomFields } from './products.graphql.js';

export const Route = createFileRoute('/_authenticated/_products/products')({
    component: ProductListPage,
    loader: () => ({ breadcrumb: () => <Trans>Products</Trans> }),
});

function ProductListPage() {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const { activeChannel, channels } = useChannel();
    const [assignAllDialogOpen, setAssignAllDialogOpen] = useState(false);
    const canAssignAllProducts = isAssignAllProductsAvailable(activeChannel, channels, DEFAULT_CHANNEL_CODE);
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

    const handleAssignmentSuccess = () => {
        void queryClient.invalidateQueries({ queryKey: ['PaginatedListDataTable'] });
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
                        cell: ({ row }) => (
                            <DetailPageButton id={row.original.id} label={row.original.name} />
                        ),
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
                              name: { contains: searchTerm },
                              slug: { contains: searchTerm },
                              sku: { contains: searchTerm },
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
                    return {
                        options: {
                            ...variables.options,
                            filterOperator: 'OR',
                        },
                    };
                }}
                defaultSort={[{ id: 'updatedAt', desc: true }]}
                defaultColumnOrder={[
                    'featuredAsset',
                    'name',
                    'fulfillmentType',
                    'enabled',
                    'channels',
                    'slug',
                    'updatedAt',
                ]}
                defaultVisibility={{
                    featuredAsset: true,
                    name: true,
                    fulfillmentType: true,
                    enabled: true,
                    channels: true,
                    slug: true,
                    updatedAt: true,
                }}
                route={Route}
                bulkActions={[
                    [
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
                <ActionBarItem itemId="rebuild-index-button" requiresPermission={['UpdateCatalog']}>
                    <Button variant="outline" onClick={handleRebuildSearchIndex}>
                        <ListRestart />
                        <Trans>Rebuild search index</Trans>
                    </Button>
                </ActionBarItem>
                <ActionBarItem itemId="create-button" requiresPermission={['CreateProduct', 'CreateCatalog']}>
                    <Button render={<Link to="./new" />}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        <Trans>Create product</Trans>
                    </Button>
                </ActionBarItem>
            </ListPage>
            <AssignAllProductsDialog
                open={assignAllDialogOpen}
                onOpenChange={setAssignAllDialogOpen}
                onSuccess={handleAssignmentSuccess}
            />
        </>
    );
}
