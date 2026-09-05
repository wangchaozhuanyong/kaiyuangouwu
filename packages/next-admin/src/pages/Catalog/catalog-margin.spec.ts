import { describe, expect, it } from 'vitest';

import { calculateDraftMargin } from './catalog-margin';

describe('catalog draft margin', () => {
    it('does not treat an empty purchase cost as zero cost', () => {
        expect(calculateDraftMargin('139', '')).toBeNull();
        expect(calculateDraftMargin('139', '   ')).toBeNull();
    });

    it('calculates margin only when price and cost are present', () => {
        expect(calculateDraftMargin('100', '40')).toBe(0.6);
        expect(calculateDraftMargin('', '40')).toBeNull();
        expect(calculateDraftMargin('0', '0')).toBeNull();
    });
});
