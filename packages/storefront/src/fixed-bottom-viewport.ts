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

/** Actual fixed surfaces own clearance; keyboard positioning never changes document height. */
export function trackFixedBottomBars(): () => void {
    const clearance = '--page-bottom-measured-clearance';
    const pages = new Set<HTMLElement>();
    const observed = new Set<HTMLElement>();
    let frame = 0;
    let disposed = false;
    const visible = (element: HTMLElement) => {
        if (element.closest('[hidden]')) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const fixedHeight = (element: HTMLElement) => {
        if (!visible(element) || getComputedStyle(element).position !== 'fixed') return 0;
        const style = getComputedStyle(element);
        const keyboardOffset =
            Number.parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue(
                    '--storefront-viewport-bottom-offset',
                ),
            ) || 0;
        // The measured height already includes the lowest surface's safe-area padding.
        return (
            element.getBoundingClientRect().height +
            Math.max(0, (Number.parseFloat(style.bottom) || 0) - keyboardOffset)
        );
    };
    const schedule = () => {
        if (!disposed && !frame) frame = window.requestAnimationFrame(update);
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    const update = () => {
        frame = 0;
        const bars = [
            ...document.querySelectorAll<HTMLElement>(
                '.page-action-bar, .address-use-bar, .storefront-bottom-nav',
            ),
        ];
        const nextObserved = new Set(bars);
        for (const element of observed) {
            if (!nextObserved.has(element)) {
                observer?.unobserve(element);
                observed.delete(element);
            }
        }
        for (const element of bars) {
            if (!observed.has(element)) {
                observer?.observe(element);
                observed.add(element);
            }
        }
        const navigationHeight = Math.max(
            0,
            ...bars.filter(bar => bar.matches('.storefront-bottom-nav')).map(fixedHeight),
        );
        const nextPages = new Set(
            document.querySelectorAll<HTMLElement>('.storefront-app .page, .storefront-app .subpage'),
        );
        for (const page of pages) {
            if (!nextPages.has(page)) {
                page.style.removeProperty(clearance);
                pages.delete(page);
            }
        }
        for (const page of nextPages) {
            pages.add(page);
            const height = visible(page)
                ? Math.max(
                      navigationHeight,
                      0,
                      ...bars.filter(bar => bar.closest('.page, .subpage') === page).map(fixedHeight),
                  )
                : 0;
            const value = `${Math.ceil(height)}px`;
            if (page.style.getPropertyValue(clearance) !== value) page.style.setProperty(clearance, value);
        }
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'hidden', 'inert'],
    });
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('pageshow', schedule, { passive: true });
    update();
    return () => {
        disposed = true;
        window.cancelAnimationFrame(frame);
        mutations.disconnect();
        observer?.disconnect();
        window.removeEventListener('resize', schedule);
        window.removeEventListener('pageshow', schedule);
        for (const page of pages) page.style.removeProperty(clearance);
    };
}
