import { Injectable } from '@nestjs/common';
import { Permission } from '@vendure/common/lib/generated-types';
import {
    AdministratorService,
    Channel,
    ChannelService,
    InternalServerError,
    isGraphQlErrorResult,
    RequestContext,
    Role,
    RoleService,
    SellerService,
    StockLocation,
    StockLocationService,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';
import { storeDomainPermission } from '@vendure/store-domain-plugin';
import { storefrontContentPermission } from '@vendure/storefront-content-plugin';
import { randomBytes } from 'node:crypto';

import { storeProfilePermission } from './constants';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import { StoreProfileService } from './store-profile.service';
import { ProvisionStoreInput, ProvisionStoreResult } from './types';

export const storeAdministratorPermissions: Permission[] = [
    Permission.ReadChannel,
    Permission.CreateCatalog,
    Permission.ReadCatalog,
    Permission.UpdateCatalog,
    Permission.DeleteCatalog,
    Permission.CreateAsset,
    Permission.ReadAsset,
    Permission.ReadOrder,
    Permission.UpdateOrder,
    Permission.ReadCustomer,
    Permission.ReadStockLocation,
    Permission.UpdateStockLocation,
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
        private readonly storeProfileService: StoreProfileService,
        private readonly merchantInitialPasswordService: MerchantInitialPasswordService,
    ) {}

    async provision(ctx: RequestContext, input: ProvisionStoreInput): Promise<ProvisionStoreResult> {
        const normalized = this.validateInput(input);
        const template = await this.channelService.findOne(ctx, normalized.templateChannelId);
        if (!template) {
            throw new UserInputError('网店模板 Channel 不存在');
        }
        await this.assertUnique(ctx, normalized.code, normalized.administrator.emailAddress);

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
        const stockLocation = await this.stockLocationService.create(ctx, {
            name: `${normalized.name} Warehouse`,
            description: `Primary stock location for ${normalized.code}`,
        });
        await this.channelService.assignToChannels(ctx, StockLocation, stockLocation.id, [channel.id]);
        if (String(ctx.channelId) !== String(channel.id)) {
            await this.channelService.removeFromChannels(ctx, StockLocation, stockLocation.id, [
                ctx.channelId,
            ]);
        }
        const profile = await this.storeProfileService.createDraft(ctx, channel);

        return {
            sellerId: seller.id,
            channelId: channel.id,
            roleId: role.id,
            administratorId: administrator.id,
            stockLocationId: stockLocation.id,
            profileId: profile.id,
            channelCode: channel.code,
            temporaryPassword,
        };
    }

    private validateInput(input: ProvisionStoreInput): ProvisionStoreInput {
        const code = input.code.trim().toLowerCase();
        const name = input.name.trim();
        const storefrontNameZh = input.storefrontNameZh.trim();
        const storefrontNameEn = input.storefrontNameEn.trim();
        const firstName = input.administrator.firstName.trim();
        const lastName = input.administrator.lastName.trim();
        const emailAddress = input.administrator.emailAddress.trim().toLowerCase();

        if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(code)) {
            throw new UserInputError('网店编码必须是 3 至 48 位小写字母、数字或短横线');
        }
        if (name.length < 2 || name.length > 80) {
            throw new UserInputError('商家名称必须是 2 至 80 个字符');
        }
        if (!this.validStorefrontName(storefrontNameZh) || !this.validStorefrontName(storefrontNameEn)) {
            throw new UserInputError('中英文网站名称必须是 1 至 16 个显示单位');
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
