interface CollapseOptions {
    root: HTMLElement;
    viewport: HTMLElement;
    navigation: HTMLElement;
    initialCollapsed?: boolean;
    onRemember?: (collapsed: boolean) => void;
    getLocks: () => { freeze: boolean; forceExpanded: boolean };
    onCollapsed: (collapsed: boolean) => void;
}

/** A bounded, interruptible mobile header motion. No catalog data or network work is owned here. */
export function bindCategoryNavigationCollapse({
    root,
    viewport,
    navigation,
    initialCollapsed,
    onRemember,
    getLocks,
    onCollapsed,
}: CollapseOptions) {
    const mobile = window.matchMedia('(max-width: 1023px)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let target = initialCollapsed === true;
    let fullHeight = navigation.getBoundingClientRect().height;
    let height = target ? 0 : fullHeight;
    let lastTop = root.scrollTop;
    let travel = 0;
    let intentUntil = 0;
    let compensationRemainder = 0;
    let animation: number | undefined;
    let scrollFrame: number | undefined;
    const previousAnchor = root.style.overflowAnchor;
    root.style.overflowAnchor = 'none';
    const top = () => Math.max(0, Math.min(root.scrollTop, root.scrollHeight - root.clientHeight));
    const stop = () => {
        if (animation !== undefined) cancelAnimationFrame(animation);
        animation = undefined;
    };
    const apply = (next: number, anchor: boolean) => {
        const before = top();
        const delta = next - height;
        viewport.style.height = `${next}px`;
        navigation.style.transform = `translateY(${next - fullHeight}px)`;
        height = next;
        if (anchor) {
            const desired = Math.max(0, before + delta + compensationRemainder);
            root.scrollTop = desired;
            compensationRemainder = Math.abs(desired - top()) < 1 ? desired - top() : 0;
            // Remove layout compensation from the next native scroll delta.
            lastTop += top() - before;
        } else {
            lastTop = top();
            compensationRemainder = 0;
        }
    };
    const change = (next: boolean, animate = true, anchor = true) => {
        if (!mobile.matches) next = false;
        if (next === target && animation === undefined && Math.abs(height - (next ? 0 : fullHeight)) < 1)
            return;
        stop();
        target = next;
        onCollapsed(next);
        onRemember?.(target);
        if (next && navigation.contains(document.activeElement))
            (document.activeElement as HTMLElement).blur();
        const from = height;
        const to = next ? 0 : fullHeight;
        const started = performance.now();
        const duration = next ? 200 : 240;
        const step = (now: number) => {
            const progress = Math.min(1, (now - started) / duration);
            apply(from + (to - from) * (1 - (1 - progress) ** 3), anchor);
            if (progress < 1) animation = requestAnimationFrame(step);
            else animation = undefined;
        };
        if (!animate || reduced.matches) apply(to, anchor);
        else animation = requestAnimationFrame(step);
    };
    const synchronizeLocks = () => {
        travel = 0;
        intentUntil = 0;
        lastTop = top();
        if (getLocks().forceExpanded) change(false, true, lastTop > 12);
    };
    const measure = () => {
        const measured = navigation.getBoundingClientRect().height;
        if (!mobile.matches) {
            stop();
            target = false;
            onCollapsed(false);
            viewport.style.height = '';
            navigation.style.transform = '';
            height = fullHeight = measured;
        } else if (Math.abs(measured - fullHeight) > 0.5 || !viewport.style.height) {
            stop();
            fullHeight = measured;
            apply(target ? 0 : fullHeight, top() > 12);
        }
        lastTop = top();
        travel = 0;
        if (mobile.matches && target && animation === undefined && root.scrollHeight <= root.clientHeight + 1)
            change(false, false, false);
    };
    const processScroll = () => {
        scrollFrame = undefined;
        const current = top();
        const delta = current - lastTop;
        lastTop = current;
        const focus = document.activeElement;
        const focusLocked =
            focus instanceof HTMLElement &&
            navigation.contains(focus) &&
            (focus.matches(':focus-visible') || focus.matches('input, textarea, [contenteditable="true"]'));
        if (
            !mobile.matches ||
            performance.now() > intentUntil ||
            getLocks().freeze ||
            getLocks().forceExpanded ||
            focusLocked ||
            root.scrollTop < 0 ||
            root.scrollTop > root.scrollHeight - root.clientHeight
        ) {
            travel = 0;
            return;
        }
        if (current <= 12) {
            travel = 0;
            change(false, true, false);
            return;
        }
        if (Math.abs(delta) < 0.5) return;
        travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
        if (travel >= 28 && current >= fullHeight + 28 && !target) {
            travel = 0;
            change(true);
        } else if (travel <= -12 && target) {
            travel = 0;
            change(false);
        }
    };
    const onScroll = () => {
        if (scrollFrame === undefined) scrollFrame = requestAnimationFrame(processScroll);
    };
    const onIntent = (event: Event) => {
        intentUntil = performance.now() + 2400;
        // A pointer gesture in the product list leaves the previously operated header.
        // Keyboard navigation retains its focused control until the user moves focus.
        if (event.type !== 'keydown' && navigation.contains(document.activeElement))
            (document.activeElement as HTMLElement).blur();
    };
    const onFocus = () => {
        if (target) change(false);
    };
    const onResize = () => {
        intentUntil = 0;
        measure();
    };
    if (mobile.matches) {
        viewport.style.height = `${height}px`;
        navigation.style.transform = `translateY(${height - fullHeight}px)`;
        onCollapsed(target);
    } else target = false;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(navigation);
    observer?.observe(root);
    const contents = new MutationObserver(measure);
    contents.observe(root, { childList: true, subtree: true });
    root.addEventListener('scroll', onScroll, { passive: true });
    const intentEvents = ['touchstart', 'touchmove', 'pointerdown', 'wheel', 'keydown'] as const;
    intentEvents.forEach(event => root.addEventListener(event, onIntent, { passive: true }));
    navigation.addEventListener('focusin', onFocus);
    window.addEventListener('resize', onResize);
    mobile.addEventListener?.('change', onResize);
    synchronizeLocks();
    return {
        synchronize: synchronizeLocks,
        dispose: () => {
            stop();
            if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
            observer?.disconnect();
            contents.disconnect();
            root.removeEventListener('scroll', onScroll);
            intentEvents.forEach(event => root.removeEventListener(event, onIntent));
            navigation.removeEventListener('focusin', onFocus);
            window.removeEventListener('resize', onResize);
            mobile.removeEventListener?.('change', onResize);
            root.style.overflowAnchor = previousAnchor;
        },
    };
}
