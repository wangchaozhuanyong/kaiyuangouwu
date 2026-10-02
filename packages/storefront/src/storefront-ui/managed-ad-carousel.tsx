import { MoveHorizontal } from 'lucide-react';
import {
    type ReactNode,
    type PointerEvent as ReactPointerEvent,
    useEffect,
    useId,
    useRef,
    useState,
} from 'react';

import { StorefrontLanguage } from '../types';

/** Loaded only by configured advertisement blocks; card content can render immediately. */
export default function ManagedAdCarouselRail({
    children,
    itemCount,
    title,
    language,
    seconds,
    productMedia,
}: {
    children: ReactNode;
    itemCount: number;
    title: string;
    language: StorefrontLanguage;
    seconds: number;
    productMedia: boolean;
}) {
    const railRef = useRef<HTMLDivElement>(null);
    const gestureRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        startScroll: number;
        lastX: number;
        lastTime: number;
        velocity: number;
        dragging: boolean;
    } | null>(null);
    const suppressClickRef = useRef(false);
    const instructionId = useId();
    const [current, setCurrent] = useState(0);
    const [paused, setPaused] = useState(false);
    const [overflowing, setOverflowing] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [manual, setManual] = useState(false);
    const selected = itemCount ? current % itemCount : 0;

    useEffect(() => {
        if (
            itemCount < 2 ||
            paused ||
            manual ||
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
        )
            return;
        const timer = window.setInterval(() => setCurrent(index => (index + 1) % itemCount), seconds * 1000);
        return () => window.clearInterval(timer);
    }, [itemCount, paused, manual, seconds]);

    useEffect(() => {
        const rail = railRef.current;
        if (!rail) return;
        const measure = () => setOverflowing(rail.scrollWidth > rail.clientWidth + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(rail);
        Array.from(rail.children).forEach(card => observer.observe(card));
        return () => observer.disconnect();
    }, [itemCount]);

    useEffect(() => {
        const rail = railRef.current;
        const card = rail?.children[selected] as HTMLElement | undefined;
        if (!rail || !card) return;
        rail.scrollTo({
            left: card.offsetLeft,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
    }, [selected]);

    const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        suppressClickRef.current = false;
        if (event.pointerType !== 'mouse') {
            setManual(true);
            return;
        }
        if (!overflowing || event.button !== 0 || !event.isPrimary) return;
        gestureRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startScroll: event.currentTarget.scrollLeft,
            lastX: event.clientX,
            lastTime: event.timeStamp,
            velocity: 0,
            dragging: false,
        };
    };

    const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        if (!gesture.dragging) {
            if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 6) return;
            if (Math.abs(deltaY) > Math.abs(deltaX)) {
                gestureRef.current = null;
                return;
            }
            gesture.dragging = true;
            setManual(true);
            setDragging(true);
            event.currentTarget.dataset.dragging = 'true';
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        event.preventDefault();
        const elapsed = event.timeStamp - gesture.lastTime;
        if (elapsed > 0) gesture.velocity = (gesture.lastX - event.clientX) / elapsed;
        gesture.lastX = event.clientX;
        gesture.lastTime = event.timeStamp;
        event.currentTarget.scrollLeft = gesture.startScroll - deltaX;
    };

    const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        const rail = event.currentTarget;
        if (!gesture.dragging) return;
        const releasedScroll = rail.scrollLeft;
        suppressClickRef.current = true;
        setDragging(false);
        delete rail.dataset.dragging;
        if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const velocity =
            event.type === 'pointerup' && event.timeStamp - gesture.lastTime < 100 ? gesture.velocity : 0;
        const projected =
            releasedScroll +
            (reducedMotion
                ? 0
                : Math.max(-rail.clientWidth / 2, Math.min(rail.clientWidth / 2, velocity * 140)));
        const maximum = Math.max(0, rail.scrollWidth - rail.clientWidth);
        const stops = [
            0,
            maximum,
            ...Array.from(rail.children, card => Math.min(maximum, (card as HTMLElement).offsetLeft)),
        ];
        const destination = stops.reduce(
            (closest, position) =>
                Math.abs(position - projected) < Math.abs(closest - projected) ? position : closest,
            0,
        );
        rail.scrollTo({ left: destination, behavior: reducedMotion ? 'auto' : 'smooth' });
    };

    if (!itemCount) return null;
    return (
        <div
            className={[
                'managed-ad-carousel',
                productMedia && 'is-product-carousel',
                overflowing && 'has-overflow',
                dragging && 'is-dragging',
                manual && 'is-manual',
            ]
                .filter(Boolean)
                .join(' ')}
            role="region"
            aria-label={title}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
            }}
        >
            <span id={instructionId} className="visually-hidden">
                {language === 'zh'
                    ? '按住拖动或左右滑动浏览，方向键切换，Home 和 End 到达首尾。'
                    : 'Drag or swipe to browse. Use arrow keys to move, Home and End to reach either end.'}
            </span>
            {overflowing && (
                <span className="managed-ad-drag-hint" aria-hidden="true">
                    <MoveHorizontal size={16} />
                    {language === 'zh'
                        ? dragging
                            ? '松手停靠'
                            : '拖动浏览'
                        : dragging
                          ? 'Release to settle'
                          : 'Drag to explore'}
                </span>
            )}
            <div
                className="managed-ad-carousel-rail"
                ref={railRef}
                tabIndex={overflowing ? 0 : undefined}
                role="group"
                aria-label={language === 'zh' ? '横向浏览卡片' : 'Browse cards horizontally'}
                aria-describedby={overflowing ? instructionId : undefined}
                onPointerDown={beginDrag}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onLostPointerCapture={finishDrag}
                onPointerLeave={() => {
                    if (gestureRef.current && !gestureRef.current.dragging) gestureRef.current = null;
                }}
                onDragStart={event => event.preventDefault()}
                onClickCapture={event => {
                    if (suppressClickRef.current && event.detail !== 0) {
                        event.preventDefault();
                        event.stopPropagation();
                        suppressClickRef.current = false;
                    }
                }}
                onWheelCapture={event => {
                    if (event.deltaX !== 0 || event.shiftKey) setManual(true);
                }}
                onKeyDown={event => {
                    if (!overflowing || event.altKey || event.ctrlKey || event.metaKey) return;
                    const rail = event.currentTarget;
                    const cards = Array.from(rail.children) as HTMLElement[];
                    const focused = cards.indexOf(document.activeElement as HTMLElement);
                    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
                    event.preventDefault();
                    setManual(true);
                    const index =
                        event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? cards.length - 1
                              : focused >= 0
                                ? Math.max(0, Math.min(cards.length - 1, focused + direction))
                                : -1;
                    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'auto'
                        : 'smooth';
                    if (index >= 0) {
                        cards[index].focus({ preventScroll: true });
                        rail.scrollTo({ left: cards[index].offsetLeft, behavior });
                    } else {
                        rail.scrollBy({
                            left: direction * ((cards[0]?.offsetWidth ?? rail.clientWidth) + 12),
                            behavior,
                        });
                    }
                }}
            >
                {children}
            </div>
        </div>
    );
}
