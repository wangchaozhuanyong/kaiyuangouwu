import { CSSProperties, useContext, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { isFirstViewportElement } from './image-readiness';
import { ImageLanguageContext } from './safe-image';
import { StorefrontContext } from './StorefrontContext';
import { StorefrontLanguage } from './types';

import './image-recovery.css';

const IMAGE_RETRY_COOLDOWN_MS = 1_000;
const IMAGE_INTERACTIVE_ANCESTOR =
    'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable="true"]';

/** The visible part of a failed frame, including scroll containers and hidden slides. */
function visibleImageFrame(frame: HTMLElement) {
    if (frame.closest('[inert]') || !isFirstViewportElement(frame, document.documentElement)) return;
    const rect = frame.getBoundingClientRect();
    let left = Math.max(0, rect.left);
    let top = Math.max(0, rect.top);
    let right = Math.min(window.innerWidth, rect.right);
    let bottom = Math.min(window.innerHeight, rect.bottom);
    for (let node = frame.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const clip = node.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/u.test(style.overflowX || style.overflow)) {
            left = Math.max(left, clip.left);
            right = Math.min(right, clip.right);
        }
        if (/(hidden|clip|auto|scroll)/u.test(style.overflowY || style.overflow)) {
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
        }
    }
    return right > left && bottom > top
        ? { left, top, right, bottom, width: right - left, height: bottom - top }
        : undefined;
}

/** Keep retry outside an enclosing link/button, inside its existing dialog and stacking context. */
export default function ImageRecovery({
    frame,
    state,
    alt,
    language,
    onRetry,
}: {
    frame: HTMLSpanElement | null;
    state: { onlineRetried: boolean; nextManualAt: number };
    alt: string;
    language?: StorefrontLanguage;
    onRetry: () => void;
}) {
    const runtime = useContext(StorefrontContext);
    const frameLanguage = useContext(ImageLanguageContext);
    const isZh = (language ?? runtime?.language ?? frameLanguage ?? 'zh') === 'zh';
    const [cooling, setCooling] = useState(() => Date.now() < state.nextManualAt);
    useLayoutEffect(() => {
        const remaining = state.nextManualAt - Date.now();
        if (remaining <= 0) return;
        const timer = window.setTimeout(() => setCooling(false), remaining);
        return () => window.clearTimeout(timer);
    }, [state]);
    useLayoutEffect(() => {
        const reconnect = () => {
            if (state.onlineRetried || !frame || !visibleImageFrame(frame)) return;
            state.onlineRetried = true;
            onRetry();
        };
        window.addEventListener('online', reconnect);
        return () => window.removeEventListener('online', reconnect);
    }, [frame, state, onRetry]);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [placement, setPlacement] = useState<{ style?: CSSProperties; compact: boolean }>();
    let owner = frame?.parentElement?.closest<HTMLElement>(IMAGE_INTERACTIVE_ANCESTOR);
    let target = owner?.parentElement;
    while (target) {
        const enclosingOwner = target.closest<HTMLElement>(IMAGE_INTERACTIVE_ANCESTOR);
        if (!enclosingOwner) break;
        owner = enclosingOwner;
        target = owner.parentElement;
    }
    useLayoutEffect(() => {
        if (!frame) return;
        const position = () => {
            const rect = visibleImageFrame(frame);
            const retryButton = buttonRef.current;
            if (!rect || rect.width < 44 || rect.height < 44 || !retryButton) {
                if (retryButton) retryButton.hidden = true;
                setPlacement(undefined);
                return;
            }
            retryButton.hidden = false;
            const style: CSSProperties = {};
            if (target) {
                const parent =
                    retryButton.offsetParent instanceof HTMLElement ? retryButton.offsetParent : null;
                const origin = parent?.getBoundingClientRect();
                const scaleX = origin && parent?.offsetWidth ? origin.width / parent.offsetWidth : 1;
                const scaleY = origin && parent?.offsetHeight ? origin.height / parent.offsetHeight : 1;
                const x =
                    origin && parent
                        ? -origin.left / scaleX + parent.scrollLeft - parent.clientLeft
                        : window.scrollX;
                const y =
                    origin && parent
                        ? -origin.top / scaleY + parent.scrollTop - parent.clientTop
                        : window.scrollY;
                style.left = (rect.left + rect.width / 2) / scaleX + x;
                style.top = (rect.bottom - Math.min(8, (rect.height - 44) / 2)) / scaleY + y;
                style.bottom = 'auto';
                style.transform = 'translate(-50%, -100%)';
                style.maxWidth = rect.width / scaleX;
            }
            setPlacement({ style, compact: rect.width < 120 });
        };
        position();
        const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position);
        resize?.observe(frame);
        const intersection =
            typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(position);
        intersection?.observe(frame);
        const attributes =
            typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(position);
        for (let node: HTMLElement | null = frame; node; node = node.parentElement)
            attributes?.observe(node, {
                attributes: true,
                attributeFilter: ['hidden', 'aria-hidden', 'inert', 'style', 'class'],
            });
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        return () => {
            resize?.disconnect();
            intersection?.disconnect();
            attributes?.disconnect();
            window.removeEventListener('resize', position);
            window.removeEventListener('scroll', position, true);
        };
    }, [frame, target]);
    const button = (
        <button
            ref={buttonRef}
            type="button"
            className="safe-image-retry"
            hidden={!placement}
            style={placement?.style}
            disabled={cooling}
            aria-label={[alt, isZh ? '重试加载图片' : 'Retry loading image'].filter(Boolean).join(' · ')}
            onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                if (Date.now() < state.nextManualAt) return;
                state.nextManualAt = Date.now() + IMAGE_RETRY_COOLDOWN_MS;
                const focus = owner ?? frame;
                if (focus) {
                    if (!owner) focus.tabIndex = -1;
                    focus.focus({ preventScroll: true });
                }
                onRetry();
            }}
        >
            {isZh ? (placement?.compact ? '重试' : '重试图片') : placement?.compact ? 'Retry' : 'Retry image'}
        </button>
    );
    return target ? createPortal(button, target) : button;
}
