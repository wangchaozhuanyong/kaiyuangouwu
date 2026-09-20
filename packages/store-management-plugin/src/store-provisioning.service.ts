import { Injectable } from '@nestjs/common';
import { Permission } from '@vendure/common/lib/generated-types';
import { ID, Type } from '@vendure/common/lib/shared-types';
import {
    ContentTranslationService,
    PreparedLocalizedContentField,
} from '@vendure/content-translation-plugin';
import {
    AdministratorService,
    Channel,
    ChannelService,
    Collection,
    CollectionService,
    Facet,
    FacetService,
    FacetValueService,
    InternalServerError,
    isGraphQlErrorResult,
    PaymentMethod,
    PaymentMethodService,
    ProductOptionGroup,
    ProductOptionGroupService,
    ProductOptionService,
    RequestContext,
    Role,
    RoleService,
    SellerService,
    ShippingMethod,
    ShippingMethodService,
    StockLocation,
    StockLocationService,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';
import { storeDomainPermission } from '@vendure/store-domain-plugin';
import { storefrontContentPermission } from '@vendure/storefront-content-plugin';
import { randomBytes } from 'node:crypto';
import { IsNull } from 'typeorm';

import { storeProfilePermission } from './constants';
import { StoreProfile } from './entities/store-profile.entity';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import {
    adjustReferralBalancePermission,
    manageReferralWithdrawalPermission,
    referralPermission,
} from './referral/referral.constants';
import { StoreProfileService } from './store-profile.service';
import { ProvisionStoreInput, ProvisionStoreResult } from './types';
import { USDT_TRC20_PAYMENT_METHOD_CODE } from './usdt/usdt-payment.constants';

const CONTROLLED_TEST_PAYMENT_HANDLER_CODE = 'controlled-test-payment-handler';
const CONTROLLED_TEST_PAYMENT_METHOD_PREFIX = 'controlled-test-payment-';

export function remapTemplateOperationIds(value: unknown, idMap: ReadonlyMap<string, ID>): unknown {
    if (typeof value === 'string') {
        const direct = idMap.get(value);
        if (direct != null) return direct;
        if (
            (value.startsWith('[') && value.endsWith(']')) ||
            (value.startsWith('{') && value.endsWith('}'))
        ) {
            try {
                const parsed = JSON.parse(value);
                const remapped = remapTemplateOperationIds(parsed, idMap);
                return JSON.stringify(remapped);
            } catch {
                return value;
            }
        }
        return value;
    }
    if (Array.isArray(value)) return value.map(item => remapTemplateOperationIds(item, idMap));
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, remapTemplateOperationIds(item, idMap)]),
        );
    }
    return value;
}

export function cloneTemplateCollectionFilters(
    filters: Array<{ code: string; args: Array<{ name: string; value: string }> }>,
    facetValueIds: ReadonlyMap<string, ID>,
) {
    return filters
        .filter(filter => !['product-id-filter', 'variant-id-filter'].includes(filter.code))
        .map(filter => ({
            code: filter.code,
            arguments: filter.args.map(argument => ({
                name: argument.name,
                value: String(remapTemplateOperationIds(argument.value, facetValueIds)),
            })),
        }));
}

export const storeAdministratorPermissions: Permission[] = [
    Permission.ReadChannel,
    Permission.ReadCatalog,
    Permission.CreateProduct,
    Permission.ReadProduct,
    Permission.UpdateProduct,
    Permission.DeleteProduct,
    Permission.CreateCollection,
    Permission.ReadCollection,
    Permission.UpdateCollection,
    Permission.DeleteCollection,
    Permission.CreateFacet,
    Permission.ReadFacet,
    Permission.UpdateFacet,
    Permission.DeleteFacet,
    Permission.CreateAsset,
    Permission.ReadAsset,
    Permission.UpdateAsset,
    Permission.DeleteAsset,
    Permission.ReadOrder,
    Permission.UpdateOrder,
    Permission.ReadCustomer,
    Permission.ReadStockLocation,
    Permission.ReadShippingMethod,
    Permission.ReadPaymentMethod,
    Permission.CreatePromotion,
    Permission.ReadPromotion,
    Permission.UpdatePromotion,
    Permission.DeletePromotion,
    Permission.CreateTag,
    Permission.ReadTag,
    Permission.UpdateTag,
    Permission.DeleteTag,
    Permission.ReadCountry,
    Permission.ReadZone,
    'CreateCatalogImport' as Permission,
    'ReadCatalogImport' as Permission,
    'UpdateCatalogImport' as Permission,
    'DeleteCatalogImport' as Permission,
    storefrontContentPermission.Create,
    storefrontContentPermission.Read,
    storefrontContentPermission.Update,
    storefrontContentPermission.Delete,
    storeDomainPermission.Create,
    storeDomainPermission.Read,
    storeDomainPermission.Update,
    storeDomainPermission.Delete,
    storeProfilePermission.Read,
    storeProfilePermission.Update,
    referralPermission.Create,
    referralPermission.Read,
    referralPermission.Update,
    referralPermission.Delete,
    manageReferralWithdrawalPermission.Permission,
    adjustReferralBalancePermission.Permission,
];

