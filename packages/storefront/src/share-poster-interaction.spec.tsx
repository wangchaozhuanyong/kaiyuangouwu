// @vitest-environment jsdom
// organize-imports-ignore -- Preserve ESLint import groups.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_ARTWORK_POSTER_DESIGN } from '../../common/src/referral-poster-design';

import { ShopApi } from './api';
import { languageCodeFor } from './i18n';
import { storefrontQueryKeys } from './query-client';
import { SharePosterModal } from './share-poster-modal';
import { MarketConfig, Product, ReferralProgram } from './types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const market: MarketConfig = {
    code: 'poster-shop-a',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};
const product = {
    id: 'local-product',
    name: '测试商品',
    featuredAsset: null,
    assets: [],
    variants: [],
} as unknown as Product;
function program(style: 'jade' | 'aurora' = 'jade'): ReferralProgram {
    return {
        channelId: 'local-shop',
        enabled: false,
        rewardRate: 0,
        releaseDelayDays: 0,
        minimumOrderAmount: 0,
        allowBalanceSpend: false,
        attributionWindowDays: 0,
        defaultPosterTemplate: 'artwork',
        posterTemplates: [],
        posterTemplateConfigs: [
            {
                id: 'artwork',
                enabled: true,
                design: {
                    ...DEFAULT_ARTWORK_POSTER_DESIGN,
                    qr: { ...DEFAULT_ARTWORK_POSTER_DESIGN.qr, style },
                },
            },
        ],
    } as unknown as ReferralProgram;
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => {
        resolve = yes;
    });
    return { promise, resolve };
}
async function settle() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 15));
    });
}

describe('product poster QR readiness and store ownership', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let client: QueryClient;
    const notify = vi.fn();
    beforeEach(() => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    });
    afterEach(() => {
        act(() => root.unmount());
        client.clear();
        host.remove();
        notify.mockReset();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    function render(api: ShopApi, selectedMarket = market) {
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <SharePosterModal
                        api={api}
                        market={selectedMarket}
                        product={product}
                        storefrontName="测试店铺"
                        logoUrl={null}
                        language="zh"
                        formattedPrice="RM 10"
                        embedded
                        onClose={vi.fn()}
                        onNotify={notify}
                    />
                </QueryClientProvider>,
            ),
        );
    }
    function element<T extends Element>(selector: string): T {
        const result = host.querySelector<T>(selector);
        if (!result) throw new Error(`Missing poster element: ${selector}`);
        return result;
    }
    const save = () => element<HTMLButtonElement>('.poster-action-btn.primary');
    const qr = () => element<HTMLImageElement>('img.poster-qrcode');
    const retry = () => element<HTMLButtonElement>('.poster-qr-status button');
    const load = () => {
        act(() => {
            qr().dispatchEvent(new Event('load'));
        });
    };

    it('uses public settings without customer rewards and retries a failed QR image before enabling save', async () => {
        const pending = deferred<ReferralProgram>();
        const read = vi.fn((_signal?: AbortSignal) => pending.promise);
        const privateRead = vi.fn();
        render({ referralProgram: read, myReferralOverview: privateRead } as unknown as ShopApi);
        expect(save().disabled).toBe(true);
        expect(host.querySelector('img.poster-qrcode')).toBeNull();
        expect(read.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
        pending.resolve(program());
        await settle();
        expect(decodeURIComponent(qr().src)).toContain('#246d5f');
        expect(save().disabled).toBe(true);
        act(() => {
            qr().dispatchEvent(new Event('error'));
        });
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('二维码生成失败');
        expect(save().disabled).toBe(true);
        const failedNode = qr();
        act(() => retry().click());
        expect(qr()).not.toBe(failedNode);
        load();
        expect(save().disabled).toBe(false);
        expect(privateRead).not.toHaveBeenCalled();
        expect(read).toHaveBeenCalledOnce();
    });

    it('clears the previous shop QR while resolving the next shop and keeps scoped query caches', async () => {
        const firstRead = vi.fn(() => Promise.resolve(program()));
        render({ referralProgram: firstRead } as unknown as ShopApi);
        await settle();
        load();
        expect(save().disabled).toBe(false);
        const next = deferred<ReferralProgram>();
        const nextMarket = { ...market, code: 'poster-shop-b' };
        render({ referralProgram: vi.fn(() => next.promise) } as unknown as ShopApi, nextMarket);
        expect(host.querySelector('img.poster-qrcode')).toBeNull();
        expect(save().disabled).toBe(true);
        next.resolve(program('aurora'));
        await settle();
        expect(decodeURIComponent(qr().src)).toContain('#6656d9');
        expect(save().disabled).toBe(true);
        load();
        expect(save().disabled).toBe(false);
        expect(
            client.getQueryData(
                storefrontQueryKeys.referralProgram(
                    storefrontQueryKeys.market(market),
                    languageCodeFor('zh'),
                ),
            ),
        ).toEqual(program());
        expect(
            client.getQueryData(
                storefrontQueryKeys.referralProgram(
                    storefrontQueryKeys.market(nextMarket),
                    languageCodeFor('zh'),
                ),
            ),
        ).toEqual(program('aurora'));
    });

    it('keeps read failures visible and retries only the public program query', async () => {
        const read = vi.fn().mockRejectedValueOnce(new Error('Read failed')).mockResolvedValue(program());
        render({ referralProgram: read } as unknown as ShopApi);
        await settle();
        expect(save().disabled).toBe(true);
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        act(() => retry().click());
        await settle();
        load();
        expect(save().disabled).toBe(false);
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('exports the displayed QR at 1440 by 2160 and blocks exports when that image cannot load', async () => {
        const loadedSources: string[] = [];
        let failImage = false;
        vi.stubGlobal(
            'Image',
            class {
                naturalWidth = 480;
                naturalHeight = 480;
                onload?: () => void;
                onerror?: () => void;
                set src(value: string) {
                    loadedSources.push(value);
                    queueMicrotask(() => (failImage ? this.onerror?.() : this.onload?.()));
                }
            },
        );
        const drawImage = vi.fn();
        const context = {
            scale: vi.fn(),
            fillRect: vi.fn(),
            createLinearGradient: () => ({ addColorStop: vi.fn() }),
            fillText: vi.fn(),
            save: vi.fn(),
            beginPath: vi.fn(),
            roundRect: vi.fn(),
            clip: vi.fn(),
            drawImage,
            restore: vi.fn(),
        };
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
        const dimensions: number[][] = [];
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
            this: HTMLCanvasElement,
        ) {
            dimensions.push([this.width, this.height]);
            return 'data:image/png;base64,local-test';
        });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        render({ referralProgram: vi.fn(() => Promise.resolve(program())) } as unknown as ShopApi);
        await settle();
        load();
        const displayed = qr().src;
        await act(async () => {
            save().click();
            await Promise.resolve();
        });
        expect(dimensions).toEqual([[1440, 2160]]);
        expect(loadedSources).toEqual([displayed]);
        expect(drawImage.mock.calls[0].slice(1)).toEqual([216, 396, 120, 120]);
        expect(click).toHaveBeenCalledOnce();
        failImage = true;
        await act(async () => {
            save().click();
            await Promise.resolve();
        });
        expect(click).toHaveBeenCalledOnce();
        expect(notify).toHaveBeenLastCalledWith('海报生成失败，请使用口令分享');
    });
});
