/** Each background import gets a separate idle turn; navigation intent bypasses this queue. */
export function scheduleRoutePreloads(
    targets: readonly string[],
    load: (target: string) => Promise<unknown>,
    canStart: () => boolean,
    schedule: (callback: () => void) => () => void = scheduleIdlePreload,
) {
    let cancelled = false;
    let index = 0;
    let cancelScheduled: (() => void) | undefined;
    const next = () => {
        if (cancelled || index >= targets.length) return;
        cancelScheduled = schedule(() => {
            if (cancelled) return;
            if (!canStart()) {
                next();
                return;
            }
            const target = targets[index++];
            void Promise.resolve()
                .then(() => load(target))
                .catch(() => undefined)
                .finally(next);
        });
    };
    next();
    return () => {
        cancelled = true;
        cancelScheduled?.();
    };
}

function scheduleIdlePreload(callback: () => void) {
    let idle: number | undefined;
    // Also space retries while the page is busy or hidden; idle callbacks alone can spin.
    const timer = window.setTimeout(() => {
        if (window.requestIdleCallback) idle = window.requestIdleCallback(callback, { timeout: 5_000 });
        else callback();
    }, 2_500);
    return () => {
        window.clearTimeout(timer);
        if (idle !== undefined) window.cancelIdleCallback(idle);
    };
}
