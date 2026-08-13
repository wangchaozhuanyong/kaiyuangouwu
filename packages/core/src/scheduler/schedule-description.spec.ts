import { LanguageCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { getScheduleDescription } from './schedule-description';

describe('getScheduleDescription()', () => {
    it('describes cron expressions in Simplified Chinese', () => {
        expect(getScheduleDescription('0 */2 * * *', LanguageCode.zh_Hans)).toContain('每隔 2 小时');
    });

    it('keeps English requests in English', () => {
        expect(getScheduleDescription('0 */2 * * *', LanguageCode.en)).toContain('every 2 hours');
    });

    it('falls back to English for unsupported locales', () => {
        expect(getScheduleDescription('0 0 * * *', LanguageCode.cy)).toContain('12:00 AM');
    });
});
