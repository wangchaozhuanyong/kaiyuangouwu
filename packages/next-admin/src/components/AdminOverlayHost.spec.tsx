// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAccessibleDialog } from '../hooks/use-accessible-dialog';
import { PageRuntimeContext } from '../runtime/page-runtime-context';
import { AdminOverlayHost, AdminOverlayPortal } from './AdminOverlayHost';

const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    document.body.style.overflow = '';
});

describe('owned admin overlays', () => {
    it('does not change body overflow when only a non-modal help card closes', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        const root = createRoot(container);
        cleanups.push(() => root.unmount());
        function Help() {
            const { dialogRef } = useAccessibleDialog(() => {}, true, { modal: false, autoFocus: false });
            return <section ref={dialogRef} />;
        }
        document.body.style.overflow = 'scroll';
        await act(async () => root.render(<Help />));
        await act(async () => root.render(null));
        expect(document.body.style.overflow).toBe('scroll');
    });

    it('keeps a child mounted in the same commit above its parent in the Escape stack', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        const parentClose = vi.fn(),
            childClose = vi.fn();
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        cleanups.push(() => {
            root.unmount();
            container.remove();
        });
        function Child() {
            const { dialogRef } = useAccessibleDialog(childClose);
            return <section ref={dialogRef} tabIndex={-1} data-child />;
        }
        function Parent() {
            const { dialogRef } = useAccessibleDialog(parentClose);
            return (
                <section ref={dialogRef} tabIndex={-1}>
                    <Child />
                </section>
            );
        }
        await act(async () => root.render(<Parent />));
        expect(document.activeElement).toBe(container.querySelector('[data-child]'));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(childClose).toHaveBeenCalledTimes(1);
        expect(parentClose).not.toHaveBeenCalled();
    });
    it('keeps hidden page drafts, releases focus/scroll lock, and only closes the top modal', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        document.body.style.overflow = 'auto';
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        cleanups.push(() => {
            root.unmount();
            container.remove();
        });
        const localClose = vi.fn(),
            globalClose = vi.fn();
        function Dialog({ name, onClose }: { name: string; onClose: () => void }) {
            const [draft, setDraft] = useState('original');
            const { dialogRef } = useAccessibleDialog(onClose);
            return (
                <AdminOverlayPortal>
                    <div data-backdrop={name}>
                        <section ref={dialogRef} role="dialog" aria-label={name} tabIndex={-1}>
                            <input readOnly value={draft} />
                            <button onClick={() => setDraft('unsaved')}>edit</button>
                        </section>
                    </div>
                </AdminOverlayPortal>
            );
        }
        const render = (active: boolean, globalOpen = false) =>
            act(async () =>
                root.render(
                    <AdminOverlayHost owner="@global">
                        <button data-outside>outside</button>
                        <PageRuntimeContext.Provider value={{ page: '/editor', active }}>
                            <AdminOverlayHost owner="/editor" active={active}>
                                <Dialog name="page" onClose={localClose} />
                            </AdminOverlayHost>
                        </PageRuntimeContext.Provider>
                        {globalOpen && <Dialog name="global" onClose={globalClose} />}
                    </AdminOverlayHost>,
                ),
            );
        await render(true);
        const pageHost = document.querySelector<HTMLElement>('[data-admin-overlay-owner="/editor"]')!;
        const pageDialog = pageHost.querySelector<HTMLElement>('[role="dialog"]')!;
        await act(async () => pageHost.querySelector('button')!.click());
        expect(pageHost.querySelector('input')!.value).toBe('unsaved');
        expect(document.body.style.overflow).toBe('hidden');
        pageHost.querySelector('input')!.focus();
        await render(true, true);
        const globalDialog = document.querySelector<HTMLElement>('[aria-label="global"]')!;
        expect(document.activeElement).toBe(globalDialog);
        container.querySelector<HTMLButtonElement>('[data-outside]')!.focus();
        expect(document.activeElement).toBe(globalDialog);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(globalClose).toHaveBeenCalledTimes(1);
        expect(localClose).not.toHaveBeenCalled();
        await render(true);
        expect(document.activeElement).toBe(pageHost.querySelector('input'));
        expect(document.body.style.overflow).toBe('hidden');
        await render(false);
        expect(pageHost.hidden).toBe(true);
        expect(pageHost.hasAttribute('inert')).toBe(true);
        expect(document.body.style.overflow).toBe('auto');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(localClose).not.toHaveBeenCalled();
        await render(true);
        expect(pageHost.hidden).toBe(false);
        expect(pageHost.querySelector('[role="dialog"]')).toBe(pageDialog);
        expect(pageHost.querySelector('input')!.value).toBe('unsaved');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(localClose).toHaveBeenCalledTimes(1);
    });

    it('lets a help popover own Escape without unlocking its parent modal or stealing hover focus', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        cleanups.push(() => {
            root.unmount();
            container.remove();
        });
        const modalClose = vi.fn(),
            helpClose = vi.fn();
        function Surface({ help = false }: { help?: boolean }) {
            const { dialogRef } = useAccessibleDialog(help ? helpClose : modalClose, true, {
                modal: !help,
                autoFocus: !help,
            });
            return (
                <section ref={dialogRef} tabIndex={-1} data-help={help}>
                    <button>target</button>
                </section>
            );
        }
        await act(async () =>
            root.render(
                <>
                    <Surface />
                </>,
            ),
        );
        const modal = container.querySelector('section')!;
        await act(async () =>
            root.render(
                <>
                    <Surface />
                    <Surface help />
                </>,
            ),
        );
        expect(document.activeElement).toBe(modal);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(helpClose).toHaveBeenCalledTimes(1);
        expect(modalClose).not.toHaveBeenCalled();
        expect(document.body.style.overflow).toBe('hidden');
    });
});
