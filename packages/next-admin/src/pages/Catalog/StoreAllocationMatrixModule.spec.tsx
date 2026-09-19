// @vitest-environment jsdom

import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { StoreAllocationMatrixModule } from './StoreAllocationMatrixModule';

const cleanups: Array<() => void> = [];

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function renderAllocationMatrix() {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    const channels = [
        { id: 'channel-default', code: '__default_channel__', isDefault: true },
        { id: 'channel-branch-1', code: 'meiyijia', isDefault: false },
        { id: 'channel-branch-2', code: 'direct-store', isDefault: false },
    ];

    const items = [
        {
            id: 'product-1',
            name: '白利群2',
            enabled: true,
            channels: [{ id: 'channel-default', code: '__default_channel__', isDefault: true }],
        },
        {
            id: 'product-2',
            name: '红双喜',
            enabled: true,
            channels: [
                { id: 'channel-default', code: '__default_channel__', isDefault: true },
                { id: 'channel-branch-1', code: 'meiyijia', isDefault: false },
            ],
        },
    ];

    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    if (operation.operationName === 'GetCatalogChannelAssignments') {
                        observer.next({
                            data: {
                                catalogProductChannelAssignments: {
                                    totalItems: 150,
                                    channels,
                                    scopeChannel: channels[0],
                                    summary: {
                                        totalItems: 150,
                                        unassignedItems: 40,
                                        multiChannelItems: 110,
                                        channelCounts: [
                                            { channelId: 'channel-default', count: 150 },
                                            { channelId: 'channel-branch-1', count: 90 },
                                            { channelId: 'channel-branch-2', count: 20 },
                                        ],
                                    },
                                    items,
                                },
                            },
                        });
                    } else if (operation.operationName === 'AssignCatalogProductsToChannel') {
                        observer.next({
                            data: {
                                assignProductsToChannel: [{ id: 'product-1' }],
                            },
                        });
                    } else if (operation.operationName === 'RemoveCatalogProductsFromChannel') {
                        observer.next({
                            data: {
                                removeProductsFromChannel: [{ id: 'product-2' }],
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
                <MemoryRouter initialEntries={['/catalog/allocation']}>
                    <FeatureHelpProvider>
                        <StoreAllocationMatrixModule />
                    </FeatureHelpProvider>
                </MemoryRouter>
            </ApolloProvider>,
        );
    });

    return container;
}

describe('StoreAllocationMatrixModule', () => {
    it('renders header, title and metric cards properly', async () => {
        const container = await renderAllocationMatrix();

        expect(container.textContent).toContain('商品多店铺分配中心');
        expect(container.textContent).toContain('当前渠道可见商品');
        expect(container.textContent).toContain('150');
        expect(container.textContent).toContain('当前第 1 / 3 页');
        expect(container.textContent).toContain('仅默认店铺 (未分发)');
        expect(container.textContent).toContain('默认店铺');
        expect(container.textContent).toContain('meiyijia');
        expect(container.textContent).toContain('direct-store');
    });

    it('renders allocation matrix table with status cells per store', async () => {
        const container = await renderAllocationMatrix();

        const table = container.querySelector('table');
        expect(table).not.toBeNull();

        // Check headers
        expect(container.textContent).toContain('商品信息');
        expect(container.textContent).toContain('商品状态');

        // Check products rendered
        expect(container.textContent).toContain('白利群2');
        expect(container.textContent).toContain('红双喜');

        // Check channel indicators
        expect(container.textContent).toContain('未分发到分店');
        expect(container.textContent).toContain('已上架 2 个店铺');

        // Check toggle buttons
        expect(container.textContent).toContain('已在售');
        expect(container.textContent).toContain('未上架');
    });

    it('displays warning when attempting to remove a product from its only store', async () => {
        const container = await renderAllocationMatrix();

        // Find the "已在售" button for product-1 on default channel
        // product-1 only belongs to default channel
        const firstRow = container.querySelector('tbody tr:first-child');
        expect(firstRow).not.toBeNull();

        const activeButtons = Array.from(firstRow!.querySelectorAll('button')).filter(btn =>
            btn.textContent?.includes('已在售'),
        );
        expect(activeButtons.length).toBe(1);

        await act(async () => {
            activeButtons[0].click();
        });

        // Should display the warning notice
        expect(container.textContent).toContain('无法移除唯一归属店铺');
    });

    it('supports selecting products and reveals floating bulk bar', async () => {
        const container = await renderAllocationMatrix();

        const selectAllCheckbox = container.querySelector<HTMLInputElement>(
            'thead th input[type="checkbox"]',
        );
        expect(selectAllCheckbox).not.toBeNull();

        await act(async () => {
            selectAllCheckbox!.click();
        });

        expect(container.textContent).toContain('已勾选 2 个商品');
        expect(container.textContent).toContain('批量上架到店铺');
        expect(container.textContent).toContain('从店铺下架');
    });
});
