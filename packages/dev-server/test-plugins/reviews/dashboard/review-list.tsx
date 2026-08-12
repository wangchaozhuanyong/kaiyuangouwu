import { graphql } from '@/graphql/graphql';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { DashboardRouteDefinition, DetailPageButton, ListPage } from '@vendure/dashboard';

const reviewMessages = {
    productReviews: msg({ id: 'review.productReviews', message: 'Product reviews' }),
};

const getReviewList = graphql(`
    query GetProductReviews($options: ProductReviewListOptions) {
        productReviews(options: $options) {
            items {
                id
                createdAt
                updatedAt
                product {
                    id
                    name
                }
                productVariant {
                    id
                    name
                    sku
                }
                summary
                body
                rating
                authorName
                authorLocation
                upvotes
                downvotes
                state
                response
                responseCreatedAt
            }
        }
    }
`);

export const reviewList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'catalog',
        id: 'reviews',
        url: '/reviews',
        title: reviewMessages.productReviews.id,
        requiresPermission: ['ReadCatalog'],
    },
    path: '/reviews',
    loader: () => ({
        breadcrumb: () => <Trans>Product reviews</Trans>,
    }),
    component: route => (
        <ListPage
            pageId="review-list"
            title={<Trans>Product reviews</Trans>}
            listQuery={getReviewList}
            route={route}
            defaultVisibility={{
                productVariant: false,
                product: false,
                summary: false,
                rating: false,
                authorName: false,
                reviewerName: false,
                responseCreatedAt: false,
                response: false,
                upvotes: false,
                downvotes: false,
            }}
            customizeColumns={{
                id: {
                    header: () => <Trans>ID</Trans>,
                    cell: ({ row }) => {
                        return <DetailPageButton id={row.original.id} label={row.original.id} />;
                    },
                },
                product: {
                    header: () => <Trans>Product</Trans>,
                    cell: ({ row }) => {
                        return <DetailPageButton id={row.original.id} label={row.original.product.name} />;
                    },
                },
                reviewerName: {
                    header: () => <Trans>Reviewer name</Trans>,
                    cell: ({ row }) => {
                        return <div className="text-red-500">{row.original.customFields?.reviewerName}</div>;
                    },
                },
            }}
        />
    ),
};
