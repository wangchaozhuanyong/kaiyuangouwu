import { afterEach, describe, expect, it, vi } from 'vitest';

import { compareMetric, getMetricRange, getPreviousMetricRange } from './dashboard-metrics';

describe('dashboard metric helpers', () => {
    afterEach(() => vi.unstubAllEnvs());

    it.each(['UTC', 'Asia/Shanghai', 'America/Los_Angeles', 'Asia/Tokyo'])(
        'uses the Beijing business day when the browser timezone is %s',
        timeZone => {
            vi.stubEnv('TZ', timeZone);
            expect(getMetricRange('TODAY', Date.parse('2026-10-15T16:30:00.123Z'))).toEqual({
                startDate: '2026-10-15T16:00:00.000Z',
                endDate: '2026-10-15T16:30:00.123Z',
            });
            expect(getMetricRange('7D', Date.parse('2026-10-15T16:30:00.123Z')).startDate).toBe(
                '2026-10-09T16:00:00.000Z',
            );
            expect(getMetricRange('30D', Date.parse('2026-10-15T16:30:00.123Z')).startDate).toBe(
                '2026-09-16T16:00:00.000Z',
            );
        },
    );

    it.each([
        ['2026-10-15T15:59:59.999Z', '2026-10-14T16:00:00.000Z'],
        ['2026-10-15T16:00:00.000Z', '2026-10-15T16:00:00.000Z'],
        ['2026-12-31T16:00:00.000Z', '2026-12-31T16:00:00.000Z'],
        ['2028-02-29T16:01:00.000Z', '2028-02-29T16:00:00.000Z'],
    ])('handles midnight, year and leap-month boundaries at %s', (end, start) => {
        expect(getMetricRange('TODAY', Date.parse(end))).toEqual({ startDate: start, endDate: end });
    });

    it('compares this morning with yesterday morning, rather than yesterday evening', () => {
        const current = getMetricRange('TODAY', Date.parse('2026-01-01T02:05:06.007Z'));
        expect(getPreviousMetricRange(current)).toEqual({
            startDate: '2025-12-30T16:00:00.000Z',
            endDate: '2025-12-31T02:05:06.007Z',
        });
    });

    it.each(['TODAY', '7D', '30D'] as const)(
        'compares %s with the same elapsed calendar period across a leap month',
        period => {
            const current = getMetricRange(period, Date.parse('2028-03-01T03:04:05.006Z'));
            const previous = getPreviousMetricRange(current);
            const days = period === 'TODAY' ? 1 : period === '7D' ? 7 : 30;
            const offset = days * 24 * 60 * 60 * 1000;
            expect(Date.parse(current.startDate) - Date.parse(previous.startDate)).toBe(offset);
            expect(Date.parse(current.endDate) - Date.parse(previous.endDate)).toBe(offset);
            expect(previous.endDate.slice(11)).toBe(current.endDate.slice(11));
        },
    );

    it('builds a current range and a non-overlapping previous range of equal duration', () => {
        const current = getMetricRange('7D', Date.parse('2026-08-31T12:00:00.000Z'));
        const previous = getPreviousMetricRange(current);
        const currentDuration = Date.parse(current.endDate) - Date.parse(current.startDate);
        const previousDuration = Date.parse(previous.endDate) - Date.parse(previous.startDate);

        expect(previousDuration).toBe(currentDuration);
        expect(Date.parse(previous.endDate)).toBeLessThan(Date.parse(current.startDate));
    });

    it('formats increases, decreases and zero baselines clearly', () => {
        expect(compareMetric(120, 100)).toEqual({ label: '+20.0%', tone: 'positive' });
        expect(compareMetric(80, 100)).toEqual({ label: '-20.0%', tone: 'negative' });
        expect(compareMetric(0, 0)).toEqual({ label: '与上期持平', tone: 'neutral' });
        expect(compareMetric(10, 0)).toEqual({ label: '上期为 0', tone: 'positive' });
    });
});
