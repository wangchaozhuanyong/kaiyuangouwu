import { Injectable } from '@nestjs/common';

const BINANCE_P2P_AD_LIST_URL =
    'https://www.binance.com/bapi/c2c/v1/public/c2c/agent/ad-list?fiat=CNY&asset=USDT&tradeType=BUY&limit=20';
const OKX_P2P_AD_LIST_URL =
    'https://www.okx.com/v3/c2c/tradingOrders/books?' +
    'quoteCurrency=CNY&baseCurrency=USDT&side=sell&paymentMethod=all&userType=merchant&' +
    'showTrade=false&showFollow=false&showAlreadyTraded=false&isAbleFilter=false&receivingAds=false';
const MAX_SOURCE_DIVERGENCE = 0.05;

interface BinanceP2pAdvertiser {
    userType?: string;
    monthOrderCount?: number;
    monthFinishRate?: number;
    positiveRate?: number;
}

interface BinanceP2pAdvertisement {
    price?: number;
    fiat?: string;
    asset?: string;
    advertiser?: BinanceP2pAdvertiser;
}

interface BinanceP2pAdListResponse {
    code?: string;
    success?: boolean;
    data?: { items?: BinanceP2pAdvertisement[] } | null;
}

interface OkxP2pAdvertisement {
    baseCurrency?: string;
    quoteCurrency?: string;
    side?: string;
    price?: string;
    creatorType?: string;
    completedOrderQuantity?: number;
    completedRate?: string;
}

interface OkxP2pAdListResponse {
    code?: number;
    data?: { sell?: OkxP2pAdvertisement[] } | null;
}

interface UsdtOtcSourceSnapshot {
    exchange: 'Binance' | 'OKX';
    medianPrice: number;
    sampledAdvertisementCount: number;
}

export interface UsdtOtcRateSnapshot {
    cnyPerUsdtRate: number;
    source: string;
    sampledAdvertisementCount: number;
    updatedAt: Date;
}

@Injectable()
export class UsdtOtcRateService {
    async fetchCnyRate(): Promise<UsdtOtcRateSnapshot> {
        const results = await Promise.allSettled([this.fetchBinanceRate(), this.fetchOkxRate()]);
        const snapshots = results.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []));
        if (!snapshots.length) {
            const reasons = results
                .flatMap(result => (result.status === 'rejected' ? [errorMessage(result.reason)] : []))
                .join('；');
            throw new Error(`USDT OTC 报价服务暂时不可用${reasons ? `：${reasons}` : ''}`);
        }
        if (
            snapshots.length === 2 &&
            relativeDifference(snapshots[0].medianPrice, snapshots[1].medianPrice) > MAX_SOURCE_DIVERGENCE
        ) {
            throw new Error('Binance 与 OKX P2P 报价偏差超过 5%，已停止生成结账汇率');
        }

        const cnyPerUsdtRate = median(snapshots.map(snapshot => snapshot.medianPrice));
        const sampledAdvertisementCount = snapshots.reduce(
            (total, snapshot) => total + snapshot.sampledAdvertisementCount,
            0,
        );
        const sourceNames = snapshots.map(snapshot => `${snapshot.exchange} P2P`).join(' + ');
        return {
            cnyPerUsdtRate,
            source: `${sourceNames} 商家出售 USDT 等权中位价（${sampledAdvertisementCount} 条）`,
            sampledAdvertisementCount,
            updatedAt: new Date(),
        };
    }

    private async fetchBinanceRate(): Promise<UsdtOtcSourceSnapshot> {
        const response = await fetch(BINANCE_P2P_AD_LIST_URL, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            throw new Error(`Binance P2P 报价服务暂时不可用（${response.status}）`);
        }
        const payload = (await response.json()) as BinanceP2pAdListResponse;
        if (!payload.success || payload.code !== '000000') {
            throw new Error('Binance P2P 报价服务返回失败状态');
        }
        const prices = selectReliableMerchantPrices(payload.data?.items ?? []);
        if (!prices.length) {
            throw new Error('Binance P2P 暂无符合风控条件的 CNY/USDT 商家报价');
        }
        const cnyPerUsdtRate = median(prices);
        if (!Number.isFinite(cnyPerUsdtRate) || cnyPerUsdtRate <= 0) {
            throw new Error('Binance P2P 返回了无效的 CNY/USDT 报价');
        }
        return {
            exchange: 'Binance',
            medianPrice: cnyPerUsdtRate,
            sampledAdvertisementCount: prices.length,
        };
    }

    private async fetchOkxRate(): Promise<UsdtOtcSourceSnapshot> {
        const response = await fetch(OKX_P2P_AD_LIST_URL, {
            headers: { accept: 'application/json', 'user-agent': 'Vendure Storefront Rate Monitor' },
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`OKX P2P 报价服务暂时不可用（${response.status}）`);
        const payload = (await response.json()) as OkxP2pAdListResponse;
        if (payload.code !== 0) throw new Error('OKX P2P 报价服务返回失败状态');
        const prices = selectReliableOkxMerchantPrices(payload.data?.sell ?? []);
        if (!prices.length) throw new Error('OKX P2P 暂无符合风控条件的 CNY/USDT 商家报价');
        const cnyPerUsdtRate = median(prices);
        if (!Number.isFinite(cnyPerUsdtRate) || cnyPerUsdtRate <= 0) {
            throw new Error('OKX P2P 返回了无效的 CNY/USDT 报价');
        }
        return {
            exchange: 'OKX',
            medianPrice: cnyPerUsdtRate,
            sampledAdvertisementCount: prices.length,
        };
    }
}

export function selectReliableMerchantPrices(items: BinanceP2pAdvertisement[]): number[] {
    const reliable = items
        .filter(item => item.fiat === 'CNY' && item.asset === 'USDT')
        .filter(item => item.advertiser?.userType === 'merchant')
        .filter(item => Number(item.advertiser?.monthOrderCount) >= 20)
        .filter(item => Number(item.advertiser?.monthFinishRate) >= 0.95)
        .filter(item => Number(item.advertiser?.positiveRate) >= 0.9)
        .map(item => Number(item.price))
        .filter(price => Number.isFinite(price) && price > 0);
    if (reliable.length < 3) return reliable;

    const center = median(reliable);
    return reliable.filter(price => Math.abs(price - center) / center <= 0.03);
}

export function selectReliableOkxMerchantPrices(items: OkxP2pAdvertisement[]): number[] {
    const reliable = items
        .filter(
            item =>
                item.baseCurrency?.toUpperCase() === 'USDT' &&
                item.quoteCurrency?.toUpperCase() === 'CNY' &&
                item.side?.toLowerCase() === 'sell',
        )
        .filter(item => ['certified', 'diamond'].includes(item.creatorType?.toLowerCase() ?? ''))
        .filter(item => Number(item.completedOrderQuantity) >= 20)
        .filter(item => Number(item.completedRate) >= 0.95)
        .map(item => Number(item.price))
        .filter(price => Number.isFinite(price) && price > 0);
    if (reliable.length < 3) return reliable;

    const center = median(reliable);
    return reliable.filter(price => Math.abs(price - center) / center <= 0.03);
}

export function median(values: number[]): number {
    if (!values.length) return Number.NaN;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function relativeDifference(left: number, right: number): number {
    return Math.abs(left - right) / ((left + right) / 2);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
