import { describe, expect, it } from 'vitest';

import { summarizeTraffic, trafficBusinessDate, trafficDateRange } from './traffic-metrics';

describe('daily storefront traffic metrics', () => {
    it('links pre-login, post-login and multiple devices belonging to one account without inflating page views', () => {
        const businessDate = '2026-09-05';
        expect(
            summarizeTraffic(
                [businessDate],
                [
                    { businessDate, visitorKeyHash: 'phone', customerKeyHash: null, pageViewCount: 3 },
                    {
                        businessDate,
                        visitorKeyHash: 'phone',
                        customerKeyHash: 'customer-a',
                        pageViewCount: 1,
                    },
                    {
                        businessDate,
                        visitorKeyHash: 'desktop',
                        customerKeyHash: 'customer-a',
                        pageViewCount: 2,
                    },
                    { businessDate, visitorKeyHash: 'other', customerKeyHash: null, pageViewCount: 1 },
                ],
                [{ businessDate, ipCount: '1', missingIpCount: '0' }],
            ),
        ).toEqual([{ businessDate, visitorCount: 2, pageViewCount: 7, ipCount: 1 }]);
    });

    it('keeps daily counts separate and distinguishes absent collection from zero', () => {
        expect(
            summarizeTraffic(
                ['2026-09-04', '2026-09-05'],
                [
                    {
                        businessDate: '2026-09-05',
                        visitorKeyHash: 'phone',
                        customerKeyHash: null,
                        pageViewCount: 2,
                    },
                ],
                [{ businessDate: '2026-09-05', ipCount: 1, missingIpCount: 1 }],
            ),
        ).toEqual([
            { businessDate: '2026-09-04', visitorCount: null, pageViewCount: null, ipCount: null },
            { businessDate: '2026-09-05', visitorCount: 1, pageViewCount: 2, ipCount: null },
        ]);
    });

    it('does not merge different accounts that use the same browser', () => {
        const businessDate = '2026-09-05';
        const groups = [null, 'customer-a', 'customer-b'].map(customerKeyHash => ({
            businessDate,
            visitorKeyHash: 'shared-browser',
            customerKeyHash,
            pageViewCount: 1,
        }));
        expect(summarizeTraffic([businessDate], groups, [])[0].visitorCount).toBe(2);
    });

    it('uses the UTC+8 midnight boundary and builds a 30-day range across months', () => {
        expect(trafficBusinessDate(new Date('2026-09-04T15:59:59Z'))).toBe('2026-09-04');
        expect(trafficBusinessDate(new Date('2026-09-04T16:00:00Z'))).toBe('2026-09-05');
        const dates = trafficDateRange(30, '2026-09-05');
        expect(dates).toHaveLength(30);
        expect(dates[0]).toBe('2026-08-07');
        expect(dates.at(-1)).toBe('2026-09-05');
    });
});
