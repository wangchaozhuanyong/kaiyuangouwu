// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DisableDialog } from './CardPoolModule';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.mutate, { loading: false }] }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('card disable dialog feedback', () => {
    it.each(['', 'SIM-DISABLE-0914'])('keeps rejection visible inside the modal (%s)', async reason => {
        mocks.mutate.mockReset().mockRejectedValue(new Error('SIM backend rejection'));
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const onCompleted = vi.fn();
        try {
            await act(async () =>
                root.render(
                    <DisableDialog
                        item={{ id: '3', sequence: 3 } as never}
                        onClose={vi.fn()}
                        onCompleted={onCompleted}
                        onError={vi.fn()}
                    />,
                ),
            );
            if (reason) {
                const field = host.querySelector('textarea')!;
                await act(async () => {
                    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
                        field,
                        reason,
                    );
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                });
            }
            await act(async () =>
                [...host.querySelectorAll('button')]
                    .find(button => button.textContent === '确认停用')!
                    .click(),
            );
            const alert = host.querySelector('[role="dialog"] [role="alert"]');
            expect(alert?.textContent).toContain(
                reason ? '管理服务没有返回可识别的失败原因' : '请填写停用原因',
            );
            expect(onCompleted).not.toHaveBeenCalled();
            if (reason)
                expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({
                    variables: { id: '3', enabled: false, reason },
                });
            else expect(mocks.mutate).not.toHaveBeenCalled();
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
});
