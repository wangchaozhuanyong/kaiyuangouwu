// @vitest-environment jsdom

import { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useAccessibleDialog } from './use-accessible-dialog';

describe('dialog input method handling', () => {
    it('cycles visible controls in both directions and keeps a radio group as one tab stop', async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const rects = vi
            .spyOn(HTMLElement.prototype, 'getClientRects')
            .mockReturnValue([{}] as unknown as DOMRectList);
        function Dialog() {
            const { dialogRef } = useAccessibleDialog(vi.fn());
            return (
                <section ref={dialogRef} role="dialog" tabIndex={-1}>
                    <button>First</button>
                    <button hidden>Hidden</button>
                    <button tabIndex={-1}>Not sequential</button>
                    <fieldset disabled>
                        <input aria-label="Disabled fieldset" />
                    </fieldset>
                    <input type="radio" name="mode" value="one" />
                    <input type="radio" name="mode" value="two" defaultChecked />
                    <details>
                        <summary>Details</summary>
                    </details>
                    <iframe title="Preview" />
                    <input aria-label="Last" />
                </section>
            );
        }
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        const tab = (shiftKey = false) => {
            const event = new KeyboardEvent('keydown', {
                key: 'Tab',
                shiftKey,
                bubbles: true,
                cancelable: true,
            });
            document.activeElement!.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
        };
        try {
            await act(async () => root.render(<Dialog />));
            tab();
            expect(document.activeElement).toBe(container.querySelector('button'));
            tab();
            expect(document.activeElement).toBe(container.querySelector('input[value="two"]'));
            tab();
            expect(document.activeElement).toBe(container.querySelector('summary'));
            tab();
            expect(document.activeElement).toBe(container.querySelector('iframe'));
            tab();
            expect(document.activeElement).toBe(container.querySelector('input[aria-label="Last"]'));
            tab();
            expect(document.activeElement).toBe(container.querySelector('button'));
            tab(true);
            expect(document.activeElement).toBe(container.querySelector('input[aria-label="Last"]'));
            const browserTab = new KeyboardEvent('keydown', {
                key: 'Tab',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            });
            document.activeElement!.dispatchEvent(browserTab);
            expect(browserTab.defaultPrevented).toBe(false);
        } finally {
            await act(async () => root.unmount());
            container.remove();
            rects.mockRestore();
        }
    });

    it('includes a non-modal help portal without releasing the parent modal focus boundary', async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const rects = vi
            .spyOn(HTMLElement.prototype, 'getClientRects')
            .mockReturnValue([{}] as unknown as DOMRectList);
        const closeModal = vi.fn();
        const closeHelp = vi.fn();
        function Help() {
            const { dialogRef } = useAccessibleDialog(closeHelp, true, { modal: false, autoFocus: false });
            return createPortal(
                <section ref={dialogRef} role="dialog" data-help>
                    <button>Help action</button>
                </section>,
                document.body,
            );
        }
        function Dialog({ help }: { help: boolean }) {
            const { dialogRef } = useAccessibleDialog(closeModal);
            return (
                <>
                    <section ref={dialogRef} role="dialog" tabIndex={-1} data-parent>
                        <button>Modal action</button>
                    </section>
                    {help && <Help />}
                </>
            );
        }
        const container = document.createElement('div');
        const outside = document.createElement('button');
        document.body.append(container, outside);
        const root = createRoot(container);
        try {
            outside.focus();
            await act(async () => root.render(<Dialog help={false} />));
            await act(async () => root.render(<Dialog help />));
            const first = container.querySelector('button')!;
            const help = document.querySelector<HTMLButtonElement>('[data-help] button')!;
            help.focus();
            expect(document.activeElement).toBe(help);
            help.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
            expect(document.activeElement).toBe(first);
            first.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
            );
            expect(document.activeElement).toBe(help);
            outside.focus();
            expect(document.activeElement).toBe(container.querySelector('[data-parent]'));
            help.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(closeHelp).toHaveBeenCalledOnce();
            expect(closeModal).not.toHaveBeenCalled();
            await act(async () => root.render(null));
            expect(document.activeElement).toBe(outside);
        } finally {
            await act(async () => root.unmount());
            container.remove();
            outside.remove();
            rects.mockRestore();
        }
    });

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
