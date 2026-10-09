import { type ReactNode } from 'react';

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
    return (
        <article
            className={`desktop-coupon-ticket coupon-face-${card.theme} coupon-variant-${variant}${selected ? ' is-selected' : ''}${
                unavailable ? ' is-unavailable' : ''
            }${historical ? ' is-history' : ''}${card.value.length > 5 ? ' has-long-value' : ''}`}
            role={role}
        >
            <div className="desktop-coupon-main">
                <div className="desktop-coupon-value">
                    <div className={card.unitBefore ? 'is-unit-before' : undefined}>
                        {card.unitBefore && <small>{card.unit}</small>}
                        <strong>{card.value}</strong>
                        {!card.unitBefore && card.unit && <small>{card.unit}</small>}
                    </div>
                    <span>{card.tag}</span>
                </div>
                <div className="desktop-coupon-info">
                    <strong>{card.title}</strong>
                    <span className="desktop-coupon-threshold">{card.description}</span>
                    {(scope ?? card.scope) && (
                        <span className="desktop-coupon-scope">{scope ?? card.scope}</span>
                    )}
                </div>
                <div className="desktop-coupon-action">{action}</div>
            </div>
            {variant === 'full' && meta && <div className="desktop-coupon-meta">{meta}</div>}
        </article>
    );
}
