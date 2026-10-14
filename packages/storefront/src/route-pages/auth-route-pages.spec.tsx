// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { LoginRoutePage, RegisterRoutePage, VerifyAccountRoutePage } from './auth-route-pages';

const state: {
    runtime: Record<string, unknown>;
    complete?: (isCurrent?: () => boolean) => Promise<void>;
} = vi.hoisted(() => ({ runtime: {} }));
vi.mock('./shared', () => ({ useRouteRuntime: () => state.runtime, registerRoutePreload: () => undefined }));
vi.mock('../desktop-layout', () => ({ useDesktopLayout: () => false }));
vi.mock('../storefront-ui/page-shell', () => ({
    AuthPageBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../lazy-storefront-pages', () => {
    const Form = ({
        authVisualContent,
        onSuccess,
    }: {
        authVisualContent?: { title: string };
        onSuccess?: (isCurrent?: () => boolean) => Promise<void>;
    }) => {
        state.complete = onSuccess;
        return (
            <>
                <input name="email" />
                <input name="password" type="password" />
                <span>{authVisualContent?.title}</span>
            </>
        );
    };
    return {
        LazyLoginPage: Form,
        LazyRegisterPage: Form,
        LazyForgotPasswordPage: Form,
        LazyResetPasswordPage: Form,
        LazyVerifyAccountPage: Form,
    };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('forwards verification ownership through the existing authentication completion guard', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const completeAuthentication = vi.fn().mockResolvedValue(undefined);
    const isCurrent = () => false;
    state.runtime = {
        route: {},
        contentBlocks: [],
        contentQuery: { isPending: false },
        completeAuthentication,
    };
    try {
        act(() => root.render(<VerifyAccountRoutePage />));
        await act(async () => {
            await state.complete?.(isCurrent);
        });
        expect(completeAuthentication).toHaveBeenCalledWith(undefined, undefined, isCurrent);
    } finally {
        act(() => root.unmount());
    }
});

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
