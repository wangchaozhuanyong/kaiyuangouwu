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
        try {
            await act(async () =>
                root.render(
                    <GroupManager
                        open
                        groups={[{ id: 'sim', name: '模拟组', customers: { totalItems: 1 } }] as never}
                        onClose={vi.fn()}
                        onChanged={vi.fn()}
                        onError={vi.fn()}
                    />,
                ),
            );
            const input = host.querySelector<HTMLInputElement>('[aria-label="新分组名称"]')!;
            await act(async () => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                    input,
                    '模拟草稿',
                );
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="删除分组"]')!.click());
            expect(host.querySelector('[aria-label="新分组名称"]')).toBeNull();
            expect(host.querySelectorAll('input')).toHaveLength(1);
            expect(host.querySelector('input')?.type).toBe('password');
            expect(host.querySelector<HTMLButtonElement>('[aria-label="重命名分组"]')?.disabled).toBe(true);
            await act(async () =>
                [...host.querySelectorAll('button')].find(button => button.textContent === '取消')!.click(),
            );
            expect(host.querySelector<HTMLInputElement>('[aria-label="新分组名称"]')?.value).toBe('模拟草稿');
            expect(mocks.mutate).not.toHaveBeenCalled();
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
});
