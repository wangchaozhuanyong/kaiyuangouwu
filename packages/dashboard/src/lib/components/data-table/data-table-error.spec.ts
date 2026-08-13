import { describe, expect, it } from 'vitest';

import { getDataTableErrorKind } from './data-table-error.js';

describe('getDataTableErrorKind', () => {
    it('recognizes a direct GraphQL forbidden error', () => {
        expect(getDataTableErrorKind({ extensions: { code: 'FORBIDDEN' } })).toBe('forbidden');
    });

    it('recognizes a forbidden error in a GraphQL response', () => {
        expect(getDataTableErrorKind({ response: { errors: [{ extensions: { code: 'FORBIDDEN' } }] } })).toBe(
            'forbidden',
        );
    });

    it('treats other failures as generic errors', () => {
        expect(getDataTableErrorKind(new Error('Network unavailable'))).toBe('generic');
    });
});
