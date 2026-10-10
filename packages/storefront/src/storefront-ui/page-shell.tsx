import {
    ArrowLeft,
    Bell,
    ChevronRight,
    CircleAlert,
    Clock3,
    Flame,
    Headphones,
    Heart,
    LayoutGrid,
    Minus,
    Package,
    ShieldCheck,
    ShoppingBag,
    Sparkles,
    Star,
    Tag,
    WifiOff,
    X,
} from 'lucide-react';
import { CSSProperties, HTMLAttributes, ReactNode, Suspense, useId } from 'react';

import { ContentText } from '../../../storefront-content-plugin/src/shared/content-text';
import { BrandLoadingIndicator } from '../brand-loading';
import { CountBadge, countBadgeLabel } from '../components/common/count-badge';
import { PageBackButton } from '../components/common/page-back-button';
import { QueryLoadState } from '../loading-state';
import { Overlay } from '../overlay-host';
import { PageSkeleton } from '../route-loading';
import { routeFromLocation, RouteName } from '../storefront-router';
import { StorefrontContentBlock, StorefrontContentTargetType, StorefrontLanguage } from '../types';

import '../styles/right-drawer.css';

export function asyncRouteTitle(routeName: RouteName, language: StorefrontLanguage): string {
    const isZh = language === 'zh';
    const routeTitles: Partial<Record<RouteName, string>> = {
        account: isZh ? '我的账户' : 'Account',
        cart: isZh ? '购物车' : 'Cart',
        purchase: isZh ? '确认购买' : 'Confirm purchase',
        checkout: isZh ? '确认订单' : 'Review order',
        payment: isZh ? '选择支付方式' : 'Choose payment',
        'order-confirmation': isZh ? '订单已提交' : 'Order confirmed',
        orders: isZh ? '我的订单' : 'My orders',
        logistics: isZh ? '物流动态' : 'Delivery updates',
        'order-detail': isZh ? '订单详情' : 'Order details',
        addresses: isZh ? '地址管理' : 'Addresses',
        'account-security': isZh ? '账户与安全' : 'Account and security',
        notifications: isZh ? '消息通知' : 'Notifications',
        announcements: isZh ? '系统公告' : 'Announcements',
        coupons: isZh ? '优惠券' : 'Coupons',
        referral: isZh ? '邀请返利' : 'Referral rewards',
        'image-studio': isZh ? 'AI 图片工坊' : 'AI image studio',
        'two-factor': isZh ? '2FA 动态码' : '2FA codes',
        'mail-query': isZh ? '邮件验证码查询' : 'Mail verification',
        reviews: isZh ? '评价中心' : 'Reviews',
        login: isZh ? '登录' : 'Sign in',
        register: isZh ? '注册账户' : 'Create account',
        'verify-account': isZh ? '验证邮箱' : 'Verify email',
        'forgot-password': isZh ? '忘记密码' : 'Forgot password',
        'reset-password': isZh ? '重置密码' : 'Reset password',
    };
    return routeTitles[routeName] ?? (isZh ? '正在加载' : 'Loading');
}

function rootRouteSkeletonVariant(routeName: RouteName): 'account' | 'checkout' | null {
    if (routeName === 'account') return 'account';
    if (routeName === 'cart') return 'checkout';
    return null;
}

