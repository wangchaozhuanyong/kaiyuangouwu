// Browser toolbars also resize the visual viewport. Only a substantial height
// loss while editing should activate keyboard avoidance.
const MIN_KEYBOARD_OCCLUSION = 150;

function hasKeyboardFocus(): boolean {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element.inputMode === 'none') return false;
    if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
    if (element instanceof HTMLInputElement) {
        return (
            !element.readOnly &&
            !element.disabled &&
            ['text', 'search', 'email', 'number', 'password', 'tel', 'url'].includes(element.type)
        );
    }
    return element.isContentEditable;
}

/** Native fixed positioning for browsing; shared keyboard avoidance while editing. */
export function trackFixedBottomViewport(): () => void {
    const viewport = window.visualViewport;
    if (!viewport) return () => undefined;

    // Measure native fixed positioning independently of our correction, so a
    // browser that already moves fixed controls above the keyboard is not adjusted twice.
    const probe = document.createElement('div');
    probe.className = 'storefront-viewport-probe';
    probe.setAttribute('aria-hidden', 'true');
    document.body.append(probe);
    const property = '--storefront-viewport-bottom-offset';
    let frame = 0;
    let previous = 0;
    const update = () => {
        frame = 0;
        const keyboardOccludesViewport =
            window.innerWidth < 1024 &&
            viewport.scale === 1 &&
            viewport.height > 0 &&
            hasKeyboardFocus() &&
            Math.max(window.innerHeight, document.documentElement.clientHeight) - viewport.height >
                MIN_KEYBOARD_OCCLUSION;
        // During ordinary scrolling the browser owns the fixed edge. Its toolbar
        // and visualViewport updates may arrive on different frames; using that
        // transient difference as bottom would make the navigation jump upwards.
        const offset = keyboardOccludesViewport
            ? Math.max(
                  0,
                  Math.round(probe.getBoundingClientRect().bottom - viewport.offsetTop - viewport.height),
              )
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
        [document, 'focusin'],
        [document, 'focusout'],
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
