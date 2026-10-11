import { type PointerEvent, type ReactNode, useRef, useState } from 'react';

/** Native touch scrolling; mouse dragging must never replay a claim click. */
export function HomepageCouponRail({ children, isZh }: { children: ReactNode; isZh: boolean }) {
    const gesture = useRef<{ id: number; x: number; y: number; scroll: number; moved: boolean } | null>(null);
    const suppressClick = useRef(false);
    const [dragging, setDragging] = useState(false);
    const finish = (event: PointerEvent<HTMLDivElement>) => {
        if (gesture.current?.id !== event.pointerId) return;
        suppressClick.current = gesture.current.moved;
        gesture.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };
    return (
        <div
            className={`coupon-hub-scroll${dragging ? ' is-dragging' : ''}`}
            role="list"
            tabIndex={0}
            aria-label={
                isZh ? '优惠券，可左右滑动或按左右方向键' : 'Coupons: scroll or use left and right arrow keys'
            }
            onPointerDown={event => {
                suppressClick.current = false;
                if (event.pointerType !== 'mouse' || event.button !== 0) return;
                if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                gesture.current = {
                    id: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    scroll: event.currentTarget.scrollLeft,
                    moved: false,
                };
            }}
            onPointerMove={event => {
                const current = gesture.current;
                if (!current || current.id !== event.pointerId) return;
                const dx = event.clientX - current.x;
                if (!current.moved) {
                    if (Math.max(Math.abs(dx), Math.abs(event.clientY - current.y)) < 6) return;
                    if (Math.abs(event.clientY - current.y) > Math.abs(dx)) {
                        gesture.current = null;
                        return;
                    }
                    current.moved = true;
                    suppressClick.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragging(true);
                }
                event.preventDefault();
                event.currentTarget.scrollLeft = current.scroll - dx;
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
            onClickCapture={event => {
                if (!suppressClick.current || event.detail === 0) return;
                suppressClick.current = false;
                event.preventDefault();
                event.stopPropagation();
            }}
            onKeyDown={event => {
                if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight'].includes(event.key))
                    return;
                event.preventDefault();
                const rail = event.currentTarget;
                const card = rail.firstElementChild;
                const step =
                    (card?.getBoundingClientRect().width ?? rail.clientWidth) +
                    (parseFloat(getComputedStyle(rail).columnGap) || 0);
                rail.scrollBy({
                    left: event.key === 'ArrowRight' ? step : -step,
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'auto'
                        : 'smooth',
                });
            }}
        >
            {children}
        </div>
    );
}