export function AsyncRouteStatePage({
    routeName,
    state,
    error,
    language,
    onBack,
    onRetry,
}: {
    routeName: RouteName;
    state: Exclude<QueryLoadState, 'ready'>;
    error: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onRetry: () => void;
}) {
    const isZh = language === 'zh';
    const title = asyncRouteTitle(routeName, language);
    const rootSkeletonVariant = rootRouteSkeletonVariant(routeName);
    const content =
        state === 'loading' ? (
            <PageSkeleton label={isZh ? '正在加载' : 'Loading'} variant={rootSkeletonVariant ?? 'default'} />
        ) : (
            <EmptyState
                icon={state === 'paused' ? <WifiOff /> : <CircleAlert />}
                title={
                    state === 'paused'
                        ? isZh
                            ? '网络连接已暂停'
                            : 'Connection paused'
                        : isZh
                          ? '页面数据加载失败'
                          : 'Could not load this page'
                }
                detail={error}
                action={isZh ? '重试' : 'Retry'}
                onAction={onRetry}
            />
        );

    if (rootSkeletonVariant) {
        return <main className="page route-state-page">{content}</main>;
    }

    return (
        <Subpage title={title} language={language} onBack={onBack}>
            {content}
        </Subpage>
    );
}

export function AuthPageBoundary({
    language,
    onBack,
    children,
}: {
    language: StorefrontLanguage;
    onBack: () => void;
    children: ReactNode;
}) {
    const title = asyncRouteTitle(routeFromLocation().name, language);
    return (
        <Suspense
            fallback={
                <Subpage title={title} language={language} onBack={onBack}>
                    <PageSkeleton label={language === 'zh' ? '正在加载页面' : 'Loading page'} />
                </Subpage>
            }
        >
            {children}
        </Suspense>
    );
}

/** Shared page inset and section rhythm; the page shell alone reserves its end gap. */
export function SubpageBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div {...props} className={`subpage-body${className ? ` ${className}` : ''}`} />;
}

export function Subpage({
    title,
    language,
    onBack,
    surfaceColor,
    className,
    children,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    surfaceColor?: string | null;
    className?: string;
    children: ReactNode;
}) {
    const surfaceStyle = surfaceColor?.trim()
        ? ({ '--page-surface': surfaceColor.trim() } as CSSProperties)
        : undefined;

    return (
        <main className={`page subpage${className ? ` ${className}` : ''}`} style={surfaceStyle}>
            <SubHeader title={title} language={language} onBack={onBack} />
            {children}
        </main>
    );
}

export function SubHeader({
    title,
    language,
    onBack,
    action,
    actionVisibility = 'all',
    className,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    action?: ReactNode;
    actionVisibility?: 'all' | 'mobile';
    className?: string;
}) {
    return (
        <header
            className={`topbar subpage-header${className ? ` ${className}` : ''}`}
            data-action-visibility={actionVisibility}
            data-desktop-actions={Boolean(action) && actionVisibility === 'all' ? true : undefined}
        >
            <PageBackButton onClick={onBack} label={language === 'zh' ? '返回' : 'Back'} />
            <strong>{title}</strong>
            <span className="subpage-header-actions">{action}</span>
        </header>
    );
}

export function NoticeButton({ language, onClick }: { language: StorefrontLanguage; onClick: () => void }) {
    return (
        <button
            className="notice-button"
            type="button"
            onClick={onClick}
            aria-label={language === 'zh' ? '通知' : 'Notifications'}
        >
            <Bell />
            <span className="notice-badge" aria-hidden="true" />
        </button>
    );
}

export function getSectionIcon(title?: string): ReactNode {
    if (!title) return null;
    if (/特惠|优惠|折扣|券|省钱/i.test(title)) return <Tag size={13} />;
    if (/热门|爆款|热销|推荐|人气/i.test(title)) return <Flame size={13} />;
    if (/精选|本周|新品|首发|挑选/i.test(title)) return <Sparkles size={13} />;
    if (/分类|全部|品类|探索/i.test(title)) return <LayoutGrid size={13} />;
    if (/服务|保障|售后|安全/i.test(title)) return <ShieldCheck size={13} />;
    if (/订单|历史|购买/i.test(title)) return <Package size={13} />;
    return <ShoppingBag size={13} />;
}

export type SectionKind =
    | 'coupons'
    | 'flash-sale'
    | 'best-sellers'
    | 'recommendations'
    | 'categories'
    | 'services'
    | 'history'
    | 'support'
    | 'orders';

