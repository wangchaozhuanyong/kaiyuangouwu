import { type ReactNode, useRef } from 'react';

export function AccountOrderCarousel({ children, isZh }: { children: ReactNode; isZh: boolean }) {
    const scrollerRef = useRef<HTMLElement>(null);
    const revealShortcut = (target: EventTarget | null) => {
        const scroller = scrollerRef.current;
        if (!scroller || !(target instanceof Element)) return;
        const button = target.closest('button');
        if (!button || button.parentElement !== scroller) return;
        const viewport = scroller.getBoundingClientRect();
        const card = button.getBoundingClientRect();
        const style = getComputedStyle(scroller);
        const start = viewport.left + (Number.parseFloat(style.scrollPaddingInlineStart) || 0);
        const end = viewport.right - (Number.parseFloat(style.scrollPaddingInlineEnd) || 0);
        const left = card.left < start ? card.left - start : card.right > end ? card.right - end : 0;
        if (Math.abs(left) < 1) return;
        scroller.scrollBy({
            left,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
    };

    return (
        <div className="account-order-carousel">
            <nav
                ref={scrollerRef}
                className="account-order-shortcuts"
                aria-label={isZh ? '订单快捷入口' : 'Order shortcuts'}
                onClickCapture={event => revealShortcut(event.target)}
                onFocusCapture={event => revealShortcut(event.target)}
            >
                {children}
            </nav>
        </div>
    );
}
