// @vitest-environment jsdom

import { act, lazy, useState, type ComponentProps, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCapabilitySnapshot } from '../../../common/src/admin-capabilities';
import { AdminCapabilitiesContext } from '../hooks/use-admin-capabilities';
import { AdminPermissionsContext } from '../hooks/use-admin-permissions';
import { hasAnyAdminPermission } from '../utils/admin-permissions';
import {
    defineNextAdminExtension as registerExtension,
    resetNextAdminExtensionsForTests,
    type NextAdminExtension,
    type NextAdminPageBlockContext,
} from './extension-api';
import { NextAdminActions, NextAdminPageBlocks } from './extension-hosts';

const cleanups: Array<() => void> = [];
const capabilitySnapshot: AdminCapabilitySnapshot = {
    channelId: 'a',
    channelCode: 'a',
    scope: 'STORE',
    commerceMode: 'HYBRID',
    capabilities: [
        { id: '/catalog/products', state: 'READY', canRead: true, canWrite: true, canConfigure: true },
    ],
};
function defineNextAdminExtension(extension: NextAdminExtension) {
    return registerExtension({
        ...extension,
        actions: extension.actions?.map(item => ({ ...item, capabilityId: '/catalog/products' })),
        pageBlocks: extension.pageBlocks?.map(item => ({ ...item, capabilityId: '/catalog/products' })),
    });
}
beforeEach(() => {
    resetNextAdminExtensionsForTests();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    resetNextAdminExtensionsForTests();
});

async function renderActions(snapshot = capabilitySnapshot) {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
        root.render(
            <AdminCapabilitiesContext.Provider value={snapshot}>
                <NextAdminActions pageId="product-list" collapseOnMobile />
            </AdminCapabilitiesContext.Provider>,
        ),
    );
    cleanups.push(() => {
        root.unmount();
        container.remove();
    });
    return container;
}

async function renderBlocks(props: ComponentProps<typeof NextAdminPageBlocks>, permissions: string[] = []) {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
        root.render(
            <AdminPermissionsContext.Provider
                value={{
                    permissions,
                    hasAnyPermission: required => hasAnyAdminPermission(permissions, required),
                }}
            >
                <AdminCapabilitiesContext.Provider value={capabilitySnapshot}>
                    <NextAdminPageBlocks {...props} />
                </AdminCapabilitiesContext.Provider>
            </AdminPermissionsContext.Provider>,
        ),
    );
    cleanups.push(() => {
        root.unmount();
        container.remove();
    });
    return container;
}