/** Determined by module identity so merchant copy and language cannot change the icon. */
export function SectionIcon({ kind }: { kind: SectionKind }) {
    const tone = {
        coupons: 'coupon',
        'flash-sale': 'support',
        'best-sellers': 'coupon',
        recommendations: 'support',
        categories: 'security',
        services: 'mail',
        history: 'studio',
        support: 'support',
        orders: 'security',
    }[kind];
    const Icon = {
        coupons: Tag,
        'flash-sale': Clock3,
        'best-sellers': Star,
        recommendations: Heart,
        categories: LayoutGrid,
        services: ShieldCheck,
        history: Clock3,
        support: Headphones,
        orders: Package,
    }[kind];
    return (
        <span
            className="section-header-icon-pill"
            data-section-kind={kind}
            data-icon-tone={tone}
            aria-hidden="true"
        >
            <Icon />
        </span>
    );
}

export function SectionHeader({
    title,
    titleSuffix,
    subtitle,
    centerLabel,
    action,
    onAction,
    icon,
    subtitlePlacement = 'below',
    kind,
    endContent,
}: {
    title?: string;
    titleSuffix?: ReactNode;
    subtitle?: string;
    centerLabel?: string;
    action?: string;
    onAction?: () => void;
    icon?: ReactNode;
    subtitlePlacement?: 'below' | 'end';
    kind?: SectionKind;
    endContent?: ReactNode;
}) {
    const resolvedIcon = icon ?? getSectionIcon(title);
    const subtitleAtEnd = subtitlePlacement === 'end';
    return (
        <header className={`section-header${subtitleAtEnd ? ' has-end-subtitle' : ''}`}>
            {(title || (subtitle && !subtitleAtEnd)) && (
                <div className="section-header-title-lockup">
                    <div className="section-header-title-row">
                        {kind ? (
                            <SectionIcon kind={kind} />
                        ) : (
                            resolvedIcon && (
                                <span className="section-header-icon-pill" aria-hidden="true">
                                    {resolvedIcon}
                                </span>
                            )
                        )}
                        {title && <h2>{title}</h2>}
                        {titleSuffix}
                    </div>
                    {subtitle && !subtitleAtEnd ? <ContentText>{subtitle}</ContentText> : null}
                </div>
            )}
            {subtitle && subtitleAtEnd ? (
                <ContentText className="section-header-end-subtitle">{subtitle}</ContentText>
            ) : null}
            {centerLabel &&
                (title ? (
                    <span className="section-header-center-label">{centerLabel}</span>
                ) : (
                    <h2 className="section-header-center-label">{centerLabel}</h2>
                ))}
            {endContent}
            {action && (
                <button type="button" className="section-header-action-btn" onClick={onAction}>
                    <span>{action}</span>
                    <ChevronRight size={13} aria-hidden="true" />
                </button>
            )}
        </header>
    );
}

export function AccountShortcut({
    icon,
    label,
    count,
    tone,
    inlineCount = false,
    onClick,
}: {
    icon: ReactNode;
    label: string;
    count: number | undefined;
    tone?: 'pending' | 'shipping' | 'receiving' | 'completed' | 'reviews' | 'service';
    inlineCount?: boolean;
    onClick: () => void;
}) {
    const iconTone =
        tone === 'pending' || tone === 'reviews'
            ? 'coupon'
            : tone === 'shipping'
              ? 'security'
              : tone === 'receiving'
                ? 'studio'
                : tone === 'completed'
                  ? 'mail'
                  : 'support';
    return (
        <button
            type="button"
            onClick={onClick}
            data-order-status={tone}
            aria-label={inlineCount ? undefined : countBadgeLabel(label, count)}
        >
            <span data-icon-tone={iconTone}>
                {icon}
                {!inlineCount && <CountBadge count={count} overlay />}
            </span>
            <small>{label}</small>
            {inlineCount && <b className="desktop-shortcut-count">{count ?? '—'}</b>}
        </button>
    );
}

