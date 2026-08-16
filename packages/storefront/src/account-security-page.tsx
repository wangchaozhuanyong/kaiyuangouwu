import { ArrowLeft, ChevronRight, Fingerprint, MapPin, UserRound } from 'lucide-react';
import { ReactNode } from 'react';

import { ActiveCustomer, StorefrontLanguage } from './types';

type AccountRoute = { name: 'login' | 'forgot-password' | 'addresses' };

export function AccountSecurityPage({
    customer,
    language,
    storefrontName,
    onBack,
    onNavigate,
    onLogout,
}: {
    customer: ActiveCustomer | null;
    language: StorefrontLanguage;
    storefrontName: string;
    onBack: () => void;
    onNavigate: (route: AccountRoute) => void;
    onLogout: () => void;
}) {
    const isZh = language === 'zh';
    if (!customer) {
        return (
            <Subpage title={isZh ? '账户与安全' : 'Account and security'} language={language} onBack={onBack}>
                <EmptyState
                    icon={<UserRound />}
                    title={isZh ? '请先登录' : 'Sign in required'}
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => onNavigate({ name: 'login' })}
                />
            </Subpage>
        );
    }
    const fullName = `${customer.lastName}${customer.firstName}`.trim();
    return (
        <main className="page subpage account-security-page">
            <SubHeader
                title={isZh ? '账户与安全' : 'Account and security'}
                language={language}
                onBack={onBack}
            />
            <section className="account-security-profile">
                <span className="avatar">
                    {(fullName || customer.emailAddress).slice(0, 1).toUpperCase()}
                </span>
                <div>
                    <strong>{fullName || storefrontName}</strong>
                    <small>{customer.emailAddress}</small>
                </div>
            </section>
            <section className="account-security-list">
                <button type="button" onClick={() => onNavigate({ name: 'forgot-password' })}>
                    <span>
                        <Fingerprint />
                        <b>{isZh ? '修改登录密码' : 'Change password'}</b>
                    </span>
                    <small>{isZh ? '通过邮箱验证后重置' : 'Reset after email verification'}</small>
                    <ChevronRight />
                </button>
                <button type="button" onClick={() => onNavigate({ name: 'addresses' })}>
                    <span>
                        <MapPin />
                        <b>{isZh ? '收货地址' : 'Delivery addresses'}</b>
                    </span>
                    <small>
                        {isZh
                            ? `${customer.addresses?.length ?? 0} 个地址`
                            : `${customer.addresses?.length ?? 0} addresses`}
                    </small>
                    <ChevronRight />
                </button>
            </section>
            <button className="logout-button" type="button" onClick={onLogout}>
                {isZh ? '退出登录' : 'Sign out'}
            </button>
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
