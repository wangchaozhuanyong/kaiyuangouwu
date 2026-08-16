import { describe, expect, it } from 'vitest';

import { BUSINESS_TIME_ZONE, formatBusinessDate } from './business-time.js';

const dateTimeOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
};

describe('business time formatting', () => {
    it('formats timestamps in Beijing time', () => {
        expect(BUSINESS_TIME_ZONE).toBe('Asia/Shanghai');
        expect(formatBusinessDate('en-US', '2026-08-15T16:30:00.000Z', dateTimeOptions)).toBe(
            '08/16/2026, 00:30',
        );
    });

    it('does not allow callers to override the business timezone', () => {
        expect(
            formatBusinessDate('en-US', '2026-08-15T16:30:00.000Z', {
                ...dateTimeOptions,
                timeZone: 'America/Los_Angeles',
            }),
        ).toBe('08/16/2026, 00:30');
    });
});
