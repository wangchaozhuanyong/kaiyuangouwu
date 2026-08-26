import {
    ArrowLeft,
    Bell,
    ChevronRight,
    CircleAlert,
    Flame,
    LayoutGrid,
    Package,
    ShieldCheck,
    ShoppingBag,
    Sparkles,
    Tag,
    WifiOff,
    X,
} from 'lucide-react';
import { CSSProperties, ReactNode, Suspense, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { QueryLoadState } from '../loading-state';
import { PageSkeleton } from '../route-loading';
import { routeFromLocation, RouteName } from '../storefront-router';
import { StorefrontContentBlock, StorefrontContentTargetType, StorefrontLanguage } from '../types';

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
        announcements: isZh ? '网站公告' : 'Website notices',
        notifications: isZh ? '消息通知' : 'Notifications',
        coupons: isZh ? '优惠券' : 'Coupons',
        referral: isZh ? '邀请返利' : 'Referral rewards',
        reviews: isZh ? '评价中心' : 'Reviews',
        login: isZh ? '登录' : 'Sign in',
        register: isZh ? '注册账户' : 'Create account',
        'verify-account': isZh ? '验证邮箱' : 'Verify email',
        'forgot-password': isZh ? '忘记密码' : 'Forgot password',
        'reset-password': isZh ? '重置密码' : 'Reset password',
    };
    return routeTitles[routeName] ?? (isZh ? '正在加载' : 'Loading');
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
    return (
        <Subpage title={title} language={language} onBack={onBack}>
            {state === 'loading' ? (
                <PageSkeleton label={isZh ? '正在加载' : 'Loading'} />
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
            )}
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

export function Subpage({
    title,
    language,
    onBack,
    surfaceColor,
    children,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    surfaceColor?: string | null;
    children: ReactNode;
}) {
    const surfaceStyle = surfaceColor?.trim()
        ? ({ '--page-surface': surfaceColor.trim() } as CSSProperties)
        : undefined;

    return (
        <main className="page subpage" style={surfaceStyle}>
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
    className,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    action?: ReactNode;
    className?: string;
}) {
    return (
        <header className={`topbar subpage-header${className ? ` ${className}` : ''}`}>
            <button type="button" onClick={onBack} aria-label={language === 'zh' ? '返回' : 'Back'}>
                <ArrowLeft aria-hidden="true" />
            </button>
            <strong>{title}</strong>
            <span>{action}</span>
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

export function SectionHeader({
    title,
    subtitle,
    centerLabel,
    action,
    onAction,
    icon,
    subtitlePlacement = 'below',
}: {
    title?: string;
    subtitle?: string;
    centerLabel?: string;
    action?: string;
    onAction?: () => void;
    icon?: ReactNode;
    subtitlePlacement?: 'below' | 'end';
}) {
    const resolvedIcon = icon ?? getSectionIcon(title);
    const subtitleAtEnd = subtitlePlacement === 'end';
    return (
        <header className={`section-header${subtitleAtEnd ? ' has-end-subtitle' : ''}`}>
            {(title || (subtitle && !subtitleAtEnd)) && (
                <div className="section-header-title-lockup">
                    <div className="section-header-title-row">
                        {resolvedIcon && (
                            <span className="section-header-icon-pill" aria-hidden="true">
                                {resolvedIcon}
                            </span>
                        )}
                        {title && <h2>{title}</h2>}
                    </div>
                    {subtitle && !subtitleAtEnd ? <p>{subtitle}</p> : null}
                </div>
            )}
            {subtitle && subtitleAtEnd ? <p className="section-header-end-subtitle">{subtitle}</p> : null}
            {centerLabel &&
                (title ? (
                    <span className="section-header-center-label">{centerLabel}</span>
                ) : (
                    <h2 className="section-header-center-label">{centerLabel}</h2>
                ))}
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
    onClick,
}: {
    icon: ReactNode;
    label: string;
    count: number;
    onClick: () => void;
}) {
    return (
        <button type="button" onClick={onClick}>
            <span>
                {icon}
                {count > 0 && <b>{count}</b>}
            </span>
            <small>{label}</small>
        </button>
    );
}

export function ServiceButton({
    icon,
    label,
    badge,
    onClick,
}: {
    icon: ReactNode;
    label: string;
    badge?: string;
    onClick: () => void;
}) {
    return (
        <button type="button" onClick={onClick}>
            <span>
                {icon}
                {badge && <em>{badge}</em>}
            </span>
            <b>{label}</b>
        </button>
    );
}

export function LegalFooter({
    storefrontName,
    language,
    content,
    onContentTarget,
}: {
    storefrontName: string;
    language: StorefrontLanguage;
    content?: StorefrontContentBlock;
    onContentTarget?: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const isZh = language === 'zh';
    const items = [...(content?.items ?? [])].filter(
        item => item.targetType !== 'NONE' && Boolean(item.targetValue?.trim()),
    );
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
    const footerItems = [...items, ...defaultLegalItems];
    const footerTitle = isZh ? '服务与政策' : 'Service and policies';

    return (
        <footer className="legal-footer">
            <strong>{footerTitle}</strong>
            {!!footerItems.length && (
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
            <span>{storefrontName}</span>
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
            <span>{icon}</span>
            <strong>{title}</strong>
            {detail && <small>{detail}</small>}
            {action && onAction && (
                <button type="button" onClick={onAction}>
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

export function ListSkeleton({ label = 'Loading' }: { label?: string }) {
    return (
        <div className="list-skeleton" role="status" aria-label={label}>
            {[0, 1, 2, 3].map(item => (
                <span key={item}>
                    <i />
                    <b />
                    <b />
                </span>
            ))}
        </div>
    );
}

export function Sheet({
    title,
    language,
    onClose,
    children,
}: {
    title: string;
    language: StorefrontLanguage;
    onClose: () => void;
    children: ReactNode;
}) {
    const dialogRef = useRef<HTMLElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    const titleId = useId();

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        previousFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        const focusableSelector = [
            'a[href]',
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])',
        ].join(',');
        const getFocusableElements = () =>
            Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
                element => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
            );
        const focusFrame = window.requestAnimationFrame(() => {
            (getFocusableElements()[0] ?? dialog).focus();
        });
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusableElements = getFocusableElements();
            if (!focusableElements.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];
            const activeElement = document.activeElement;
            if (event.shiftKey && (activeElement === firstElement || !dialog.contains(activeElement))) {
                event.preventDefault();
                lastElement.focus();
            } else if (
                !event.shiftKey &&
                (activeElement === lastElement || !dialog.contains(activeElement))
            ) {
                event.preventDefault();
                firstElement.focus();
            }
        };

        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            previousFocusRef.current?.focus();
        };
    }, []);

    const content = (
        <div className="sheet-layer" role="presentation">
            <button
                className="sheet-mask"
                type="button"
                onClick={onClose}
                aria-label={language === 'zh' ? '关闭' : 'Close'}
            />
            <section
                ref={dialogRef}
                className="sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <header>
                    <strong id={titleId}>{title}</strong>
                    <button type="button" onClick={onClose} aria-label={language === 'zh' ? '关闭' : 'Close'}>
                        <X aria-hidden="true" />
                    </button>
                </header>
                {children}
            </section>
        </div>
    );

    if (typeof document === 'undefined') return content;
    return createPortal(content, document.body);
}
