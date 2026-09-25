import { type ReactNode } from 'react';

import { type StorefrontCouponCard } from '../../storefront-coupons';
import '../../styles/desktop-coupon-ticket.css';

/** Presentation only. Callers retain eligibility, pricing and mutation handlers. */
export function DesktopCouponTicket({
    card,
    action,
    meta,
    selected = false,
    unavailable = false,
    role,
}: {
    card: StorefrontCouponCard;
    action: ReactNode;
    meta?: string;
    selected?: boolean;
    unavailable?: boolean;
    role?: 'listitem';
}) {
    return (
        <article
            className={`desktop-coupon-ticket coupon-face-${card.theme}${selected ? ' is-selected' : ''}${unavailable ? ' is-unavailable' : ''}`}
            role={role}
        >
            <div className="desktop-coupon-value">
                <div>
                    {card.unitBefore && <small>{card.unit}</small>}
                    <strong>{card.value}</strong>
                    {!card.unitBefore && card.unit && <small>{card.unit}</small>}
                </div>
                <span>{card.description}</span>
            </div>
            <div className="desktop-coupon-info">
                <strong>{card.title}</strong>
                <span>{card.tag}</span>
                {meta && <small>{meta}</small>}
                <div className="desktop-coupon-action">{action}</div>
            </div>
        </article>
    );
}
