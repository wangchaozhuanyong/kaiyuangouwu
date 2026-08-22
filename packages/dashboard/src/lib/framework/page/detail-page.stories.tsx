import { graphql } from '@/vdb/graphql/graphql.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DemoRouterProvider } from '../../../../.storybook/providers.js';
import { DetailPage, DetailPageProps } from './detail-page.js';

// Sample GraphQL query for a product detail
const productFragment = graphql(`
    fragment ProductDetail on Product {
        id
        createdAt
        updatedAt
        name
        slug
        description
        enabled
        featuredAsset {
            id
        }
        assets {
            id
        }
        facetValues {
            id
        }
        translations {
            id
            languageCode
            name
            slug
            description
        }
    }
`);

const productQuery = graphql(
    `
        query Product($id: ID!) {
            product(id: $id) {
                ...ProductDetail
            }
        }
    `,
    [productFragment],
);

const createProductDocument = graphql(`
    mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
            name
            slug
            description
            enabled
        }
    }
`);

const updateProductDocument = graphql(`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
            name
            slug
            description
            enabled
        }
    }
`);

const storyQueryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
            staleTime: Infinity,
        },
    },
});

storyQueryClient.setQueryData(['DetailPage', 'product', { id: '1' }], {
    product: {
        id: '1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        name: 'Sample product',
        slug: 'sample-product',
        description: 'A deterministic product used by the DetailPage story.',
        enabled: true,
        featuredAsset: null,
        assets: [],
        facetValues: [],
        translations: [
            {
                id: '1',
                languageCode: 'en',
                name: 'Sample product',
                slug: 'sample-product',
                description: 'A deterministic product used by the DetailPage story.',
            },
        ],
    },
});

function DetailPageStoryWrapper(props: Omit<DetailPageProps<any, any, any>, 'route'>) {
    return (
        <QueryClientProvider client={storyQueryClient}>
            <DemoRouterProvider
                component={route => <DetailPage {...props} route={route} />}
                path={'/products/$id'}
                initialPath={'/products/1'}
            />
        </QueryClientProvider>
    );
}

const meta = {
    title: 'Layout/DetailPage',
    component: DetailPageStoryWrapper,
    parameters: {
        layout: 'fullscreen',
    },
    tags: ['autodocs'],
    argTypes: {
        pageId: {
            control: 'text',
            description: 'Unique identifier for the detail page',
        },
        entityName: {
            control: 'text',
            description: 'Name of the entity (inferred from query if not provided)',
        },
        title: {
            control: false,
            description: 'Function that returns the page title based on the entity',
        },
        queryDocument: {
            control: false,
            description: 'GraphQL query document for fetching entity data',
        },
        createDocument: {
            control: false,
            description: 'GraphQL mutation document for creating the entity',
        },
        updateDocument: {
            control: false,
            description: 'GraphQL mutation document for updating the entity',
        },
        setValuesForUpdate: {
            control: false,
            description: 'Function to map entity data to update input',
        },
    },
} satisfies Meta<typeof DetailPageStoryWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Basic example of a DetailPage showing a product entity.
 * This demonstrates the minimal configuration needed to render a detail page.
 */
export const BasicDetail: Story = {
    args: {
        pageId: 'product-detail',
        queryDocument: productQuery,
        updateDocument: updateProductDocument,
        title: entity => entity?.name || 'Product',
        setValuesForUpdate: entity => ({
            id: entity.id,
            name: entity.name,
            slug: entity.slug,
            description: entity.description,
            enabled: entity.enabled,
            featuredAssetId: entity.featuredAsset?.id,
            assetIds: entity.assets.map(asset => asset.id),
            facetValueIds: entity.facetValues.map(facetValue => facetValue.id),
            translations: entity.translations.map(translation => ({
                id: translation.id,
                languageCode: translation.languageCode,
                name: translation.name,
                slug: translation.slug,
                description: translation.description,
                customFields: (translation as any).customFields,
            })),
        }),
    },
};