describe('page block placement filters', () => {
    it('does not mount an extension with no supported capability', async () => {
        const block = vi.fn(() => <div>未授权扩展</div>);
        registerExtension({
            id: 'unknown-capability',
            pageBlocks: [{ id: 'unknown', pageId: 'product-detail', component: block }],
        });
        const container = await renderBlocks({ pageId: 'product-detail' }, ['SuperAdmin']);
        expect(block).not.toHaveBeenCalled();
        expect(container.textContent).not.toContain('未授权扩展');
    });
    it('renders only included blocks from the current page and passes the product context', async () => {
        const unrelatedBlock = vi.fn(() => <div>供货资料</div>);
        const otherPageBlock = vi.fn(() => <div>其他页面价格</div>);
        defineNextAdminExtension({
            id: 'product-sections',
            pageBlocks: [
                {
                    id: 'currency-prices',
                    pageId: 'product-detail',
                    component: ({ context }: { context: NextAdminPageBlockContext }) => (
                        <div>{`${context.pageId}：${context.entity?.id} 的币种价格`}</div>
                    ),
                },
                { id: 'supply', pageId: 'product-detail', component: unrelatedBlock },
                { id: 'other-prices', pageId: 'order-detail', component: otherPageBlock },
            ],
        });

        const container = await renderBlocks({
            pageId: 'product-detail',
            entity: { id: 'product-6259' },
            includeIds: ['currency-prices', 'other-prices'],
        });

        expect(container.textContent).toBe('product-detail：product-6259 的币种价格');
        expect(unrelatedBlock).not.toHaveBeenCalled();
        expect(otherPageBlock).not.toHaveBeenCalled();
        expect(container.querySelector('[data-extension-location="product-detail:blocks"]')).not.toBeNull();
    });

    it('requires the original permissions even when a block is explicitly included', async () => {
        const restrictedBlock = vi.fn(() => <div>库存管理</div>);
        defineNextAdminExtension({
            id: 'restricted-section',
            pageBlocks: [
                {
                    id: 'inventory',
                    pageId: 'product-detail',
                    permissions: ['ReadStockLocation'],
                    component: restrictedBlock,
                },
            ],
        });
        const props = {
            pageId: 'product-detail',
            includeIds: ['inventory'],
            fallback: <div>当前无可用区块</div>,
        };

        const denied = await renderBlocks(props, ['ReadProduct']);
        expect(denied.textContent).toBe('当前无可用区块');
        expect(denied.querySelector('[data-extension-location]')).toBeNull();
        expect(restrictedBlock).not.toHaveBeenCalled();

        const allowed = await renderBlocks(props, ['ReadProduct', 'ReadStockLocation']);
        expect(allowed.textContent).toBe('库存管理');
        expect(restrictedBlock).toHaveBeenCalledOnce();
    });

    it('keeps conditional rendering and exclusions authoritative for included blocks', async () => {
        const entity = { id: 'product-6259', fulfillmentType: 'digital' };
        const physicalOnly = vi.fn(
            (context: NextAdminPageBlockContext) => context.entity?.fulfillmentType === 'physical',
        );
        const hiddenBlock = vi.fn(() => <div>实物包装</div>);
        const excludedBlock = vi.fn(() => <div>已在其他位置展示</div>);
        defineNextAdminExtension({
            id: 'conditional-sections',
            pageBlocks: [
                {
                    id: 'packaging',
                    pageId: 'product-detail',
                    shouldRender: physicalOnly,
                    component: hiddenBlock,
                },
                { id: 'supply', pageId: 'product-detail', component: excludedBlock },
            ],
        });

        const container = await renderBlocks({
            pageId: 'product-detail',
            entity,
            includeIds: ['packaging', 'supply'],
            excludeIds: ['supply'],
            fallback: <div>没有适用区块</div>,
        });

        expect(physicalOnly).toHaveBeenCalledWith({ pageId: 'product-detail', entity });
        expect(hiddenBlock).not.toHaveBeenCalled();
        expect(excludedBlock).not.toHaveBeenCalled();
        expect(container.textContent).toBe('没有适用区块');
    });

    it('preserves default placement while an explicit empty inclusion list renders no blocks', async () => {
        defineNextAdminExtension({
            id: 'default-sections',
            pageBlocks: [
                { id: 'prices', pageId: 'product-detail', component: () => <div>币种价格</div> },
                { id: 'supply', pageId: 'product-detail', component: () => <div>供货资料</div> },
            ],
        });

        const original = await renderBlocks({ pageId: 'product-detail', excludeIds: ['supply'] });
        expect(original.textContent).toBe('币种价格');

        const empty = await renderBlocks({
            pageId: 'product-detail',
            includeIds: [],
            fallback: <div>未选择扩展区块</div>,
        });
        expect(empty.textContent).toBe('未选择扩展区块');
        expect(empty.querySelector('[data-extension-location]')).toBeNull();
    });
});

