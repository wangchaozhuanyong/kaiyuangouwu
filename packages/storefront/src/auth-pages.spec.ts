import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApiError } from './api';
import {
    ForgotPasswordPage,
    loginErrorMessage,
    LoginPage,
    registerErrorMessage,
    RegisterPage,
    splitCustomerName,
    verificationErrorMessage,
    verificationRequiresPassword,
} from './auth-pages';
import { DesktopLayoutContext } from './desktop-layout';
import { readStorefrontStylesheet } from './test-stylesheet';
import { StorefrontContentBlock } from './types';

const authPageProps = {
    api: {} as never,
    language: 'zh' as const,
    storefrontName: 'MOYAO AI｜模钥',
    onBack: vi.fn(),
    onContentTarget: vi.fn(),
};

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

function renderDesktop(element: ReactElement): string {
    return renderToStaticMarkup(createElement(DesktopLayoutContext.Provider, { value: true }, element));
}

describe('loginErrorMessage', () => {
    it('does not reveal whether an account exists', () => {
        const error = new ShopApiError(
            'INVALID_CREDENTIALS_ERROR',
            'The provided credentials are invalid',
            'STOREFRONT_ACCOUNT_NOT_FOUND',
        );

        expect(loginErrorMessage(error, 'zh')).toBe('电子邮箱或密码错误，请检查后重试');
        expect(loginErrorMessage(error, 'en')).toBe('The email address or password is incorrect');
    });

    it('uses the same message for legacy wrong-password responses', () => {
        const error = new ShopApiError(
            'INVALID_CREDENTIALS_ERROR',
            'The provided credentials are invalid',
            'STOREFRONT_INVALID_PASSWORD',
        );

        expect(loginErrorMessage(error, 'zh')).toBe('电子邮箱或密码错误，请检查后重试');
        expect(loginErrorMessage(error, 'en')).toBe('The email address or password is incorrect');
    });

    it('identifies an account which still needs email verification', () => {
        const error = new ShopApiError('NOT_VERIFIED_ERROR', 'Please verify this email address');

        expect(loginErrorMessage(error, 'zh')).toBe('该电子邮箱尚未验证，请先查收验证邮件');
        expect(loginErrorMessage(error, 'en')).toContain('has not been verified');
    });

    it('localizes connection failures and rate limits', () => {
        expect(loginErrorMessage(new TypeError('Failed to fetch'), 'zh')).toBe(
            '网络连接失败，请检查网络后重试。',
        );
        expect(loginErrorMessage(new ShopApiError('RATE_LIMIT_ERROR', 'Too many attempts'), 'zh')).toBe(
            '操作过于频繁，请稍后重试。',
        );
    });
});

describe('registerErrorMessage', () => {
    it('identifies an email address which is already registered', () => {
        const error = new ShopApiError('EMAIL_ADDRESS_CONFLICT_ERROR', 'The email address is not available');

        expect(registerErrorMessage(error, 'zh')).toBe('该电子邮箱已注册，请直接登录或使用其他邮箱');
        expect(registerErrorMessage(error, 'en')).toContain('already registered');
    });

    it('identifies password validation and registration service failures', () => {
        expect(
            registerErrorMessage(new ShopApiError('PASSWORD_VALIDATION_ERROR', 'Password is invalid'), 'zh'),
        ).toBe('密码不符合安全要求，请重新设置');
        expect(
            registerErrorMessage(new ShopApiError('NATIVE_AUTH_STRATEGY_ERROR', 'Auth unavailable'), 'zh'),
        ).toBe('账户服务暂时不可用，请稍后重试。');
    });

    it('localizes connection failures and rate limits', () => {
        expect(registerErrorMessage(new Error('Network request failed'), 'zh')).toBe(
            '网络连接失败，请检查网络后重试。',
        );
        expect(registerErrorMessage(new ShopApiError('RATE_LIMIT_ERROR', 'Too many attempts'), 'zh')).toBe(
            '操作过于频繁，请稍后重试。',
        );
    });
});

