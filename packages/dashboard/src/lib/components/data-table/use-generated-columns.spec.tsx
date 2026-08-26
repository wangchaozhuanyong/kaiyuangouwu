import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { getRowActions } from './use-generated-columns.js';

describe('getRowActions', () => {
    const row = { original: { id: 'variant-1', name: 'Variant 1' } } as any;
    const table = {} as any;

    it('renders the primary action directly without an overflow menu', () => {
        const onClick = vi.fn();
        const column = getRowActions(
            {
                label: 'Edit',
                href: currentRow => `./${currentRow.original.id}`,
                onClick,
                ariaLabel: currentRow => `Edit ${currentRow.original.name}`,
            },
            undefined,
            undefined,
            [],
        );

        const cell = (column.cell as any)({ row, table });
        expect(isValidElement(cell)).toBe(true);
        const children = cell.props.children as any[];
        expect(children[0].props['data-testid']).toBe('dt-row-primary-action');
        expect(children[0].props['aria-label']).toBe('Edit Variant 1');
        expect(children[1]).toBe(false);
    });

    it('keeps secondary row actions in the overflow menu', () => {
        const column = getRowActions(
            { label: 'Edit', onClick: vi.fn() },
            [{ label: 'Duplicate', onClick: vi.fn() }],
            undefined,
            [],
        );

        const cell = (column.cell as any)({ row, table });
        const children = cell.props.children as any[];
        expect(children[0].props['data-testid']).toBe('dt-row-primary-action');
        expect(isValidElement(children[1])).toBe(true);
    });
});
