// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SortableTableHeader } from './SortableTableHeader';

const cleanups: Array<() => void> = [];

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function renderHeader(activeSortField: 'name' | 'price', sortDirection: 'ASC' | 'DESC') {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const row = document.createElement('tr');
    table.append(head);
    head.append(row);
    document.body.append(table);
    const root = createRoot(row);
    const onSort = vi.fn();
    await act(async () => {
        root.render(
            <SortableTableHeader
                label="商品名称"
                sortField="name"
                activeSortField={activeSortField}
                sortDirection={sortDirection}
                onSort={onSort}
            />,
        );
    });
    cleanups.push(() => {
        root.unmount();
        table.remove();
    });
    return { button: row.querySelector('button')!, header: row.querySelector('th')!, onSort };
}

describe('SortableTableHeader', () => {
    it('announces an inactive sortable column and requests its initial direction', async () => {
        const view = await renderHeader('price', 'DESC');
        expect(view.header.getAttribute('aria-sort')).toBe('none');
        expect(view.button.getAttribute('aria-label')).toContain('未排序');
        await act(async () => view.button.click());
        expect(view.onSort).toHaveBeenCalledWith('name', 'ASC');
    });

    it('announces the active direction and requests a toggle', async () => {
        const view = await renderHeader('name', 'DESC');
        expect(view.header.getAttribute('aria-sort')).toBe('descending');
        expect(view.button.getAttribute('aria-label')).toContain('当前降序');
        await act(async () => view.button.click());
        expect(view.onSort).toHaveBeenCalledWith('name', 'ASC');
    });
});