@Injectable()
export class StoreProvisioningService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly sellerService: SellerService,
        private readonly channelService: ChannelService,
        private readonly roleService: RoleService,
        private readonly administratorService: AdministratorService,
        private readonly stockLocationService: StockLocationService,
        private readonly shippingMethodService: ShippingMethodService,
        private readonly paymentMethodService: PaymentMethodService,
        private readonly storeProfileService: StoreProfileService,
        private readonly merchantInitialPasswordService: MerchantInitialPasswordService,
        private readonly contentTranslations: ContentTranslationService,
        private readonly facetService: FacetService,
        private readonly facetValueService: FacetValueService,
        private readonly productOptionGroupService: ProductOptionGroupService,
        private readonly productOptionService: ProductOptionService,
        private readonly collectionService: CollectionService,
    ) {}

    async findTemplates(ctx: RequestContext): Promise<Channel[]> {
        const channels = await this.connection.getRepository(ctx, Channel).find({
            order: { code: 'ASC' },
        });
        return channels.filter(channel => channel.code !== '__default_channel__');
    }

    async provision(ctx: RequestContext, input: ProvisionStoreInput): Promise<ProvisionStoreResult> {
        const normalized = this.validateInput(input);
        const template = await this.channelService.findOne(ctx, normalized.templateChannelId);
        if (!template) {
            throw new UserInputError('基础店铺 Channel 不存在');
        }
        if (!template.defaultShippingZone || !template.defaultTaxZone) {
            throw new UserInputError('基础店铺必须先配置默认配送区域和默认计税区域');
        }
        const [templateStockLocations, templatePaymentMethods, templateShippingMethods] = await Promise.all([
            this.connection.getRepository(ctx, StockLocation).find({
                where: { channels: { id: template.id } },
                order: { createdAt: 'ASC' },
            }),
            this.connection.getRepository(ctx, PaymentMethod).find({
                where: { channels: { id: template.id } },
                order: { createdAt: 'ASC' },
            }),
            this.connection.getRepository(ctx, ShippingMethod).find({
                where: { channels: { id: template.id }, deletedAt: IsNull() },
                order: { createdAt: 'ASC' },
            }),
        ]);
        if (templateStockLocations.length === 0) {
            throw new UserInputError('基础店铺没有可复制的库存点');
        }
        await this.assertUnique(ctx, normalized.code, normalized.administrator.emailAddress);

        const [preparedStorefrontName] = await this.contentTranslations.prepareLocalizedFields([
            {
                path: 'storefrontName',
                maxTargetLength: 16,
                sourceText: normalized.storefrontNameZh,
                targetText: normalized.storefrontNameEn,
                required: true,
            },
        ]);
        normalized.storefrontNameEn = preparedStorefrontName.translatedText;
        if (normalized.storefrontNameEn && !this.validStorefrontName(normalized.storefrontNameEn)) {
            throw new UserInputError('英文网站名称必须是 1 至 16 个显示单位');
        }

        const seller = await this.sellerService.create(ctx, { name: normalized.name });
        const channel = await this.channelService.create(ctx, {
            code: normalized.code,
            token: randomBytes(24).toString('base64url'),
            sellerId: seller.id,
            defaultLanguageCode: template.defaultLanguageCode,
            availableLanguageCodes: template.availableLanguageCodes,
            defaultCurrencyCode: template.defaultCurrencyCode,
            availableCurrencyCodes: template.availableCurrencyCodes,
            pricesIncludeTax: template.pricesIncludeTax,
            trackInventory: template.trackInventory,
            outOfStockThreshold: template.outOfStockThreshold,
            defaultShippingZoneId: template.defaultShippingZone.id,
            defaultTaxZoneId: template.defaultTaxZone.id,
            customFields: {
                storefrontNameZh: normalized.storefrontNameZh,
                storefrontNameEn: normalized.storefrontNameEn,
                isStoreProvisioningTemplate: false,
            },
        });
        if (isGraphQlErrorResult(channel)) {
            throw new UserInputError(channel.message);
        }

        const [superAdminRole, customerRole] = await Promise.all([
            this.roleService.getSuperAdminRole(ctx),
            this.roleService.getCustomerRole(ctx),
        ]);
        await this.roleService.assignRoleToChannel(ctx, superAdminRole.id, channel.id);
        await this.roleService.assignRoleToChannel(ctx, customerRole.id, channel.id);
        this.extendSuperAdminContext(ctx, channel, superAdminRole.permissions);

        const role = await this.roleService.create(ctx, {
            code: `${normalized.code}-store-admin`,
            description: `Administrator of ${normalized.name}`,
            channelIds: [channel.id],
            permissions: storeAdministratorPermissions,
        });
        const temporaryPassword = randomBytes(24).toString('base64url');
        const administrator = await this.administratorService.create(ctx, {
            ...normalized.administrator,
            password: temporaryPassword,
            roleIds: [role.id],
        });
        await this.merchantInitialPasswordService.requirePasswordChange(ctx, administrator);
        const channelCtx = this.contextForChannel(ctx, channel);
        const stockLocations: StockLocation[] = [];
        for (const stockLocation of templateStockLocations) {
            stockLocations.push(await this.cloneStockLocation(channelCtx, channel, stockLocation));
        }
        for (const paymentMethod of templatePaymentMethods.filter(method =>
            this.canClonePaymentMethod(method),
        )) {
            await this.clonePaymentMethod(channelCtx, channel, paymentMethod);
        }
        for (const shippingMethod of templateShippingMethods) {
            await this.cloneShippingMethod(channelCtx, channel, shippingMethod);
        }
        await this.cloneClassification(ctx, channelCtx, template, channel);
        const profile = await this.storeProfileService.createDraft(ctx, channel);
        await this.recordStorefrontNameTranslation(ctx, profile, preparedStorefrontName);

        return {
            sellerId: seller.id,
            channelId: channel.id,
            roleId: role.id,
            administratorId: administrator.id,
            stockLocationId: stockLocations[0].id,
            profileId: profile.id,
            channelCode: channel.code,
            temporaryPassword,
        };
    }

    private validateInput(input: ProvisionStoreInput): ProvisionStoreInput {
        const code = input.code.trim().toLowerCase();
        const name = input.name.trim();
        const storefrontNameZh = input.storefrontNameZh.trim();
        const storefrontNameEn = input.storefrontNameEn?.trim() ?? '';
        const firstName = input.administrator.firstName.trim();
        const lastName = input.administrator.lastName.trim();
        const emailAddress = input.administrator.emailAddress.trim().toLowerCase();

        if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(code)) {
            throw new UserInputError('网店编码必须是 3 至 48 位小写字母、数字或短横线');
        }
        if (name.length < 2 || name.length > 80) {
            throw new UserInputError('商家名称必须是 2 至 80 个字符');
        }
        if (!this.validStorefrontName(storefrontNameZh)) {
            throw new UserInputError('中文网站名称必须是 1 至 16 个显示单位');
        }
        if (storefrontNameEn && !this.validStorefrontName(storefrontNameEn)) {
            throw new UserInputError('英文网站名称必须是 1 至 16 个显示单位');
        }
        if (!firstName || firstName.length > 50 || !lastName || lastName.length > 50) {
            throw new UserInputError('管理员姓名不能为空且每项不能超过 50 个字符');
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress) || emailAddress.length > 254) {
            throw new UserInputError('管理员邮箱格式不正确');
        }

        return {
            ...input,
            code,
            name,
            storefrontNameZh,
            storefrontNameEn,
            administrator: { firstName, lastName, emailAddress },
        };
    }

    private validStorefrontName(value: string): boolean {
        const units = Array.from(value).reduce(
            (total, character) => total + (/\p{Script=Han}|[\uFF01-\uFF60]/u.test(character) ? 2 : 1),
            0,
        );
        return units >= 1 && units <= 16;
    }

    private async assertUnique(ctx: RequestContext, code: string, emailAddress: string): Promise<void> {
        const [channel, role, user] = await Promise.all([
            this.connection.getRepository(ctx, Channel).findOne({ where: { code } }),
            this.connection.getRepository(ctx, Role).findOne({ where: { code: `${code}-store-admin` } }),
            this.connection.getRepository(ctx, User).findOne({ where: { identifier: emailAddress } }),
        ]);
        if (channel || role) {
            throw new UserInputError('网店编码已被使用');
        }
        if (user) {
            throw new UserInputError('管理员邮箱已被使用');
        }
    }

    private recordStorefrontNameTranslation(
        ctx: RequestContext,
        profile: StoreProfile,
        field: PreparedLocalizedContentField,
    ): Promise<void> {
        return this.contentTranslations.recordPreparedFields(
            ctx,
            {
                channelId: profile.channelId,
                entityType: StoreProfile.name,
                entityId: profile.id,
            },
            [field],
        );
    }

    private contextForChannel(ctx: RequestContext, channel: Channel): RequestContext {
        const channelCtx = ctx.copy();
        Object.assign(channelCtx as unknown as Record<string, unknown>, {
            _channel: channel,
            _languageCode: channel.defaultLanguageCode,
            _currencyCode: channel.defaultCurrencyCode,
        });
        return channelCtx;
    }

    private async cloneClassification(
        ctx: RequestContext,
        targetCtx: RequestContext,
        template: Channel,
        target: Channel,
    ) {
        const sourceCtx = this.contextForChannel(ctx, template);
        const [facets, optionGroups, collections] = await Promise.all([
            this.connection.getRepository(sourceCtx, Facet).find({
                where: { channels: { id: template.id } },
                relations: { translations: true, values: { translations: true } },
                order: { createdAt: 'ASC' },
            }),
            this.connection.getRepository(sourceCtx, ProductOptionGroup).find({
                where: { channels: { id: template.id }, deletedAt: IsNull() },
                relations: { translations: true, options: { translations: true } },
                order: { createdAt: 'ASC' },
            }),
            this.connection.getRepository(sourceCtx, Collection).find({
                where: { channels: { id: template.id }, isRoot: false },
                relations: { translations: true, parent: true },
                order: { position: 'ASC', createdAt: 'ASC' },
            }),
        ]);

        const facetValueIds = new Map<string, ID>();
        let facetValueCount = 0;
        for (const sourceFacet of facets ?? []) {
            const targetFacet = await this.facetService.create(targetCtx, {
                code: `${target.code}-${sourceFacet.code}`.slice(0, 255),
                isPrivate: sourceFacet.isPrivate,
                translations: sourceFacet.translations.map(translation => ({
                    languageCode: translation.languageCode,
                    name: translation.name,
                    customFields: translation.customFields,
                })),
                customFields: sourceFacet.customFields,
            });
            for (const sourceValue of sourceFacet.values ?? []) {
                const targetValue = await this.facetValueService.create(targetCtx, targetFacet, {
                    code: sourceValue.code,
                    translations: sourceValue.translations.map(translation => ({
                        languageCode: translation.languageCode,
                        name: translation.name,
                        customFields: translation.customFields,
                    })),
                    customFields: sourceValue.customFields,
                });
                facetValueIds.set(String(sourceValue.id), targetValue.id);
                facetValueCount++;
            }
        }

        let optionCount = 0;
        for (const sourceGroup of optionGroups ?? []) {
            const targetGroup = await this.productOptionGroupService.create(targetCtx, {
                code: `${target.code}-${sourceGroup.code}`.slice(0, 255),
                translations: sourceGroup.translations.map(translation => ({
                    languageCode: translation.languageCode,
                    name: translation.name,
                    customFields: translation.customFields,
                })),
                customFields: sourceGroup.customFields,
            });
            for (const sourceOption of sourceGroup.options ?? []) {
                await this.productOptionService.create(targetCtx, targetGroup, {
                    code: sourceOption.code,
                    productOptionGroupId: targetGroup.id,
                    translations: sourceOption.translations.map(translation => ({
                        languageCode: translation.languageCode,
                        name: translation.name,
                        customFields: translation.customFields,
                    })),
                    customFields: sourceOption.customFields,
                });
                optionCount++;
            }
        }

        const collectionIds = new Map<string, ID>();
        const pending = [...(collections ?? [])];
        while (pending.length > 0) {
            const before = pending.length;
            for (let index = pending.length - 1; index >= 0; index--) {
                const sourceCollection = pending[index];
                const sourceParentId = sourceCollection.parent?.isRoot
                    ? null
                    : sourceCollection.parentId == null
                      ? null
                      : String(sourceCollection.parentId);
                if (sourceParentId && !collectionIds.has(sourceParentId)) continue;
                const targetCollection = await this.collectionService.create(targetCtx, {
                    parentId: sourceParentId ? collectionIds.get(sourceParentId) : undefined,
                    isPrivate: sourceCollection.isPrivate,
                    inheritFilters: sourceCollection.inheritFilters,
                    filters: cloneTemplateCollectionFilters(sourceCollection.filters, facetValueIds),
                    translations: sourceCollection.translations.map(translation => ({
                        languageCode: translation.languageCode,
                        name: translation.name,
                        slug: translation.slug,
                        description: translation.description,
                        customFields: translation.customFields,
                    })),
                    customFields: sourceCollection.customFields,
                });
                collectionIds.set(String(sourceCollection.id), targetCollection.id);
                pending.splice(index, 1);
            }
            if (pending.length === before) {
                throw new InternalServerError('基础店铺的分类层级无法完整复制');
            }
        }

        return {
            facetCount: facets?.length ?? 0,
            facetValueCount,
            optionGroupCount: optionGroups?.length ?? 0,
            optionCount,
            collectionCount: collections?.length ?? 0,
        };
    }

    private async cloneStockLocation(
        ctx: RequestContext,
        channel: Channel,
        source: StockLocation,
    ): Promise<StockLocation> {
        const cloned = await this.stockLocationService.create(ctx, {
            name: source.name,
            description: source.description,
            customFields: source.customFields,
        });
        await this.removeDefaultChannelAssignment(ctx, channel, StockLocation, cloned.id);
        return cloned;
    }

    private async cloneShippingMethod(
        ctx: RequestContext,
        channel: Channel,
        source: ShippingMethod,
    ): Promise<ShippingMethod> {
        const cloned = await this.shippingMethodService.create(ctx, {
            code: source.code,
            checker: this.operationInput(source.checker),
            calculator: this.operationInput(source.calculator),
            fulfillmentHandler: source.fulfillmentHandlerCode,
            translations: source.translations.map(translation => ({
                languageCode: translation.languageCode,
                name: translation.name,
                description: translation.description,
                customFields: translation.customFields,
            })),
            customFields: source.customFields,
        });
        await this.removeDefaultChannelAssignment(ctx, channel, ShippingMethod, cloned.id);
        return cloned;
    }

    private async clonePaymentMethod(
        ctx: RequestContext,
        channel: Channel,
        source: PaymentMethod,
    ): Promise<PaymentMethod> {
        const cloned = await this.paymentMethodService.create(ctx, {
            code: source.code,
            enabled: source.enabled,
            ...(source.checker ? { checker: this.operationInput(source.checker) } : {}),
            handler: this.operationInput(source.handler),
            translations: source.translations.map(translation => ({
                languageCode: translation.languageCode,
                name: translation.name,
                description: translation.description,
                customFields: translation.customFields,
            })),
            customFields: source.customFields,
        });
        await this.removeDefaultChannelAssignment(ctx, channel, PaymentMethod, cloned.id);
        return cloned;
    }

    private canClonePaymentMethod(method: PaymentMethod): boolean {
        // Controlled test payments are bound to one encoded Channel ID in both their code and handler
        // arguments. They must be configured explicitly for the new store rather than copied verbatim.
        return (
            method.code !== USDT_TRC20_PAYMENT_METHOD_CODE &&
            method.handler.code !== CONTROLLED_TEST_PAYMENT_HANDLER_CODE &&
            !method.code.startsWith(CONTROLLED_TEST_PAYMENT_METHOD_PREFIX)
        );
    }

    private operationInput(operation: { code: string; args: Array<{ name: string; value: string }> }) {
        return { code: operation.code, arguments: operation.args.map(argument => ({ ...argument })) };
    }

    private async removeDefaultChannelAssignment<T extends StockLocation | ShippingMethod | PaymentMethod>(
        ctx: RequestContext,
        channel: Channel,
        entity: Type<T>,
        entityId: ID,
    ): Promise<void> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (String(defaultChannel.id) !== String(channel.id)) {
            await this.channelService.removeFromChannels(ctx, entity, entityId, [defaultChannel.id]);
        }
    }

    private extendSuperAdminContext(ctx: RequestContext, channel: Channel, permissions: Permission[]): void {
        const user = ctx.session?.user;
        if (!user) {
            throw new InternalServerError('无法读取当前平台管理员会话');
        }
        if (user.channelPermissions.some(item => String(item.id) === String(channel.id))) {
            return;
        }
        user.channelPermissions.push({
            id: channel.id,
            token: channel.token,
            code: channel.code,
            permissions,
        });
    }
}
