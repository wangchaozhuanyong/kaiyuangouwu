// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useAccessibleDialog } from './use-accessible-dialog';

describe('dialog input method handling', () => {
    it('leaves IME cancellation to the input method, then allows a normal Escape to close', async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const onClose = vi.fn();
        function Dialog() {
            const { dialogRef } = useAccessibleDialog(onClose);
            return (
                <section ref={dialogRef} tabIndex={-1}>
                    <input />
                </section>
            );
        }
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        try {
            await act(async () => root.render(<Dialog />));
            const input = container.querySelector('input')!;
            input.focus();
            for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
                const event = new KeyboardEvent('keydown', {
                    key: 'Escape',
                    bubbles: true,
                    cancelable: true,
                    ...options,
                });
                input.dispatchEvent(event);
                expect(onClose).not.toHaveBeenCalled();
                expect(event.defaultPrevented).toBe(false);
                expect(document.activeElement).toBe(input);
            }
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(onClose).toHaveBeenCalledTimes(1);
        } finally {
            await act(async () => root.unmount());
            container.remove();
        }
    });
});
