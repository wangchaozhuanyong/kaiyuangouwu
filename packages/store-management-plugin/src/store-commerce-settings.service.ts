import { Injectable } from '@nestjs/common';
import type { ConfigArg, ConfigurableOperationInput } from '@vendure/common/lib/generated-types';
import { ContentTranslationService } from '@vendure/content-translation-plugin';
import {
    Channel,
    ChannelService,
    CountryService,
    idsAreEqual,
    isGraphQlErrorResult,
    LanguageCode,
    RequestContext,
    ShippingMethod,
    ShippingMethodService,
    TaxCategory,
    TaxRate,
    TaxRateService,
    TransactionalConnection,
    UserInputError,
    Zone,
    ZoneService,
} from '@vendure/core';
import { IsNull } from 'typeorm';

import { StoreCommerceConfiguration, UpdateMyStoreCommerceConfigurationInput } from './types';

const SHIPPING_CALCULATOR_CODE = 'physical-subtotal-shipping-calculator';
const SHIPPING_CHECKER_CODE = 'supported-destination-eligibility-checker';
const DEFAULT_FULFILLMENT_HANDLER = 'manual-fulfillment';
const PLACEHOLDER_SHIPPING_CODES = new Set(['standard-shipping', 'express-shipping', '标准配送']);

const defaultShippingCopy = {
    nameZh: '标准配送',
    nameEn: 'Standard delivery',
    descriptionZh: '适用于需要物流配送的实物商品。',
    descriptionEn: 'Standard delivery for physical products.',
};

