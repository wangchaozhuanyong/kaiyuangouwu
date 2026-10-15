import type { CurrencyCode, RequestContext } from '@vendure/core';
import {
    convertChannelAmount,
    convertSyncedCatalogAmount,
} from '@vendure/store-management-plugin/currency-conversion';

interface ShippingMoney {
    baseRate: number;
    freeAbove: number;
    currencyCode?: string;
    sourceCurrencyCode?: string;
}

export function shippingMoneyArguments(args: Array<{ name: string; value: string }>): ShippingMoney {
    const value = (name: string) => args.find(arg => arg.name === name)?.value;
    return {
        baseRate: Number(value('baseRate') ?? 0),
        freeAbove: Number(value('freeAbove') ?? 0),
        currencyCode: value('currencyCode'),
        sourceCurrencyCode: value('sourceCurrencyCode'),
    };
}

export function quoteShippingAmounts(
    ctx: RequestContext,
    args: ShippingMoney,
    currency: CurrencyCode,
    source?: RequestContext,
) {
    const from = (args.sourceCurrencyCode ||
        args.currencyCode ||
        source?.channel.defaultCurrencyCode ||
        ctx.channel.defaultCurrencyCode) as CurrencyCode;
    const convert = (amount: number) => {
        if (!source) return convertChannelAmount(ctx, amount, from, currency);
        const operating = convertChannelAmount(source, amount, from, source.channel.defaultCurrencyCode);
        return operating == null
            ? null
            : convertSyncedCatalogAmount(ctx, operating, source.channel.defaultCurrencyCode, currency);
    };
    const baseRate = convert(args.baseRate);
    const freeAbove = convert(args.freeAbove);
    return baseRate == null || freeAbove == null ? null : { baseRate, freeAbove };
}
