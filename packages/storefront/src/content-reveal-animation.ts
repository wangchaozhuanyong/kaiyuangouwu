/** Remembers only entrance history, never data. Cached returns and background reads stay still. */
export function createContentRevealController(reveal = revealContentRegions) {
    const displayed = new Set<string>();
    let activeKey: string | undefined;
    let waiting = false;
    let stop: () => void = () => undefined;
    const remember = (key: string) => {
        displayed.add(key);
        if (displayed.size > 64) {
            const oldest = displayed.values().next();
            if (!oldest.done) displayed.delete(oldest.value);
        }
    };
    return {
        update(
            root: HTMLElement,
            key: string,
            ready: boolean,
            skip = false,
            failed = false,
            reads?: ReadonlyMap<object, { presentation: string; failed: boolean }>,
        ) {
            // Child layout effects register before the boundary. Read the live map,
            // including when this optional module finishes loading between commits.
            for (const read of reads?.values() ?? []) {
                if (read.presentation !== 'optional') {
                    ready = false;
                    failed ||= read.failed;
                }
            }
            if (activeKey !== key) {
                stop();
                activeKey = key;
                waiting = false;
            }
            if (skip) remember(key);
            if (failed) {
                stop();
                return;
            }
            if (!ready) {
                stop();
                waiting = true;
                return;
            }
            if (waiting && !displayed.has(key)) stop = reveal(root);
            waiting = false;
            remember(key);
        },
        dispose() {
            stop();
        },
    };
}

/** A bounded presentation effect. It never controls query state, focus or clickability. */
export function revealContentRegions(root: HTMLElement): () => void {
    if (
        typeof root.animate !== 'function' ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
        window.scrollY > 0
    )
        return () => undefined;

    const content = root.querySelector<HTMLElement>('#storefront-content') ?? root;
    const regions = Array.from(content.querySelectorAll<HTMLElement>('[data-content-reveal]'))
        .filter(element => {
            // A region may be mounted inside a retained route or still contain a local skeleton.
            if (
                element.closest('[hidden], [inert], [aria-hidden="true"]') ||
                element.matches('[data-page-pending]') ||
                element.querySelector('[data-page-pending], [aria-busy="true"]') ||
                element.contains(document.activeElement)
            )
                return false;
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight;
        })
        // CSS order can differ from source order, especially on the shared homepage.
        .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)
        .filter(
            (element, index, elements) => !elements.slice(0, index).some(parent => parent.contains(element)),
        )
        .slice(0, 4);
    const style = getComputedStyle(root);
    // Production CSS may shorten 240ms to .24s. WAAPI always expects milliseconds.
    const milliseconds = (property: string, fallback: number) => {
        const value = style.getPropertyValue(property).trim();
        const amount = Number.parseFloat(value);
        if (!Number.isFinite(amount) || amount < 0) return fallback;
        return value.endsWith('ms') ? amount : value.endsWith('s') ? amount * 1000 : fallback;
    };
    const duration = milliseconds('--experience-motion-emphasized', 240);
    const stagger = milliseconds('--experience-motion-stagger', 60);
    const distance = style.getPropertyValue('--experience-reveal-distance').trim() || '6px';
    const easing =
        style.getPropertyValue('--experience-ease-standard').trim() || 'cubic-bezier(0.2, 0, 0, 1)';
    const animations = regions.map((element, index) =>
        element.animate(
            [
                { opacity: 0.94, transform: `translateY(${distance})` },
                { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration, delay: index * stagger, easing, fill: 'backwards' },
        ),
    );
    // Reading/interaction immediately wins over the remaining entrance, including restored scroll.
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const cancel = () => {
        animations.forEach(animation => animation.cancel());
        window.removeEventListener('scroll', cancel, true);
        window.removeEventListener('pointerdown', cancel);
        window.removeEventListener('keydown', cancel);
        motion?.removeEventListener('change', cancel);
    };
    if (animations.length) {
        window.addEventListener('scroll', cancel, { passive: true, once: true, capture: true });
        window.addEventListener('pointerdown', cancel, { passive: true, once: true });
        window.addEventListener('keydown', cancel, { once: true });
        motion?.addEventListener('change', cancel, { once: true });
        void Promise.all(animations.map(animation => animation.finished.catch(() => undefined))).then(cancel);
    }
    return cancel;
}
