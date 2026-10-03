// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { StoreAllocationMatrixModule } from './StoreAllocationMatrixModule';

const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});
async function renderPlatform() {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const operations: Array<{ name: string; variables: any }> = [];
    const channels = [
        { id: 'a', displayName: '来源店', currencyCode: 'USD', assignedCount: 51, coverageDenominator: 51 },
        { id: 'b', displayName: '销售店', currencyCode: 'USD', assignedCount: 1, coverageDenominator: 51 },
    ];
    let receipt: any;
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    operations.push({ name: operation.operationName ?? '', variables: operation.variables });
                    let data: any;
                    if (operation.operationName === 'PlatformCatalog')
                        data = {
                            platformCatalogProducts: {
                                totalItems: 51,
                                channels,
                                ownershipReviewCount: 0,
                                unassignedCount: 0,
                                categories: [
                                    { id: 'category-a', name: '整类来源', parentId: null, channelIds: ['a'] },
                                ],
                                items: [
                                    {
                                        id: operation.variables.skip ? 'p51' : 'p1',
                                        name: operation.variables.skip ? '第二页商品' : '首个商品',
                                        enabled: true,
                                        ownerChannelId: 'a',
                                        channelIds: ['a'],
                                        variants: [
                                            {
                                                id: operation.variables.skip ? 'v51' : 'v1',
                                                name: operation.variables.skip ? '第二页规格' : '首个规格',
                                            },
                                        ],
                                    },
                                ],
                            },
                        };
                    else if (operation.operationName === 'PlatformResources')
                        data = { platformCatalogResources: [] };
                    else if (operation.operationName === 'DistributionPreview') {
                        receipt = {
                            id: 'batch-1',
                            state: 'PREVIEW',
                            items: [
                                {
                                    productId: 'p1',
                                    channelId: 'b',
                                    name: '首个商品',
                                    alreadyAssigned: false,
                                    missingPriceCount: 0,
                                    targetCurrencyCode: 'USD',
                                    plannedPrices: [{ variantId: 'v1', price: 1200 }],
                                },
                            ],
                            results: [],
                        };
                        data = { previewPlatformCatalogDistribution: receipt };
                    } else if (operation.operationName === 'DistributionExecute')
                        data = {
                            executePlatformCatalogDistribution: {
                                ...receipt,
                                state: 'COMPLETE',
                                results: [{ index: 0, success: true, readback: { state: 'ACTIVE' } }],
                            },
                        };
                    else {
                        observer.error(new Error(`Unexpected operation ${operation.operationName}`));
                        return;
                    }
                    observer.next({ data });
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
    await act(async () =>
        root.render(
            <ApolloProvider client={client}>
                <FeatureHelpProvider>
                    <StoreAllocationMatrixModule />
                </FeatureHelpProvider>
            </ApolloProvider>,
        ),
    );
    const click = async (text: string) => {
        const button = [...container.querySelectorAll('button')].find(b => b.textContent === text);
        expect(button).toBeTruthy();
        await act(async () => button!.click());
    };
    const check = async (label: string) => {
        const input = container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
        expect(input).toBeTruthy();
        await act(async () => input.click());
    };
    const target = async () => {
        const label = [...container.querySelectorAll('label')].find(l =>
            l.textContent?.includes('销售店 · USD'),
        );
        await act(async () => (label!.querySelector('input') as HTMLInputElement).click());
    };
    return { container, operations, click, check, target };
}
describe('platform distribution workflow', () => {
    it('uses operating-store denominators and preserves product/spec selections across pages', async () => {
        const { container, operations, click, check, target } = await renderPlatform();
        expect(container.textContent).toContain('平台商品分配中心');
        expect(container.textContent).toContain('51 / 51');
        expect(container.textContent).not.toContain('多店共享异常');
        await check('选择 首个商品');
        await click('下一页');
        await check('选择 第二页商品');
        await target();
        await click('生成预览');
        expect(operations.find(o => o.name === 'DistributionPreview')?.variables.input).toMatchObject({
            productIds: ['p1', 'p51'],
            variantIds: ['v1', 'v51'],
            targets: [{ channelId: 'b' }],
        });
        expect(container.textContent).toContain('确认执行此预览');
        await click('确认执行此预览');
        expect(operations.find(o => o.name === 'DistributionExecute')?.variables).toEqual({
            batchId: 'batch-1',
        });
        expect(container.textContent).toContain('已回读：启用');
        expect(container.textContent).toContain('交付配置仍需在目标店铺确认');
        expect(operations.filter(o => o.name === 'PlatformCatalog').length).toBeGreaterThan(2);
    });
    it('submits a category and descendants independently of the visible page', async () => {
        const { container, operations, click, target } = await renderPlatform();
        const select = container.querySelector('select[aria-label="来源分类"]') as HTMLSelectElement;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
                select,
                'category-a',
            );
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await click('下一页');
        await target();
        await click('生成预览');
        expect(operations.find(o => o.name === 'DistributionPreview')?.variables.input).toMatchObject({
            collectionId: 'category-a',
            includeDescendants: true,
            productIds: [],
            variantIds: [],
        });
    });
});
