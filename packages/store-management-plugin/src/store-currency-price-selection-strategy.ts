import {
    CurrencyCode,
    DefaultProductVariantPriceSelectionStrategy,
    idsAreEqual,
    ProductVariantPrice,
    ProductVariantPriceSelectionStrategy,
    RequestContext,
} from '@vendure/core';

import { convertMinorPrice } from './store-currency-settings.service';
import { StoreCurrencyRoundingMode } from './types';

interface CurrencyChannelFields {
    cnyToMyrRate?: number | null;
    currencyRateMarkupBps?: number | null;
    currencyRoundingMode?: string | null;
}

/**
 * Uses the active Channel's default-currency price as the only catalog source price.
 * Prices requested in the other managed fiat currency are calculated in memory and
 * are never persisted as a second independently editable price.
 */
export class StoreDefaultCurrencyPriceSelectionStrategy implements ProductVariantPriceSelectionStrategy {
    private readonly fallback = new DefaultProductVariantPriceSelectionStrategy();

    selectPrice(ctx: RequestContext, prices: ProductVariantPrice[]): ProductVariantPrice | undefined {
        const defaultCurrency = ctx.channel.defaultCurrencyCode;
        if (!isManagedCurrency(defaultCurrency) || !isManagedCurrency(ctx.currencyCode)) {
            return this.fallback.selectPrice(ctx, prices);
        }

        const basePrice = prices.find(
            price => idsAreEqual(price.channelId, ctx.channelId) && price.currencyCode === defaultCurrency,
        );
        if (!basePrice || ctx.currencyCode === defaultCurrency) return basePrice;

        const convertedPrice = convertDefaultCurrencyPriceForRequest(ctx, basePrice.price);
        if (convertedPrice == null) return undefined;

        return new ProductVariantPrice({
            ...basePrice,
            currencyCode: ctx.currencyCode,
            price: convertedPrice,
        });
    }
}

/**
 * Converts a default-currency amount with the same Channel settings used for catalog prices.
 * Fixed-price promotions use this so their displayed and calculated prices stay aligned with
 * the selected storefront currency.
 */
export function convertDefaultCurrencyPriceForRequest(ctx: RequestContext, price: number): number | null {
    return convertChannelAmount(ctx, price, ctx.channel.defaultCurrencyCode, ctx.currencyCode);
}

/** Converts a fixed Channel amount without relying on the Channel's mutable default currency. */
export function convertChannelAmount(
    ctx: Pick<RequestContext, 'channel'>,
    price: number,
    sourceCurrencyCode: CurrencyCode,
    targetCurrencyCode: CurrencyCode,
): number | null {
    if (!isManagedCurrency(sourceCurrencyCode) || !isManagedCurrency(targetCurrencyCode)) return price;
    if (sourceCurrencyCode === targetCurrencyCode) return price;

    const customFields = ctx.channel.customFields as CurrencyChannelFields;
    const cnyToMyrRate = Number(customFields.cnyToMyrRate);
    if (!Number.isFinite(cnyToMyrRate) || cnyToMyrRate <= 0) return null;

    const markupBps = Number(customFields.currencyRateMarkupBps);
    const markupPercent = Number.isFinite(markupBps) ? markupBps / 100 : 0;
    return convertMinorPrice(
        price,
        sourceCurrencyCode,
        cnyToMyrRate,
        markupPercent,
        normalizeRoundingMode(customFields.currencyRoundingMode),
    );
}

export function isManagedCurrency(value: CurrencyCode): value is CurrencyCode.CNY | CurrencyCode.MYR {
    return value === CurrencyCode.CNY || value === CurrencyCode.MYR;
}

function normalizeRoundingMode(value: unknown): StoreCurrencyRoundingMode {
    return value === 'TENTH' || value === 'WHOLE' ? value : 'CENT';
}
