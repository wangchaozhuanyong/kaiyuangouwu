import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

export function AccountOrderCarousel({ children, isZh }: { children: ReactNode; isZh: boolean }) {
    const scrollerRef = useRef<HTMLElement>(null);
    const scrollerId = useId();
    const [edges, setEdges] = useState({ previous: false, next: false });
    const updateEdges = useCallback(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const previous = scroller.scrollLeft > 1;
        const next = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
        setEdges(current =>
            current.previous === previous && current.next === next ? current : { previous, next },
        );
    }, []);

    useEffect(() => {
        updateEdges();
        const scroller = scrollerRef.current;
        if (!scroller) return;
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateEdges);
            return () => window.removeEventListener('resize', updateEdges);
        }
        const observer = new ResizeObserver(updateEdges);
        observer.observe(scroller);
        return () => observer.disconnect();
    }, [updateEdges]);

    const move = (direction: number) => {
        const scroller = scrollerRef.current;
        const card = scroller?.querySelector('button');
        if (!scroller || !card) return;
        const gap = Number.parseFloat(getComputedStyle(scroller).columnGap) || 0;
        scroller.scrollBy({
            left: direction * (card.getBoundingClientRect().width + gap),
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
    };

    return (
        <div className="account-order-carousel">
            <nav
                id={scrollerId}
                ref={scrollerRef}
                className="account-order-shortcuts"
                aria-label={isZh ? '订单快捷入口' : 'Order shortcuts'}
                onScroll={updateEdges}
            >
                {children}
            </nav>
            {(edges.previous || edges.next) && (
                <div className="account-order-carousel-controls">
                    <small>{isZh ? '左右滑动查看' : 'Swipe to browse'}</small>
                    <button
                        type="button"
                        aria-label={isZh ? '向左滑动订单入口' : 'Scroll order shortcuts left'}
                        aria-controls={scrollerId}
                        disabled={!edges.previous}
                        onClick={() => move(-1)}
                    >
                        <ChevronLeft aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        aria-label={isZh ? '向右滑动订单入口' : 'Scroll order shortcuts right'}
                        aria-controls={scrollerId}
                        disabled={!edges.next}
                        onClick={() => move(1)}
                    >
                        <ChevronRight aria-hidden="true" />
                    </button>
                </div>
            )}
        </div>
    );
}
