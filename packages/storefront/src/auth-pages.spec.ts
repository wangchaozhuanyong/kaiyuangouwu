import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApiError } from './api';
import { loginErrorMessage, LoginPage, RegisterPage, splitCustomerName } from './auth-pages';

const authPageProps = {
    api: {} as never,
    language: 'zh' as const,
    storefrontName: '云桥Ai',
    onBack: vi.fn(),
    onNavigate: vi.fn(),
    onContentTarget: vi.fn(),
};

describe('loginErrorMessage', () => {
    it('identifies an email address which has not been registered', () => {
        const error = new ShopApiError(
            'INVALID_CREDENTIALS_ERROR',
            'The provided credentials are invalid',
            'STOREFRONT_ACCOUNT_NOT_FOUND',
        );

        expect(loginErrorMessage(error, 'zh')).toBe('该电子邮箱尚未注册');
        expect(loginErrorMessage(error, 'en')).toBe('No account was found for this email address');
    });

    it('identifies an incorrect password', () => {
        const error = new ShopApiError(
            'INVALID_CREDENTIALS_ERROR',
            'The provided credentials are invalid',
            'STOREFRONT_INVALID_PASSWORD',
        );

        expect(loginErrorMessage(error, 'zh')).toBe('密码错误，请重新输入');
        expect(loginErrorMessage(error, 'en')).toBe('The password is incorrect. Please try again');
    });

    it('identifies an account which still needs email verification', () => {
        const error = new ShopApiError('NOT_VERIFIED_ERROR', 'Please verify this email address');

        expect(loginErrorMessage(error, 'zh')).toBe('该电子邮箱尚未验证，请先查收验证邮件');
        expect(loginErrorMessage(error, 'en')).toContain('has not been verified');
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

        expect(markup.match(/aria-label="显示密码"/g)).toHaveLength(1);
        expect(markup).toMatch(/type="password"[^>]*name="password"/);
    });

    it('renders independent password visibility buttons for registration and confirmation', () => {
        const markup = renderToStaticMarkup(createElement(RegisterPage, authPageProps));

        expect(markup).toContain('/storefront/auth-ai-bridge-hero.jpg');
        expect(markup).toContain('智联云端 · 桥接未来');
        expect(markup.match(/aria-label="显示密码"/g)).toHaveLength(2);
        expect(markup).toMatch(/name="fullName"/);
        expect(markup).not.toMatch(/name="firstName"|name="lastName"/);
        expect(markup).not.toContain('验证码');
        expect(markup).toMatch(/type="password"[^>]*name="password"/);
        expect(markup).toMatch(/type="password"[^>]*name="confirmPassword"/);
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
