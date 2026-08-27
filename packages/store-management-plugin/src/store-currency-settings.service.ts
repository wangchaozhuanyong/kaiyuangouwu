import { Injectable } from '@nestjs/common';
import {
    Channel,
    ChannelService,
    CurrencyCode,
    EventBus,
    isGraphQlErrorResult,
    OrderService,
    ProductVariant,
    ProductVariantPrice,
    ProductVariantPriceEvent,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { LessThan, MoreThan } from 'typeorm';

import { StorefrontUsdtCheckoutQuote } from './entities/storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from './entities/storefront-usdt-payment-intent.entity';
import {
    StoreCurrencyConfiguration,
    StoreCurrencyRateMode,
    StoreCurrencyRoundingMode,
    StorefrontUsdtCheckoutQuoteView,
    UpdateStoreCurrencyConfigurationInput,
} from './types';
import { UsdtOtcRateService } from './usdt-otc-rate.service';
import { UsdtPaymentService } from './usdt/usdt-payment.service';

const SUPPORTED_CURRENCIES = [CurrencyCode.CNY, CurrencyCode.MYR] as const;
const BNM_EXCHANGE_RATE_URL = 'https://api.bnm.gov.my/public/exchange-rate/CNY?session=1200&quote=rm';
const BNM_RATE_SOURCE = 'Bank Negara Malaysia';
const USDT_RATE_MAX_AGE_MS = 15 * 60 * 1000;
const USDT_CHECKOUT_QUOTE_TTL_MS = 10 * 60 * 1000;
const USDT_QUOTE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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
    usdtDisplayEnabled?: boolean | null;
    usdtRateMarkupBps?: number | null;
    cnyPerUsdtRate?: number | null;
    usdtRateSource?: string | null;
    usdtRateUpdatedAt?: Date | string | null;
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
        private readonly usdtOtcRateService: UsdtOtcRateService,
        private readonly orderService: OrderService,
        private readonly usdtPaymentService: UsdtPaymentService,
    ) {}

    async get(ctx: RequestContext): Promise<StoreCurrencyConfiguration> {
        return this.toConfiguration(await this.getActiveChannel(ctx));
    }

    getPublic(ctx: RequestContext): StoreCurrencyConfiguration {
        return {
            ...this.toConfiguration(ctx.channel),
            ...publicCurrencySelection(ctx.channel),
        };
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
                usdtDisplayEnabled: normalized.usdtDisplayEnabled,
                usdtRateMarkupBps: Math.round(normalized.usdtMarkupPercent * 100),
            },
        });
        if (isGraphQlErrorResult(updated)) throw new UserInputError(updated.message);
        return this.toConfiguration(updated);
    }

    async refreshUsdtRate(ctx: RequestContext): Promise<StoreCurrencyConfiguration> {
        const channel = await this.getActiveChannel(ctx);
        const snapshot = await this.usdtOtcRateService.fetchCnyRate();
        const customFields = channel.customFields as CurrencyChannelFields;
        const updated = await this.channelService.update(ctx, {
            id: channel.id,
            customFields: {
                ...customFields,
                cnyPerUsdtRate: snapshot.cnyPerUsdtRate,
                usdtRateSource: snapshot.source,
                usdtRateUpdatedAt: snapshot.updatedAt,
            },
        });
        if (isGraphQlErrorResult(updated)) throw new UserInputError(updated.message);
        return this.toConfiguration(updated);
    }

    async createCheckoutUsdtQuote(ctx: RequestContext): Promise<StorefrontUsdtCheckoutQuoteView> {
        const activeOrderId = ctx.session?.activeOrderId;
        if (!activeOrderId) throw new UserInputError('当前没有可结算订单');
        const order = await this.orderService.findOne(ctx, activeOrderId, ['payments']);
        if (!order || !['AddingItems', 'ArrangingPayment'].includes(order.state)) {
            throw new UserInputError('当前订单状态不能生成 USDT 报价');
        }
        if (order.currencyCode !== CurrencyCode.CNY && order.currencyCode !== CurrencyCode.MYR) {
            throw new UserInputError('USDT 报价目前仅支持 CNY 和 MYR 订单');
        }
        const configuration = await this.get(ctx);
        if (!configuration.usdtRateAvailable) {
            throw new UserInputError('USDT 报价已过期，请等待系统更新后重试');
        }
        const fiatPerUsdtRate =
            order.currencyCode === CurrencyCode.CNY
                ? configuration.cnyPerUsdtRate
                : configuration.myrPerUsdtRate;
        if (!fiatPerUsdtRate) throw new UserInputError('当前订单币种缺少 USDT 报价');

        const coveredAmount = (order.payments ?? [])
            .filter(payment => payment.state === 'Authorized' || payment.state === 'Settled')
            .reduce((total, payment) => total + payment.amount, 0);
        const fiatAmount = Math.max(0, order.totalWithTax - coveredAmount);
        if (!fiatAmount) throw new UserInputError('当前订单已无待支付金额');

        const repository = this.connection.getRepository(ctx, StorefrontUsdtCheckoutQuote);
        const current = await repository.findOne({
            where: {
                orderId: order.id,
                fiatCurrencyCode: order.currencyCode,
                fiatAmount,
                expiresAt: MoreThan(new Date()),
            },
            order: { createdAt: 'DESC' },
        });
        if (current) {
            const existingIntent = await this.ensureCheckoutPaymentIntent(ctx, current);
            return this.toCheckoutQuoteView(current, existingIntent);
        }

        const usdtAmount = calculateUsdtCheckoutAmount(
            fiatAmount,
            fiatPerUsdtRate,
            configuration.usdtMarkupPercent,
        );
        const quote = await repository.save(
            new StorefrontUsdtCheckoutQuote({
                channelId: ctx.channelId,
                orderId: order.id,
                fiatCurrencyCode: order.currencyCode,
                fiatAmount,
                fiatPerUsdtRate,
                markupBps: Math.round(configuration.usdtMarkupPercent * 100),
                usdtAmount: usdtAmount.toFixed(6),
                source: configuration.usdtRateSource ?? 'USDT OTC',
                expiresAt: new Date(Date.now() + USDT_CHECKOUT_QUOTE_TTL_MS),
            }),
        );
        const intent = await this.ensureCheckoutPaymentIntent(ctx, quote);
        return this.toCheckoutQuoteView(quote, intent);
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

    async refreshAllEnabledUsdtRates(ctx: RequestContext): Promise<StoreCurrencyAutomaticSyncResult[]> {
        await this.connection.getRepository(ctx, StorefrontUsdtCheckoutQuote).delete({
            expiresAt: LessThan(new Date(Date.now() - USDT_QUOTE_RETENTION_MS)),
        });
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

        const enabledChannels = channels.filter(channel => this.toConfiguration(channel).usdtDisplayEnabled);
        if (!enabledChannels.length) return [];

        const snapshot = await this.usdtOtcRateService.fetchCnyRate();
        const results: StoreCurrencyAutomaticSyncResult[] = [];
        for (const channel of enabledChannels) {
            const channelContext = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: channel,
            });
            const customFields = channel.customFields as CurrencyChannelFields;
            const updated = await this.channelService.update(channelContext, {
                id: channel.id,
                customFields: {
                    ...customFields,
                    cnyPerUsdtRate: snapshot.cnyPerUsdtRate,
                    usdtRateSource: snapshot.source,
                    usdtRateUpdatedAt: snapshot.updatedAt,
                },
            });
            if (isGraphQlErrorResult(updated)) {
                throw new Error(`${channel.code}: ${updated.message}`);
            }
            results.push({
                channelCode: channel.code,
                syncedPriceCount: snapshot.sampledAdvertisementCount,
                rate: snapshot.cnyPerUsdtRate,
            });
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
        const usdtPayment = this.usdtPaymentService.walletStatus();
        const availableCurrencyCodes = channel.availableCurrencyCodes.filter(isSupportedCurrency);
        const defaultCurrencyCode = isSupportedCurrency(channel.defaultCurrencyCode)
            ? channel.defaultCurrencyCode
            : CurrencyCode.CNY;
        if (!availableCurrencyCodes.includes(defaultCurrencyCode)) {
            availableCurrencyCodes.unshift(defaultCurrencyCode);
        }
        const cnyPerUsdtRate = nullablePositiveNumber(customFields.cnyPerUsdtRate);
        const usdtRateUpdatedAt = nullableDate(customFields.usdtRateUpdatedAt);
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
            usdtDisplayEnabled: customFields.usdtDisplayEnabled === true,
            usdtMarkupPercent: finiteNumber(customFields.usdtRateMarkupBps, 0) / 100,
            cnyPerUsdtRate,
            myrPerUsdtRate: cnyPerUsdtRate
                ? cnyPerUsdtRate * positiveNumber(customFields.cnyToMyrRate, 0.6)
                : null,
            usdtRateSource: customFields.usdtRateSource?.trim() || null,
            usdtRateUpdatedAt,
            usdtRateAvailable:
                customFields.usdtDisplayEnabled === true &&
                cnyPerUsdtRate !== null &&
                usdtRateUpdatedAt !== null &&
                Date.now() - usdtRateUpdatedAt.getTime() <= USDT_RATE_MAX_AGE_MS,
            usdtPaymentConfigured: usdtPayment.configured,
            usdtPaymentNetwork: usdtPayment.network,
            usdtReceivingAddressMasked: usdtPayment.receivingAddressMasked,
            usdtReceivingAddressFingerprint: usdtPayment.receivingAddressFingerprint,
        };
    }

    private async ensureCheckoutPaymentIntent(
        ctx: RequestContext,
        quote: StorefrontUsdtCheckoutQuote,
    ): Promise<StorefrontUsdtPaymentIntent> {
        try {
            return await this.usdtPaymentService.ensureIntent(ctx, quote);
        } catch (error) {
            throw new UserInputError(error instanceof Error ? error.message : 'USDT-TRC20 收款暂不可用');
        }
    }

    private toCheckoutQuoteView(
        quote: StorefrontUsdtCheckoutQuote,
        intent: StorefrontUsdtPaymentIntent,
    ): StorefrontUsdtCheckoutQuoteView {
        return {
            id: quote.id,
            fiatCurrencyCode: quote.fiatCurrencyCode,
            fiatAmount: quote.fiatAmount,
            fiatPerUsdtRate: quote.fiatPerUsdtRate,
            markupPercent: quote.markupBps / 100,
            usdtAmount: Number(intent.expectedUsdtAmount),
            source: quote.source,
            network: intent.network,
            tokenContractAddress: intent.tokenContractAddress,
            receivingAddress: intent.receivingAddress,
            receivingAddressFingerprint: intent.receivingAddressFingerprint,
            paymentStatus: intent.status,
            transactionId: intent.transactionId,
            settledAt: intent.settledAt,
            createdAt: quote.createdAt,
            expiresAt: quote.expiresAt,
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

export function calculateUsdtCheckoutAmount(
    fiatMinorAmount: number,
    fiatPerUsdtRate: number,
    markupPercent: number,
): number {
    if (!Number.isFinite(fiatMinorAmount) || fiatMinorAmount <= 0) return 0;
    if (!Number.isFinite(fiatPerUsdtRate) || fiatPerUsdtRate <= 0) return 0;
    const markupFactor = 1 + Math.max(0, markupPercent) / 100;
    return Math.ceil((fiatMinorAmount / 100 / fiatPerUsdtRate) * markupFactor * 10_000) / 10_000;
}

export function publicCurrencySelection(
    channel: Pick<Channel, 'defaultCurrencyCode' | 'availableCurrencyCodes'>,
): Pick<StoreCurrencyConfiguration, 'defaultCurrencyCode' | 'availableCurrencyCodes'> {
    const availableCurrencyCodes = Array.from(new Set(channel.availableCurrencyCodes));
    if (!availableCurrencyCodes.includes(channel.defaultCurrencyCode)) {
        availableCurrencyCodes.unshift(channel.defaultCurrencyCode);
    }
    return {
        defaultCurrencyCode: channel.defaultCurrencyCode,
        availableCurrencyCodes,
    };
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
    if (
        !Number.isFinite(input.usdtMarkupPercent) ||
        input.usdtMarkupPercent < 0 ||
        input.usdtMarkupPercent > 20
    ) {
        throw new UserInputError('USDT 报价加价范围为 0% 至 20%');
    }
    return {
        ...input,
        availableCurrencyCodes,
        rateMode: normalizeRateMode(input.rateMode),
        roundingMode: normalizeRoundingMode(input.roundingMode),
    };
}

function nullablePositiveNumber(value: unknown): number | null {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
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
