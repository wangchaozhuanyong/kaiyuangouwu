import { describe, expect, it } from 'vitest';

import { quotaWindow } from './image-usage-quota.service';

describe('image usage quota windows', () => {
    it('uses fixed UTC minute buckets for anti-abuse attempts', () => {
        expect(quotaWindow('PROMPT_MINUTE', new Date('2026-08-27T16:00:42.500Z'))).toEqual({
            key: '2026-08-27T16:00',
            startsAt: new Date('2026-08-27T16:00:00.000Z'),
            endsAt: new Date('2026-08-27T16:01:00.000Z'),
        });
    });

    it('resets daily free quota at Beijing midnight', () => {
        expect(quotaWindow('IMAGE_DAILY_FREE', new Date('2026-08-27T16:00:00.000Z'))).toEqual({
            key: '2026-08-28',
            startsAt: new Date('2026-08-27T16:00:00.000Z'),
            endsAt: new Date('2026-08-28T16:00:00.000Z'),
        });
    });
});
