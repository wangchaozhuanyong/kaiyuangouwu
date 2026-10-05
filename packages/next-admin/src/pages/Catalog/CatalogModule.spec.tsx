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

async function renderCatalog({
    empty = false,
    initialEntry = '/',
    channelCode = 'meiyijia',
    digital = false,
    stockAllocated = 0,
    stockUnavailable = false,
    productTotal = 1,
    assignmentTotal = 1,
    requests,
}: {
    empty?: boolean;
    initialEntry?: string;
    channelCode?: string;
    digital?: boolean;
    stockAllocated?: number;
    stockUnavailable?: boolean;
    productTotal?: number;
    assignmentTotal?: number;
    requests?: Array<{ name: string; variables: Record<string, unknown> }>;
} = {}) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
                    requests?.push({ name: operation.operationName ?? '', variables: operation.variables });
                    if (operation.operationName === 'StoreCatalogStatus') {
                        observer.next({
                            data: {
                                myStoreCatalogStatus: {
                                    authorized: empty ? 0 : 1,
                                    listed: empty ? 0 : 1,
                                    paused: 0,
                                    pending: 0,
                                    outOfStock: stockAllocated >= 105 ? 1 : 0,
                                    items: empty
                                        ? []
                                        : [
                                              {
                                                  productId: 'product-1',
                                                  listed: true,
                                                  pending: false,
                                                  paused: false,
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
                                            variants: [
                                                {
                                                    id: 'variant-1',
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
                                                    autoCardAvailableStock: null,
                                                    customFields: {
                                                        fulfillmentType: digital ? 'digital' : 'physical',
                                                        pricingMode: 'FIXED',
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
                                    code: channelCode,
                                    token: 'meiyijia',
                                    defaultCurrencyCode: 'MYR',
                                    customFields: {
                                        storefrontNameZh:
                                            channelCode === '__default_channel__' ? '' : channelCode,
                                        storefrontNameEn:
                                            channelCode === '__default_channel__' ? '' : channelCode,
                                    },
                                },
                                channels: {
                                    totalItems: 1,
                                    items: [
                                        {
                                            id: 'channel-1',
                                            code: channelCode,
                                            token: 'meiyijia',
                                            defaultCurrencyCode: 'MYR',
                                            customFields: {
                                                storefrontNameZh:
                                                    channelCode === '__default_channel__' ? '' : channelCode,
                                                storefrontNameEn:
                                                    channelCode === '__default_channel__' ? '' : channelCode,
                                            },
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
                    } else if (operation.operationName === 'GetCatalogChannelAssignments') {
                        const channel = {
                            id: 'channel-1',
                            code: channelCode,
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
                <MemoryRouter initialEntries={[initialEntry]}>
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
