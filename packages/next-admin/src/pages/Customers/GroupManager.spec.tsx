// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { GroupManager } from './CustomersModule';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.mutate, { loading: false }] }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('customer group deletion form isolation', () => {
    it('removes unrelated text fields during password confirmation and restores the draft on cancel', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const onClose = vi.fn();
        try {
            await act(async () =>
                root.render(
                    <GroupManager
                        open
                        groups={[{ id: 'sim', name: '模拟组', customers: { totalItems: 1 } }] as never}
                        onClose={onClose}
                        onChanged={vi.fn()}
                        onError={vi.fn()}
                    />,
                ),
            );
            const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
            expect(dialog).not.toBeNull();
            expect(host.contains(dialog)).toBe(false);
            const input = dialog.querySelector<HTMLInputElement>('[aria-label="新分组名称"]')!;
            await act(async () => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                    input,
                    '模拟草稿',
                );
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await act(async () =>
                dialog.querySelector<HTMLButtonElement>('[aria-label="删除分组"]')!.click(),
            );
            expect(dialog.querySelector('[aria-label="新分组名称"]')).toBeNull();
            expect(dialog.querySelectorAll('input')).toHaveLength(1);
            expect(dialog.querySelector('input')?.type).toBe('password');
            expect(dialog.querySelector<HTMLButtonElement>('[aria-label="重命名分组"]')?.disabled).toBe(true);
            await act(async () =>
                [...dialog.querySelectorAll('button')].find(button => button.textContent === '取消')!.click(),
            );
            expect(dialog.querySelector<HTMLInputElement>('[aria-label="新分组名称"]')?.value).toBe(
                '模拟草稿',
            );
            expect(mocks.mutate).not.toHaveBeenCalled();
            await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());
            expect(onClose).toHaveBeenCalledTimes(1);
            await act(async () =>
                root.render(
                    <GroupManager
                        open={false}
                        groups={[]}
                        onClose={onClose}
                        onChanged={vi.fn()}
                        onError={vi.fn()}
                    />,
                ),
            );
            expect(document.body.querySelector('[role="dialog"]')).toBeNull();
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
});

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
