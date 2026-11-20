import { describe, expect, it } from 'vitest';

import { reviewedNewsForSource } from './reviewed-news';

describe('historical news editions', () => {
    const url = 'https://ai.google.dev/gemini-api/docs/changelog#10-08-2026';
    const older = 'gemini-3.5-flash is deprecated';
    const newer = 'gemini-3.7-flash is deprecated';

    it('distinguishes two Flash migrations that share the same dated official changelog', () => {
        const first = reviewedNewsForSource(url, older);
        const second = reviewedNewsForSource(url, newer);
        expect(first?.zh.title).toContain('3.5');
        expect(first?.en.title).toContain('3.5');
        expect(second?.zh.title).toContain('3.7');
        expect(second?.en.title).toContain('3.7');
        expect(reviewedNewsForSource(url, 'a deprecation notice')).toBeUndefined();
        expect(reviewedNewsForSource(url, older + ' ' + newer)).toBeUndefined();
    });
});