describe('account verification errors', () => {
    it('requests a first password for accounts created without one', () => {
        const error = new ShopApiError('MISSING_PASSWORD_ERROR', 'A password must be provided.');

        expect(verificationRequiresPassword(error)).toBe(true);
        expect(verificationRequiresPassword(new Error('A password must be provided.'))).toBe(false);
    });

    it('distinguishes expired and invalid verification links', () => {
        expect(
            verificationErrorMessage(
                new ShopApiError('VERIFICATION_TOKEN_EXPIRED_ERROR', 'Verification token has expired'),
                'zh',
            ),
        ).toContain('已过期');
        expect(
            verificationErrorMessage(
                new ShopApiError('VERIFICATION_TOKEN_INVALID_ERROR', 'Verification token not recognized'),
                'zh',
            ),
        ).toContain('无效');
    });

    it('shows a retryable message for password validation and network failures', () => {
        expect(
            verificationErrorMessage(
                new ShopApiError('PASSWORD_VALIDATION_ERROR', 'Password is invalid'),
                'zh',
            ),
        ).toBe('密码不符合安全要求，请重新设置');
        expect(verificationErrorMessage(new TypeError('Failed to fetch'), 'zh')).toBe(
            '网络连接失败，请检查网络后重试。',
        );
    });
});

