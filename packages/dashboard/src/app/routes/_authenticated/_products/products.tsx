import { FacetValueFacetedFilter } from '@/vdb/components/data-table/data-table-facet-value-faceted-filter.js';
import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { RichTextDescriptionCell } from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ListRestart, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
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

    return (
        <ListPage
            pageId="product-list"
            listQuery={withProductVariantCustomFields(productListDocument)}
            title={<Trans>Products</Trans>}
            searchPlaceholder={t`Search product name, URL identifier or SKU`}
            customizeColumns={{
                name: {
                    header: () => <Trans>Product name</Trans>,
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
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
    );
}