@Injectable()
export class StoreCommerceSettingsService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly channelService: ChannelService,
        private readonly countryService: CountryService,
        private readonly zoneService: ZoneService,
        private readonly taxRateService: TaxRateService,
        private readonly shippingMethodService: ShippingMethodService,
        private readonly translations: ContentTranslationService,
    ) {}

    async get(ctx: RequestContext): Promise<StoreCommerceConfiguration> {
        const channel = await this.getActiveChannel(ctx);
        const [taxCategory, shippingMethods, taxZone, shippingZone] = await Promise.all([
            this.getDefaultTaxCategory(ctx),
            this.shippingMethodService.findAll(ctx),
            channel.defaultTaxZone
                ? this.zoneService.findOne(ctx, channel.defaultTaxZone.id)
                : Promise.resolve(undefined),
            channel.defaultShippingZone
                ? this.zoneService.findOne(ctx, channel.defaultShippingZone.id)
                : Promise.resolve(undefined),
        ]);
        const shippingMethodCode = storeShippingMethodCode(channel.code);
        const shippingMethod = shippingMethods.items.find(method => method.code === shippingMethodCode);
        const countryCode = shippingZone?.members?.[0]?.code ?? taxZone?.members?.[0]?.code ?? null;
        const taxRate =
            taxCategory && taxZone ? await this.findTaxRate(ctx, taxZone.id, taxCategory.id) : undefined;
        const taxZoneName = taxZone?.name ?? null;
        const shippingZoneName = shippingZone?.name ?? null;
        const managedTaxEnabled = taxZoneName === storeZoneName(channel.code, 'tax');

        return {
            channelId: channel.id,
            channelCode: channel.code,
            currencyCode: channel.defaultCurrencyCode,
            pricesIncludeTax: channel.pricesIncludeTax,
            countryCode,
            taxRate: taxRate?.value ?? 0,
            taxCategoryName: taxCategory?.name ?? null,
            taxZoneName,
            shippingZoneName,
            shippingMethodId: shippingMethod?.id ?? null,
            shippingMethodCode,
            shippingMethodNameZh: translatedField(
                shippingMethod,
                LanguageCode.zh_Hans,
                'name',
                defaultShippingCopy.nameZh,
            ),
            shippingMethodNameEn: translatedField(
                shippingMethod,
                LanguageCode.en,
                'name',
                defaultShippingCopy.nameEn,
            ),
            shippingDescriptionZh: translatedField(
                shippingMethod,
                LanguageCode.zh_Hans,
                'description',
                defaultShippingCopy.descriptionZh,
            ),
            shippingDescriptionEn: translatedField(
                shippingMethod,
                LanguageCode.en,
                'description',
                defaultShippingCopy.descriptionEn,
            ),
            baseRate: numericArg(shippingMethod?.calculator?.args, 'baseRate', 0),
            freeShippingThreshold: numericArg(shippingMethod?.calculator?.args, 'freeAbove', 0),
            shippingTaxRate: numericArg(shippingMethod?.calculator?.args, 'taxRate', 0),
            shippingPriceIncludesTax: booleanArg(
                shippingMethod?.calculator?.args,
                'priceIncludesTax',
                channel.pricesIncludeTax,
            ),
            estimateMinDays: numericArg(shippingMethod?.calculator?.args, 'estimateMinDays', 1),
            estimateMaxDays: numericArg(shippingMethod?.calculator?.args, 'estimateMaxDays', 3),
            blockedPostalPrefixes: stringArg(shippingMethod?.checker?.args, 'blockedPostalPrefixes', ''),
            ready:
                Boolean(countryCode && shippingMethod) &&
                (!managedTaxEnabled || Boolean(taxRate)) &&
                shippingZoneName === storeZoneName(channel.code, 'shipping') &&
                shippingMethod?.calculator?.code === SHIPPING_CALCULATOR_CODE &&
                shippingMethod?.checker?.code === SHIPPING_CHECKER_CODE,
        };
    }

    async update(
        ctx: RequestContext,
        input: UpdateMyStoreCommerceConfigurationInput,
    ): Promise<StoreCommerceConfiguration> {
        const normalized = normalizeStoreCommerceInput(input);
        const existing = await this.get(ctx);
        const prepared = await this.translations.prepareLocalizedFields([
            {
                path: 'name',
                sourceText: normalized.shippingMethodNameZh,
                targetText: normalized.shippingMethodNameEn,
                existingSourceText: existing.shippingMethodNameZh,
                existingTargetText: existing.shippingMethodNameEn,
                required: true,
            },
            {
                path: 'description',
                sourceText: normalized.shippingDescriptionZh,
                targetText: normalized.shippingDescriptionEn,
                existingSourceText: existing.shippingDescriptionZh,
                existingTargetText: existing.shippingDescriptionEn,
            },
        ]);
        const english = new Map(prepared.map(field => [field.path, field.translatedText]));
        normalized.shippingMethodNameEn = english.get('name') ?? '';
        normalized.shippingDescriptionEn = english.get('description') ?? '';
        const channel = await this.getActiveChannel(ctx);
        const country = await this.countryService.findOneByCode(ctx, normalized.countryCode);
        if (!country.enabled) {
            throw new UserInputError('所选配送国家已停用');
        }
        const [taxZone, shippingZone] = await Promise.all([
            this.ensureDedicatedZone(ctx, storeZoneName(channel.code, 'tax'), country.id),
            this.ensureDedicatedZone(ctx, storeZoneName(channel.code, 'shipping'), country.id),
        ]);
        const updatedChannel = await this.channelService.update(ctx, {
            id: channel.id,
            pricesIncludeTax: normalized.pricesIncludeTax,
            defaultTaxZoneId: taxZone.id,
            defaultShippingZoneId: shippingZone.id,
        });
        if (isGraphQlErrorResult(updatedChannel)) {
            throw new UserInputError(updatedChannel.message);
        }

        await this.ensureDefaultTaxRate(ctx, updatedChannel, taxZone, normalized.taxRate);
        const shippingMethod = await this.ensureShippingMethod(ctx, updatedChannel, normalized);
        await this.translations.recordPreparedFields(
            ctx,
            {
                channelId: ctx.channelId,
                entityType: ShippingMethod.name,
                entityId: shippingMethod.id,
            },
            prepared,
        );
        await this.detachPlaceholderShippingMethods(ctx, updatedChannel, shippingMethod.id);

        return this.get(ctx);
    }

    private async getActiveChannel(ctx: RequestContext): Promise<Channel> {
        const channel = await this.channelService.findOne(ctx, ctx.channelId);
        if (!channel) {
            throw new UserInputError('当前店铺不存在');
        }
        return channel;
    }

    private async getDefaultTaxCategory(ctx: RequestContext): Promise<TaxCategory | undefined> {
        const repository = this.connection.getRepository(ctx, TaxCategory);
        return (
            (await repository.findOne({ where: { isDefault: true } })) ??
            (await repository.findOne({ where: {}, order: { createdAt: 'ASC' } })) ??
            undefined
        );
    }

    private async ensureDedicatedZone(ctx: RequestContext, name: string, countryId: string | number) {
        const repository = this.connection.getRepository(ctx, Zone);
        const existing = await repository.findOne({ where: { name }, relations: ['members'] });
        if (!existing) {
            return this.zoneService.create(ctx, { name, memberIds: [countryId] });
        }
        const removeIds = existing.members
            .filter(member => !idsAreEqual(member.id, countryId))
            .map(member => member.id);
        if (removeIds.length > 0) {
            await this.zoneService.removeMembersFromZone(ctx, { zoneId: existing.id, memberIds: removeIds });
        }
        if (!existing.members.some(member => idsAreEqual(member.id, countryId))) {
            await this.zoneService.addMembersToZone(ctx, { zoneId: existing.id, memberIds: [countryId] });
        }
        return (await this.zoneService.findOne(ctx, existing.id)) ?? existing;
    }

    private async ensureDefaultTaxRate(ctx: RequestContext, channel: Channel, zone: Zone, value: number) {
        const categories = await this.connection.getRepository(ctx, TaxCategory).find({
            order: { isDefault: 'DESC', createdAt: 'ASC' },
        });
        const category = categories.find(item => item.isDefault) ?? categories[0];
        if (!category) {
            throw new UserInputError('系统尚未建立商品税种，无法保存店铺税率');
        }
        const existing = await this.findTaxRate(ctx, zone.id, category.id);
        const name = `${channel.code} ${category.name} tax`;
        if (existing) {
            await this.taxRateService.update(ctx, {
                id: existing.id,
                name,
                enabled: true,
                value,
                categoryId: category.id,
                zoneId: zone.id,
            });
        } else {
            await this.taxRateService.create(ctx, {
                name,
                enabled: true,
                value,
                categoryId: category.id,
                zoneId: zone.id,
            });
        }
    }

    private findTaxRate(ctx: RequestContext, zoneId: string | number, categoryId: string | number) {
        return this.connection.getRepository(ctx, TaxRate).findOne({
            where: {
                zone: { id: zoneId },
                category: { id: categoryId },
                customerGroup: IsNull(),
            },
            order: { enabled: 'DESC', createdAt: 'ASC' },
        });
    }

    private async ensureShippingMethod(
        ctx: RequestContext,
        channel: Channel,
        input: UpdateMyStoreCommerceConfigurationInput,
    ) {
        const code = storeShippingMethodCode(channel.code);
        const current = (await this.shippingMethodService.findAll(ctx)).items.find(
            method => method.code === code,
        );
        const checker = shippingCheckerInput(input.countryCode, input.blockedPostalPrefixes);
        const calculator = shippingCalculatorInput(input);
        const translations = [
            {
                languageCode: LanguageCode.zh_Hans,
                name: input.shippingMethodNameZh,
                description: input.shippingDescriptionZh,
            },
            {
                languageCode: LanguageCode.en,
                name: input.shippingMethodNameEn,
                description: input.shippingDescriptionEn,
            },
        ];
        if (current) {
            return this.shippingMethodService.update(ctx, {
                id: current.id,
                code,
                checker,
                calculator,
                fulfillmentHandler: DEFAULT_FULFILLMENT_HANDLER,
                translations,
            });
        }
        return this.shippingMethodService.create(ctx, {
            code,
            checker,
            calculator,
            fulfillmentHandler: DEFAULT_FULFILLMENT_HANDLER,
            translations,
        });
    }

    private async detachPlaceholderShippingMethods(
        ctx: RequestContext,
        channel: Channel,
        configuredMethodId: string | number,
    ) {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(channel.id, defaultChannel.id)) {
            return;
        }
        const methods = await this.shippingMethodService.findAll(ctx);
        for (const method of methods.items) {
            if (!idsAreEqual(method.id, configuredMethodId) && PLACEHOLDER_SHIPPING_CODES.has(method.code)) {
                await this.channelService.removeFromChannels(ctx, ShippingMethod, method.id, [channel.id]);
            }
        }
    }
}

