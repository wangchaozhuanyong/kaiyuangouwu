import { type ReactNode, useLayoutEffect, useRef } from 'react';

import { type StorefrontCouponCard } from '../../storefront-coupons';
import '../../styles/desktop-coupon-ticket.css';

/** Presentation only. Callers retain eligibility, pricing and mutation handlers. */
export function DesktopCouponTicket({
    card,
    action,
    meta,
    scope,
    variant = 'full',
    selected = false,
    unavailable = false,
    historical = false,
    role,
}: {
    card: StorefrontCouponCard;
    action: ReactNode;
    meta?: ReactNode;
    scope?: string;
    variant?: 'compact' | 'full';
    selected?: boolean;
    unavailable?: boolean;
    historical?: boolean;
    role?: 'listitem';
}) {
    const approximateValue = historical ? undefined : card.approximateValue;
    const exactAmount = `${card.unit}${card.value}`;
    return (
        <article
            className={`desktop-coupon-ticket coupon-face-${card.theme} coupon-variant-${variant}${selected ? ' is-selected' : ''}${
                unavailable ? ' is-unavailable' : ''
            }${historical ? ' is-history' : ''}`}
            role={role}
        >
            <div className="desktop-coupon-main">
                <div className="desktop-coupon-value">
                    <CouponValueLine
                        className={card.unitBefore ? 'is-unit-before' : undefined}
                        label={card.unitBefore ? exactAmount : `${card.value}${card.unit}`}
                    >
                        {approximateValue && <small>{approximateValue.label}</small>}
                        {card.unitBefore && <small>{card.unit}</small>}
                        <strong>{approximateValue?.value ?? card.value}</strong>
                        {!card.unitBefore && card.unit && <small>{card.unit}</small>}
                    </CouponValueLine>
                    <span>{card.tag}</span>
                    {approximateValue && (
                        <CouponValueLine className="desktop-coupon-exact-amount" label={exactAmount}>
                            {exactAmount}
                        </CouponValueLine>
                    )}
                </div>
                <div className="desktop-coupon-info">
                    <strong title={card.title}>{card.title}</strong>
                    <CouponValueLine className="desktop-coupon-threshold" label={card.description}>
                        {card.description}
                    </CouponValueLine>
                    {(scope ?? card.scope) && (
                        <span className="desktop-coupon-scope" title={scope ?? card.scope}>
                            {scope ?? card.scope}
                        </span>
                    )}
                </div>
                <div className="desktop-coupon-action">{action}</div>
            </div>
            {variant === 'full' && meta && <div className="desktop-coupon-meta">{meta}</div>}
        </article>
    );
}

/** Fit text inside its existing column; never change the ticket's three-column geometry. */
function CouponValueLine({
    children,
    className = '',
    label,
}: {
    children: ReactNode;
    className?: string;
    label: string;
}) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        const text = textRef.current;
        if (!viewport || !text) return;
        let active = true;
        const fit = () => {
            if (!active || viewport.clientWidth === 0 || text.scrollWidth === 0) return;
            const scale = Math.min(1, viewport.clientWidth / text.scrollWidth);
            text.style.transform = scale < 1 ? `scale(${scale})` : '';
        };
        fit();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
        observer?.observe(viewport);
        observer?.observe(text);
        void document.fonts?.ready.then(fit);
        return () => {
            active = false;
            observer?.disconnect();
        };
    }, [children, label]);
    return (
        <div className={`desktop-coupon-value-line ${className}`} ref={viewportRef} title={label}>
            <span className="desktop-coupon-value-text" ref={textRef}>
                {children}
            </span>
        </div>
    );
}
