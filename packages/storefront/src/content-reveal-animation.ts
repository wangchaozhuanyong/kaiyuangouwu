export type ContentEntrance = 'first' | 'return';

/** Remembers presentation history only. Refreshes never become another entrance. */
export function createContentRevealController(reveal = revealContentRegions) {
    const displayed = new Set<string>();
    let activeKey: string | undefined;
    let waiting = false;
    let entering = false;
    let adopted = false;
    let previousPage = false;
    let stop: () => void = () => undefined;
    const remember = (key: string) => {
        displayed.add(key);
        const oldest = displayed.values().next().value;
        if (displayed.size > 64 && oldest !== undefined) displayed.delete(oldest);
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
                previousPage = activeKey !== undefined;
                adopted = !previousPage && skip;
                activeKey = key;
                waiting = false;
                entering = true;
            }
            if (failed) {
                stop();
                return;
            }
            if (!ready) {
                stop();
                waiting = true;
                return;
            }
            if (entering && !adopted) {
                if (waiting && !displayed.has(key)) stop = reveal(root, 'first');
                else if (previousPage) stop = reveal(root, 'return');
            }
            entering = false;
            waiting = false;
            remember(key);
        },
        dispose() {
            stop();
        },
    };
}

/** A bounded presentation effect. It never controls query state, focus or clickability. */
export function revealContentRegions(root: HTMLElement, entrance: ContentEntrance = 'first'): () => void {
    if (
        typeof root.animate !== 'function' ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
        window.scrollY > 0
    )
        return () => undefined;

    const content = root.querySelector<HTMLElement>('#storefront-content') ?? root;
    const explicit = Array.from(content.querySelectorAll<HTMLElement>('[data-content-reveal]')).filter(
        element => !element.closest('[hidden], [inert], [aria-hidden="true"]'),
    );
    const splitFixedOwners = (element: HTMLElement): HTMLElement[] => {
        if (element.querySelector('.page-action-bar, header.topbar, [role="dialog"], .sheet-layer'))
            return Array.from(element.children).flatMap(child =>
                child instanceof HTMLElement ? splitFixedOwners(child) : [],
            );
        return [element];
    };
    const candidates = explicit.length
        ? explicit
        : Array.from(content.querySelectorAll<HTMLElement>('main.page')).flatMap(page =>
              Array.from(page.children).flatMap(element =>
                  element instanceof HTMLElement ? splitFixedOwners(element) : [],
              ),
          );
    const regions = candidates
        .filter(element => {
            // Headers, fixed actions, primary media and overlay owners never join body entrances.
            if (
                element.matches(
                    'header, footer, img, picture, .topbar, .page-action-bar, [role="dialog"], .sheet-layer',
                ) ||
                element.querySelector('img[fetchpriority="high"]') ||
                ['fixed', 'sticky'].includes(getComputedStyle(element).position)
            )
                return false;
            // A region may be mounted inside a retained route or still contain a local skeleton.
            if (
                element.closest('[hidden], [inert], [aria-hidden="true"]') ||
                element.matches('[data-page-pending]') ||
                element.querySelector('[data-page-pending], [aria-busy="true"]') ||
                element.contains(document.activeElement)
            )
                return false;
            // Catalogs restore their own reading pane, independently of window.scrollY.
            for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
                if (parent.scrollTop > 0) return false;
                if (parent === root) break;
            }
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
    const returning = entrance === 'return';
    const duration = milliseconds(
        returning ? '--experience-return-duration' : '--experience-reveal-duration',
        returning ? 180 : 320,
    );
    const stagger = milliseconds(
        returning ? '--experience-return-stagger' : '--experience-reveal-stagger',
        returning ? 20 : 40,
    );
    const distance =
        style
            .getPropertyValue(returning ? '--experience-return-distance' : '--experience-reveal-distance')
            .trim() || (returning ? '4px' : '8px');
    const easing =
        style.getPropertyValue('--experience-reveal-easing').trim() || 'cubic-bezier(.22,.8,.24,1)';
    const animations = regions.map((element, index) =>
        element.animate(
            [
                { opacity: returning ? 0.94 : 0, transform: `translateY(-${distance})` },
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
