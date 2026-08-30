import { describe, expect, it } from 'vitest';

import { normalizeStoreReportOptions } from './store-reporting-options';

describe('normalizeStoreReportOptions', () => {
    it('normalizes dates and caps the requested page size', () => {
        expect(
            normalizeStoreReportOptions(
                {
                    from: '2026-08-01T00:00:00.000Z',
                    to: '2026-08-31T23:59:59.999Z',
                    skip: 50,
                    take: 999,
                },
                50,
                200,
            ),
        ).toEqual({
            from: new Date('2026-08-01T00:00:00.000Z'),
            to: new Date('2026-08-31T23:59:59.999Z'),
            skip: 50,
            take: 200,
        });
    });

    it('rejects invalid ranges and unsafe pagination values', () => {
        expect(() =>
            normalizeStoreReportOptions(
                { from: '2026-09-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
                50,
                200,
            ),
        ).toThrow('开始时间不能晚于结束时间');
        expect(() => normalizeStoreReportOptions({ skip: -1 }, 50, 200)).toThrow('非负整数');
        expect(() => normalizeStoreReportOptions({ take: 0 }, 50, 200)).toThrow('正整数');
    });
});
