// @vitest-environment jsdom
// organize-imports-ignore -- Keep the repository's type import grouping.
import type { EmbeddedSearchControl } from '../../pages/search-page';
import type { RouteState } from '../../storefront-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontContext } from '../../StorefrontContext';

import DesktopSearch from './desktop-search';

const embeddedSearch = vi.hoisted(() => vi.fn());
vi.mock('../../pages/search-page', () => ({
    SearchPage: ({ embedded }: { embedded: EmbeddedSearchControl }) => {
        embeddedSearch(embedded);
        return <div data-embedded-search="true">Embedded results</div>;
    },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('desktop search route continuity', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    async function render(route: RouteState, displayedRoute = route) {
        await act(async () => {
            root.render(
                <StorefrontContext.Provider
                    value={
                        {
                            route,
                            displayedRoute,
                            language: 'en',
                            collections: [],
                            products: [],
                        } as never
                    }
                >
                    <DesktopSearch />
                    {displayedRoute.name === 'search' && (
                        <main className="search-page">
                            <input type="search" defaultValue={displayedRoute.term} />
                        </main>
                    )}
                </StorefrontContext.Provider>,
            );
            await Promise.resolve();
        });
    }

    async function openPopover() {
        await render({ name: 'home' });
        const input = host.querySelector<HTMLInputElement>('.proto-search-input');
        if (!input) throw new Error('Desktop search input was not mounted');
        await act(async () => {
            input.focus();
            await import('../../pages/search-page');
        });
        const panel = host.querySelector<HTMLElement>('.desktop-search-popover');
        if (!panel) throw new Error('Desktop search popover was not mounted');
        expect(panel.hidden).toBe(false);
        return { input, panel };
    }

    beforeEach(() => {
        embeddedSearch.mockClear();
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {
                    /* This test supplies fixed layout geometry. */
                }
                disconnect() {
                    /* The observer never attaches native resources. */
                }
            },
        );
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.unstubAllGlobals();
    });

    it('focuses the direct route input without mounting another result query', async () => {
        await render({ name: 'search', term: 'coffee' });
        const trigger = host.querySelector<HTMLButtonElement>('.proto-search-route-trigger');
        const input = host.querySelector<HTMLInputElement>('.search-page input');
        expect(trigger?.textContent).toContain('coffee');
        act(() => trigger?.click());
        expect(document.activeElement).toBe(input);
        act(() => input?.blur());
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }));
        });
        expect(document.activeElement).toBe(input);
        expect(host.querySelectorAll('input[type="search"]')).toHaveLength(1);
        expect(host.querySelector('.desktop-search-popover')).toBeNull();
        expect(embeddedSearch).not.toHaveBeenCalled();
    });

    it('preserves the normal popover until the search route is actually displayed', async () => {
        await render({ name: 'search', term: 'coffee' }, { name: 'home' });
        const input = host.querySelector<HTMLInputElement>('.proto-search-input');
        expect(input).not.toBeNull();
        await act(async () => {
            input?.focus();
            await import('../../pages/search-page');
        });
        expect(host.querySelector('.desktop-search-popover')?.hasAttribute('hidden')).toBe(false);
        expect(embeddedSearch).toHaveBeenCalled();
        await render({ name: 'search', term: 'coffee' });
        expect(host.querySelector('.desktop-search-popover')).toBeNull();
        expect(host.querySelectorAll('input[type="search"]')).toHaveLength(1);
    });

    it.each([{ isComposing: true }, { isComposing: false, keyCode: 229 }])(
        'keeps the popover open for an input-method Escape %j, then closes on ordinary Escape',
        async options => {
            const { input, panel } = await openPopover();
            act(() => {
                input.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'Escape',
                        bubbles: true,
                        cancelable: true,
                        ...options,
                    }),
                );
            });
            expect(panel.hidden).toBe(false);
            act(() => {
                input.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
                );
            });
            expect(panel.hidden).toBe(true);
        },
    );

    it('leaves Escape to an open filter sheet before closing the popover', async () => {
        const { panel } = await openPopover();
        const sheet = document.createElement('div');
        sheet.className = 'search-filter-sheet';
        sheet.setAttribute('role', 'dialog');
        document.body.append(sheet);
        try {
            act(() => {
                sheet.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
                );
            });
            expect(panel.hidden).toBe(false);
        } finally {
            sheet.remove();
        }
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
        expect(panel.hidden).toBe(true);
    });

    it('restores form submission after an IME cancellation ends composition', async () => {
        const { input, panel } = await openPopover();
        const form = input.form;
        if (!form) throw new Error('Desktop search form was not mounted');
        act(() => {
            input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        });
        act(() => {
            input.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }),
            );
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(panel.hidden).toBe(false);
        expect(embeddedSearch).toHaveBeenLastCalledWith(
            expect.objectContaining({ composing: true, submission: 0 }),
        );
        act(() => {
            input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
        });
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '日常');
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        });
        act(() => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(panel.hidden).toBe(false);
        expect(embeddedSearch).toHaveBeenLastCalledWith(
            expect.objectContaining({ composing: false, query: '日常', submission: 1 }),
        );
    });

    it('still closes on an outside pointer press', async () => {
        const { panel } = await openPopover();
        act(() => {
            document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        });
        expect(panel.hidden).toBe(true);
    });
});
