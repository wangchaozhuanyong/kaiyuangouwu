const VIEWPORT_GUTTER = 12;
const POPOVER_GAP = 8;

export interface FeatureHelpPosition {
    left: number;
    top: number;
    placement: 'above' | 'below';
}

export function calculateFeatureHelpPosition(
    triggerRect: Pick<DOMRect, 'bottom' | 'left' | 'top'>,
    viewport: { width: number; height: number },
    popover: { width: number; height: number },
): FeatureHelpPosition {
    const maxLeft = Math.max(VIEWPORT_GUTTER, viewport.width - popover.width - VIEWPORT_GUTTER);
    const left = Math.min(Math.max(VIEWPORT_GUTTER, triggerRect.left), maxLeft);
    const fitsBelow = triggerRect.bottom + POPOVER_GAP + popover.height <= viewport.height - VIEWPORT_GUTTER;
    const top = fitsBelow
        ? triggerRect.bottom + POPOVER_GAP
        : Math.max(VIEWPORT_GUTTER, triggerRect.top - POPOVER_GAP - popover.height);

    return { left, top, placement: fitsBelow ? 'below' : 'above' };
}