describe('auth password visibility controls', () => {
    it('renders one password visibility button on the login page', () => {
        const markup = renderDesktop(
            createElement(LoginPage, {
                ...authPageProps,
                onSuccess: vi.fn().mockResolvedValue(undefined),
            }),
        );

        expect(markup).toContain('auth-login-ai-campaign-v2-480.webp');
        expect(markup).toContain('auth-page-has-image');
        expect(markup).not.toContain('--auth-hero-text-color:var(--auth-visual-foreground)');
        expect(markup).not.toContain('auth-register-ai-campaign-v2');
        expect(markup).toContain('登录账号');
        expect(markup).not.toContain('购买记录与状态清晰可查');
        expect(markup).not.toContain('支持服务类型');
        expect(markup).not.toContain('人工服务');
        expect(markup).toContain('欢迎回来');
        expect(markup).toContain('登录后查看订单、管理账户并继续使用店铺服务。');
        expect(markup).toContain('auth-form-heading');
        expect(markup).not.toContain('账户登录');
        expect(markup).toContain('auth-hero-header');
        expect(markup).toContain('>返回</span>');
        expect(markup).toContain('class="auth-mobile-back-button"');
        expect(markup).not.toContain('auth-route-tabs');
        expect(markup).toContain('立即注册');
        expect(markup).toContain('class="auth-assurance-rail"');
        expect(markup).toContain('class="auth-account-form"');
        expect(markup).toContain('aria-label="登录表单"');
        expect(markup).not.toContain('auth-field-label-row');
        expect(markup).toMatch(/<label class="visually-hidden"[^>]*>电子邮箱<\/label>/);
        expect(markup).toContain('placeholder="电子邮箱"');
        expect(markup).toContain('class="auth-field-action-row"');
        expect(markup).toContain('忘记密码？');
        expect(markup.match(/aria-label="显示密码"/g)).toHaveLength(1);
        expect(markup).toMatch(/type="password"[^>]*name="password"/);
    });

    it('renders independent password visibility buttons for registration and confirmation', () => {
        const markup = renderDesktop(createElement(RegisterPage, authPageProps));

        expect(markup).toContain('auth-register-ai-campaign-v2-480.webp');
        expect(markup).toContain('auth-page-has-image');
        expect(markup).not.toContain('auth-login-ai-campaign-v2');
        expect(markup).toContain('创建账号');
        expect(markup).not.toContain('验证邮箱即可开始使用');
        expect(markup).not.toContain('订单与售后状态清晰可查');
        expect(markup).not.toContain('新账户');
        expect(markup).toContain('创建账户');
        expect(markup).toContain('验证邮箱并完成注册，开始选购商品与使用店铺服务。');
        expect(markup).not.toContain('验证邮箱后，即可统一管理收藏与订单');
        expect(markup).toContain('auth-form-heading');
        expect(markup).toContain('auth-hero-header');
        expect(markup).not.toContain('auth-route-tabs');
        expect(markup).toContain('立即登录');
        expect(markup).toContain('class="auth-assurance-rail"');
        expect(markup).not.toContain('全球模型 · 一钥直达');
        expect(markup).toContain('class="auth-account-form"');
        expect(markup).toContain('aria-label="注册表单"');
        expect(markup).not.toContain('auth-field-label-row');
        expect(markup).toMatch(/<label class="visually-hidden"[^>]*>姓名<\/label>/);
        expect(markup).toContain('placeholder="姓名"');
        expect(markup).toContain('密码需为 8–72 个字符');
        expect(markup.match(/aria-label="显示密码"/g)).toHaveLength(2);
        expect(markup).toMatch(/name="fullName"/);
        expect(markup).not.toMatch(/name="firstName"|name="lastName"/);
        expect(markup).not.toContain('验证码');
        expect(markup).toMatch(/type="password"[^>]*name="password"/);
        expect(markup).toMatch(/type="password"[^>]*name="confirmPassword"/);
    });

    it('uses the same compact placeholder-only form hierarchy in English', () => {
        const loginMarkup = renderToStaticMarkup(
            createElement(LoginPage, {
                ...authPageProps,
                language: 'en',
                onSuccess: vi.fn().mockResolvedValue(undefined),
            }),
        );
        const registerMarkup = renderToStaticMarkup(
            createElement(RegisterPage, { ...authPageProps, language: 'en' }),
        );

        expect(loginMarkup).toContain('Welcome back');
        expect(loginMarkup).toContain(
            'Sign in to view orders, manage your account, and continue using store services.',
        );
        expect(registerMarkup).toContain('Create your account');
        expect(registerMarkup).toContain(
            'Verify your email and create an account to shop and use store services.',
        );
        expect(loginMarkup).not.toContain('auth-field-label-row');
        expect(registerMarkup).not.toContain('auth-field-label-row');
        expect(loginMarkup).toContain('placeholder="Email address"');
        expect(registerMarkup).toContain('placeholder="Full name"');
    });

    it('renders the email-only quick registration form when enabled by the store', () => {
        const markup = renderToStaticMarkup(
            createElement(RegisterPage, {
                ...authPageProps,
                authSettings: {
                    emailPasswordEnabled: true,
                    emailAutoRegistrationEnabled: false,
                    emailQuickRegistrationEnabled: true,
                    googleEnabled: false,
                    googleClientId: null,
                },
            }),
        );

        expect(markup).toContain('使用邮箱快捷注册');
        expect(markup).toContain('name="emailAddress"');
        expect(markup).not.toContain('name="fullName"');
        expect(markup).not.toContain('name="password"');
        expect(markup).not.toContain('name="confirmPassword"');
    });

    it('shows Google as the only method when email registration is disabled', () => {
        const markup = renderToStaticMarkup(
            createElement(RegisterPage, {
                ...authPageProps,
                authSettings: {
                    emailPasswordEnabled: false,
                    emailAutoRegistrationEnabled: false,
                    emailQuickRegistrationEnabled: false,
                    googleEnabled: true,
                    googleClientId: '123456789-test.apps.googleusercontent.com',
                },
            }),
        );

        expect(markup).toContain('class="google-auth-button"');
        expect(markup).not.toContain('class="auth-account-form"');
        expect(markup).not.toContain('当前店铺暂未开启注册方式');
    });

    it('shows a clear message when all login methods are disabled', () => {
        const markup = renderToStaticMarkup(
            createElement(LoginPage, {
                ...authPageProps,
                onSuccess: vi.fn().mockResolvedValue(undefined),
                authSettings: {
                    emailPasswordEnabled: false,
                    emailAutoRegistrationEnabled: false,
                    emailQuickRegistrationEnabled: false,
                    googleEnabled: false,
                    googleClientId: null,
                },
            }),
        );

        expect(markup).toContain('当前店铺暂未开启登录方式');
        expect(markup).not.toContain('class="auth-account-form"');
        expect(markup).not.toContain('class="google-auth-button"');
    });

    it('renders the managed image, copy and theme when the dashboard has published a login visual', () => {
        const markup = renderDesktop(
            createElement(LoginPage, {
                ...authPageProps,
                onSuccess: vi.fn().mockResolvedValue(undefined),
                authVisualContent: {
                    id: 'auth-login',
                    code: 'auth-login-visual',
                    type: 'AUTH_LOGIN',
                    enabled: true,
                    position: 1,
                    startsAt: null,
                    endsAt: null,
                    imageUrl: '/assets/preview/managed-login.webp',
                    backgroundColor: '#010203',
                    textColor: '#fefefe',
                    targetType: 'NONE',
                    targetValue: null,
                    settings: { accentColor: '#abcdef' },
                    title: '后台登录主标题',
                    subtitle: '后台登录说明',
                    body: '',
                    ctaLabel: '后台顶部短句',
                    items: [1, 2, 3].map(position => ({
                        id: `tag-${position}`,
                        enabled: true,
                        position,
                        imageUrl: null,
                        targetType: 'NONE' as const,
                        targetValue: null,
                        label: `后台卖点${position}`,
                        description: '',
                    })),
                },
            }),
        );

        expect(markup).toContain('managed-login.webp');
        expect(markup).toContain('preset=storefront-detail-640');
        expect(markup).toContain('preset=storefront-detail-1200');
        expect(markup).toContain('sizes="(min-width: 1024px) 640px, 1px"');
        expect(markup).not.toContain('preset=storefront-hero-');
        expect(markup).toContain('后台登录主标题');
        expect(markup).toContain('后台卖点3');
        expect(markup).toContain('--auth-visual-background:#010203');
        expect(markup).toContain('--auth-visual-foreground:#fefefe');
        expect(markup).toContain('--auth-visual-accent:#abcdef');
        expect(markup).toContain('auth-hero-managed');
        expect(markup).toContain('auth-hero-message-managed');
        expect(markup).toContain('class="auth-hero-tags"');
        expect(markup).not.toContain('auth-brand-lockup');
        expect(markup).not.toContain('auth-hero-benefit');
        expect(markup).not.toContain('支持服务类型');
    });

    it('does not request hidden login or registration artwork on mobile', () => {
        const loginMarkup = renderToStaticMarkup(
            createElement(LoginPage, { ...authPageProps, onSuccess: vi.fn() }),
        );
        const registerMarkup = renderToStaticMarkup(createElement(RegisterPage, authPageProps));

        expect(loginMarkup).not.toContain('auth-login-ai-campaign-v2-480.webp');
        expect(registerMarkup).not.toContain('auth-register-ai-campaign-v2-480.webp');
    });

    it('uses neutral login visuals for password recovery when no store content exists', () => {
        const markup = renderToStaticMarkup(createElement(ForgotPasswordPage, authPageProps));

        expect(markup).toContain('auth-page-login');
        expect(markup).not.toContain('auth-login-ai-campaign-v2-480.webp');
        expect(markup).toContain('登录账号');
        expect(markup).not.toContain('主流工具精选');
        expect(markup).toContain('找回密码');
        expect(markup).not.toContain('auth-ai-bridge-hero');
    });
});

