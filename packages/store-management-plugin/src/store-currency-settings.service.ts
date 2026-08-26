import { Injectable } from '@nestjs/common';
import {
    Channel,
    ChannelService,
    CurrencyCode,
    EventBus,
    isGraphQlErrorResult,
    ProductVariant,
    ProductVariantPrice,
    ProductVariantPriceEvent,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import {
    StoreCurrencyConfiguration,
    StoreCurrencyRateMode,
    StoreCurrencyRoundingMode,
    UpdateStoreCurrencyConfigurationInput,
} from './types';

const SUPPORTED_CURRENCIES = [CurrencyCode.CNY, CurrencyCode.MYR] as const;
const BNM_EXCHANGE_RATE_URL = 'https://api.bnm.gov.my/public/exchange-rate/CNY?session=1200&quote=rm';
const BNM_RATE_SOURCE = 'Bank Negara Malaysia';

interface CurrencyChannelFields {
    currencySelectorEnabled?: boolean | null;
    currencyRateMode?: string | null;
    cnyToMyrRate?: number | null;
    currencyRateMarkupBps?: number | null;
    currencyRoundingMode?: string | null;
    currencyRateSource?: string | null;
    currencyRateUpdatedAt?: Date | string | null;
    currencyPricesUpdatedAt?: Date | string | null;
    currencySyncedPriceCount?: number | null;
}

interface BnmExchangeRateResponse {
    data?: {
        currency_code?: string;
        unit?: number;
        rate?: { date?: string; middle_rate?: number | null };
    };
}

export interface StoreCurrencyAutomaticSyncResult {
    channelCode: string;
    syncedPriceCount: number;
    rate: number;
}

@Injectable()
export class StoreCurrencySettingsService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly channelService: ChannelService,
        private readonly eventBus: EventBus,
        private readonly requestContextService: RequestContextService,
    ) {}

    async get(ctx: RequestContext): Promise<StoreCurrencyConfiguration> {
        return this.toConfiguration(await this.getActiveChannel(ctx));
    }

    getPublic(ctx: RequestContext): StoreCurrencyConfiguration {
        return this.toConfiguration(ctx.channel);
    }

    async update(
        ctx: RequestContext,
        input: UpdateStoreCurrencyConfigurationInput,
    ): Promise<StoreCurrencyConfiguration> {
        const normalized = normalizeInput(input);
        const channel = await this.getActiveChannel(ctx);
        const customFields = channel.customFields as CurrencyChannelFields;
        const updated = await this.channelService.update(ctx, {
            id: channel.id,
            defaultCurrencyCode: normalized.defaultCurrencyCode,
            availableCurrencyCodes: normalized.availableCurrencyCodes,
            customFields: {
                ...customFields,
                currencySelectorEnabled: normalized.selectorEnabled,
                currencyRateMode: normalized.rateMode,
                cnyToMyrRate: normalized.cnyToMyrRate,
                currencyRateMarkupBps: Math.round(normalized.markupPercent * 100),
                currencyRoundingMode: normalized.roundingMode,
            },
        });
        if (isGraphQlErrorResult(updated)) throw new UserInputError(updated.message);
        return this.toConfiguration(updated);
    }

    async refreshRate(ctx: RequestContext): Promise<StoreCurrencyConfiguration> {
        const channel = await this.getActiveChannel(ctx);
        const response = await fetch(BNM_EXCHANGE_RATE_URL, {
            headers: { accept: 'application/vnd.BNM.API.v1+json' },
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            throw new UserInputError(`汇率服务暂时不可用（${response.status}）`);
        }
        const payload = (await response.json()) as BnmExchangeRateResponse;
        const unit = Number(payload.data?.unit ?? 1);
        const middleRate = Number(payload.data?.rate?.middle_rate);
        const rate = middleRate / unit;
        if (payload.data?.currency_code !== 'CNY' || !Number.isFinite(rate) || rate <= 0) {
            throw new UserInputError('汇率服务返回了无效数据');
        }
        const customFields = channel.customFields as CurrencyChannelFields;
        const updated = await this.channelService.update(ctx, {
            id: channel.id,
            customFields: {
                ...customFields,
                cnyToMyrRate: rate,
                currencyRateSource: BNM_RATE_SOURCE,
                currencyRateUpdatedAt: new Date(),
            },
        });
        if (isGraphQlErrorResult(updated)) throw new UserInputError(updated.message);
        return this.toConfiguration(updated);
    }

    async syncPrices(ctx: RequestContext): Promise<StoreCurrencyConfiguration> {
        let configuration = await this.get(ctx);
        if (configuration.rateMode === 'AUTO') {
            configuration = await this.refreshRate(ctx);
        }
        if (configuration.availableCurrencyCodes.length < 2) {
            throw new UserInputError('请先同时启用 CNY 和 MYR');
        }

        const baseCurrency = configuration.defaultCurrencyCode;
        const targetCurrency = baseCurrency === CurrencyCode.CNY ? CurrencyCode.MYR : CurrencyCode.CNY;
        const repository = this.connection.getRepository(ctx, ProductVariantPrice);
        const [basePrices, targetPrices] = await Promise.all([
            repository.find({
                where: { channelId: ctx.channelId, currencyCode: baseCurrency },
                relations: { variant: true },
            }),
            repository.find({
                where: { channelId: ctx.channelId, currencyCode: targetCurrency },
                relations: { variant: true },
            }),
        ]);
        const targetByVariant = new Map(targetPrices.map(price => [String(price.variant.id), price]));
        const created: ProductVariantPrice[] = [];
        const updated: ProductVariantPrice[] = [];

        for (const basePrice of basePrices) {
            const variantId = String(basePrice.variant.id);
            const converted = convertMinorPrice(
                basePrice.price,
                baseCurrency,
                configuration.cnyToMyrRate,
                configuration.markupPercent,
                configuration.roundingMode,
            );
            const existing = targetByVariant.get(variantId);
            if (existing) {
                if (existing.price !== converted) {
                    existing.price = converted;
                    updated.push(existing);
                }
                continue;
            }
            created.push(
                new ProductVariantPrice({
                    channelId: ctx.channelId,
                    currencyCode: targetCurrency,
                    price: converted,
                    variant: new ProductVariant({ id: basePrice.variant.id }),
                }),
            );
        }

        if (created.length) {
            const saved = await repository.save(created);
            await this.eventBus.publish(new ProductVariantPriceEvent(ctx, saved, 'created'));
        }
        if (updated.length) {
            const saved = await repository.save(updated);
            await this.eventBus.publish(new ProductVariantPriceEvent(ctx, saved, 'updated'));
        }

        const channel = await this.getActiveChannel(ctx);
        const customFields = channel.customFields as CurrencyChannelFields;
        const syncedPriceCount = created.length + updated.length;
        const savedChannel = await this.channelService.update(ctx, {
            id: channel.id,
            customFields: {
                ...customFields,
                currencyPricesUpdatedAt: new Date(),
                currencySyncedPriceCount: syncedPriceCount,
            },
        });
        if (isGraphQlErrorResult(savedChannel)) throw new UserInputError(savedChannel.message);
        return this.toConfiguration(savedChannel);
    }

    async syncAllAutomaticPrices(ctx: RequestContext): Promise<StoreCurrencyAutomaticSyncResult[]> {
        const pageSize = 100;
        let skip = 0;
        let totalItems = 0;
        const channels: Channel[] = [];

        do {
            const page = await this.channelService.findAll(ctx, { skip, take: pageSize });
            channels.push(...page.items);
            totalItems = page.totalItems;
            if (!page.items.length) break;
            skip += page.items.length;
        } while (skip < totalItems);

        const results: StoreCurrencyAutomaticSyncResult[] = [];
        const failures: string[] = [];
        for (const channel of channels) {
            const configuration = this.toConfiguration(channel);
            const hasBothCurrencies = SUPPORTED_CURRENCIES.every(currency =>
                configuration.availableCurrencyCodes.includes(currency),
            );
            if (configuration.rateMode !== 'AUTO' || !hasBothCurrencies) continue;

            try {
                const channelContext = await this.requestContextService.create({
                    apiType: 'admin',
                    channelOrToken: channel,
                });
                const updated = await this.syncPrices(channelContext);
                results.push({
                    channelCode: updated.channelCode,
                    syncedPriceCount: updated.syncedPriceCount,
                    rate: updated.cnyToMyrRate,
                });
            } catch (error) {
                failures.push(`${channel.code}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (failures.length) {
            throw new Error(`自动汇率同步失败：${failures.join('；')}`);
        }
        return results;
    }

    private async getActiveChannel(ctx: RequestContext): Promise<Channel> {
        const channel = await this.channelService.findOne(ctx, ctx.channelId);
        if (!channel) throw new UserInputError('当前店铺不存在');
        return channel;
    }

    private toConfiguration(channel: Channel): StoreCurrencyConfiguration {
        const customFields = channel.customFields as CurrencyChannelFields;
        const availableCurrencyCodes = channel.availableCurrencyCodes.filter(isSupportedCurrency);
        const defaultCurrencyCode = isSupportedCurrency(channel.defaultCurrencyCode)
            ? channel.defaultCurrencyCode
            : CurrencyCode.CNY;
        if (!availableCurrencyCodes.includes(defaultCurrencyCode)) {
            availableCurrencyCodes.unshift(defaultCurrencyCode);
        }
        return {
            channelId: channel.id,
            channelCode: channel.code,
            defaultCurrencyCode,
            availableCurrencyCodes,
            selectorEnabled: customFields.currencySelectorEnabled !== false,
            rateMode: normalizeRateMode(customFields.currencyRateMode),
            cnyToMyrRate: positiveNumber(customFields.cnyToMyrRate, 0.6),
            markupPercent: finiteNumber(customFields.currencyRateMarkupBps, 0) / 100,
            roundingMode: normalizeRoundingMode(customFields.currencyRoundingMode),
            rateSource: customFields.currencyRateSource?.trim() || null,
            rateUpdatedAt: nullableDate(customFields.currencyRateUpdatedAt),
            pricesUpdatedAt: nullableDate(customFields.currencyPricesUpdatedAt),
            syncedPriceCount: Math.max(0, Math.round(finiteNumber(customFields.currencySyncedPriceCount, 0))),
        };
    }
}

export function convertMinorPrice(
    price: number,
    baseCurrency: CurrencyCode,
    cnyToMyrRate: number,
    markupPercent: number,
    roundingMode: StoreCurrencyRoundingMode,
): number {
    const exchangeFactor = baseCurrency === CurrencyCode.CNY ? cnyToMyrRate : 1 / cnyToMyrRate;
    const raw = price * exchangeFactor * (1 + markupPercent / 100);
    const step = roundingMode === 'WHOLE' ? 100 : roundingMode === 'TENTH' ? 10 : 1;
    return Math.max(0, Math.round(raw / step) * step);
}

function normalizeInput(input: UpdateStoreCurrencyConfigurationInput): UpdateStoreCurrencyConfigurationInput {
    if (!isSupportedCurrency(input.defaultCurrencyCode)) {
        throw new UserInputError('目前仅支持 CNY 和 MYR');
    }
    const availableCurrencyCodes = Array.from(new Set(input.availableCurrencyCodes)).filter(
        isSupportedCurrency,
    );
    if (!availableCurrencyCodes.includes(input.defaultCurrencyCode)) {
        throw new UserInputError('可用币种必须包含主币种');
    }
    if (!Number.isFinite(input.cnyToMyrRate) || input.cnyToMyrRate <= 0) {
        throw new UserInputError('CNY 兑 MYR 汇率必须大于 0');
    }
    if (!Number.isFinite(input.markupPercent) || input.markupPercent < -20 || input.markupPercent > 100) {
        throw new UserInputError('汇率加价范围为 -20% 至 100%');
    }
    return {
        ...input,
        availableCurrencyCodes,
        rateMode: normalizeRateMode(input.rateMode),
        roundingMode: normalizeRoundingMode(input.roundingMode),
    };
}

function isSupportedCurrency(value: CurrencyCode): value is CurrencyCode.CNY | CurrencyCode.MYR {
    return SUPPORTED_CURRENCIES.includes(value as (typeof SUPPORTED_CURRENCIES)[number]);
}

function normalizeRateMode(value: unknown): StoreCurrencyRateMode {
    return value === 'MANUAL' ? 'MANUAL' : 'AUTO';
}

function normalizeRoundingMode(value: unknown): StoreCurrencyRoundingMode {
    return value === 'TENTH' || value === 'WHOLE' ? value : 'CENT';
}

function finiteNumber(value: unknown, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
    const number = finiteNumber(value, fallback);
    return number > 0 ? number : fallback;
}

function nullableDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
