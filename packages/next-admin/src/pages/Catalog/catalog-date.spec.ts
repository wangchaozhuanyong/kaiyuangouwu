import { describe, expect, it } from 'vitest';

import { dateInputToUtcDateTime } from './catalog-date';

describe('dateInputToUtcDateTime', () => {
    it('converts an HTML date input into the DateTime scalar format', () => {
        expect(dateInputToUtcDateTime('2026-08-20')).toBe('2026-08-20T00:00:00.000Z');
    });

    it('keeps an empty optional date as null', () => {
        expect(dateInputToUtcDateTime('')).toBeNull();
    });

    it('rejects an invalid calendar value', () => {
        expect(dateInputToUtcDateTime('not-a-date')).toBeNull();
    });
});