export function ServiceButton({
    icon,
    label,
    badge,
    tone,
    onClick,
}: {
    icon: ReactNode;
    label: string;
    badge?: number;
    tone?: 'security' | 'mail' | 'studio' | 'coupon' | 'support';
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-icon-tone={tone}
            aria-label={countBadgeLabel(label, badge)}
        >
            <span>
                {icon}
                <CountBadge count={badge} overlay />
            </span>
            <b>{label}</b>
        </button>
    );
}

function footerIntroduction(description: string, names: string[]): string {
    const original = description.trim();
    const aliases = names
        .map(brandAlias => brandAlias.trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
    const name = aliases.find(alias => {
        if (!original.toLocaleLowerCase().startsWith(alias.toLocaleLowerCase())) return false;
        // Do not treat a partial Latin word as a repeated brand name.
        return !(
            /[\p{Script=Latin}\d]$/u.test(alias) &&
            /^[\p{Script=Latin}\d]/u.test(original.slice(alias.length))
        );
    });
    if (!name) return original;
    let remainder = original.slice(name.length).trimStart();
    const parenthetical = remainder.match(/^[（(]([^）)]+)[）)]\s*/u);
    if (parenthetical) {
        // Strip only a known translated brand alias, never merchant facts in parentheses.
        if (!aliases.some(alias => alias.toLocaleLowerCase() === parenthetical[1].trim().toLocaleLowerCase()))
            return original;
        remainder = remainder.slice(parenthetical[0].length);
    }
    remainder = remainder.replace(/^[\s:：,，·—–-]+/u, '');
    return remainder.replace(/^\p{Ll}/u, character => character.toLocaleUpperCase());
}

export function LegalFooter({
    storefrontName,
    storefrontNameAliases = [],
    storefrontTagline = '',
    storefrontDescription = '',
    showLinks = true,
    language,
    content,
    onContentTarget,
    style,
}: {
    storefrontName: string;
    storefrontNameAliases?: string[];
    storefrontTagline?: string;
    storefrontDescription?: string;
    showLinks?: boolean;
    language: StorefrontLanguage;
    content?: StorefrontContentBlock;
    onContentTarget?: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
    style?: CSSProperties;
}) {
    const isZh = language === 'zh';
    const managedFooter = content?.type === 'FOOTER';
    const items = [...(content?.items ?? [])]
        .filter(
            item =>
                (!managedFooter || item.enabled) &&
                item.targetType !== 'NONE' &&
                Boolean(item.targetValue?.trim()),
        )
        .sort((first, second) => first.position - second.position);
    const normalizedTargets = new Set(
        items.map(item => item.targetValue?.trim().toLowerCase().replace(/^#?\//u, '')),
    );
    const defaultLegalItems = [
        {
            id: 'default-privacy',
            kind: 'privacy',
            label: isZh ? '隐私政策' : 'Privacy Policy',
            targetType: 'PAGE' as const,
            targetValue: '#/legal?id=privacy',
        },
        {
            id: 'default-terms',
            kind: 'terms',
            label: isZh ? '使用条款' : 'Terms of use',
            targetType: 'PAGE' as const,
            targetValue: '#/legal?id=terms',
        },
    ]
        .filter(
            fallback =>
                !normalizedTargets.has(fallback.kind) && !normalizedTargets.has(`legal?id=${fallback.kind}`),
        )
        .map(({ kind: _kind, ...item }) => item);
    const footerItems = managedFooter ? items : [...items, ...defaultLegalItems];
    const footerBrand = managedFooter ? content.title.trim() || storefrontName : storefrontName;
    const footerTitle = isZh ? '服务与政策' : 'Service and policies';
    const tagline = storefrontTagline.trim();
    const description = footerIntroduction(storefrontDescription, [storefrontName, ...storefrontNameAliases]);
    const hasIntroduction = Boolean(tagline || description);

    return (
        <footer className={`legal-footer${hasIntroduction ? ' has-introduction' : ''}`} style={style}>
            {hasIntroduction && (
                <div className="legal-footer-introduction">
                    <h2 className="legal-footer-title">
                        {[storefrontName.trim(), tagline].filter(Boolean).join(' · ')}
                    </h2>
                    {description && (
                        <ContentText className="legal-footer-description">{description}</ContentText>
                    )}
                </div>
            )}
            <strong className="legal-footer-brand">{footerBrand}</strong>
            {showLinks && !!footerItems.length && (
                <nav aria-label={footerTitle}>
                    {footerItems.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            disabled={!onContentTarget || item.targetType === 'NONE' || !item.targetValue}
                            onClick={() => onContentTarget?.(item.targetType, item.targetValue)}
                        >
                            {item.label}
                        </button>
                    ))}
                </nav>
            )}
        </footer>
    );
}

