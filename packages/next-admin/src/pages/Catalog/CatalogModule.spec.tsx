// @vitest-environment jsdom

import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { CatalogModule } from './CatalogModule';

const cleanups: Array<() => void> = [];

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function renderCatalog() {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const rootCollection = {
        __typename: 'Collection',
        id: 'root',
        name: '__root_collection__',
        slug: '__root_collection__',
    };
    const tobacco = { __typename: 'Collection', id: 'tobacco', name: '正品烟草', slug: 'tobacco' };
    const cigarettes = { __typename: 'Collection', id: 'cigarettes', name: '香烟', slug: 'cigarettes' };
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    if (operation.operationName === 'GetProducts') {
                        observer.next({
                            data: {
                                products: {
                                    totalItems: 1,
                                    items: [
                                        {
                                            id: 'product-1',
                                            createdAt: '2026-09-07T00:00:00.000Z',
                                            updatedAt: '2026-09-07T00:00:00.000Z',
                                            enabled: true,
                                            name: '白利群2',
                                            slug: 'white-liqun-2',
                                            description: '',
                                            customFields: {
                                                fulfillmentType: 'physical',
                                                refundPolicy: null,
                                                manualDeliverySlaMinutes: null,
                                            },
                                            featuredAsset: null,
                                            facetValues: [],
                                            variants: [
                                                {
                                                    id: 'variant-1',
                                                    name: '白利群2',
                                                    sku: 'WHITE-LIQUN-2',
                                                    price: 19000,
                                                    currencyCode: 'MYR',
                                                    stockLevel: 'IN_STOCK',
                                                    stockOnHand: 105,
                                                    stockAllocated: 0,
                                                    enabled: true,
                                                    trackInventory: 'TRUE',
                                                    autoCardAvailableStock: null,
                                                    customFields: {
                                                        fulfillmentType: 'physical',
                                                        digitalDeliveryMode: null,
                                                        digitalStockPolicy: null,
                                                    },
                                                },
                                            ],
                                            collections: [
                                                { ...tobacco, parent: rootCollection },
                                                { ...cigarettes, parent: tobacco },
                                            ],
                                        },
                                    ],
                                },
                            },
                        });
                    } else if (operation.operationName === 'GetCollections') {
                        observer.next({
                            data: {
                                collections: {
                                    totalItems: 2,
                                    items: [
                                        {
                                            ...tobacco,
                                            position: 1,
                                            isPrivate: false,
                                            filters: [],
                                            children: [],
                                        },
                                        {
                                            ...cigarettes,
                                            position: 2,
                                            isPrivate: false,
                                            filters: [],
                                            children: [],
                                        },
                                    ],
                                },
                            },
                        });
                    } else if (operation.operationName === 'NextAdminStoreCommerceMode') {
                        observer.next({
                            data: { myStoreCommerceMode: { mode: 'PHYSICAL_ONLY', conflicts: [] } },
                        });
                    } else if (operation.operationName === 'GetCatalogChannels') {
                        observer.next({
                            data: {
                                activeChannel: {
                                    id: 'channel-1',
                                    code: 'meiyijia',
                                    token: 'meiyijia',
                                    defaultCurrencyCode: 'MYR',
                                },
                                channels: {
                                    totalItems: 1,
                                    items: [
                                        {
                                            id: 'channel-1',
                                            code: 'meiyijia',
                                            token: 'meiyijia',
                                            defaultCurrencyCode: 'MYR',
                                        },
                                    ],
                                },
                            },
                        });
                    } else if (operation.operationName === 'NextAdminCatalogProductOperations') {
                        observer.next({
                            data: {
                                catalogProductOperations: [
                                    {
                                        productId: 'product-1',
                                        variantCount: 1,
                                        minimumSellingPrice: 19000,
                                        maximumSellingPrice: 19000,
                                        minimumPurchaseCostMicrounits: 70000,
                                        maximumPurchaseCostMicrounits: 70000,
                                        minimumMargin: 0.632,
                                        maximumMargin: 0.632,
                                        minimumStock: null,
                                        maximumStock: null,
                                        lowStock: false,
                                        missingCostVariants: 0,
                                    },
                                ],
                            },
                        });
                    } else {
                        observer.error(new Error(`Unexpected operation: ${operation.operationName}`));
                        return;
                    }
                    observer.complete();
                }),
        ),
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
        root.unmount();
        client.stop();
        container.remove();
    });

    await act(async () => {
        root.render(
            <ApolloProvider client={client}>
                <MemoryRouter>
                    <FeatureHelpProvider>
                        <CatalogModule />
                    </FeatureHelpProvider>
                </MemoryRouter>
            </ApolloProvider>,
        );
    });

    return container;
}

describe('CatalogModule category columns', () => {
    it('renders separate first-level and second-level category statistics', async () => {
        const container = await renderCatalog();
        const headers = Array.from(container.querySelectorAll('thead th')).map(header =>
            header.textContent?.trim(),
        );
        const cells = Array.from(container.querySelectorAll('tbody tr:first-child td')).map(cell =>
            cell.textContent?.trim(),
        );

        expect(headers).toContain('一级分类');
        expect(headers).toContain('二级分类');
        expect(cells).toContain('正品烟草');
        expect(cells).toContain('香烟');
    });
});
