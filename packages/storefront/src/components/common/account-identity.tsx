import { ChevronRight, Heart, Share2, TicketPercent, UsersRound } from 'lucide-react';

import { SafeImage } from '../../safe-image';
import { type RouteState } from '../../storefront-router';
import { formatMoney } from '../../storefront-ui/product-display';
import { type ActiveCustomer, type StorefrontLanguage } from '../../types';

export function maskedAccountEmail(email: string): string {
    const separator = email.lastIndexOf('@');
    if (separator <= 0 || separator === email.length - 1) return '•••';
    return `${email.slice(0, Math.min(2, separator))}***${email.slice(separator)}`;
}

export function AccountIdentity({
    customer,
    storefrontName,
    language,
    favoriteCount,
    couponCount,
    referralEnabled,
    referralPending,
    referralBalance,
    currencyCode,
    locale,
    navigate,
}: {
    customer: ActiveCustomer | null;
    storefrontName: string;
    language: StorefrontLanguage;
    favoriteCount: number;
    couponCount: number;
    referralEnabled: boolean;
    referralPending: boolean;
    referralBalance: number | undefined;
    currencyCode: string;
    locale: string;
    navigate: (route: RouteState) => void;
}) {
    const isZh = language === 'zh';
    const name = customer
        ? `${customer.lastName}${customer.firstName}`.trim() || (isZh ? '会员' : 'Member')
        : storefrontName;
    const open = (route: RouteState) => navigate(customer ? route : { name: 'login' });
    const promotionLabel = !customer
        ? isZh
            ? '登录查看'
            : 'Sign in'
        : referralPending
          ? isZh
              ? '加载中'
              : 'Loading'
          : referralEnabled
            ? isZh
                ? '查看'
                : 'View'
            : isZh
              ? '暂未开放'
              : 'Unavailable';

    return (
        <div className="account-identity">
            <section className="account-identity-card" aria-label={isZh ? '账户信息' : 'Account details'}>
                <div className="account-identity-welcome">
                    <span>
                        {isZh ? (customer ? '欢迎回来' : '欢迎您') : customer ? 'Welcome back' : 'Welcome'}
                    </span>
                    {customer && (
                        <button
                            type="button"
                            className="account-identity-edit"
                            onClick={() => navigate({ name: 'account-security' })}
                        >
                            {isZh ? '个人资料' : 'Your profile'}
                            <ChevronRight aria-hidden="true" />
                        </button>
                    )}
                </div>
                <div className="account-identity-person">
                    <button
                        type="button"
                        className="account-identity-avatar"
                        aria-label={isZh ? '个人信息与安全' : 'Profile and security'}
                        onClick={() => open({ name: 'account-security' })}
                    >
                        {customer?.avatar?.preview ? (
                            <SafeImage src={customer.avatar.preview} alt="" />
                        ) : (
                            Array.from(name)[0]?.toUpperCase()
                        )}
                    </button>
                    <div className="account-identity-details">
                        <h2>{name}</h2>
                        <p>
                            {customer
                                ? `${isZh ? '账号：' : 'Account: '}${maskedAccountEmail(customer.emailAddress)}`
                                : isZh
                                  ? '登录后管理订单与专属优惠'
                                  : 'Sign in to manage orders and offers'}
                        </p>
                    </div>
                </div>
                <p className="account-identity-description">
                    {isZh
                        ? '您的订单、优惠和分享，都在这里。'
                        : 'Your orders, offers and sharing, in one place.'}
                </p>
                {customer ? (
                    <div
                        className="account-identity-assets"
                        role="group"
                        aria-label={isZh ? '账户快捷入口' : 'Account shortcuts'}
                    >
                        <button type="button" onClick={() => open({ name: 'favorites' })}>
                            <span>
                                <Heart aria-hidden="true" />
                                <strong>{favoriteCount}</strong>
                            </span>
                            <small>{isZh ? '我的收藏' : 'Favorites'}</small>
                        </button>
                        <button type="button" onClick={() => open({ name: 'coupons' })}>
                            <span>
                                <TicketPercent aria-hidden="true" />
                                <strong>{couponCount}</strong>
                            </span>
                            <small>{isZh ? '优惠券' : 'Coupons'}</small>
                        </button>
                        <button
                            type="button"
                            disabled={referralPending || !referralEnabled}
                            onClick={() => open({ name: 'referral' })}
                        >
                            <span>
                                <Share2 aria-hidden="true" />
                                <strong className="account-identity-word">{promotionLabel}</strong>
                            </span>
                            <small>{isZh ? '推广中心' : 'Referrals'}</small>
                        </button>
                    </div>
                ) : (
                    <div className="account-identity-guest-actions">
                        <button type="button" onClick={() => navigate({ name: 'login' })}>
                            {isZh ? '立即登录' : 'Sign in'}
                        </button>
                        <button type="button" onClick={() => navigate({ name: 'register' })}>
                            {isZh ? '免费注册' : 'Register'}
                        </button>
                    </div>
                )}
            </section>
            {customer && referralEnabled && (
                <section
                    className="account-identity-promotion"
                    aria-label={isZh ? '邀请与推广' : 'Invite and share'}
                >
                    <div className="account-identity-promotion-title">
                        <span>
                            <UsersRound aria-hidden="true" />
                        </span>
                        <div>
                            <h3>{isZh ? '邀请好友，一起发现好物' : 'Invite friends to discover more'}</h3>
                            <p>{isZh ? '查看邀请记录与返利明细' : 'View invitations and reward details'}</p>
                        </div>
                    </div>
                    <div className="account-identity-promotion-actions">
                        <p>
                            {isZh ? '返利余额' : 'Referral balance'}
                            <strong>
                                {referralBalance == null
                                    ? '—'
                                    : formatMoney(referralBalance, currencyCode, locale)}
                            </strong>
                        </p>
                        <button type="button" onClick={() => navigate({ name: 'referral' })}>
                            {isZh ? '邀请好友' : 'Invite friends'}
                            <ChevronRight aria-hidden="true" />
                        </button>
                    </div>
                </section>
            )}
        </div>
    );
}