export function EmptyState({
    icon,
    title,
    detail,
    action,
    onAction,
    compact = false,
}: {
    icon: ReactNode;
    title: string;
    detail?: string;
    action?: string;
    onAction?: () => void;
    compact?: boolean;
}) {
    return (
        <section className={`empty-state ${compact ? 'is-compact' : ''}`}>
            <span className="empty-state-icon" aria-hidden="true">
                {icon}
            </span>
            <h2 className="empty-state-title">{title}</h2>
            {detail && <p className="empty-state-detail">{detail}</p>}
            {action && onAction && (
                <button className="empty-state-action" type="button" onClick={onAction}>
                    {action}
                </button>
            )}
        </section>
    );
}

export function InlineError({
    message,
    action,
    onAction,
}: {
    message: string;
    action?: string;
    onAction?: () => void;
}) {
    return (
        <div className="inline-error" role="alert">
            <CircleAlert />
            <span>{message}</span>
            {action && onAction && (
                <button type="button" onClick={onAction}>
                    {action}
                </button>
            )}
        </div>
    );
}

export function ListSkeleton({
    label = 'Loading',
    layout = 'rows',
}: {
    label?: string;
    layout?: 'rows' | 'products';
}) {
    return (
        <div
            data-page-pending="data"
            className={`list-skeleton${layout === 'products' ? ' is-product-grid' : ''}`}
            role="status"
            aria-label={label}
        >
            <BrandLoadingIndicator />
        </div>
    );
}

export function Sheet({
    title,
    language,
    onClose,
    children,
    className,
    showHandle = false,
    initialFocus = 'first',
    side,
}: {
    title: string;
    language: StorefrontLanguage;
    onClose: () => void;
    children: ReactNode;
    className?: string;
    showHandle?: boolean;
    initialFocus?: 'first' | 'dialog';
    side?: 'right';
}) {
    const titleId = useId();
    return (
        <Overlay
            className={`sheet-layer${className ? ` ${className}-layer` : ''}`}
            data-side={side}
            role="presentation"
            onClose={onClose}
            initialFocus={initialFocus}
        >
            <button
                className="sheet-mask"
                type="button"
                onClick={onClose}
                aria-label={language === 'zh' ? '关闭' : 'Close'}
            />
            <section
                className={className ? `sheet ${className}` : 'sheet'}
                data-side={side}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                {showHandle && (
                    <Minus className="sheet-drag-handle" aria-hidden="true" preserveAspectRatio="none" />
                )}
                <header>
                    <strong id={titleId}>{title}</strong>
                    <button type="button" onClick={onClose} aria-label={language === 'zh' ? '关闭' : 'Close'}>
                        {side && <ArrowLeft className="sheet-back-icon" aria-hidden="true" />}
                        <X aria-hidden="true" />
                    </button>
                </header>
                {children}
            </section>
        </Overlay>
    );
}
