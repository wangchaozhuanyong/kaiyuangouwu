// @vitest-environment jsdom
// organize-imports-ignore -- Keep the repository's type import grouping.
import type { RouteState } from '../../storefront-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontContext } from '../../StorefrontContext';

import DesktopSearch from './desktop-search';

const embeddedSearch = vi.hoisted(() => vi.fn());
vi.mock('../../pages/search-page', () => ({
    SearchPage: () => {
        embeddedSearch();
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
});
