import { Injectable } from '@nestjs/common';
import { Permission } from '@vendure/common/lib/generated-types';
import {
    ContentTranslationService,
    PreparedLocalizedContentField,
} from '@vendure/content-translation-plugin';
import {
    AdministratorService,
    Channel,
    ChannelService,
    InternalServerError,
    isGraphQlErrorResult,
    PaymentMethod,
    RequestContext,
    Role,
    RoleService,
    SellerService,
    ShippingMethod,
    StockLocation,
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

interface StoreProvisioningChannelFields {
    isStoreProvisioningTemplate?: boolean | null;
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
        private readonly storeProfileService: StoreProfileService,
        private readonly merchantInitialPasswordService: MerchantInitialPasswordService,
        private readonly contentTranslations: ContentTranslationService,
    ) {}

    async findTemplates(ctx: RequestContext): Promise<Channel[]> {
        const channels = await this.connection.getRepository(ctx, Channel).find({
            order: { code: 'ASC' },
        });
        return channels.filter(channel =>
            Boolean(
                (channel.customFields as StoreProvisioningChannelFields | undefined)
                    ?.isStoreProvisioningTemplate,
            ),
        );
    }

    async provision(ctx: RequestContext, input: ProvisionStoreInput): Promise<ProvisionStoreResult> {
        const normalized = this.validateInput(input);
        const template = await this.channelService.findOne(ctx, normalized.templateChannelId);
        if (!template) {
            throw new UserInputError('网店模板 Channel 不存在');
        }
        if (
            !(template.customFields as StoreProvisioningChannelFields | undefined)
                ?.isStoreProvisioningTemplate
        ) {
            throw new UserInputError('所选 Channel 未启用“开店配置模板”，不能用于创建网店');
        }
        const [sharedStockLocations, sharedPaymentMethods, sharedShippingMethods] = await Promise.all([
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
        if (sharedStockLocations.length === 0) {
            throw new UserInputError('网店模板没有可共享的库存点');
        }
        await this.assertUnique(ctx, normalized.code, normalized.administrator.emailAddress);

        const [preparedStorefrontName] = await this.contentTranslations.prepareLocalizedFields([
            {
                path: 'storefrontName',
                sourceText: normalized.storefrontNameZh,
                targetText: normalized.storefrontNameEn,
                required: true,
            },
        ]);
        normalized.storefrontNameEn = preparedStorefrontName.translatedText;
        if (!this.validStorefrontName(normalized.storefrontNameEn)) {
            throw new UserInputError('自动生成的英文网站名称必须是 1 至 16 个显示单位，请手动调整');
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
        for (const stockLocation of sharedStockLocations) {
            await this.channelService.assignToChannels(ctx, StockLocation, stockLocation.id, [channel.id]);
        }
        for (const paymentMethod of sharedPaymentMethods) {
            await this.channelService.assignToChannels(ctx, PaymentMethod, paymentMethod.id, [channel.id]);
        }
        for (const shippingMethod of sharedShippingMethods) {
            await this.channelService.assignToChannels(ctx, ShippingMethod, shippingMethod.id, [channel.id]);
        }
        const profile = await this.storeProfileService.createDraft(ctx, channel);
        await this.recordStorefrontNameTranslation(ctx, profile, preparedStorefrontName);

        return {
            sellerId: seller.id,
            channelId: channel.id,
            roleId: role.id,
            administratorId: administrator.id,
            stockLocationId: sharedStockLocations[0].id,
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
