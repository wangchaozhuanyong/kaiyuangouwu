export const DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS = 5;
export const MIN_HERO_AUTOPLAY_INTERVAL_SECONDS = 3;
export const MAX_HERO_AUTOPLAY_INTERVAL_SECONDS = 30;
export const HERO_SWIPE_THRESHOLD = 40;

export function normalizeHeroAutoplayIntervalSeconds(value: number): number {
    return Number.isInteger(value) &&
        value >= MIN_HERO_AUTOPLAY_INTERVAL_SECONDS &&
        value <= MAX_HERO_AUTOPLAY_INTERVAL_SECONDS
        ? value
        : DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS;
}

export function heroIndexAfterManualMove(currentIndex: number, heroCount: number, direction: -1 | 1): number {
    if (heroCount < 1) return 0;
    return (currentIndex + direction + heroCount) % heroCount;
}

export function isCompletedHeroSwipe(deltaX: number, deltaY: number): boolean {
    return Math.abs(deltaX) >= HERO_SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY);
}
