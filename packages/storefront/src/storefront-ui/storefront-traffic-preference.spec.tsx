// @vitest-environment jsdom
// organize-imports-ignore
import type { ShopApi } from '../api';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storefrontTrafficConsent, storefrontTrafficOptedOut } from '../storefront-traffic';

import { StorefrontTrafficPreference } from './storefront-traffic-preference';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('StorefrontTrafficPreference', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        localStorage.clear();
        document.cookie = 'storefront_analytics_consent=; Path=/; Max-Age=0';
        document.cookie = 'storefront_analytics_opt_out=; Path=/; Max-Age=0';
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    const render = (recordAnalyticsConsent: ShopApi['recordAnalyticsConsent']) => {
        const api = { recordAnalyticsConsent } as ShopApi;
        act(() => root.render(<StorefrontTrafficPreference api={api} language="zh" />));
    };

    const click = async (label: string) => {
        const button = [...container.querySelectorAll('button')].find(item =>
            item.textContent?.includes(label),
        );
        if (!button) throw new Error(`Missing consent button: ${label}`);
        await act(async () => {
            button.click();
            await Promise.resolve();
        });
    };

    it('closes the banner only after a grant is recorded', async () => {
        const record = vi.fn().mockResolvedValue({ id: 'consent-1' });
        render(record);
        await click('允许访问统计');

        expect(record).toHaveBeenCalledWith(expect.objectContaining({ granted: true, locale: 'zh' }));
        expect(container.querySelector('.traffic-consent-banner')).toBeNull();
        expect(container.childElementCount).toBe(0);
        expect(storefrontTrafficConsent()).toBe('granted');
    });

    it('closes a failed grant safely without leaving a persistent status module', async () => {
        const record = vi.fn().mockRejectedValue(new Error('temporary failure'));
        render(record);
        await click('允许访问统计');

        expect(container.querySelector('.traffic-consent-banner')).toBeNull();
        expect(storefrontTrafficOptedOut()).toBe(true);
        expect(container.childElementCount).toBe(0);
        expect(record).toHaveBeenCalledOnce();
        expect(storefrontTrafficConsent()).toBe('denied');
    });

    it('applies necessary-only immediately even when evidence recording fails', async () => {
        const record = vi.fn().mockRejectedValue(new Error('temporary failure'));
        render(record);
        await click('仅必要功能');

        expect(record).toHaveBeenCalledWith(expect.objectContaining({ granted: false }));
        expect(container.querySelector('.traffic-consent-banner')).toBeNull();
        expect(container.childElementCount).toBe(0);
        expect(container.querySelector('.traffic-preference-error')).toBeNull();
        expect(storefrontTrafficOptedOut()).toBe(true);
    });

    it('sends only one record while a choice is pending', async () => {
        let finish!: (value: { id: string }) => void;
        const record = vi.fn().mockReturnValue(new Promise<{ id: string }>(resolve => (finish = resolve)));
        render(record);
        const button = container.querySelector<HTMLButtonElement>('.traffic-consent-actions .is-primary');
        if (!button) throw new Error('Missing grant button');

        await act(async () => {
            button.click();
            button.click();
            await Promise.resolve();
        });
        expect(record).toHaveBeenCalledOnce();

        await act(async () => {
            finish({ id: 'consent-3' });
            await Promise.resolve();
        });
        expect(container.childElementCount).toBe(0);
    });
});
