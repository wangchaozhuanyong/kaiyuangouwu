/** One visible bottom edge for all mobile navigation and action bars. */
export function trackFixedBottomViewport(): () => void {
    const viewport = window.visualViewport;
    if (!viewport) return () => undefined;

    // Measure native fixed positioning independently of our correction. This also
    // detects bars stranded above the visible edge after mobile browser UI closes.
    const probe = document.createElement('div');
    probe.className = 'storefront-viewport-probe';
    probe.setAttribute('aria-hidden', 'true');
    document.body.append(probe);
    const property = '--storefront-viewport-bottom-offset';
    let frame = 0;
    let previous = 0;
    const update = () => {
        frame = 0;
        const offset =
            window.innerWidth < 1024 && viewport.scale === 1 && viewport.height > 0
                ? Math.round(probe.getBoundingClientRect().bottom - viewport.offsetTop - viewport.height)
                : 0;
        if (offset === previous) return;
        previous = offset;
        document.documentElement.style.setProperty(property, `${offset}px`);
    };
    const schedule = () => {
        if (!frame) frame = window.requestAnimationFrame(update);
    };
    const events: Array<[EventTarget, string]> = [
        [viewport, 'resize'],
        [viewport, 'scroll'],
        [window, 'resize'],
        [window, 'scroll'],
        [window, 'pageshow'],
    ];
    update();
    for (const [target, event] of events) target.addEventListener(event, schedule, { passive: true });
    return () => {
        window.cancelAnimationFrame(frame);
        for (const [target, event] of events) target.removeEventListener(event, schedule);
        probe.remove();
        document.documentElement.style.removeProperty(property);
    };
}
