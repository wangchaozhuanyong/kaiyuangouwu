import { ChevronRight, Heart, Share2, Smile, TicketPercent } from 'lucide-react';

import { SafeImage } from '../../safe-image';
import { type RouteState } from '../../storefront-router';
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
    referralBalanceStatus = referralBalance == null ? 'loading' : 'ready',
    onRetryReferral,
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
    referralBalanceStatus?: 'loading' | 'error' | 'ready';
    onRetryReferral?: () => void;
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
                    <div className="account-identity-greeting" aria-hidden="true">
                        <span>Hello!</span>
                        <small>NICE TO SEE YOU</small>
                        <Smile />
                    </div>
                </div>
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
                    <div className="account-identity-promotion-actions">
                        <button type="button" onClick={() => navigate({ name: 'referral' })}>
                            <Share2 aria-hidden="true" />
                            <span>{isZh ? '邀请好友' : 'Invite friends'}</span>
                            <ChevronRight aria-hidden="true" />
                        </button>
                        <div className="account-identity-promotion-balance" aria-live="polite">
                            <p>{isZh ? '返利余额' : 'Referral balance'}</p>
                            {referralBalanceStatus === 'ready' && referralBalance != null ? (
                                <strong>
                                    <span className="account-identity-promotion-currency">
                                        {currencyCode}
                                    </span>{' '}
                                    <span>
                                        {new Intl.NumberFormat(locale, {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                        }).format(referralBalance / 100)}
                                    </span>
                                </strong>
                            ) : (
                                <span className="account-identity-promotion-status">
                                    {referralBalanceStatus === 'error'
                                        ? isZh
                                            ? '暂不可用'
                                            : 'Unavailable'
                                        : isZh
                                          ? '加载中…'
                                          : 'Loading…'}
                                    {referralBalanceStatus === 'error' && onRetryReferral && (
                                        <button
                                            type="button"
                                            className="account-identity-promotion-retry"
                                            onClick={onRetryReferral}
                                        >
                                            {isZh ? '重试' : 'Retry'}
                                        </button>
                                    )}
                                </span>
                            )}
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}