describe('managed auth visual layout', () => {
    it('omits empty text groups after managed labels and benefits are cleared', () => {
        const content: StorefrontContentBlock = {
            id: 'compact',
            code: 'compact',
            type: 'AUTH_LOGIN',
            enabled: true,
            position: 0,
            startsAt: null,
            endsAt: null,
            imageUrl: '/assets/preview/auth.png',
            backgroundColor: null,
            textColor: null,
            targetType: 'NONE',
            targetValue: null,
            settings: {},
            title: 'Short title',
            subtitle: 'One sentence.',
            body: '',
            ctaLabel: '',
            items: [],
        };
        const markup = renderToStaticMarkup(
            createElement(LoginPage, {
                ...authPageProps,
                authVisualContent: content,
                onSuccess: vi.fn(),
            }),
        );
        expect(markup).toContain('Short title');
        expect(markup).toContain('One sentence.');
        expect(markup).not.toContain('auth-hero-kicker');
        expect(markup).not.toContain('auth-hero-tags');
        const emptyMarkup = renderToStaticMarkup(
            createElement(LoginPage, {
                ...authPageProps,
                authVisualContent: { ...content, title: '', subtitle: '' },
                onSuccess: vi.fn(),
            }),
        );
        expect(emptyMarkup).not.toContain('auth-hero-copy');
    });

    it('keeps the previous compact hero and form layout on mobile and short screens', () => {
        const styles = readStorefrontStylesheet();

        expect(styles).toContain('--auth-managed-hero-height: clamp(210px, 58.974vw, 230px)');
        expect(styles).toContain('.auth-page .auth-hero-message-managed > .auth-hero-copy > p');
        expect(styles).toContain('.auth-page .auth-hero-message-managed .auth-hero-tags');
        expect(styles).toContain('.auth-page-managed .login-content');
        expect(styles).toContain('.auth-page .auth-hero-header .auth-back-button');
        expect(styles).toContain('.auth-page .auth-password-toggle svg');
        expect(styles).not.toContain('.auth-route-tabs');
        expect(styles).toContain('.auth-mobile-back-button');
        expect(styles).toContain('.auth-assurance-rail');
        expect(styles).toMatch(
            /\.auth-page-login \.auth-hero,[\s\S]*?\.auth-page-register \.auth-hero\s*\{[^}]*display:\s*none;/,
        );
        expect(styles).toMatch(/\.auth-assurance-rail\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
        expect(styles).toMatch(/\.auth-account-form\s*\{[^}]*margin-top:\s*0;[^}]*display:\s*grid;/);
        expect(styles).toMatch(
            /@media \(min-width:\s*1024px\)[\s\S]*?\.auth-page \.auth-hero-tags\s*\{[^}]*width:\s*100%;[^}]*flex-wrap:\s*wrap;[^}]*overflow:\s*visible;/,
        );
    });

    it('allows the desktop hero copy to wrap at the 1024px breakpoint', () => {
        const styles = readStorefrontStylesheet();

        expect(styles).toMatch(
            // eslint-disable-next-line max-len -- Existing stylesheet regression pattern.
            /@media \(min-width:\s*1024px\) and \(max-width:\s*1199px\)[\s\S]*?\.auth-page \.auth-hero-message h2\s*\{[^}]*max-width:\s*none;[^}]*-webkit-line-clamp:\s*3;/,
        );
        expect(styles).toMatch(
            // eslint-disable-next-line max-len -- Existing stylesheet regression pattern.
            /@media \(min-width:\s*1024px\) and \(max-width:\s*1199px\)[\s\S]*?\.auth-page \.auth-hero-tags\s*\{[^}]*width:\s*100%;[^}]*flex-wrap:\s*wrap;[^}]*overflow:\s*visible;/,
        );
    });

    it('centers the complete desktop auth module in the available viewport', () => {
        const styles = readStorefrontStylesheet(['./styles/desktop-pages.css']);

        expect(styles).toMatch(
            /\.desktop-store-layout:has\(\.auth-page\) #storefront-content\s*\{[^}]*min-height:\s*100dvh;[^}]*padding:\s*32px;[^}]*display:\s*flex;/,
        );
        expect(styles).toMatch(
            // eslint-disable-next-line max-len -- Keeping the complete CSS contract in one expression makes regression failures actionable.
            /\.desktop-store-layout \.page\.auth-page\s*\{[^}]*width:\s*min\(100%, 1160px\);[^}]*min-height:\s*min\(680px, calc\(100dvh - 64px\)\);[^}]*margin:\s*auto;[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto;/,
        );
        expect(styles).toMatch(
            /\.desktop-store-layout \.auth-assurance-rail\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-template-columns:\s*repeat\(4,/,
        );
        expect(styles).toMatch(/\.desktop-store-layout \.auth-page \.auth-hero\s*\{[^}]*border-radius:\s*0;/);
        expect(styles).not.toMatch(
            /\.desktop-store-layout \.auth-page \.auth-hero\s*\{[^}]*border-radius:\s*var\(--skin-hero-radius\) 0 0 var\(--skin-hero-radius\);/,
        );
    });
});

describe('splitCustomerName', () => {
    it('maps a Chinese full name to Vendure first and last name fields', () => {
        expect(splitCustomerName('王超', 'zh')).toEqual({ firstName: '超', lastName: '王' });
        expect(splitCustomerName('欧阳娜娜', 'zh')).toEqual({ firstName: '娜娜', lastName: '欧阳' });
    });

    it('maps a western full name without exposing separate fields', () => {
        expect(splitCustomerName('Ada Lovelace', 'en')).toEqual({
            firstName: 'Ada',
            lastName: 'Lovelace',
        });
    });
});