describe('collapsible extension actions', () => {
    it('keeps an explicit read action while refusing mutation actions on a read-only capability', async () => {
        const mutation = vi.fn(() => <button>修改商品</button>);
        const read = vi.fn(() => <button>导出商品</button>);
        defineNextAdminExtension({
            id: 'read-only-actions',
            actions: [
                { id: 'mutate', label: '修改', pageId: 'product-list', component: mutation },
                {
                    id: 'read',
                    label: '导出',
                    pageId: 'product-list',
                    component: read,
                    capabilityOperation: 'read',
                },
            ],
        });
        const container = await renderActions({
            ...capabilitySnapshot,
            capabilities: capabilitySnapshot.capabilities.map(item => ({
                ...item,
                canWrite: false,
                canConfigure: false,
            })),
        });
        expect(mutation).not.toHaveBeenCalled();
        expect(read).toHaveBeenCalled();
        expect(container.textContent).toContain('导出商品');
        expect(container.textContent).not.toContain('修改商品');
    });

    it('loads a lazy action in its own placeholder while preserving a sibling draft', async () => {
        let finishLoading!: (module: { default: ComponentType }) => void;
        const LazyAction = lazy(
            () =>
                new Promise<{ default: ComponentType }>(resolve => {
                    finishLoading = resolve;
                }),
        );
        function SiblingAction() {
            const [count, setCount] = useState(0);
            return <button onClick={() => setCount(value => value + 1)}>相邻草稿 {count}</button>;
        }
        defineNextAdminExtension({
            id: 'lazy-action',
            actions: [
                { id: 'lazy', label: '懒加载操作', pageId: 'product-list', component: LazyAction },
                { id: 'sibling', label: '相邻草稿', pageId: 'product-list', component: SiblingAction },
            ],
        });
        const container = await renderActions();
        expect(container.querySelector('[data-admin-extension-loading]')).not.toBeNull();
        const sibling = Array.from(container.querySelectorAll('button')).find(button =>
            button.textContent?.startsWith('相邻草稿'),
        )!;
        await act(async () => sibling.click());
        await act(async () => finishLoading({ default: () => <button>懒加载操作已就绪</button> }));
        expect(container.querySelector('[data-admin-extension-loading]')).toBeNull();
        expect(container.textContent).toContain('懒加载操作已就绪');
        expect(container.textContent).toContain('相邻草稿 1');
        expect(sibling.isConnected).toBe(true);
    });

    it('retries a failed extension without resetting a sibling action draft', async () => {
        let unavailable = true;
        function RecoverableAction() {
            if (unavailable) throw new Error('test extension unavailable');
            return <button>已恢复扩展</button>;
        }
        function SiblingAction() {
            const [count, setCount] = useState(0);
            return <button onClick={() => setCount(value => value + 1)}>相邻草稿 {count}</button>;
        }
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            defineNextAdminExtension({
                id: 'recoverable',
                actions: [
                    { id: 'failed', label: '恢复扩展', pageId: 'product-list', component: RecoverableAction },
                    { id: 'sibling', label: '相邻草稿', pageId: 'product-list', component: SiblingAction },
                ],
            });
            const container = await renderActions();
            const sibling = Array.from(container.querySelectorAll('button')).find(button =>
                button.textContent?.startsWith('相邻草稿'),
            )!;
            await act(async () => sibling.click());
            const retry = Array.from(container.querySelectorAll('button')).find(
                button => button.textContent === '重试扩展',
            )!;
            expect(container.querySelector('[data-admin-extension-error]')).not.toBeNull();
            unavailable = false;
            await act(async () => retry.click());
            expect(container.querySelector('[data-admin-extension-error]')).toBeNull();
            expect(container.textContent).toContain('已恢复扩展');
            expect(sibling.textContent).toBe('相邻草稿 1');
        } finally {
            errors.mockRestore();
        }
    });

    it('preserves one action instance and its draft state across collapse cycles', async () => {
        let mounts = 0;
        function Action() {
            const [count, setCount] = useState(() => {
                mounts++;
                return 0;
            });
            return <button onClick={() => setCount(value => value + 1)}>草稿 {count}</button>;
        }
        defineNextAdminExtension({
            id: 'draft',
            actions: [{ id: 'draft', label: '草稿', pageId: 'product-list', component: Action }],
        });
        const container = await renderActions();
        const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls]')!;
        const action = container.querySelector<HTMLButtonElement>('button:not([aria-controls])')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        await act(async () => toggle.click());
        await act(async () => action.click());
        await act(async () => toggle.click());
        await act(async () => toggle.click());
        expect(container.querySelectorAll('button:not([aria-controls])')).toHaveLength(1);
        expect(action.textContent).toBe('草稿 1');
        expect(mounts).toBe(1);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.contains(action)).toBe(true);
    });

    it('does not expose an empty toolbar or actions outside the current permissions', async () => {
        defineNextAdminExtension({
            id: 'restricted',
            actions: [
                {
                    id: 'restricted',
                    label: '受限操作',
                    pageId: 'product-list',
                    permissions: ['SuperAdmin'],
                    component: () => <button>受限操作</button>,
                },
            ],
        });
        const container = await renderActions();
        expect(container.textContent).toBe('');
        expect(container.querySelector('button')).toBeNull();
    });
});
