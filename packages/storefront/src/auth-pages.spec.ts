import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApiError } from './api';
import {
    loginErrorMessage,
    LoginPage,
    registerErrorMessage,
    RegisterPage,
    splitCustomerName,
    verificationErrorMessage,
    verificationRequiresPassword,
} from './auth-pages';

const authPageProps = {
    api: {} as never,
    language: 'zh' as const,
    storefrontName: '云桥Ai',
    onBack: vi.fn(),
    onContentTarget: vi.fn(),
};

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

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

    it('identifies connection failures and preserves unknown Shop API error codes', () => {
        expect(loginErrorMessage(new TypeError('Failed to fetch'), 'zh')).toBe(
            '网络连接失败，请检查网络后重试',
        );
        expect(loginErrorMessage(new ShopApiError('RATE_LIMIT_ERROR', 'Too many attempts'), 'zh')).toBe(
            '登录失败（错误代码：RATE_LIMIT_ERROR）',
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
        ).toBe('账户注册服务暂时不可用，请稍后重试');
    });

    it('identifies connection failures and preserves unknown Shop API error codes', () => {
        expect(registerErrorMessage(new Error('Network request failed'), 'zh')).toBe(
            '网络连接失败，请检查网络后重试',
        );
        expect(registerErrorMessage(new ShopApiError('RATE_LIMIT_ERROR', 'Too many attempts'), 'zh')).toBe(
            '注册失败（错误代码：RATE_LIMIT_ERROR）',
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
            '网络连接失败，请检查网络后重试',
        );
    });
});

describe('auth password visibility controls', () => {
    it('renders one password visibility button on the login page', () => {
        const markup = renderToStaticMarkup(
            createElement(LoginPage, {
                ...authPageProps,
                onSuccess: vi.fn().mockResolvedValue(undefined),
            }),
        );

        expect(markup).toContain('一次登录，连接你的 AI 效率宇宙');
        expect(markup).toContain('auth-login-ai-campaign-v2-480.webp');
        expect(markup).not.toContain('auth-register-ai-campaign-v2');
        expect(markup.match(/aria-label="显示密码"/g)).toHaveLength(1);
        expect(markup).toMatch(/type="password"[^>]*name="password"/);
    });

    it('renders independent password visibility buttons for registration and confirmation', () => {
        const markup = renderToStaticMarkup(createElement(RegisterPage, authPageProps));

        expect(markup).toContain('从今天起，让 AI 成为你的增长引擎');
        expect(markup).toContain('auth-register-ai-campaign-v2-480.webp');
        expect(markup).not.toContain('auth-login-ai-campaign-v2');
        expect(markup).toContain('智联云端 · 桥接未来');
        expect(markup.match(/aria-label="显示密码"/g)).toHaveLength(2);
        expect(markup).toMatch(/name="fullName"/);
        expect(markup).not.toMatch(/name="firstName"|name="lastName"/);
        expect(markup).not.toContain('验证码');
        expect(markup).toMatch(/type="password"[^>]*name="password"/);
        expect(markup).toMatch(/type="password"[^>]*name="confirmPassword"/);
    });

    it('renders the image, copy and theme published from the dashboard', () => {
        const markup = renderToStaticMarkup(
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
                    imageUrl: '/assets/preview/managed-login.jpg',
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

        expect(markup).toContain('managed-login.jpg');
        expect(markup).toContain('format=webp');
        expect(markup).toContain('后台登录主标题');
        expect(markup).toContain('后台卖点3');
        expect(markup).toContain('--auth-hero-overlay-color:#010203');
        expect(markup).toContain('--auth-hero-accent-color:#abcdef');
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
