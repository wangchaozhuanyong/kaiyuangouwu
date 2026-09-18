// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAllListSearch, getSavedListSearch, saveListSearch } from '../utils/list-state-storage';
import { useUrlListState } from './use-url-list-state';

const cleanups: Array<() => void> = [];

beforeEach(() => {
    clearAllListSearch();
});

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function renderListState(initialEntry: string) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    let stateHandle!: ReturnType<typeof useUrlListState>;
    let currentUrl = '';

    function Harness() {
        const location = useLocation();
        const state = useUrlListState();
        useEffect(() => {
            currentUrl = `${location.pathname}${location.search}`;
            stateHandle = state;
        });
        return (
            <div>
                <span data-testid="url">{currentUrl}</span>
                <span data-testid="search">{state.searchTerm}</span>
                <span data-testid="page">{state.page}</span>
                <span data-testid="isFiltered">{String(state.isFiltered)}</span>
                <button type="button" data-testid="set-search" onClick={() => state.setSearchTerm('phone')}>
                    Search
                </button>
                <button type="button" data-testid="set-page" onClick={() => state.setPage(2)}>
                    Page
                </button>
                <button
                    type="button"
                    data-testid="set-filter"
                    onClick={() => state.setFilter('status', 'enabled', 'all')}
                >
                    Filter
                </button>
                <button type="button" data-testid="reset-filters" onClick={() => state.resetFilters()}>
                    Reset
                </button>
            </div>
        );
    }

    await act(async () => {
        root.render(
            <MemoryRouter initialEntries={[initialEntry]}>
                <Harness />
            </MemoryRouter>,
        );
    });

    cleanups.push(() => {
        root.unmount();
        container.remove();
    });

    return {
        getState: () => stateHandle,
        getCurrentUrl: () => currentUrl,
        click: async (testId: string) => {
            const btn = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
            await act(async () => btn.click());
        },
    };
}

describe('useUrlListState', () => {
    it('initializes with URL values and detects filter state', async () => {
        const { getCurrentUrl, getState } = await renderListState(
            '/catalog/list?search=macbook&page=3&status=enabled',
        );

        expect(getState().searchTerm).toBe('macbook');
        expect(getState().page).toBe(2);
        expect(getState().isFiltered).toBe(true);
        expect(getCurrentUrl()).toBe('/catalog/list?search=macbook&page=3&status=enabled');
    });

    it('persists state changes to session storage', async () => {
        const { click } = await renderListState('/catalog/list');

        await click('set-search');
        expect(getSavedListSearch('/catalog/list')).toBe('?search=phone');

        await click('set-page');
        expect(getSavedListSearch('/catalog/list')).toBe('?search=phone&page=3');

        await click('set-filter');
        expect(getSavedListSearch('/catalog/list')).toContain('status=enabled');
    });

    it('auto-restores saved search on fresh mount with empty URL query', async () => {
        saveListSearch('/catalog/list', '?search=iphone&page=2');

        const { getCurrentUrl, getState } = await renderListState('/catalog/list');

        // URL and state should be smoothly restored from session storage
        expect(getCurrentUrl()).toBe('/catalog/list?search=iphone&page=2');
        expect(getState().searchTerm).toBe('iphone');
        expect(getState().page).toBe(1);
        expect(getState().isFiltered).toBe(true);
    });

    it('does not overwrite explicit URL query params if present on mount', async () => {
        saveListSearch('/sales/orders', '?search=old');

        const { getCurrentUrl, getState } = await renderListState('/sales/orders?tab=to-fulfill');

        expect(getCurrentUrl()).toBe('/sales/orders?tab=to-fulfill');
        expect(getState().searchTerm).toBe('');
    });

    it('clears storage and URL when resetFilters is invoked', async () => {
        saveListSearch('/catalog/list', '?search=macbook&page=2');
        const { click, getCurrentUrl, getState } = await renderListState(
            '/catalog/list?search=macbook&page=2',
        );

        expect(getState().isFiltered).toBe(true);

        await click('reset-filters');
        expect(getCurrentUrl()).toBe('/catalog/list');
        expect(getState().searchTerm).toBe('');
        expect(getState().page).toBe(0);
        expect(getState().isFiltered).toBe(false);
        expect(getSavedListSearch('/catalog/list')).toBeNull();
    });
});
