import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft,
    CheckCircle2,
    ChevronRight,
    KeyRound,
    LogOut,
    MapPin,
    ShieldCheck,
    UserRound,
} from 'lucide-react';
import { ReactNode } from 'react';

import { routeNavigateOptions } from './storefront-router';
import { ActiveCustomer, StorefrontLanguage } from './types';

type AccountRoute = { name: 'login' | 'forgot-password' | 'addresses' };

export function AccountSecurityPage({
    customer,
    language,
    storefrontName,
    onBack,
    onLogout,
}: {
    customer: ActiveCustomer | null;
    language: StorefrontLanguage;
    storefrontName: string;
    onBack: () => void;
    onLogout: () => void;
}) {
    const navigate = useNavigate();
    const navigateTo = (route: AccountRoute) => void navigate(routeNavigateOptions(route) as never);
    const isZh = language === 'zh';
    if (!customer) {
        return (
            <Subpage title={isZh ? '账户与安全' : 'Account & Security'} language={language} onBack={onBack}>
                <EmptyState
                    icon={<UserRound size={32} />}
                    title={isZh ? '请先登录' : 'Sign in required'}
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => navigateTo({ name: 'login' })}
                />
            </Subpage>
        );
    }

    const fullName = `${customer.lastName || ''}${customer.firstName || ''}`.trim();
    const displayName = fullName || customer.emailAddress.split('@')[0] || storefrontName;
    const initial = (fullName || customer.emailAddress).slice(0, 1).toUpperCase();

    return (
        <main className="page subpage account-security-page">
            <SubHeader
                title={isZh ? '账户与安全' : 'Account & Security'}
                language={language}
                onBack={onBack}
            />

            <div className="security-page-body">
                {/* 1. 用户信息高质感微卡片 */}
                <section className="security-user-card" aria-label={isZh ? '个人信息' : 'Personal info'}>
                    <div className="security-user-avatar" aria-hidden="true">
                        {initial}
                    </div>
                    <div className="security-user-meta">
                        <div className="security-user-title-row">
                            <h2 className="security-user-name">{displayName}</h2>
                            <span className="security-status-badge">
                                <CheckCircle2 size={12} aria-hidden="true" />
                                <span>{isZh ? '已认证' : 'Verified'}</span>
                            </span>
                        </div>
                        <p className="security-user-email">{customer.emailAddress}</p>
                    </div>
                </section>

                {/* 2. 核心设置列表 */}
                <div className="security-group">
                    <div className="security-group-header">
                        <span>{isZh ? '账户与登录管理' : 'Account & Login'}</span>
                    </div>
                    <div className="security-card-list">
                        <button
                            type="button"
                            className="security-item-btn"
                            onClick={() => navigateTo({ name: 'forgot-password' })}
                        >
                            <span className="security-item-icon icon-password" aria-hidden="true">
                                <KeyRound size={17} />
                            </span>
                            <div className="security-item-info">
                                <strong className="security-item-title">
                                    {isZh ? '修改登录密码' : 'Change Password'}
                                </strong>
                                <span className="security-item-subtitle">
                                    {isZh ? '通过邮箱验证后安全重置' : 'Reset after email verification'}
                                </span>
                            </div>
                            <span className="security-item-tail">
                                <span className="security-tail-text">{isZh ? '去重置' : 'Reset'}</span>
                                <ChevronRight size={15} aria-hidden="true" />
                            </span>
                        </button>

                        <button
                            type="button"
                            className="security-item-btn"
                            onClick={() => navigateTo({ name: 'addresses' })}
                        >
                            <span className="security-item-icon icon-address" aria-hidden="true">
                                <MapPin size={17} />
                            </span>
                            <div className="security-item-info">
                                <strong className="security-item-title">
                                    {isZh ? '收货地址管理' : 'Delivery Addresses'}
                                </strong>
                                <span className="security-item-subtitle">
                                    {isZh ? '管理实物商品默认收货地址' : 'Manage default shipping addresses'}
                                </span>
                            </div>
                            <span className="security-item-tail">
                                <span className="security-tail-text">
                                    {isZh
                                        ? `${customer.addresses?.length ?? 0} 个地址`
                                        : `${customer.addresses?.length ?? 0} addresses`}
                                </span>
                                <ChevronRight size={15} aria-hidden="true" />
                            </span>
                        </button>
                    </div>
                </div>

                {/* 3. 安全防护与隐私 */}
                <div className="security-group">
                    <div className="security-group-header">
                        <span>{isZh ? '安全与保护' : 'Security & Protection'}</span>
                    </div>
                    <div className="security-card-list">
                        <div className="security-item-static">
                            <span className="security-item-icon icon-shield" aria-hidden="true">
                                <ShieldCheck size={17} />
                            </span>
                            <div className="security-item-info">
                                <strong className="security-item-title">
                                    {isZh ? '账号安全评级' : 'Security Level'}
                                </strong>
                                <span className="security-item-subtitle">
                                    {isZh
                                        ? '已绑定密保邮箱，账户处于高等级保护状态'
                                        : 'Protected with verified email'}
                                </span>
                            </div>
                            <span className="security-safe-badge">
                                <span>{isZh ? '极佳' : 'Optimal'}</span>
                            </span>
                        </div>
                    </div>
                </div>

                {/* 4. 退出登录 */}
                <div className="security-action-group">
                    <button className="security-logout-button" type="button" onClick={onLogout}>
                        <LogOut size={16} aria-hidden="true" />
                        <span>{isZh ? '退出当前登录账号' : 'Sign Out of Account'}</span>
                    </button>
                </div>
            </div>
        </main>
    );
}

function SubHeader({
    title,
    language,
    onBack,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
}) {
    return (
        <header className="topbar subpage-header">
            <button type="button" onClick={onBack} aria-label={language === 'zh' ? '返回' : 'Back'}>
                <ArrowLeft aria-hidden="true" />
            </button>
            <strong>{title}</strong>
            <span />
        </header>
    );
}

function Subpage({
    title,
    language,
    onBack,
    children,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    children: ReactNode;
}) {
    return (
        <main className="page subpage">
            <SubHeader title={title} language={language} onBack={onBack} />
            {children}
        </main>
    );
}

function EmptyState({
    icon,
    title,
    action,
    onAction,
}: {
    icon: ReactNode;
    title: string;
    action: string;
    onAction: () => void;
}) {
    return (
        <section className="empty-state">
            <span>{icon}</span>
            <h2>{title}</h2>
            <button type="button" onClick={onAction}>
                {action}
            </button>
        </section>
    );
}
