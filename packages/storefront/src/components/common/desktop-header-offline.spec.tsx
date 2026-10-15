// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { StorefrontContext } from '../../StorefrontContext';

import { DesktopHeader } from './desktop-header';

const { loadSearch } = vi.hoisted(() => ({ loadSearch: vi.fn() }));
vi.mock('./desktop-search', () => {
    loadSearch();
    return { default: () => <input aria-label="Available search" /> };
});
vi.mock('@tanstack/react-router', () => ({
    createLink:
        (Component: React.ElementType) =>
        ({ to, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }) => (
            <Component {...props} href={to} />
        ),
    Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a {...props}>{children}</a>
    ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('does not request uncached search offline, starts it online and preserves an already usable search on later disconnect', async () => {
    let online = false;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => {
            root.render(
                <StorefrontContext.Provider
                    value={
                        {
                            language: 'zh',
                            route: { name: 'home' },
                            storefrontName: 'Example store',
                            logoUrl: null,
                            market: {},
                            availableCurrencyCodes: ['CNY'],
                            displayCurrencyCode: 'CNY',
                            navigate: vi.fn(),
                            toggleLanguage: vi.fn(),
                            switchCurrency: vi.fn(),
                        } as never
                    }
                >
                    <DesktopHeader cartQuantity={0} />
                    <main>Existing content</main>
                </StorefrontContext.Provider>,
            );
            await vi.dynamicImportSettled();
        });
        const main = host.querySelector('main');
        expect(loadSearch).not.toHaveBeenCalled();
        expect(host.querySelector('.proto-header-search [inert]')).not.toBeNull();
        await act(async () => {
            online = true;
            window.dispatchEvent(new Event('online'));
            await vi.dynamicImportSettled();
        });
        const input = host.querySelector<HTMLInputElement>('[aria-label="Available search"]');
        expect(input).not.toBeNull();
        expect(loadSearch).toHaveBeenCalledOnce();
        if (!input) throw new Error('Expected available search input');
        input.value = 'Draft search';
        input.focus();
        await act(async () => {
            online = false;
            window.dispatchEvent(new Event('offline'));
            await Promise.resolve();
        });
        expect(host.querySelector('main')).toBe(main);
        expect(host.querySelector('[aria-label="Available search"]')).toBe(input);
        expect(input.value).toBe('Draft search');
        expect(document.activeElement).toBe(input);
    } finally {
        act(() => root.unmount());
        host.remove();
        vi.restoreAllMocks();
    }
});
