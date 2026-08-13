import { describe, expect, it } from 'vitest';

import { getDataTableColumnLabel } from './data-table-utils.js';

describe('getDataTableColumnLabel()', () => {
    it('prefers the page-provided translated string header', () => {
        expect(
            getDataTableColumnLabel(
                { id: 'currentValue', columnDef: { header: '当前值' } },
                () => 'Current Value',
            ),
        ).toBe('当前值');
    });

    it('uses the dynamic field-name translation for generated headers', () => {
        expect(
            getDataTableColumnLabel({ id: 'currentValue', columnDef: { header: () => null } }, id =>
                id === 'currentValue' ? '当前值' : id,
            ),
        ).toBe('当前值');
    });
});
