// @vitest-environment jsdom
// organize-imports-ignore -- Preserve ESLint import groups and local import ordering.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getStorefrontUpdateCopy,
    shouldShowStorefrontUpdatePrompt,
    StorefrontUpdatePrompt,
} from './StorefrontUpdatePrompt';
import { readStorefrontStylesheet } from './test-stylesheet';

const stylesheet = readStorefrontStylesheet();
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
    if (root)
        await act(async () => {
            root?.unmount();
            await Promise.resolve();
        });
    root = undefined;
    host?.remove();
    host = undefined;
    document.head.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

async function mountUpdatePrompt(initialAssetReferences?: readonly string[]) {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.head.innerHTML = '<script type="module" src="/assets/index-old.js"></script>';
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root?.render(
            createElement(StorefrontUpdatePrompt, { language: 'zh', route: 'home', initialAssetReferences }),
        );
        await Promise.resolve();
    });
}

describe('StorefrontUpdatePrompt', () => {
    it('uses one language throughout the update notice', () => {
        expect(getStorefrontUpdateCopy('zh')).toEqual({
            title: '发现新版本',
            description: '刷新即可使用最新内容',
            action: '立即刷新',
            later: '稍后',
        });
        expect(getStorefrontUpdateCopy('en')).toEqual({
            title: 'Update available',
            description: 'Refresh to use the latest version',
            action: 'Refresh now',
            later: 'Later',
        });
    });

    it('defers the notice while a customer is paying or filling a form', () => {
        expect(shouldShowStorefrontUpdatePrompt('product')).toBe(true);
        expect(shouldShowStorefrontUpdatePrompt('account')).toBe(true);
        for (const route of [
            'purchase',
            'checkout',
            'payment',
            'addresses',
            'account-security',
            'reviews',
        ] as const) {
            expect(shouldShowStorefrontUpdatePrompt(route)).toBe(false);
        }
    });

    it('sets explicit readable colors for update notice text', () => {
        expect(stylesheet).toMatch(/\.storefront-update-prompt strong\s*{[\s\S]*?color: var\(--text\)/);
        expect(stylesheet).toMatch(/\.storefront-update-prompt span\s*{[\s\S]*?color: var\(--muted\)/);
    });

    it('starts the background check after the page load event and cleans up its listeners', async () => {
        vi.useFakeTimers();
        const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await mountUpdatePrompt();
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            await vi.advanceTimersByTimeAsync(60_000);
        });
        expect(fetchMock).not.toHaveBeenCalled();

        readyState.mockReturnValue('complete');
        await act(async () => {
            window.dispatchEvent(new Event('load'));
            await Promise.resolve();
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await act(async () => {
            root?.unmount();
            await Promise.resolve();
        });
        root = undefined;
        window.dispatchEvent(new Event('load'));
        window.dispatchEvent(new Event('focus'));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retries a stalled check at the next interval and still announces a new build', async () => {
        vi.useFakeTimers();
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
        let requestSignal: AbortSignal | null | undefined;
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockImplementationOnce((_input, init) => {
                requestSignal = init?.signal;
                return new Promise((_resolve, reject) => {
                    requestSignal?.addEventListener(
                        'abort',
                        () => reject(new DOMException('Aborted', 'AbortError')),
                        {
                            once: true,
                        },
                    );
                });
            })
            .mockResolvedValueOnce(
                new Response('<script type="module" src="/assets/index-new.js"></script>', { status: 200 }),
            );
        vi.stubGlobal('fetch', fetchMock);
        await mountUpdatePrompt();
        await act(async () => vi.advanceTimersByTimeAsync(5_001));
        expect(requestSignal?.aborted).toBe(true);
        expect(host?.querySelector('[role="status"]')).toBeNull();
        await act(async () => vi.advanceTimersByTimeAsync(54_999));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(host?.textContent).toContain('发现新版本');
    });

    it('uses early entry references after lazy route CSS is attached without inventing a new version', async () => {
        vi.useFakeTimers();
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValue(
                new Response('<script type="module" src="/assets/index-old.js"></script>', { status: 200 }),
            );
        vi.stubGlobal('fetch', fetchMock);
        await mountUpdatePrompt(['/assets/index-old.js']);
        document.head.insertAdjacentHTML(
            'beforeend',
            '<link rel="stylesheet" href="/assets/account-route.css">',
        );
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            await Promise.resolve();
        });
        expect(fetchMock).toHaveBeenCalled();
        expect(host?.querySelector('[role="status"]')).toBeNull();
    });

    it('still announces a real new entry when supplied an early resource snapshot', async () => {
        vi.useFakeTimers();
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response('<script type="module" src="/assets/index-new.js"></script>', {
                    status: 200,
                }),
            ),
        );
        await mountUpdatePrompt(['/assets/index-old.js']);
        expect(host?.textContent).toContain('发现新版本');
    });

    it('aborts a pending request when the prompt unmounts', async () => {
        vi.useFakeTimers();
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
        let requestSignal: AbortSignal | null | undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>((_input, init) => {
                requestSignal = init?.signal;
                return new Promise((_resolve, reject) => {
                    requestSignal?.addEventListener(
                        'abort',
                        () => reject(new DOMException('Aborted', 'AbortError')),
                        {
                            once: true,
                        },
                    );
                });
            }),
        );
        await mountUpdatePrompt();
        expect(requestSignal?.aborted).toBe(false);
        await act(async () => {
            root?.unmount();
            await Promise.resolve();
        });
        root = undefined;
        expect(requestSignal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});
