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
        const originalLayoutWidth = documentElement.getBoundingClientRect().width;

        snapshot = {
            documentOverflow: documentElement.style.overflow,
            bodyOverflow: body.style.overflow,
            bodyPaddingRight: body.style.paddingRight,
        };

        documentElement.style.overflow = 'hidden';
        body.style.overflow = 'hidden';

        // Compensate only for width actually released by the lock. A stable
        // root gutter already preserves it, so adding padding again would jump.
        const scrollbarWidth = Math.max(
            0,
            documentElement.getBoundingClientRect().width - originalLayoutWidth,
        );
        if (scrollbarWidth > 0) {
            const existingPadding = body.style.paddingRight || '0px';
            body.style.paddingRight = `calc(${existingPadding} + ${scrollbarWidth}px)`;
        }
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
