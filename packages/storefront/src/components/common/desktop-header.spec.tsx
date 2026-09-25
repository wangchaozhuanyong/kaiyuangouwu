// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontContext } from '../../StorefrontContext';

import { DesktopHeader } from './desktop-header';

vi.mock('@tanstack/react-router', () => ({
    createLink:
        (Component: React.ElementType) =>
        ({ to, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }) => (
            <Component {...props} href={to} aria-current="page" />
        ),
    Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a {...props}>{children}</a>
    ),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('desktop header search', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    const navigate = vi.fn();
    const switchCurrency = vi.fn();
    const toggleLanguage = vi.fn();

    function renderHeader(
        route: { name: 'home' } | { name: 'search'; term?: string },
        displayedRoute = route,
    ) {
        act(() => {
            root.render(
                <StorefrontContext.Provider
                    value={
                        {
                            language: 'zh',
                            route,
                            displayedRoute,
                            navigate,
                            storefrontName: '大马通',
                            logoUrl: null,
                            market: { label: '马来西亚' },
                            currencySelectorEnabled: true,
                            availableCurrencyCodes: ['MYR', 'CNY'],
                            displayCurrencyCode: 'CNY',
                            cartLoading: false,
                            switchCurrency,
                            toggleLanguage,
                            customer: null,
                        } as never
                    }
                >
                    <DesktopHeader cartQuantity={0} />
                </StorefrontContext.Provider>,
            );
        });
    }

    beforeEach(() => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        renderHeader({ name: 'home' });
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        navigate.mockReset();
        switchCurrency.mockReset();
        toggleLanguage.mockReset();
    });

    it('opens the dedicated search page when the header search is clicked', () => {
        const trigger = host.querySelector<HTMLButtonElement>('.proto-search-open');
        expect(trigger?.textContent).toContain('搜索商品、分类');
        expect(host.querySelector('.proto-search-input')).toBeNull();

        act(() => trigger?.click());

        expect(navigate).toHaveBeenCalledWith({ name: 'search' });
    });

    it('opens the dedicated search page with the keyboard shortcut', () => {
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
        });

        expect(navigate).toHaveBeenCalledWith({ name: 'search' });
    });

    it('leaves one search form on the dedicated search page', () => {
        renderHeader({ name: 'search', term: 'gemini' });
        expect(host.querySelector('.proto-header-search')).toBeNull();
        expect(host.querySelector('.proto-desktop-header.is-search-page')).not.toBeNull();
    });

    it('keeps navigation and search controls aligned with the page still visible during loading', () => {
        renderHeader({ name: 'search', term: 'cup' }, { name: 'home' });
        expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('首页');
        expect(host.querySelector('.proto-header-search')).not.toBeNull();
    });

    it('stages and saves language and currency from one compact header trigger', async () => {
        const trigger = host.querySelector<HTMLButtonElement>('.locale-preferences-trigger');
        expect(trigger?.textContent).toContain('简中');
        expect(trigger?.textContent).toContain('CNY');

        act(() => trigger?.click());

        const dialog = document.body.querySelector<HTMLElement>('.locale-preferences-sheet');
        expect(dialog?.getAttribute('role')).toBe('dialog');
        expect(dialog?.textContent).toContain('语言与货币');
        expect(dialog?.textContent).toContain('保存设置');

        const buttons = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? []);
        const english = buttons.find(button => button.textContent?.trim() === 'English');
        const myr = buttons.find(button => button.textContent?.trim() === 'MYR');
        const save = buttons.find(button => button.textContent?.trim() === '保存设置');
        if (!english || !myr || !save) throw new Error('Missing locale preference controls');

        act(() => english.click());
        act(() => myr.click());
        expect(switchCurrency).not.toHaveBeenCalled();
        expect(toggleLanguage).not.toHaveBeenCalled();

        await act(async () => {
            save.click();
            await Promise.resolve();
        });

        expect(switchCurrency).toHaveBeenCalledWith('MYR');
        expect(toggleLanguage).toHaveBeenCalledOnce();
        expect(document.body.querySelector('.locale-preferences-sheet')).toBeNull();
    });
});
