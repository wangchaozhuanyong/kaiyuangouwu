interface ScrollLockSnapshot {
    documentOverflow: string;
    bodyOverflow: string;
    bodyPaddingRight: string;
}

let activeLocks = 0;
let snapshot: ScrollLockSnapshot | null = null;

/**
 * Locks the document without changing the layout width when a native scrollbar
 * is present. The returned release function is idempotent and supports nested
 * sheets/modals rendered by different storefront features.
 */
export function acquireBodyScrollLock(): () => void {
    if (typeof document === 'undefined') return () => undefined;

    if (activeLocks === 0) {
        const documentElement = document.documentElement;
        const body = document.body;
        const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth);

        snapshot = {
            documentOverflow: documentElement.style.overflow,
            bodyOverflow: body.style.overflow,
            bodyPaddingRight: body.style.paddingRight,
        };

        // Keep the content's visual width stable on browsers where
        // scrollbar-gutter is unavailable or not applied to the root scroller.
        if (scrollbarWidth > 0) {
            const existingPadding = body.style.paddingRight || '0px';
            body.style.paddingRight = `calc(${existingPadding} + ${scrollbarWidth}px)`;
        }

        documentElement.style.overflow = 'hidden';
        body.style.overflow = 'hidden';
    }

    activeLocks += 1;
    let released = false;

    return () => {
        if (released) return;
        released = true;
        activeLocks -= 1;

        if (activeLocks > 0 || !snapshot) return;

        const documentElement = document.documentElement;
        const body = document.body;
        documentElement.style.overflow = snapshot.documentOverflow;
        body.style.overflow = snapshot.bodyOverflow;
        body.style.paddingRight = snapshot.bodyPaddingRight;
        snapshot = null;
    };
}
