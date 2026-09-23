// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontContext } from '../../StorefrontContext';

import { DesktopHeader } from './desktop-header';

vi.mock('@tanstack/react-router', () => ({
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

    beforeEach(() => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        act(() => {
            root.render(
                <StorefrontContext.Provider
                    value={
                        {
                            language: 'zh',
                            route: { name: 'home' },
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
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        navigate.mockReset();
        switchCurrency.mockReset();
        toggleLanguage.mockReset();
    });

    it('submits the trimmed query from the visible search button', () => {
        const input = host.querySelector<HTMLInputElement>('.proto-search-input');
        const button = host.querySelector<HTMLButtonElement>('.proto-search-submit');
        expect(button?.textContent).toBe('搜索');
        if (!input || !button) throw new Error('Missing desktop search controls');

        act(() => {
            // eslint-disable-next-line @typescript-eslint/unbound-method -- The native setter is invoked with the input as its receiver below.
            const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            valueSetter?.call(input, '  111  ');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => button.click());

        expect(navigate).toHaveBeenCalledWith({ name: 'search', term: '111' });
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
