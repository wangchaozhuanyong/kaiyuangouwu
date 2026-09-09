import { describe, expect, it } from 'vitest';

import { csvCell } from './sales-csv';

describe('order CSV text', () => {
    it.each(['=1+1', '+1', '-1', '@name', ' \t=1+1', '\r=1+1', '\nordinary', '\tordinary'])(
        'neutralizes %j',
        value => {
            expect(csvCell(value)).toBe(`"'${value}"`);
        },
    );
    it('keeps ordinary text and quotes delimiters', () => {
        expect(csvCell('客户,"A"')).toBe('"客户,""A"""');
        expect(csvCell('123.45')).toBe('"123.45"');
    });
});
