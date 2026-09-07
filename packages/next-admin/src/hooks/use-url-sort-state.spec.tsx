// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useUrlSortState } from './use-url-sort-state';

const cleanups: Array<() => void> = [];
const fields = ['updatedAt', 'name', 'price'] as const;

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function renderSortState(initialEntry: string) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    function Harness() {
        const location = useLocation();
        const sort = useUrlSortState({
            fields,
            defaultField: 'updatedAt',
            defaultDirection: 'DESC',
        });
        return (
            <button type="button" onClick={() => sort.toggleSort('name')}>
                {sort.sortField}|{sort.sortDirection}|{location.search}
            </button>
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
    return container.querySelector('button')!;
}

describe('useUrlSortState', () => {
    it('uses a safe default when URL sort values are unsupported', async () => {
        const button = await renderSortState('/catalog?sort=unknown&direction=sideways&page=3');
        expect(button.textContent).toContain('updatedAt|DESC');
    });

    it('stores a new sort in the URL and resets pagination', async () => {
        const button = await renderSortState('/catalog?page=3&status=enabled');
        await act(async () => button.click());
        expect(button.textContent).toContain('name|ASC');
        expect(button.textContent).toContain('sort=name');
        expect(button.textContent).toContain('direction=ASC');
        expect(button.textContent).toContain('status=enabled');
        expect(button.textContent).not.toContain('page=3');
    });

    it('toggles the active sort direction', async () => {
        const button = await renderSortState('/catalog?sort=name&direction=ASC');
        await act(async () => button.click());
        expect(button.textContent).toContain('name|DESC');
        expect(button.textContent).toContain('direction=DESC');
    });
});
