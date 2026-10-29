// organize-imports-ignore -- Preserve ESLint type groups.
import type { StorefrontContentBlock, StorefrontLanguage } from './types';
import type { ReactNode } from 'react';
import { useContext } from 'react';

import { authPresentation, authVisualStyle } from '../../storefront-content-plugin/src/shared/auth-visual';

import { AuthPresentationContext } from './auth-presentation';

export function AuthOverlaySurface({
    title,
    content,
    children,
}: {
    title: string;
    content?: StorefrontContentBlock;
    children: ReactNode;
}) {
    return (
        <section
            className="page auth-page auth-page-overlay"
            aria-label={title}
            style={authVisualStyle(content)}
        >
            <div className="login-content">
                <div className="auth-form-column">
                    <div className="auth-card-content">{children}</div>
                </div>
            </div>
        </section>
    );
}

export function AuthFormIntro({
    variant,
    language,
    content,
}: {
    variant: 'login' | 'register';
    language: StorefrontLanguage;
    content?: StorefrontContentBlock;
}) {
    const overlay = useContext(AuthPresentationContext);
    const presentation = authPresentation(content, variant, language);
    const configuredSubtitle = content?.settings?.[`formSubtitle${language === 'zh' ? 'Zh' : 'En'}`];
    const subtitle =
        overlay && !(typeof configuredSubtitle === 'string' && configuredSubtitle.trim())
            ? variant === 'login'
                ? language === 'zh'
                    ? '登录后管理订单与服务'
                    : 'Sign in to manage your orders and services'
                : language === 'zh'
                  ? '创建账户，探索更多商品与服务'
                  : 'Create an account to explore products and services'
            : presentation.subtitle;
    return (
        <header className={`auth-form-heading auth-form-heading-${language}`}>
            <h1>{presentation.title}</h1>
            <p>{subtitle}</p>
        </header>
    );
}
