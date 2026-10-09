// @vitest-environment jsdom
// organize-imports-ignore -- Preserve ESLint type groups and CSS side-effect order.
import type { AuthOverlayRequest } from './auth-overlay-navigation';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationOverlay } from './auth-overlay';
import { OverlayHost } from './overlay-host';
import { StorefrontContext, type StorefrontContextValue } from './StorefrontContext';

const state = vi.hoisted(() => ({ complete: undefined as undefined | (() => Promise<void>) }));
vi.mock('./lazy-storefront-pages', async () => {
    const { useContext } = await import('react');
    const { AuthPresentationContext } = await import('./auth-presentation');
    function Form(props: {
        onSuccess(this: void): Promise<void>;
        onContentTarget(type: string, value: string): void;
    }) {
        const presentation = useContext(AuthPresentationContext);
        if (!presentation) throw new Error('Missing authentication presentation');
        state.complete = props.onSuccess;
        return (
            <>
                <input name="email" />
                <input name="password" type="password" />
                <button onClick={() => presentation.navigate({ name: 'register' })}>Register</button>
                <button onClick={() => presentation.onSubmittingChange?.(true)}>Start request</button>
                <button onClick={() => presentation.onSubmittingChange?.(false)}>Finish request</button>
                <button onClick={() => void props.onSuccess()}>Complete</button>
                <button onClick={() => props.onContentTarget('PAGE', '/legal?id=terms')}>Read terms</button>
            </>
        );
    }
    return { LazyLoginPage: Form, LazyRegisterPage: Form, LazyForgotPasswordPage: Form };
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('authentication overlay lifecycle', () => {
    let root: ReturnType<typeof createRoot>;
    let host: HTMLDivElement;
    let runtime: StorefrontContextValue;
    let request: AuthOverlayRequest;
    let shown: boolean;
    let trigger: HTMLButtonElement;

    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(0), 0),
        );
        vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();
        shown = true;
        request = { mode: 'login' };
        runtime = {
            language: 'zh',
            storefrontCode: 'local-test',
            market: { code: 'MY', currencyCode: 'MYR' },
            customer: null,
            route: { name: 'product', id: 'local-product' },
            contentBlocks: [],
            contentQuery: { isPending: false },
            closeAuthOverlay: vi.fn(),
            changeAuthOverlay: vi.fn(),
            completeAuthentication: vi.fn(() => Promise.resolve()),
            toggleLanguage: vi.fn(),
            openContentTarget: vi.fn(),
        } as unknown as StorefrontContextValue;
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        trigger.remove();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
    async function render() {
        await act(async () => {
            root.render(
                <StorefrontContext.Provider value={runtime}>
                    <OverlayHost ownerKey={`background:${runtime.language}:${runtime.customer?.id ?? ''}`}>
                        <OverlayHost
                            ownerKey={`authentication:${runtime.storefrontCode}:${runtime.market.code}:${runtime.market.currencyCode}`}
                        >
                            {shown && <AuthenticationOverlay request={request} />}
                        </OverlayHost>
                    </OverlayHost>
                </StorefrontContext.Provider>,
            );
            await new Promise(resolve => setTimeout(resolve, 5));
        });
    }
    function button(text: string) {
        const found = [...document.querySelectorAll<HTMLButtonElement>('.auth-dialog button')].find(
            item => item.textContent === text,
        );
        if (!found) throw new Error(`Missing fixture button ${text}`);
        return found;
    }
    function escape() {
        act(() => {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
            );
        });
    }

    it('keeps the same form through language refresh while the background owner changes', async () => {
        await render();
        const email = document.querySelector<HTMLInputElement>('[name=email]');
        const password = document.querySelector<HTMLInputElement>('[name=password]');
        if (!email || !password) throw new Error('Missing authentication fields');
        email.value = 'fixture@example.invalid';
        password.value = 'local-fixture-value';
        runtime = { ...runtime, language: 'en' };
        await render();
        expect(document.querySelector('[name=email]')).toBe(email);
        expect(password.value).toBe('local-fixture-value');
        expect(runtime.closeAuthOverlay).not.toHaveBeenCalled();
        expect(document.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Sign in');
        escape();
        expect(runtime.closeAuthOverlay).toHaveBeenCalledOnce();
    });

    it('blocks closing and mode changes while a mutation is pending, then restores them', async () => {
        await render();
        act(() => button('Start request').click());
        expect(document.querySelector<HTMLButtonElement>('.auth-overlay-close')?.disabled).toBe(true);
        expect(document.querySelector<HTMLSelectElement>('.auth-overlay-language')?.disabled).toBe(true);
        escape();
        act(() => button('Register').click());
        expect(runtime.closeAuthOverlay).not.toHaveBeenCalled();
        expect(runtime.changeAuthOverlay).not.toHaveBeenCalled();
        act(() => button('Finish request').click());
        act(() => button('Register').click());
        expect(runtime.changeAuthOverlay).toHaveBeenCalledWith('register');
        escape();
        expect(runtime.closeAuthOverlay).toHaveBeenCalledOnce();
    });

    it('passes the selected product and quantity to existing checkout completion', async () => {
        request = { mode: 'login', target: { name: 'purchase', id: 'variant-local', quantity: 3 } };
        await render();
        await act(async () => {
            button('Complete').click();
            await Promise.resolve();
        });
        expect(runtime.completeAuthentication).toHaveBeenCalledWith(
            { name: 'login', returnTo: 'purchase', id: 'variant-local', quantity: 3 },
            undefined,
            expect.any(Function),
        );
    });

    it('returns ordinary login to its browsing page instead of the account page', async () => {
        await render();
        await act(async () => {
            button('Complete').click();
            await Promise.resolve();
        });
        expect(runtime.completeAuthentication).toHaveBeenCalledWith(
            { name: 'login' },
            runtime.route,
            expect.any(Function),
        );
    });

    it('opens legal reading separately and keeps the current form mounted', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        await render();
        const input = document.querySelector('[name=email]');
        act(() => button('Read terms').click());
        expect(open).toHaveBeenCalledWith('/legal?id=terms', '_blank', 'noopener,noreferrer');
        expect(document.querySelector('[name=email]')).toBe(input);
        expect(runtime.closeAuthOverlay).not.toHaveBeenCalled();
    });

    it('releases the dialog on a store change', async () => {
        await render();
        runtime = { ...runtime, storefrontCode: 'another-local-store' };
        await render();
        expect(document.querySelector('[role=dialog]')).toBeNull();
        expect(runtime.closeAuthOverlay).toHaveBeenCalledOnce();
    });

    it('restores focus and ignores late authentication completion after closing', async () => {
        await render();
        const complete = state.complete;
        if (!complete) throw new Error('Missing authentication completion');
        shown = false;
        await render();
        expect(document.activeElement).toBe(trigger);
        await act(async () => complete());
        expect(runtime.completeAuthentication).not.toHaveBeenCalled();
    });
});
