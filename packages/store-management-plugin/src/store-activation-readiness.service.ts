import { Injectable } from '@nestjs/common';
import { isUsableEnglishTranslation } from '@vendure/content-translation-plugin';
import {
    Channel,
    ID,
    PaymentMethod,
    ProductVariant,
    RequestContext,
    ShippingMethodService,
    TransactionalConnection,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import { StorefrontContentBlock } from '@vendure/storefront-content-plugin';

import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { StoreProfile } from './entities/store-profile.entity';
import { hasReadyShippingMethod } from './shipping-readiness';
import { StoreActivationCheck, StoreActivationCheckCode, StoreActivationReadiness } from './types';
import {
    USDT_TRC20_PAYMENT_HANDLER_CODE,
    USDT_TRC20_PAYMENT_METHOD_CODE,
} from './usdt/usdt-payment.constants';
export { hasReadyShippingMethod } from './shipping-readiness';

const TEST_PAYMENT_PATTERN = /(?:^|[-_\s])(demo|dummy|mock|sandbox|test)(?:$|[-_\s])|测试/iu;
const INTERNAL_BALANCE_PAYMENT_CODES = new Set(['referral-balance', 'referral-balance-payment']);
export function isUsableEnglishContent(value: unknown): boolean {
    return isUsableEnglishTranslation(value);
}

export function hasCompleteStoreProfile(profile: StoreProfile): boolean {
    return storeProfileActivationCheck(profile).ready;
}

/** Explain the exact saved fields, including automatic translations, without weakening readiness. */
export function storeProfileActivationCheck(profile: StoreProfile): StoreActivationCheck {
    const customFields = profile.channel?.customFields as
        { storefrontNameZh?: string | null; storefrontNameEn?: string | null } | undefined;
    const manual = [
        [customFields?.storefrontNameZh, '中文店铺名称', 'Chinese store name'],
        [profile.logoAssetId, '店铺图标', 'Store icon'],
        [profile.legalEntityName, '法定经营主体', 'Legal entity'],
        [profile.legalRegistrationCountry, '注册国家/地区', 'Registration country/region'],
        [profile.supportEmail, '客服邮箱', 'Support email'],
        [profile.privacyEmail, '隐私邮箱', 'Privacy email'],
    ].filter(([value]) => !String(value ?? '').trim());
    const automatic = [[customFields?.storefrontNameEn, '店铺名称', 'store name']].filter(
        ([value]) => !isUsableEnglishContent(value),
    );
    const ready = manual.length === 0 && automatic.length === 0;
    return {
        code: 'PROFILE',
        ready,
        message: ready
            ? '店铺品牌与经营资料已完整'
            : [
                  manual.length ? `请在“编辑档案”补充：${manual.map(field => field[1]).join('、')}` : '',
                  automatic.length
                      ? `英文资料尚未生成或未通过校验：${automatic.map(field => field[1]).join('、')}；请保存中文资料后查看翻译结果`
                      : '',
              ]
                  .filter(Boolean)
                  .join('；'),
        messageEn: ready
            ? 'Store brand and legal profile are complete'
            : [
                  manual.length
                      ? `Complete in Edit profile: ${manual.map(field => field[2]).join(', ')}`
                      : '',
                  automatic.length
                      ? `English content is missing or invalid: ${automatic.map(field => field[2]).join(', ')}. Save the Chinese content and review the translation`
                      : '',
              ]
                  .filter(Boolean)
                  .join('; '),
    };
}

export function isProductionPaymentMethod(
    method: Pick<PaymentMethod, 'code' | 'handler' | 'translations'>,
    registeredHandlerCodes?: ReadonlySet<string>,
    usdtPaymentReady = false,
): boolean {
    if (
        INTERNAL_BALANCE_PAYMENT_CODES.has(method.code) ||
        (method.handler?.code && INTERNAL_BALANCE_PAYMENT_CODES.has(method.handler.code))
    ) {
        return false;
    }
    if (
        registeredHandlerCodes &&
        (!method.handler?.code || !registeredHandlerCodes.has(method.handler.code))
    ) {
        return false;
    }
    if (
        method.code === USDT_TRC20_PAYMENT_METHOD_CODE ||
        method.handler?.code === USDT_TRC20_PAYMENT_HANDLER_CODE
    ) {
        if (
            !usdtPaymentReady ||
            method.code !== USDT_TRC20_PAYMENT_METHOD_CODE ||
            method.handler?.code !== USDT_TRC20_PAYMENT_HANDLER_CODE
        ) {
            return false;
        }
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
    shipping: boolean;
    /** Accepted for older callers; payment setup is not a store activation requirement. */
    payment?: boolean;
}

const checkMessages: Record<Exclude<StoreActivationCheckCode, 'PAYMENT'>, { zh: string; en: string }> = {
    PROFILE: {
        zh: '在“编辑档案”填写中文店铺名称、店铺图标，以及法定经营主体、注册国家/地区和客服/隐私邮箱（英文自动生成）',
        en: 'In Edit profile, fill in the store name, icon, legal entity, registration country/region and support/privacy emails (English auto-generated)',
    },
    DOMAIN: { zh: '验证并设置主域名', en: 'Verify and select a primary domain' },
    PASSWORD: {
        zh: '所有店铺管理员完成首次改密',
        en: 'Complete the initial password change for every store administrator',
    },
    CATALOG: {
        zh: '至少上架一个资料完整的可售商品（英文自动生成）',
        en: 'Publish at least one complete sellable product (English is generated automatically)',
    },
    SUPPORT: {
        zh: '发布客服内容（英文自动生成）',
        en: 'Publish support content (English is generated automatically)',
    },
    PRIVACY: {
        zh: '发布隐私政策（英文自动生成）',
        en: 'Publish the privacy policy (English is generated automatically)',
    },
    TERMS: {
        zh: '发布使用条款（英文自动生成）',
        en: 'Publish the terms (English is generated automatically)',
    },
    SHIPPING: {
        zh: '配置本店配送区域，并启用通用包邮或本店配送模板',
        en: 'Configure the store shipping zone and enable a shared or private shipping template',
    },
};

export function evaluateStoreActivationReadiness(
    snapshot: StoreActivationSnapshot,
    commerceMode: 'DIGITAL_ONLY' | 'PHYSICAL_ONLY' | 'HYBRID' = 'HYBRID',
): StoreActivationReadiness {
    const mappings: Array<[Exclude<StoreActivationCheckCode, 'PAYMENT'>, boolean]> = [
        ['PROFILE', snapshot.profile],
        ['DOMAIN', snapshot.domain],
        ['PASSWORD', snapshot.password],
        ['CATALOG', snapshot.catalog],
        ['SUPPORT', snapshot.support],
        ['PRIVACY', snapshot.privacy],
        ['TERMS', snapshot.terms],
        ...(commerceMode === 'DIGITAL_ONLY'
            ? []
            : ([['SHIPPING', snapshot.shipping]] as Array<
                  [Exclude<StoreActivationCheckCode, 'PAYMENT'>, boolean]
              >)),
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
        private readonly shippingMethodService: ShippingMethodService,
    ) {}

    async get(ctx: RequestContext, profile: StoreProfile): Promise<StoreActivationReadiness> {
        const channel = await this.connection.getRepository(ctx, Channel).findOne({
            where: { id: profile.channelId },
            relations: { defaultTaxZone: true, defaultShippingZone: { members: true } },
        });
        if (!channel) {
            return evaluateStoreActivationReadiness(this.emptySnapshot());
        }

        const [domain, temporaryPasswordCount, catalogVariants, contentBlocks, shippingMethods] =
            await Promise.all([
                this.connection.getRepository(ctx, StoreDomain).findOne({
                    where: {
                        channelId: profile.channelId,
                        isPrimary: true,
                        status: 'ACTIVE',
                    },
                }),
                this.temporaryPasswordCount(ctx, profile.channelId),
                this.connection.getRepository(ctx, ProductVariant).find({
                    where: {
                        enabled: true,
                        product: { enabled: true },
                        channels: { id: profile.channelId },
                    },
                    relations: { translations: true, product: { translations: true } },
                }),
                this.connection.getRepository(ctx, StorefrontContentBlock).find({
                    where: { channelId: profile.channelId, enabled: true },
                    relations: { items: { translations: true } },
                }),
                this.shippingMethodService.getActiveShippingMethods(ctx.copy({ channel })),
            ]);

        const activeContent = contentBlocks.filter(block => this.isActiveContent(block));

        const profileCheck = storeProfileActivationCheck(profile);
        const readiness = evaluateStoreActivationReadiness(
            {
                profile: profileCheck.ready,
                domain: Boolean(domain),
                password: temporaryPasswordCount === 0,
                catalog: this.hasBilingualCatalog(catalogVariants),
                support: this.hasSupportContent(activeContent),
                privacy: this.hasLegalContent(activeContent, 'privacy'),
                terms: this.hasLegalContent(activeContent, 'terms'),
                shipping: hasReadyShippingMethod(channel, shippingMethods),
            },
            channel.customFields?.commerceMode ?? 'DIGITAL_ONLY',
        );
        readiness.checks = readiness.checks.map(check => (check.code === 'PROFILE' ? profileCheck : check));
        return readiness;
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
            shipping: false,
        };
    }

    private hasBilingualCatalog(variants: ProductVariant[]): boolean {
        return (
            variants.length > 0 &&
            variants.every(
                variant =>
                    this.hasBilingualTranslations(variant.translations, ['name']) &&
                    this.hasBilingualTranslations(variant.product?.translations, [
                        'name',
                        'slug',
                        'description',
                    ]),
            )
        );
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
                    fields.every(field => {
                        const value = translation[field];
                        return languageCode === 'en'
                            ? isUsableEnglishContent(value)
                            : typeof value === 'string' && value.trim().length > 0;
                    }),
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
