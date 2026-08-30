import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { RequestContext, UserInputError } from '@vendure/core';
import { convertChannelAmount } from '@vendure/store-management-plugin';

type QuoteContext = Pick<RequestContext, 'channel' | 'currencyCode'>;

interface CurrencyChannelFields {
    cnyToMyrRate?: number | null;
    currencyRateMarkupBps?: number | null;
    currencyRoundingMode?: string | null;
    currencyRateUpdatedAt?: Date | string | null;
}

export interface ImageMoneyQuote {
    baseAmount: number;
    baseCurrencyCode: CurrencyCode;
    amount: number;
    currencyCode: CurrencyCode;
    cnyToMyrRate: number | null;
    markupPercent: number;
    roundingMode: 'CENT' | 'TENTH' | 'WHOLE';
    rateUpdatedAt: string | null;
}

export interface ImagePricingSnapshot {
    baseAmount: number;
    baseCurrencyCode: CurrencyCode;
    settlementAmount: number;
    settlementCurrencyCode: CurrencyCode;
    cnyToMyrRate: number | null;
    markupPercent: number;
    roundingMode: 'CENT' | 'TENTH' | 'WHOLE';
    rateUpdatedAt: string | null;
}

/** Quotes a configured AI price in the active Shop API settlement currency. */
export function quoteImageMoney(
    ctx: QuoteContext,
    baseAmount: number,
    baseCurrencyCode: CurrencyCode,
): ImageMoneyQuote {
    if (!Number.isSafeInteger(baseAmount) || baseAmount < 0) {
        throw new UserInputError('AI 基础价格无效');
    }
    const currencyCode = ctx.currencyCode;
    if (baseCurrencyCode !== currencyCode && !isManagedCurrencyPair(baseCurrencyCode, currencyCode)) {
        throw new UserInputError(`AI 图片工坊暂不支持 ${currencyCode} 结算`);
    }
    const conversionContext = ctx.channel.customFields
        ? ctx
        : ({ channel: { ...ctx.channel, customFields: {} } } as Pick<RequestContext, 'channel'>);
    const amount = convertChannelAmount(conversionContext, baseAmount, baseCurrencyCode, currencyCode);
    if (amount == null || !Number.isSafeInteger(amount) || amount < 0) {
        throw new UserInputError(`${baseCurrencyCode} 兑 ${currencyCode} 汇率不可用，暂时无法生成图片`);
    }

    const customFields = (ctx.channel.customFields ?? {}) as CurrencyChannelFields;
    const cnyToMyrRate = positiveNumber(customFields.cnyToMyrRate);
    const markupBps = Number(customFields.currencyRateMarkupBps);
    return {
        baseAmount,
        baseCurrencyCode,
        amount,
        currencyCode,
        cnyToMyrRate,
        markupPercent: baseCurrencyCode === currencyCode || !Number.isFinite(markupBps) ? 0 : markupBps / 100,
        roundingMode: normalizeRoundingMode(customFields.currencyRoundingMode),
        rateUpdatedAt: normalizedDate(customFields.currencyRateUpdatedAt),
    };
}

export function imagePricingSnapshot(quote: ImageMoneyQuote): ImagePricingSnapshot {
    return {
        baseAmount: quote.baseAmount,
        baseCurrencyCode: quote.baseCurrencyCode,
        settlementAmount: quote.amount,
        settlementCurrencyCode: quote.currencyCode,
        cnyToMyrRate: quote.cnyToMyrRate,
        markupPercent: quote.markupPercent,
        roundingMode: quote.roundingMode,
        rateUpdatedAt: quote.rateUpdatedAt,
    };
}

function isManagedCurrencyPair(left: CurrencyCode, right: CurrencyCode): boolean {
    const managed = new Set<CurrencyCode>([CurrencyCode.CNY, CurrencyCode.MYR]);
    return managed.has(left) && managed.has(right);
}

function positiveNumber(value: unknown): number | null {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeRoundingMode(value: unknown): 'CENT' | 'TENTH' | 'WHOLE' {
    return value === 'TENTH' || value === 'WHOLE' ? value : 'CENT';
}

function normalizedDate(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
