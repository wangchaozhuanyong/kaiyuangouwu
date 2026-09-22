import { useEffect, useState, type RefObject } from 'react';

export interface ScrollDirectionVisibilityOptions {
    disabled?: boolean;
    hideDistance?: number;
    maxViewportWidth?: number;
    minimumTopBoundary?: number;
    showDistance?: number;
}

/**
 * Hides compact mobile chrome after a deliberate downward-page scroll and
 * reveals it sooner when the user reverses direction. The asymmetric
 * thresholds prevent touchpad and inertial-scroll jitter from toggling it.
 */
export function useScrollDirectionVisibility(
    anchorRef: RefObject<HTMLElement | null>,
    {
        disabled = false,
        hideDistance = 24,
        maxViewportWidth = 1023,
        minimumTopBoundary = 96,
        showDistance = 12,
    }: ScrollDirectionVisibilityOptions = {},
): boolean {
    const [hidden, setHidden] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        let frame = 0;
        let hiddenNow = false;
        let lastDirection = 0;
        let accumulatedDistance = 0;
        let previousY = Math.max(0, window.scrollY);
        const anchorTop = anchorRef.current
            ? Math.max(minimumTopBoundary, anchorRef.current.getBoundingClientRect().top + window.scrollY)
            : minimumTopBoundary;

        const show = () => {
            accumulatedDistance = 0;
            lastDirection = 0;
            if (!hiddenNow) return;
            hiddenNow = false;
            setHidden(false);
        };

        const update = () => {
            frame = 0;
            const currentY = Math.max(0, window.scrollY);
            const delta = currentY - previousY;
            previousY = currentY;

            if (disabled || window.innerWidth > maxViewportWidth || currentY <= anchorTop) {
                show();
                return;
            }
            if (Math.abs(delta) < 1) return;

            const direction = delta > 0 ? 1 : -1;
            if (direction !== lastDirection) accumulatedDistance = 0;
            lastDirection = direction;
            accumulatedDistance += delta;

            if (!hiddenNow && direction > 0 && accumulatedDistance >= hideDistance) {
                hiddenNow = true;
                accumulatedDistance = 0;
                setHidden(true);
            } else if (hiddenNow && direction < 0 && accumulatedDistance <= -showDistance) {
                show();
            }
        };

        const scheduleUpdate = () => {
            if (!frame) frame = window.requestAnimationFrame(update);
        };

        setHidden(false);
        window.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', scheduleUpdate);
        return () => {
            window.removeEventListener('scroll', scheduleUpdate);
            window.removeEventListener('resize', scheduleUpdate);
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, [anchorRef, disabled, hideDistance, maxViewportWidth, minimumTopBoundary, showDistance]);

    return hidden;
}
