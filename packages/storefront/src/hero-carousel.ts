export const DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS = 5;
export const MIN_HERO_AUTOPLAY_INTERVAL_SECONDS = 3;
export const MAX_HERO_AUTOPLAY_INTERVAL_SECONDS = 30;
export const HERO_SWIPE_THRESHOLD = 40;
export const HERO_TRANSITION_MS = 520;
export const HERO_HEIGHT_TRANSITION_MS = 220;

export function heroSwipeAxis(deltaX: number, deltaY: number): 'pending' | 'horizontal' | 'vertical' {
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 8) return 'pending';
    if (Math.abs(deltaY) >= Math.abs(deltaX)) return 'vertical';
    return Math.abs(deltaX) > Math.abs(deltaY) + 4 ? 'horizontal' : 'pending';
}

export function heroDirectionBetweenSlides(
    currentIndex: number,
    nextIndex: number,
    heroCount: number,
): -1 | 1 {
    const forward = (nextIndex - currentIndex + heroCount) % heroCount;
    const backward = (currentIndex - nextIndex + heroCount) % heroCount;
    return forward <= backward ? 1 : -1;
}

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
