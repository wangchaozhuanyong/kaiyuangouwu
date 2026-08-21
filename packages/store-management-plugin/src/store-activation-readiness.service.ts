import { Injectable } from '@nestjs/common';
import {
    Channel,
    ConfigService,
    ID,
    PaymentMethod,
    ProductVariant,
    RequestContext,
    ShippingMethod,
    TaxRate,
    TransactionalConnection,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import { StorefrontContentBlock } from '@vendure/storefront-content-plugin';
import { IsNull } from 'typeorm';

import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { StoreProfile } from './entities/store-profile.entity';
import { storeShippingMethodCode, storeZoneName } from './store-commerce-settings.service';
import { StoreActivationCheck, StoreActivationCheckCode, StoreActivationReadiness } from './types';

const TEST_PAYMENT_PATTERN = /(?:^|[-_\s])(demo|dummy|mock|sandbox|test)(?:$|[-_\s])|测试/iu;
const PLACEHOLDER_TAX_RATE = 1.23;
const SHIPPING_CALCULATOR_CODE = 'physical-subtotal-shipping-calculator';
const SHIPPING_CHECKER_CODE = 'supported-destination-eligibility-checker';

export function isProductionPaymentMethod(
    method: Pick<PaymentMethod, 'code' | 'handler' | 'translations'>,
    registeredHandlerCodes?: ReadonlySet<string>,
): boolean {
    if (
        registeredHandlerCodes &&
        (!method.handler?.code || !registeredHandlerCodes.has(method.handler.code))
    ) {
        return false;
    }
    const searchable = [
        method.code,
        method.handler?.code,
        ...(method.translations ?? []).flatMap(translation => [translation.name, translation.description]),
    ].join(' ');
    return !TEST_PAYMENT_PATTERN.test(searchable);
}

export interface StoreActivationSnapshot {
    profile: boolean;
    domain: boolean;
    password: boolean;
    catalog: boolean;
    support: boolean;
    privacy: boolean;
    terms: boolean;
    tax: boolean;
    shipping: boolean;
    payment: boolean;
}

const checkMessages: Record<StoreActivationCheckCode, { zh: string; en: string }> = {
    PROFILE: {
        zh: '补全中英文店铺名称、简介和 Logo',
        en: 'Complete both store names, descriptions, and the logo',
    },
    DOMAIN: { zh: '验证并设置主域名', en: 'Verify and select a primary domain' },
    PASSWORD: {
        zh: '所有店铺管理员完成首次改密',
        en: 'Complete the initial password change for every store administrator',
    },
    CATALOG: { zh: '至少上架一个可售商品', en: 'Publish at least one sellable product' },
    SUPPORT: { zh: '发布中英文客服内容', en: 'Publish support content in Chinese and English' },
    PRIVACY: { zh: '发布中英文隐私政策', en: 'Publish the privacy policy in Chinese and English' },
    TERMS: { zh: '发布中英文使用条款', en: 'Publish the terms in Chinese and English' },
    TAX: { zh: '保存店铺专属税区和正式税率', en: 'Save the store tax zone and production tax rate' },
    SHIPPING: { zh: '保存店铺专属配送区域和配送方式', en: 'Save the store shipping zone and method' },
    PAYMENT: { zh: '启用至少一种非测试支付方式', en: 'Enable at least one non-test payment method' },
};

export function evaluateStoreActivationReadiness(
    snapshot: StoreActivationSnapshot,
): StoreActivationReadiness {
    const mappings: Array<[StoreActivationCheckCode, boolean]> = [
        ['PROFILE', snapshot.profile],
        ['DOMAIN', snapshot.domain],
        ['PASSWORD', snapshot.password],
        ['CATALOG', snapshot.catalog],
        ['SUPPORT', snapshot.support],
        ['PRIVACY', snapshot.privacy],
        ['TERMS', snapshot.terms],
        ['TAX', snapshot.tax],
        ['SHIPPING', snapshot.shipping],
        ['PAYMENT', snapshot.payment],
    ];
    const checks: StoreActivationCheck[] = mappings.map(([code, ready]) => ({
        code,
        ready,
        message: checkMessages[code].zh,
        messageEn: checkMessages[code].en,
    }));
    return { ready: checks.every(check => check.ready), checks };
}

@Injectable()
export class StoreActivationReadinessService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly configService: ConfigService,
    ) {}

    async get(ctx: RequestContext, profile: StoreProfile): Promise<StoreActivationReadiness> {
        const channel = await this.connection.getRepository(ctx, Channel).findOne({
            where: { id: profile.channelId },
            relations: { defaultTaxZone: true, defaultShippingZone: true },
        });
        if (!channel) {
            return evaluateStoreActivationReadiness(this.emptySnapshot());
        }

        const [domain, temporaryPasswordCount, catalogCount, contentBlocks, paymentMethods, shippingMethods] =
            await Promise.all([
                this.connection.getRepository(ctx, StoreDomain).findOne({
                    where: {
                        channelId: profile.channelId,
                        isPrimary: true,
                        status: 'ACTIVE',
                    },
                }),
                this.temporaryPasswordCount(ctx, profile.channelId),
                this.connection.getRepository(ctx, ProductVariant).count({
                    where: {
                        enabled: true,
                        product: { enabled: true },
                        channels: { id: profile.channelId },
                    },
                }),
                this.connection.getRepository(ctx, StorefrontContentBlock).find({
                    where: { channelId: profile.channelId, enabled: true },
                    relations: { items: { translations: true } },
                }),
                this.connection.getRepository(ctx, PaymentMethod).find({
                    where: { enabled: true, channels: { id: profile.channelId } },
                    relations: { channels: true, translations: true },
                }),
                this.connection.getRepository(ctx, ShippingMethod).find({
                    where: { channels: { id: profile.channelId }, deletedAt: IsNull() },
                    relations: { channels: true },
                }),
            ]);

        const taxRate = channel.defaultTaxZone
            ? await this.connection.getRepository(ctx, TaxRate).findOne({
                  where: {
                      enabled: true,
                      zone: { id: channel.defaultTaxZone.id },
                      customerGroup: IsNull(),
                  },
                  order: { createdAt: 'ASC' },
              })
            : null;
        const storeShippingMethod = shippingMethods.find(
            method => method.code === storeShippingMethodCode(channel.code),
        );
        const activeContent = contentBlocks.filter(block => this.isActiveContent(block));
        const registeredPaymentHandlers = new Set(
            this.configService.paymentOptions.paymentMethodHandlers.map(handler => handler.code),
        );

        return evaluateStoreActivationReadiness({
            profile: this.hasCompleteProfile(profile),
            domain: Boolean(domain),
            password: temporaryPasswordCount === 0,
            catalog: catalogCount > 0,
            support: this.hasSupportContent(activeContent),
            privacy: this.hasLegalContent(activeContent, 'privacy'),
            terms: this.hasLegalContent(activeContent, 'terms'),
            tax:
                channel.defaultTaxZone?.name === storeZoneName(channel.code, 'tax') &&
                Boolean(
                    taxRate &&
                    Number.isFinite(taxRate.value) &&
                    Math.abs(taxRate.value - PLACEHOLDER_TAX_RATE) > 0.000_001,
                ),
            shipping:
                channel.defaultShippingZone?.name === storeZoneName(channel.code, 'shipping') &&
                storeShippingMethod?.calculator?.code === SHIPPING_CALCULATOR_CODE &&
                storeShippingMethod?.checker?.code === SHIPPING_CHECKER_CODE,
            payment: paymentMethods.some(method =>
                isProductionPaymentMethod(method, registeredPaymentHandlers),
            ),
        });
    }

    private emptySnapshot(): StoreActivationSnapshot {
        return {
            profile: false,
            domain: false,
            password: false,
            catalog: false,
            support: false,
            privacy: false,
            terms: false,
            tax: false,
            shipping: false,
            payment: false,
        };
    }

    private hasCompleteProfile(profile: StoreProfile): boolean {
        const customFields = profile.channel?.customFields as
            | { storefrontNameZh?: string | null; storefrontNameEn?: string | null }
            | undefined;
        return [
            customFields?.storefrontNameZh,
            customFields?.storefrontNameEn,
            profile.descriptionZh,
            profile.descriptionEn,
            profile.logoAssetId,
        ].every(value => String(value ?? '').trim().length > 0);
    }

    private isActiveContent(block: StorefrontContentBlock): boolean {
        const now = Date.now();
        return (!block.startsAt || +block.startsAt <= now) && (!block.endsAt || +block.endsAt > now);
    }

    private hasSupportContent(blocks: StorefrontContentBlock[]): boolean {
        return blocks
            .filter(block => block.type === 'SUPPORT')
            .some(block => this.hasBilingualBlockText(block, ['title', 'body']));
    }

    private hasLegalContent(blocks: StorefrontContentBlock[], kind: 'privacy' | 'terms'): boolean {
        const blockCodes = kind === 'privacy' ? ['privacy', 'privacy-policy'] : ['terms', 'terms-of-use'];
        return blocks
            .filter(block => block.type === 'LEGAL')
            .some(block => {
                if (blockCodes.includes(block.code.trim().toLowerCase())) {
                    return this.hasBilingualBlockText(block, ['body']);
                }
                const matchingItems = (block.items ?? []).filter(item => {
                    if (!item.enabled || item.targetType !== 'PAGE') return false;
                    const target = (item.targetValue ?? '').trim().toLowerCase().replace(/^#?\//, '');
                    return target === `legal?id=${kind}`;
                });
                return matchingItems.some(item =>
                    this.hasBilingualTranslations(item.translations, ['description']),
                );
            });
    }

    private hasBilingualBlockText(block: StorefrontContentBlock, fields: Array<'title' | 'body'>): boolean {
        return this.hasBilingualTranslations(block.translations, fields);
    }

    private hasBilingualTranslations(
        translations: Array<Record<string, unknown>> | undefined,
        fields: string[],
    ): boolean {
        return ['zh_Hans', 'en'].every(languageCode =>
            (translations ?? []).some(
                translation =>
                    translation.languageCode === languageCode &&
                    fields.every(field => String(translation[field] ?? '').trim().length > 0),
            ),
        );
    }

    private temporaryPasswordCount(ctx: RequestContext, channelId: ID): Promise<number> {
        return this.connection
            .getRepository(ctx, StoreAdministratorAccess)
            .createQueryBuilder('access')
            .innerJoin('access.administrator', 'administrator')
            .innerJoin('administrator.user', 'user')
            .innerJoin('user.roles', 'role')
            .innerJoin('role.channels', 'channel')
            .where('channel.id = :channelId', { channelId })
            .andWhere('access.mustChangePassword = :mustChangePassword', { mustChangePassword: true })
            .getCount();
    }
}
