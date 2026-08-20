import { describe, expect, it } from 'vitest';

import { metricLabelDate } from './metric-date.js';

describe('metricLabelDate', () => {
    it('keeps a business calendar label on the same local day', () => {
        const date = metricLabelDate('2026-08-20');

        expect(date.getFullYear()).toBe(2026);
        expect(date.getMonth()).toBe(7);
        expect(date.getDate()).toBe(20);
    });

    it('keeps compatibility with existing ISO labels', () => {
        expect(metricLabelDate('2026-08-20T00:00:00.000Z').toISOString()).toBe('2026-08-20T00:00:00.000Z');
    });
});
