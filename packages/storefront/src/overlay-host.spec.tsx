// @vitest-environment jsdom
import { act, ReactNode, StrictMode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogSheet } from './components/common/dialog-sheet';
import { Overlay, OverlayHost } from './overlay-host';
import { Sheet } from './storefront-ui/page-shell';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('shared storefront overlay lifecycle', () => {
    let host: HTMLDivElement;
    let root: Root;
    let trigger: HTMLButtonElement;

    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(performance.now()), 0),
        );
        vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
        host = document.createElement('div');
        trigger = document.createElement('button');
        trigger.textContent = 'Open';
        host.append(trigger);
        document.body.append(host);
        trigger.focus();
        root = createRoot(document.createElement('div'));
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.unstubAllGlobals();
    });

    async function render(children: ReactNode, ownerKey = 'store:CNY:zh:category') {
        await act(async () => {
            root.render(<OverlayHost ownerKey={ownerKey}>{children}</OverlayHost>);
            await new Promise(resolve => setTimeout(resolve, 5));
        });
        await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    }

    function key(value: string, shiftKey = false) {
        act(() => {
            document.activeElement?.dispatchEvent(
                new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }),
            );
        });
    }

    it('uses stack order for dialog and alertdialog, traps focus and restores the visible trigger', async () => {
        const outerClose = vi.fn();
        const innerClose = vi.fn();
        const outer = (
            <Sheet title="Outer" language="en" onClose={outerClose}>
                <button id="open-inner">Open inner</button>
            </Sheet>
        );
        await render(
            <>
                {outer}
                {null}
            </>,
        );
        const innerTrigger = document.getElementById('open-inner');
        if (!innerTrigger) throw new Error('Missing inner dialog trigger');
        innerTrigger.focus();
        await render(
            <>
                {outer}
                <Overlay onClose={innerClose}>
                    <section role="alertdialog" aria-modal="true" aria-label="Confirm">
                        <button id="first">Cancel</button>
                        <button style={{ display: 'none' }}>Hidden</button>
                        <button id="last">Confirm</button>
                    </section>
                </Overlay>
            </>,
        );
        expect(document.activeElement?.id).toBe('first');
        expect(host.hasAttribute('inert')).toBe(true);
        key('Tab', true);
        expect(document.activeElement?.id).toBe('last');
        key('Tab');
        expect(document.activeElement?.id).toBe('first');
        key('Escape');
        expect(innerClose).toHaveBeenCalledOnce();
        expect(outerClose).not.toHaveBeenCalled();
        await render(
            <>
                {outer}
                {null}
            </>,
        );
        expect(document.activeElement).toBe(innerTrigger);
        expect(document.body.style.overflow).toBe('hidden');
        await render(null);
        expect(document.activeElement).toBe(trigger);
        expect(host.hasAttribute('inert')).toBe(false);
        expect(document.body.style.overflow).toBe('');
    });

    it('keeps a remaining overlay locked when the outer dialog is removed first', async () => {
        const outer = (
            <DialogSheet title="Address" language="en" onClose={vi.fn()}>
                <button id="address-trigger">Another dialog</button>
            </DialogSheet>
        );
        const inner = (
            <Overlay onClose={vi.fn()}>
                <section role="dialog" aria-modal="true">
                    <button>Inner</button>
                </section>
            </Overlay>
        );
        await render(
            <>
                {outer}
                {null}
            </>,
        );
        document.getElementById('address-trigger')?.focus();
        await render(
            <>
                {outer}
                {inner}
            </>,
        );
        await render(
            <>
                {null}
                {inner}
            </>,
        );
        expect(document.body.style.overflow).toBe('hidden');
        expect(document.documentElement.style.overflow).toBe('hidden');
        await render(null);
        expect(document.body.style.overflow).toBe('');
        expect(document.documentElement.style.overflow).toBe('');
        expect(document.activeElement).toBe(trigger);
    });

    it('tears down old route ownership even when business open state remains true', async () => {
        const close = vi.fn();
        const dialog = (
            <Sheet title="Filter" language="en" onClose={close}>
                <input />
            </Sheet>
        );
        await render(dialog);
        await render(dialog, 'store:MYR:en:home');
        expect(document.querySelector('[data-overlay-layer]')).toBeNull();
        expect(close).toHaveBeenCalledOnce();
        expect(document.body.style.overflow).toBe('');
        expect(host.hasAttribute('inert')).toBe(false);
    });

    it('preserves preexisting inert state and releases StrictMode mount locks once', async () => {
        host.setAttribute('inert', '');
        await render(
            <StrictMode>
                <Sheet title="Address" language="en" onClose={vi.fn()}>
                    <input />
                </Sheet>
            </StrictMode>,
        );
        const layer = document.querySelector('[data-overlay-layer]');
        if (!layer) throw new Error('Missing overlay layer');
        expect(layer.parentElement).toBe(document.body);
        expect(document.querySelectorAll('[data-overlay-top]')).toHaveLength(1);
        await render(null);
        expect(host.hasAttribute('inert')).toBe(true);
        expect(document.body.style.overflow).toBe('');
    });

    it('never resurrects an old owner overlay if its busy callback keeps the business state open', async () => {
        const close = vi.fn();
        const dialog = (
            <Sheet title="Busy editor" language="en" onClose={close}>
                <input />
            </Sheet>
        );
        await render(dialog);
        await render(dialog, 'other-store:MYR:en:category');
        expect(document.querySelector('[data-overlay-layer]')).toBeNull();
        await render(dialog);
        expect(document.querySelector('[data-overlay-layer]')).toBeNull();
        expect(document.body.style.overflow).toBe('');
    });

    it('retains a busy confirmation without letting Escape reach the page underneath', async () => {
        const background = vi.fn();
        document.addEventListener('keydown', background);
        try {
            await render(
                <Overlay onClose={() => undefined}>
                    <section role="alertdialog" aria-modal="true">
                        <button disabled>Saving</button>
                    </section>
                </Overlay>,
            );
            key('Tab');
            expect(document.activeElement?.getAttribute('role')).toBe('alertdialog');
            key('Escape');
            expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
            expect(background).not.toHaveBeenCalled();
        } finally {
            document.removeEventListener('keydown', background);
        }
    });
});
