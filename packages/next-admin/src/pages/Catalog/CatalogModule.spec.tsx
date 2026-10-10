// @vitest-environment jsdom

import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { buildSchema, print, validate } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { digitalProductAdminSchema } from '../../../../commerce-fulfillment-plugin/src/digital-product.schema';
import { channelScopeResponseLink, setInitialActiveChannel } from '../../apollo';
import { AdminPageWorkspace } from '../../components/AdminPageWorkspace';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import {
    catalogDigitalStockQuery,
    UPDATE_DIGITAL_VARIANT,
    type DigitalWorkspaceVariant,
} from '../../graphql/product-domains.graphql';
import { queryPolicy } from '../../runtime/admin-query-runtime';
import { createResourceInvalidationLink, resourceDomains } from '../../runtime/admin-resource-events';
import { CatalogModule } from './CatalogModule';

const cleanups: Array<() => void> = [];

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    sessionStorage.clear();
    vi.useRealTimers();
});

async function renderCatalog({
    empty = false,
    initialEntry = '/',
    channelCode = 'meiyijia',
    digital = false,
    stockAllocated = 0,
    stockUnavailable = false,
    variantCount = 1,
    autoCardStock = null,
    deliveryMode = null,
    managedWorkspace = false,
    digitalWorkspaces,
    workspaceFailure,
    onClient,
    listed = true,
    productTotal = 1,
    assignmentTotal = 1,
    requests,
}: {
    empty?: boolean;
    initialEntry?: string;
    channelCode?: string | (() => string);
    digital?: boolean;
    stockAllocated?: number;
    stockUnavailable?: boolean;
    variantCount?: number;
    autoCardStock?: number | null;
    deliveryMode?: DigitalWorkspaceVariant['deliveryMode'] | null;
    managedWorkspace?: boolean;
    digitalWorkspaces?: () => Array<
        Pick<
            DigitalWorkspaceVariant,
            'id' | 'deliveryMode' | 'stockPolicy' | 'availableQuantity' | 'migrationRequired'
        >
    >;
    workspaceFailure?: () => boolean;
    onClient?: (client: ApolloClient, rerender: () => Promise<void>) => void;
    listed?: boolean;
    productTotal?: number;
    assignmentTotal?: number;
    requests?: Array<{ name: string; variables: Record<string, unknown> }>;
} = {}) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const rootCollection = {
        __typename: 'Collection',
        id: 'root',
        name: '未填写中文名称',
        slug: '__root_collection__',
    };
    const tobacco = { __typename: 'Collection', id: 'tobacco', name: '正品烟草', slug: 'tobacco' };
    const cigarettes = { __typename: 'Collection', id: 'cigarettes', name: '香烟', slug: 'cigarettes' };
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    const currentChannelCode =
                        typeof channelCode === 'function' ? channelCode() : channelCode;
                    requests?.push({
                        name: operation.operationName ?? '',
                        variables: operation.variables,
                    });
                    if (operation.operationName === 'StoreCatalogStatus') {
                        observer.next({
                            data: {
                                myStoreCatalogStatus: {
                                    authorized: empty ? 0 : 1,
                                    listed: empty || !listed ? 0 : 1,
                                    paused: !empty && !listed ? 1 : 0,
                                    pending: 0,
                                    outOfStock: stockAllocated >= 105 ? 1 : 0,
                                    items: empty
                                        ? []
                                        : [
                                              {
                                                  productId: 'product-1',
                                                  listed,
                                                  pending: false,
                                                  paused: !listed,
                                                  outOfStock: stockAllocated >= 105,
                                              },
                                          ],
                                },
                            },
                        });
                        observer.complete();
                        return;
                    }
                    if (operation.operationName === 'GetProducts') {
                        if (empty) {
                            observer.next({ data: { products: { totalItems: 0, items: [] } } });
                            observer.complete();
                            return;
                        }
                        observer.next({
                            data: {
                                products: {
                                    totalItems: productTotal,
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
                                                fulfillmentType: digital ? 'digital' : 'physical',
                                                pricingMode: 'FIXED',
                                                refundPolicy: null,
                                                manualDeliverySlaMinutes: null,
                                            },
                                            featuredAsset: null,
                                            facetValues: [],
                                            variants: Array.from({ length: variantCount }, (_, index) => ({
                                                id: `variant-${index + 1}`,
                                                name: '白利群2',
                                                sku: 'WHITE-LIQUN-2',
                                                price: 19000,
                                                currencyCode: 'MYR',
                                                stockLevel:
                                                    stockAllocated >= 105 ? 'OUT_OF_STOCK' : 'IN_STOCK',
                                                stockOnHand: stockUnavailable ? null : 105,
                                                stockAllocated,
                                                enabled: true,
                                                trackInventory: 'TRUE',
                                                autoCardAvailableStock: autoCardStock,
                                                customFields: {
                                                    fulfillmentType: digital ? 'digital' : 'physical',
                                                    pricingMode: 'FIXED',
                                                    digitalDeliveryMode: deliveryMode,
                                                    digitalStockPolicy: null,
                                                },
                                            })),
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
                            data: {
                                myStoreCommerceMode: {
                                    mode: digital ? 'DIGITAL_ONLY' : 'PHYSICAL_ONLY',
                                    conflicts: [],
                                },
                            },
                        });
                    } else if (operation.operationName === 'GetCatalogChannels') {
                        observer.next({
                            data: {
                                activeChannel: {
                                    id: 'channel-1',
                                    code: currentChannelCode,
                                    token: 'meiyijia',
                                    defaultCurrencyCode: 'MYR',
                                    customFields: {
                                        storefrontNameZh:
                                            currentChannelCode === '__default_channel__'
                                                ? ''
                                                : currentChannelCode,
                                        storefrontNameEn:
                                            currentChannelCode === '__default_channel__'
                                                ? ''
                                                : currentChannelCode,
                                    },
                                },
                                channels: {
                                    totalItems: 1,
                                    items: [
                                        {
                                            id: 'channel-1',
                                            code: currentChannelCode,
                                            token: 'meiyijia',
                                            defaultCurrencyCode: 'MYR',
                                            customFields: {
                                                storefrontNameZh:
                                                    currentChannelCode === '__default_channel__'
                                                        ? ''
                                                        : currentChannelCode,
                                                storefrontNameEn:
                                                    currentChannelCode === '__default_channel__'
                                                        ? ''
                                                        : currentChannelCode,
                                            },
                                        },
                                    ],
                                },
                            },
                        });
                    } else if (operation.operationName === 'UpdateDigitalVariant') {
                        observer.next({
                            data: {
                                updateDigitalVariantConfig: {
                                    id: 'fixture-config',
                                    availableQuantity: operation.variables.input.availableQuantity,
                                },
                            },
                        });
                    } else if (operation.operationName === 'NextAdminCatalogProductOperationsStock') {
                        if (workspaceFailure?.()) {
                            observer.error(new Error('Digital stock read failed'));
                            return;
                        }
                        observer.next({
                            data: Object.fromEntries(
                                Object.entries(operation.variables).map(([alias, productId]) => [
                                    alias,
                                    {
                                        productId,
                                        variants: digitalWorkspaces?.() ?? [
                                            {
                                                id: 'variant-1',
                                                deliveryMode: 'manual_service',
                                                stockPolicy: 'limited',
                                                availableQuantity: null,
                                                migrationRequired: true,
                                            },
                                        ],
                                    },
                                ]),
                            ),
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
                    } else if (operation.operationName === 'GetCatalogChannelAssignments') {
                        const channel = {
                            id: 'channel-1',
                            code: currentChannelCode,
                            displayName: '本店',
                            isDefault: false,
                        };
                        observer.next({
                            data: {
                                catalogProductChannelAssignments: {
                                    totalItems: assignmentTotal,
                                    channels: [channel],
                                    scopeChannel: channel,
                                    summary: {
                                        totalItems: assignmentTotal,
                                        unassignedItems: 0,
                                        multiChannelItems: 0,
                                        channelCounts: [{ channelId: 'channel-1', count: assignmentTotal }],
                                    },
                                    items: assignmentTotal
                                        ? [
                                              {
                                                  id: 'product-1',
                                                  name: '白利群2',
                                                  enabled: true,
                                                  channels: [channel],
                                              },
                                          ]
                                        : [],
                                },
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
    client.setLink(
        ApolloLink.from([
            channelScopeResponseLink,
            createResourceInvalidationLink(() => 'fixture-scope'),
            client.link,
        ]),
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
        root.unmount();
        client.stop();
        container.remove();
    });

    const rerender = async () =>
        act(async () => {
            root.render(
                <ApolloProvider client={client}>
                    <MemoryRouter
                        key={typeof channelCode === 'function' ? channelCode() : channelCode}
                        initialEntries={[initialEntry]}
                    >
                        <FeatureHelpProvider>
                            {managedWorkspace ? (
                                <AdminPageWorkspace page="/catalog/list" active>
                                    <CatalogModule />
                                </AdminPageWorkspace>
                            ) : (
                                <CatalogModule />
                            )}
                        </FeatureHelpProvider>
                    </MemoryRouter>
                </ApolloProvider>,
            );
        });
    onClient?.(client, rerender);
    await rerender();

    return container;
}

function stockCell(container: HTMLElement) {
    const headers = [...container.querySelectorAll('thead th')].map(cell => cell.textContent?.trim());
    return container
        .querySelectorAll('tbody tr:first-child td')
        [headers.indexOf('虚拟可售库存')]?.textContent?.trim();
}

const manualWorkspace = (availableQuantity: number | null, migrationRequired = false) => [
    {
        id: 'variant-1',
        deliveryMode: 'manual_service' as const,
        stockPolicy: 'limited' as const,
        availableQuantity,
        migrationRequired,
    },
];

describe('CatalogModule current-store digital stock', () => {
    it('uses active digital quota instead of the preserved legacy warehouse', async () => {
        const container = await renderCatalog({
            digital: true,
            digitalWorkspaces: () => manualWorkspace(100),
        });
        expect(stockCell(container)).toBe('100');
    });

    it('shows 100 → 80 → 100 from net availability without subtracting legacy allocation twice', async () => {
        let available = 100;
        let client!: ApolloClient;
        const container = await renderCatalog({
            digital: true,
            stockAllocated: 20,
            digitalWorkspaces: () => manualWorkspace(available),
            onClient: value => {
                client = value;
            },
        });
        expect(stockCell(container)).toBe('100');
        for (const value of [80, 100]) {
            available = value;
            await act(async () => {
                await client.refetchQueries({ include: ['NextAdminCatalogProductOperationsStock'] });
            });
            expect(stockCell(container)).toBe(String(value));
        }
    });

    it('keeps uncutover stock on the legacy available-stock path', async () => {
        const container = await renderCatalog({
            digital: true,
            stockAllocated: 20,
            digitalWorkspaces: () => manualWorkspace(null, true),
        });
        expect(stockCell(container)).toBe('85');
    });

    it.each([0, 80])('preserves paused/listed state independently of quota %i', async available => {
        const container = await renderCatalog({
            digital: true,
            listed: false,
            digitalWorkspaces: () => manualWorkspace(available),
        });
        expect(stockCell(container)).toBe(String(available));
        expect(container.textContent).toContain('仓库中');
    });

    it('keeps unlimited and partly unlimited summaries', async () => {
        const unlimited = { ...manualWorkspace(100)[0], stockPolicy: 'unlimited' as const };
        const container = await renderCatalog({ digital: true, digitalWorkspaces: () => [unlimited] });
        expect(stockCell(container)).toBe('无限');
        const mixed = await renderCatalog({
            digital: true,
            variantCount: 2,
            digitalWorkspaces: () => [unlimited, { ...manualWorkspace(20)[0], id: 'variant-2' }],
        });
        expect(stockCell(mixed)).toBe('部分无限');
    });

    it('keeps automatic-card stock sourced from the pool', async () => {
        const container = await renderCatalog({
            digital: true,
            autoCardStock: 7,
            digitalWorkspaces: () => [
                { ...manualWorkspace(999)[0], deliveryMode: 'auto_card', stockPolicy: 'pool_derived' },
            ],
        });
        expect(stockCell(container)).toBe('7');
        const failedWorkspace = await renderCatalog({
            digital: true,
            deliveryMode: 'auto_card',
            autoCardStock: 7,
            workspaceFailure: () => true,
        });
        expect(stockCell(failedWorkspace)).toBe('7');
    });

    it('reads limited file availability through the same independent workspace', async () => {
        const container = await renderCatalog({
            digital: true,
            digitalWorkspaces: () => [{ ...manualWorkspace(35)[0], deliveryMode: 'file_download' }],
        });
        expect(stockCell(container)).toBe('35');
    });

    it('does not disguise missing active quota data as old stock or zero', async () => {
        const failed = await renderCatalog({ digital: true, workspaceFailure: () => true });
        expect(stockCell(failed)).toBe('未获取');
        const missing = await renderCatalog({ digital: true, digitalWorkspaces: () => [] });
        expect(stockCell(missing)).toBe('未获取');
    });

    it('retains the last same-store quantity when a refresh fails', async () => {
        let fail = false;
        let client!: ApolloClient;
        const container = await renderCatalog({
            digital: true,
            digitalWorkspaces: () => manualWorkspace(80),
            workspaceFailure: () => fail,
            onClient: value => {
                client = value;
            },
        });
        expect(stockCell(container)).toBe('80');
        fail = true;
        await act(async () => {
            await expect(
                client.refetchQueries({ include: ['NextAdminCatalogProductOperationsStock'] }),
            ).rejects.toThrow('Digital stock read failed');
        });
        expect(stockCell(container)).toBe('80');
    });

    it('refreshes the existing stock slot after a digital workspace save through shared catalog invalidation', async () => {
        let available = 100;
        let client!: ApolloClient;
        const requests: Array<{ name: string; variables: Record<string, unknown> }> = [];
        const container = await renderCatalog({
            digital: true,
            managedWorkspace: true,
            requests,
            digitalWorkspaces: () => manualWorkspace(available),
            onClient: value => {
                client = value;
            },
        });
        expect(stockCell(container)).toBe('100');
        const readsBeforeSave = requests.filter(
            request => request.name === 'NextAdminCatalogProductOperationsStock',
        ).length;
        vi.useFakeTimers();
        available = 80;
        await act(async () => {
            await client.mutate({
                mutation: UPDATE_DIGITAL_VARIANT,
                variables: {
                    input: {
                        productVariantId: 'variant-1',
                        deliveryMode: 'manual_service',
                        stockPolicy: 'limited',
                        availableQuantity: 80,
                        expectedAvailableQuantity: 100,
                    },
                },
            });
        });
        await act(async () => {
            await vi.runAllTimersAsync();
        });
        expect(stockCell(container)).toBe('80');
        expect(
            requests.filter(request => request.name === 'NextAdminCatalogProductOperationsStock'),
        ).toHaveLength(readsBeforeSave + 1);
    });

    it('clears same-product stock when the actual Apollo cache and store scope switch', async () => {
        let store = 'store-a';
        let client!: ApolloClient;
        let rerender!: () => Promise<void>;
        setInitialActiveChannel('fixture-store-a');
        const container = await renderCatalog({
            digital: true,
            channelCode: () => store,
            digitalWorkspaces: () => manualWorkspace(store === 'store-a' ? 100 : 30),
            onClient: (value, render) => {
                client = value;
                rerender = render;
            },
        });
        expect(stockCell(container)).toBe('100');
        await act(async () => {
            await client.clearStore();
        });
        store = 'store-b';
        setInitialActiveChannel('fixture-store-b');
        await rerender();
        expect(stockCell(container)).toBe('30');
        expect(container.textContent).toContain('当前数据范围：store-b');
    });

    it('batches existing workspace fields and uses shared catalog invalidation/secondary refresh', () => {
        const document = catalogDigitalStockQuery(2);
        expect(resourceDomains(document)).toEqual(['catalog']);
        expect(queryPolicy(document).stage).toBe(2);
        expect(document.definitions[0]).toMatchObject({
            kind: 'OperationDefinition',
            operation: 'query',
            variableDefinitions: [
                { variable: { name: { value: 'product0' } } },
                { variable: { name: { value: 'product1' } } },
            ],
            selectionSet: {
                selections: [
                    { alias: { value: 'product0' }, name: { value: 'digitalProductWorkspace' } },
                    { alias: { value: 'product1' }, name: { value: 'digitalProductWorkspace' } },
                ],
            },
        });
    });

    it('validates the maximum 100-row document against the existing digital Admin schema', () => {
        const schema = buildSchema(`
            scalar DateTime
            scalar Upload
            interface Node { id: ID! }
            type CatalogSupplier { id: ID! }
            type Product { id: ID! }
            type Query { _empty: Boolean }
            type Mutation { _empty: Boolean }
            ${print(digitalProductAdminSchema)}
        `);
        const document = catalogDigitalStockQuery(100);
        const operation = document.definitions[0];
        expect(validate(schema, document)).toEqual([]);
        expect(operation).toMatchObject({ kind: 'OperationDefinition' });
        if (operation.kind !== 'OperationDefinition') throw new Error('Expected query');
        expect(operation.variableDefinitions).toHaveLength(100);
        expect(operation.selectionSet.selections).toHaveLength(100);
        expect(operation.selectionSet.selections.at(-1)).toMatchObject({
            alias: { value: 'product99' },
            name: { value: 'digitalProductWorkspace' },
        });
    });

    it('does not request digital workspaces for physical rows', async () => {
        const requests: Array<{ name: string; variables: Record<string, unknown> }> = [];
        await renderCatalog({ requests });
        expect(requests.some(request => request.name === 'NextAdminCatalogProductOperationsStock')).toBe(
            false,
        );
    });
});

describe('CatalogModule category columns', () => {
    it('shows unallocated virtual stock while physical stock remains on-hand stock', async () => {
        const digital = await renderCatalog({ digital: true, stockAllocated: 105 });
        const digitalHeaders = Array.from(digital.querySelectorAll('thead th')).map(cell =>
            cell.textContent?.trim(),
        );
        const digitalCells = Array.from(digital.querySelectorAll('tbody tr:first-child td')).map(cell =>
            cell.textContent?.trim(),
        );
        expect(digitalCells[digitalHeaders.indexOf('虚拟可售库存')]).toBe('0');

        const physical = await renderCatalog({ stockAllocated: 105 });
        const physicalHeaders = Array.from(physical.querySelectorAll('thead th')).map(cell =>
            cell.textContent?.trim(),
        );
        const physicalCells = Array.from(physical.querySelectorAll('tbody tr:first-child td')).map(cell =>
            cell.textContent?.trim(),
        );
        expect(physicalCells[physicalHeaders.indexOf('在手总库存')]).toBe('105');
    });

    it('pins desktop filters while keeping the mobile toolbar in normal flow', async () => {
        const container = await renderCatalog();
        const toolbar = container.querySelector<HTMLElement>('[data-testid="catalog-filter-toolbar"]');

        expect(toolbar?.classList.contains('md:sticky')).toBe(true);
        expect(toolbar?.classList.contains('md:-top-8')).toBe(true);
        expect(toolbar?.parentElement?.classList.contains('overflow-hidden')).toBe(false);
    });

    it('describes soft deletion accurately and disables background search during password confirmation', async () => {
        const container = await renderCatalog();
        await act(async () => container.querySelector<HTMLButtonElement>('[title="删除商品"]')!.click());
        const dialog = container.querySelector('[role="alertdialog"]');
        expect(dialog?.textContent).toContain('标记删除');
        expect(dialog?.textContent).toContain('所有已分配店铺');
        expect(dialog?.textContent).not.toContain('从数据库中彻底移除');
        expect(container.querySelector<HTMLInputElement>('[aria-label="搜索商品"]')?.disabled).toBe(true);
        await act(async () =>
            [...dialog!.querySelectorAll('button')]
                .find(button => button.textContent?.trim() === '取消')!
                .click(),
        );
        expect(container.querySelector<HTMLInputElement>('[aria-label="搜索商品"]')?.disabled).toBe(false);
    });

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

    it('renders local sales scope and keeps platform allocation tools out of the store', async () => {
        const container = await renderCatalog();
        const headers = Array.from(container.querySelectorAll('thead th')).map(header =>
            header.textContent?.trim(),
        );

        expect(headers).toContain('销售店铺');
        expect(container.textContent).not.toContain('平台归属异常');
        expect(container.textContent).not.toContain('店铺归属检查');
        expect(container.textContent).toContain('本店已授权：1');
    });

    it('directs selected cross-store sales authorization to the platform', async () => {
        const container = await renderCatalog();
        const selectAllCheckbox = container.querySelector<HTMLInputElement>(
            'thead th input[type="checkbox"]',
        );
        expect(selectAllCheckbox).not.toBeNull();

        await act(async () => {
            selectAllCheckbox!.click();
        });

        expect(container.textContent).toContain('已选 1 个商品');
        expect(container.textContent).toContain('跨店销售授权由平台管理中心分配');
        expect(container.textContent).not.toContain('批量上架到店铺');
    });
});

describe('CatalogModule mobile actions', () => {
    it('keeps missing inventory unknown in both the phone summary and the table', async () => {
        const container = await renderCatalog({ stockUnavailable: true });
        const card = container.querySelector('.admin-mobile-record')!;
        const stockField = [...card.querySelectorAll('dt')].find(label => label.textContent === '在手总库存');
        expect(stockField?.nextElementSibling?.textContent).toBe('未获取');
        const headers = [...container.querySelectorAll('thead th')].map(cell => cell.textContent?.trim());
        const cells = [...container.querySelectorAll('tbody tr:first-child td')];
        expect(cells[headers.indexOf('在手总库存')]?.textContent?.trim()).toBe('未获取');
    });

    it('keeps the mobile selection and the original table selection in sync', async () => {
        const container = await renderCatalog();
        const cardSelection = container.querySelector<HTMLInputElement>(
            '[aria-label="移动端选择商品 白利群2"]',
        )!;
        await act(async () => cardSelection.click());
        expect(container.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')?.checked).toBe(true);
        expect(container.textContent).toContain('已选 1 个商品');
        await act(async () =>
            container.querySelector<HTMLInputElement>('[aria-label="选择本页全部商品"]')!.click(),
        );
        expect(container.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')?.checked).toBe(
            false,
        );
    });

    it('uses the original URL-backed query when sorting from the mobile controls', async () => {
        const requests: Array<{ name: string; variables: Record<string, unknown> }> = [];
        const container = await renderCatalog({ requests });
        const sorter = container.querySelector<HTMLSelectElement>('[aria-label="商品排序"]')!;
        await act(async () => {
            sorter.value = 'name';
            sorter.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(requests.filter(request => request.name === 'GetProducts').at(-1)?.variables).toMatchObject({
            options: { sort: { name: 'DESC' } },
        });
        await act(async () =>
            container.querySelector<HTMLButtonElement>('[aria-label^="商品排序方向"]')!.click(),
        );
        expect(requests.filter(request => request.name === 'GetProducts').at(-1)?.variables).toMatchObject({
            options: { sort: { name: 'ASC' } },
        });
    });
});

describe('CatalogModule filtered empty results', () => {
    it('paginates assignment exceptions using the filtered server total', async () => {
        const requests: Array<{ name: string; variables: Record<string, unknown> }> = [];
        const container = await renderCatalog({
            initialEntry: '/?channel=UNASSIGNED',
            productTotal: 201,
            assignmentTotal: 0,
            requests,
        });

        expect(container.textContent).toContain('共 0 件商品，当前第 1 / 1 页');
        expect(
            Array.from(container.querySelectorAll('button')).find(button =>
                button.textContent?.includes('下一页'),
            )?.disabled,
        ).toBe(true);
        expect(
            requests.find(request => request.name === 'GetCatalogChannelAssignments')?.variables,
        ).toMatchObject({ assignmentFilter: { mode: 'UNASSIGNED' }, options: { skip: 0, take: 20 } });
    });

    it('loads exception rows by the server-selected product ids', async () => {
        const requests: Array<{ name: string; variables: Record<string, unknown> }> = [];
        const container = await renderCatalog({
            initialEntry: '/?channel=MULTI_STORE',
            productTotal: 201,
            assignmentTotal: 1,
            requests,
        });

        expect(container.textContent).toContain('共 1 件商品，当前第 1 / 1 页');
        expect(container.textContent).toContain('白利群2');
        expect(
            requests.find(request => request.name === 'GetCatalogChannelAssignments')?.variables,
        ).toMatchObject({ assignmentFilter: { mode: 'MULTI' } });
        expect(requests.find(request => request.name === 'GetProducts')?.variables).toMatchObject({
            options: { skip: 0, filter: { id: { in: ['product-1'] } } },
        });
    });

    it('clears a category URL from another store after loading the current store categories', async () => {
        const container = await renderCatalog({ initialEntry: '/?category=other-store' });

        expect(container.querySelector<HTMLSelectElement>('[aria-label="按商品分类筛选"]')?.value).toBe('');
        expect(container.textContent).toContain('白利群2');
        expect(container.textContent).not.toContain('重置筛选');
    });

    it('describes operating-store scope without global statistics', async () => {
        const container = await renderCatalog();

        expect(container.textContent).toContain('当前数据范围：meiyijia');
        expect(container.textContent).toContain('仅显示分配到当前店铺的商品、库存和价格');
        expect(container.textContent).not.toContain('总目录');
        expect(container.textContent).not.toContain('汇总全部商品');
    });

    it.each(['/?status=disabled', '/?status=enabled', '/?category=tobacco'])(
        'does not describe the whole store as empty for %s',
        async initialEntry => {
            const container = await renderCatalog({ empty: true, initialEntry });

            expect(container.textContent).toContain('当前筛选条件下暂无商品');
            expect(container.textContent).not.toContain('当前暂无商品。');
        },
    );
});
