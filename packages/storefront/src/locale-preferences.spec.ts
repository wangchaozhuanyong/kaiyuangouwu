// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalePreferencesSheet } from './components/common/locale-preferences';
import { StorefrontDisplayError, storefrontErrorCopy } from './storefront-errors';
import { readStorefrontStylesheet } from './test-stylesheet';

describe('locale preferences presentation', () => {
    it('uses the shared desktop action surface and a responsive dialog', () => {
        const stylesheet = readStorefrontStylesheet([
            './styles/locale-preferences.css',
            './styles/desktop-home.css',
        ]);

        expect(stylesheet).toMatch(
            /\.locale-preferences-trigger\s*\{[^}]*border:\s*0;[^}]*background-color:\s*var\(--control-surface[^}]*background-image:\s*var\(--control-surface-image/,
        );
        expect(stylesheet).toMatch(
            /\.proto-header-right > \.proto-header-action\s*\{[^}]*background-color:\s*var\(--control-surface\);[^}]*box-shadow:\s*var\(--control-elevation\);/,
        );
        expect(stylesheet).toMatch(
            /\.proto-header-right > \.proto-header-action:hover\s*\{[^}]*background:\s*var\(--interaction-hover\);/,
        );
        expect(stylesheet).toMatch(
            /\.locale-preferences-language\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
        );
        expect(stylesheet).toMatch(
            /@media \(max-width:\s*460px\)[\s\S]*\.locale-preferences-currencies\s*\{[^}]*grid-template-columns:\s*1fr;/,
        );
    });

    it('targets portal-mounted sheets through the desktop layout marker on body', () => {
        const stylesheet = readStorefrontStylesheet([
            './styles/desktop-pages.css',
            './styles/locale-preferences.css',
        ]);

        expect(stylesheet).toMatch(
            /body:has\(\.desktop-store-layout\) \.sheet-layer\s*\{[^}]*place-items:\s*center;/,
        );
        expect(stylesheet).toMatch(
            /body:has\(\.desktop-store-layout\) \.sheet-layer > \.locale-preferences-sheet\s*\{[^}]*width:\s*min\(520px, 100%\);/,
        );
    });
});

vi.mock('./storefront-ui/page-shell', () => ({
    Sheet: ({ children }: { children: ReactNode }) => createElement('section', null, children),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('currency preference confirmation', () => {
    let root: ReturnType<typeof createRoot>;
    afterEach(() => act(() => root?.unmount()));
    const render = (onSelectCurrency: (code: string) => Promise<void>) => {
        const host = document.createElement('div');
        const onClose = vi.fn();
        root = createRoot(host);
        act(() =>
            root.render(
                createElement(LocalePreferencesSheet, {
                    language: 'zh',
                    currencyCodes: ['CNY', 'MYR'],
                    selectedCurrencyCode: 'MYR',
                    currencyLoading: false,
                    storefrontLabel: 'Generic storefront',
                    onToggleLanguage: vi.fn(),
                    onSelectCurrency,
                    onClose,
                }),
            ),
        );
        return { host, onClose };
    };
    it('confirms the selected MYR again so a stale CNY order can be synchronized', async () => {
        const select = vi.fn().mockResolvedValue(undefined);
        const { host, onClose } = render(select);
        const button = host.querySelector<HTMLButtonElement>('.locale-preferences-save');
        if (!button) throw new Error('Missing save action');
        await act(async () => {
            button.click();
            await Promise.resolve();
        });
        expect(select).toHaveBeenCalledExactlyOnceWith('MYR');
        expect(onClose).toHaveBeenCalledOnce();
    });
    it('keeps the dialog and its draft visible when currency confirmation fails', async () => {
        const select = vi.fn().mockRejectedValue(
            new StorefrontDisplayError(
                {
                    zh: '付款币种已保存，但购物车读取未完成。请重试读取核对，无需重复提交。',
                    en: 'Payment currency saved; cart refresh failed. Retry reading the cart without resubmitting.',
                },
                'zh',
            ),
        );
        const { host, onClose } = render(select);
        const button = host.querySelector<HTMLButtonElement>('.locale-preferences-save');
        if (!button) throw new Error('Missing save action');
        await act(async () => {
            button.click();
            await Promise.resolve();
        });
        expect(onClose).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('读取未完成');
        expect(host.querySelector('[aria-checked="true"]')?.textContent).toBeTruthy();
        expect(host.querySelector<HTMLButtonElement>('.locale-preferences-save')?.disabled).toBe(false);
    });
    it('keeps private exception details out of the settings dialog', async () => {
        const { host, onClose } = render(
            vi.fn().mockRejectedValue(new Error('SQL driver /private/internal-path')),
        );
        const button = host.querySelector<HTMLButtonElement>('.locale-preferences-save');
        if (!button) throw new Error('Missing save action');
        await act(async () => {
            button.click();
            await Promise.resolve();
        });
        expect(onClose).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(storefrontErrorCopy.UNKNOWN.zh);
        expect(host.textContent).not.toContain('/private/');
    });
});
