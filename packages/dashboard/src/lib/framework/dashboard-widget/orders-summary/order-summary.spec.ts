import { describe, expect, it } from 'vitest';

import { metricSummaryTotal } from './order-summary.js';

describe('metricSummaryTotal', () => {
    it('sums every daily entry for the selected metric', () => {
        const summaries = [
            { type: 'OrderCount', entries: [{ value: 1 }, { value: 2 }] },
            { type: 'OrderTotal', entries: [{ value: 33787 }, { value: 1000 }] },
        ];

        expect(metricSummaryTotal(summaries, 'OrderCount')).toBe(3);
        expect(metricSummaryTotal(summaries, 'OrderTotal')).toBe(34787);
    });

    it('returns zero when the requested metric is missing', () => {
        expect(metricSummaryTotal([], 'OrderTotal')).toBe(0);
    });
});