export function normalizeStoreCommerceInput(
    input: UpdateMyStoreCommerceConfigurationInput,
): UpdateMyStoreCommerceConfigurationInput {
    const countryCode = input.countryCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/u.test(countryCode)) {
        throw new UserInputError('配送国家代码无效');
    }
    const shippingMethodNameZh = requiredText(input.shippingMethodNameZh, '中文配送名称', 80);
    const shippingMethodNameEn = optionalText(input.shippingMethodNameEn, '英文配送名称', 80);
    const shippingDescriptionZh = optionalText(input.shippingDescriptionZh, '中文配送说明', 500);
    const shippingDescriptionEn = optionalText(input.shippingDescriptionEn, '英文配送说明', 500);
    const taxRate = percentage(input.taxRate, '商品税率');
    const shippingTaxRate = percentage(input.shippingTaxRate, '运费税率');
    const baseRate = money(input.baseRate, '基础运费');
    const freeShippingThreshold = money(input.freeShippingThreshold, '免邮门槛');
    const estimateMinDays = deliveryDays(input.estimateMinDays, '最短配送天数');
    const estimateMaxDays = deliveryDays(input.estimateMaxDays, '最长配送天数');
    if (estimateMaxDays < estimateMinDays) {
        throw new UserInputError('最长配送天数不能小于最短配送天数');
    }

    return {
        ...input,
        countryCode,
        taxRate,
        shippingTaxRate,
        baseRate,
        freeShippingThreshold,
        estimateMinDays,
        estimateMaxDays,
        shippingMethodNameZh,
        shippingMethodNameEn,
        shippingDescriptionZh,
        shippingDescriptionEn,
        blockedPostalPrefixes: normalizePostalPrefixes(input.blockedPostalPrefixes),
    };
}

