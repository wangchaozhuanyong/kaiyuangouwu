import { describe, expect, it } from 'vitest';

import {
    DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS,
    heroIndexAfterManualMove,
    isCompletedHeroSwipe,
    normalizeHeroAutoplayIntervalSeconds,
} from './hero-carousel';

describe('hero carousel behavior', () => {
    it('uses the configured whole-second interval inside the supported range', () => {
        expect(normalizeHeroAutoplayIntervalSeconds(3)).toBe(3);
        expect(normalizeHeroAutoplayIntervalSeconds(12)).toBe(12);
        expect(normalizeHeroAutoplayIntervalSeconds(30)).toBe(30);
    });

    it('falls back to five seconds for missing or invalid settings', () => {
        expect(normalizeHeroAutoplayIntervalSeconds(Number.NaN)).toBe(DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS);
        expect(normalizeHeroAutoplayIntervalSeconds(2)).toBe(DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS);
        expect(normalizeHeroAutoplayIntervalSeconds(5.5)).toBe(DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS);
        expect(normalizeHeroAutoplayIntervalSeconds(31)).toBe(DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS);
    });

    it('wraps manual previous and next navigation', () => {
        expect(heroIndexAfterManualMove(0, 3, -1)).toBe(2);
        expect(heroIndexAfterManualMove(2, 3, 1)).toBe(0);
        expect(heroIndexAfterManualMove(1, 3, 1)).toBe(2);
    });

    it('requires a deliberate horizontal swipe', () => {
        expect(isCompletedHeroSwipe(-40, 5)).toBe(true);
        expect(isCompletedHeroSwipe(55, 8)).toBe(true);
        expect(isCompletedHeroSwipe(39, 0)).toBe(false);
        expect(isCompletedHeroSwipe(50, 60)).toBe(false);
    });
});
