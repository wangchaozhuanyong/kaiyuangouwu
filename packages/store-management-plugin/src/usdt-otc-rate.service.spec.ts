import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    median,
    selectReliableMerchantPrices,
    selectReliableOkxMerchantPrices,
    UsdtOtcRateService,
} from './usdt-otc-rate.service';

describe('USDT OTC merchant quote selection', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses qualified merchant sell ads and removes price outliers', () => {
        const reliableMerchant = {
            userType: 'merchant',
            monthOrderCount: 100,
            monthFinishRate: 0.99,
            positiveRate: 0.98,
        };
        expect(
            selectReliableMerchantPrices([
                { fiat: 'CNY', asset: 'USDT', price: 7.2, advertiser: reliableMerchant },
                { fiat: 'CNY', asset: 'USDT', price: 7.22, advertiser: reliableMerchant },
                { fiat: 'CNY', asset: 'USDT', price: 7.21, advertiser: reliableMerchant },
                { fiat: 'CNY', asset: 'USDT', price: 9.9, advertiser: reliableMerchant },
                {
                    fiat: 'CNY',
                    asset: 'USDT',
                    price: 6.5,
                    advertiser: { ...reliableMerchant, monthFinishRate: 0.7 },
                },
                {
                    fiat: 'CNY',
                    asset: 'USDT',
                    price: 6.4,
                    advertiser: { ...reliableMerchant, userType: 'user' },
                },
            ]),
        ).toEqual([7.2, 7.22, 7.21]);
    });

    it('calculates the median without allowing list order to affect the result', () => {
        expect(median([7.3, 7.1, 7.2])).toBe(7.2);
        expect(median([7.3, 7.1, 7.2, 7.4])).toBeCloseTo(7.25);
    });

    it('uses only reliable OKX merchants selling official CNY/USDT offers', () => {
        const reliableMerchant = {
            baseCurrency: 'usdt',
            quoteCurrency: 'cny',
            side: 'sell',
            creatorType: 'certified',
            completedOrderQuantity: 100,
            completedRate: '0.99',
        };
        expect(
            selectReliableOkxMerchantPrices([
                { ...reliableMerchant, price: '7.20' },
                { ...reliableMerchant, price: '7.22', creatorType: 'diamond' },
                { ...reliableMerchant, price: '7.21' },
                { ...reliableMerchant, price: '9.90' },
                { ...reliableMerchant, price: '6.50', completedRate: '0.70' },
                { ...reliableMerchant, price: '6.40', creatorType: 'common' },
            ]),
        ).toEqual([7.2, 7.22, 7.21]);
    });

    it('combines Binance and OKX source medians with equal weighting', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(jsonResponse(binancePayload([7.2, 7.22, 7.21])))
                .mockResolvedValueOnce(jsonResponse(okxPayload([7.18, 7.2, 7.19]))),
        );

        const snapshot = await new UsdtOtcRateService().fetchCnyRate();

        expect(snapshot.cnyPerUsdtRate).toBeCloseTo(7.2);
        expect(snapshot.sampledAdvertisementCount).toBe(6);
        expect(snapshot.source).toContain('Binance P2P + OKX P2P');
    });

    it('keeps using one healthy source when the other source is temporarily unavailable', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockRejectedValueOnce(new Error('Binance timeout'))
                .mockResolvedValueOnce(jsonResponse(okxPayload([7.18, 7.2, 7.19]))),
        );

        const snapshot = await new UsdtOtcRateService().fetchCnyRate();

        expect(snapshot.cnyPerUsdtRate).toBeCloseTo(7.19);
        expect(snapshot.source).toContain('OKX P2P');
        expect(snapshot.source).not.toContain('Binance P2P');
    });

    it('fails closed when the two exchange medians diverge by more than five percent', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(jsonResponse(binancePayload([7.2, 7.22, 7.21])))
                .mockResolvedValueOnce(jsonResponse(okxPayload([8, 8.02, 8.01]))),
        );

        await expect(new UsdtOtcRateService().fetchCnyRate()).rejects.toThrow('偏差超过 5%');
    });
});

function jsonResponse(payload: unknown): Pick<Response, 'ok' | 'status' | 'json'> {
    return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(payload),
    };
}

function binancePayload(prices: number[]) {
    return {
        code: '000000',
        success: true,
        data: {
            items: prices.map(price => ({
                fiat: 'CNY',
                asset: 'USDT',
                price,
                advertiser: {
                    userType: 'merchant',
                    monthOrderCount: 100,
                    monthFinishRate: 0.99,
                    positiveRate: 0.98,
                },
            })),
        },
    };
}

function okxPayload(prices: number[]) {
    return {
        code: 0,
        data: {
            sell: prices.map(price => ({
                baseCurrency: 'usdt',
                quoteCurrency: 'cny',
                side: 'sell',
                price: String(price),
                creatorType: 'certified',
                completedOrderQuantity: 100,
                completedRate: '0.99',
            })),
        },
    };
}