export function storeShippingMethodCode(channelCode: string): string {
    return `store-${channelCode.toLowerCase()}-standard-delivery`;
}

export function storeZoneName(channelCode: string, kind: 'tax' | 'shipping'): string {
    return `Store ${channelCode} ${kind}`;
}

export function shippingCalculatorInput(
    input: Pick<
        UpdateMyStoreCommerceConfigurationInput,
        | 'baseRate'
        | 'freeShippingThreshold'
        | 'shippingTaxRate'
        | 'shippingPriceIncludesTax'
        | 'estimateMinDays'
        | 'estimateMaxDays'
    >,
): ConfigurableOperationInput {
    return {
        code: SHIPPING_CALCULATOR_CODE,
        arguments: [
            { name: 'baseRate', value: String(input.baseRate) },
            { name: 'freeAbove', value: String(input.freeShippingThreshold) },
            { name: 'taxRate', value: String(input.shippingTaxRate) },
            { name: 'priceIncludesTax', value: String(input.shippingPriceIncludesTax) },
            { name: 'estimateMinDays', value: String(input.estimateMinDays) },
            { name: 'estimateMaxDays', value: String(input.estimateMaxDays) },
        ],
    };
}

export function shippingCheckerInput(
    countryCode: string,
    blockedPostalPrefixes: string,
): ConfigurableOperationInput {
    return {
        code: SHIPPING_CHECKER_CODE,
        arguments: [
            { name: 'allowedCountryCodes', value: countryCode },
            { name: 'blockedPostalPrefixes', value: blockedPostalPrefixes },
        ],
    };
}

function normalizePostalPrefixes(value: string): string {
    const prefixes = value
        .split(/[\s,;]+/u)
        .map(prefix => prefix.replace(/\s+/gu, '').toUpperCase())
        .filter(Boolean);
    if (prefixes.length > 50 || prefixes.some(prefix => !/^[A-Z0-9-]{1,20}$/u.test(prefix))) {
        throw new UserInputError('禁运邮编前缀格式无效，最多填写 50 个');
    }
    return [...new Set(prefixes)].join(',');
}

function requiredText(value: string, label: string, maxLength: number): string {
    const normalized = value.trim();
    if (!normalized || Array.from(normalized).length > maxLength) {
        throw new UserInputError(`${label}必须为 1 至 ${maxLength} 个字符`);
    }
    return normalized;
}

function optionalText(value: string, label: string, maxLength: number): string {
    const normalized = value.trim();
    if (Array.from(normalized).length > maxLength) {
        throw new UserInputError(`${label}不能超过 ${maxLength} 个字符`);
    }
    return normalized;
}

function percentage(value: number, label: string): number {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new UserInputError(`${label}必须在 0 至 100 之间`);
    }
    return Math.round(value * 100) / 100;
}

function money(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
        throw new UserInputError(`${label}金额无效`);
    }
    return value;
}

function deliveryDays(value: number, label: string): number {
    if (!Number.isInteger(value) || value < 0 || value > 365) {
        throw new UserInputError(`${label}必须为 0 至 365 的整数`);
    }
    return value;
}

function configArg(args: ConfigArg[] | undefined, name: string): string | undefined {
    return args?.find(arg => arg.name === name)?.value;
}

function stringArg(args: ConfigArg[] | undefined, name: string, fallback: string): string {
    return configArg(args, name) ?? fallback;
}

function numericArg(args: ConfigArg[] | undefined, name: string, fallback: number): number {
    const value = Number(configArg(args, name));
    return Number.isFinite(value) ? value : fallback;
}

function booleanArg(args: ConfigArg[] | undefined, name: string, fallback: boolean): boolean {
    const value = configArg(args, name);
    return value == null ? fallback : value === 'true';
}

function translatedField(
    method: ShippingMethod | undefined,
    languageCode: LanguageCode,
    field: 'name' | 'description',
    fallback: string,
): string {
    return (
        method?.translations?.find(translation => translation.languageCode === languageCode)?.[field] ??
        fallback
    );
}
