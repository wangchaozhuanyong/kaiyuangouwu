// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { LoginRoutePage, RegisterRoutePage } from './auth-route-pages';

const state: { runtime: Record<string, unknown> } = vi.hoisted(() => ({ runtime: {} }));
vi.mock('./shared', () => ({ useRouteRuntime: () => state.runtime, registerRoutePreload: () => undefined }));
vi.mock('../desktop-layout', () => ({ useDesktopLayout: () => false }));
vi.mock('../storefront-ui/page-shell', () => ({
    AuthPageBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../lazy-storefront-pages', () => {
    const Form = ({ authVisualContent }: { authVisualContent?: { title: string } }) => (
        <>
            <input name="email" />
            <input name="password" type="password" />
            <span>{authVisualContent?.title}</span>
        </>
    );
    return {
        LazyLoginPage: Form,
        LazyRegisterPage: Form,
        LazyForgotPasswordPage: Form,
        LazyResetPasswordPage: Form,
        LazyVerifyAccountPage: Form,
    };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it.each([
    ['AUTH_LOGIN', LoginRoutePage],
    ['AUTH_REGISTER', RegisterRoutePage],
] as const)('keeps %s inputs and artwork mounted during a language content refresh', (type, Page) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    state.runtime = {
        market: { code: 'MY' },
        route: {},
        language: 'zh',
        contentBlocks: [],
        contentQuery: { isPending: true },
    };
    try {
        act(() => root.render(<Page />));
        expect(host.querySelector('input')).toBeNull();
        state.runtime = {
            ...state.runtime,
            contentQuery: { isPending: false },
            contentBlocks: [{ type, title: '原文案' }],
        };
        act(() => root.render(<Page />));
        const email = host.querySelector<HTMLInputElement>('input[name="email"]');
        const password = host.querySelector<HTMLInputElement>('input[name="password"]');
        if (!email || !password) throw new Error('Expected the loaded authentication form');
        email.value = 'local@example.invalid';
        password.value = 'local-only';
        state.runtime = {
            ...state.runtime,
            language: 'en',
            contentQuery: { isPending: true },
            contentBlocks: [],
        };
        act(() => root.render(<Page />));
        expect(host.querySelector('input[name="email"]')).toBe(email);
        expect(password.value).toBe('local-only');
        expect(host.textContent).toContain('原文案');
        state.runtime = {
            ...state.runtime,
            contentQuery: { isPending: false },
            contentBlocks: [{ type, title: 'Translated copy' }],
        };
        act(() => root.render(<Page />));
        expect(email.value).toBe('local@example.invalid');
        expect(host.textContent).toContain('Translated copy');
    } finally {
        act(() => root.unmount());
        host.remove();
    }
});
