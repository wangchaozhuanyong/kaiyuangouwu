// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineNextAdminExtension, resetNextAdminExtensionsForTests } from './extension-api';
import { NextAdminActions } from './extension-hosts';

const cleanups: Array<() => void> = [];
beforeEach(() => {
    resetNextAdminExtensionsForTests();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    resetNextAdminExtensionsForTests();
});

async function renderActions() {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<NextAdminActions pageId="product-list" collapseOnMobile />));
    cleanups.push(() => {
        root.unmount();
        container.remove();
    });
    return container;
}

describe('collapsible extension actions', () => {
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
