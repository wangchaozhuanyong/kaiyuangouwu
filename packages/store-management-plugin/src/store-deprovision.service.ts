import { Injectable } from '@nestjs/common';
import { DeletionResult } from '@vendure/common/lib/generated-types';
import {
    Administrator,
    AdministratorService,
    Channel,
    ChannelService,
    Customer,
    ID,
    Order,
    Product,
    RequestContext,
    Role,
    RoleService,
    SellerService,
    TransactionalConnection,
    UserInputError,
    idsAreEqual,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import { In, IsNull } from 'typeorm';

import { CouponLedgerEntry } from './entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from './entities/coupon-order-allocation.entity';
import { CustomerCoupon } from './entities/customer-coupon.entity';
import { ReferralAccount } from './entities/referral-account.entity';
import { ReferralBalanceUse } from './entities/referral-balance-use.entity';
import { ReferralLedgerEntry } from './entities/referral-ledger-entry.entity';
import { ReferralPosterTemplate } from './entities/referral-poster-template.entity';
import { ReferralProgramConfig } from './entities/referral-program-config.entity';
import { ReferralRelationship } from './entities/referral-relationship.entity';
import { ReferralReward } from './entities/referral-reward.entity';
import { ReferralWalletUsage } from './entities/referral-wallet-usage.entity';
import { ReferralWallet } from './entities/referral-wallet.entity';
import { ReferralWithdrawal } from './entities/referral-withdrawal.entity';
import { StoreCouponCampaignConfig } from './entities/store-coupon-campaign-config.entity';
import { StoreProfile } from './entities/store-profile.entity';
import { StorefrontDailyVisitor } from './entities/storefront-daily-visitor.entity';
import { StorefrontPromotionPage } from './entities/storefront-promotion-page.entity';
import { StorefrontUsdtCheckoutQuote } from './entities/storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from './entities/storefront-usdt-payment-intent.entity';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import { StoreProfileService } from './store-profile.service';
import {
    DeprovisionStoreInput,
    DeprovisionStoreResult,
    StoreDeprovisionImpact,
    StoreProfileStatus,
} from './types';

interface StoreDeprovisionFacts {
    status: StoreProfileStatus;
    isDefaultChannel: boolean;
    isProvisioningTemplate: boolean;
    isActiveChannel: boolean;
    orderCount: number;
    productCount: number;
    customerCount: number;
    extensionRecordCount: number;
    dedicatedRoleSharedAcrossChannels: boolean;
    administratorWithAdditionalRoles: boolean;
}

export function getStoreDeprovisionBlockers(facts: StoreDeprovisionFacts): string[] {
    const blockers: string[] = [];
    if (facts.isDefaultChannel) blockers.push('默认店铺不允许清退');
    if (facts.isProvisioningTemplate) blockers.push('长期基础模板不允许清退');
    if (facts.isActiveChannel) blockers.push('请先切换到其他店铺再清退当前店铺');
    if (facts.status !== 'SUSPENDED') blockers.push('店铺必须先暂停营业');
    if (facts.orderCount > 0) blockers.push(`已存在 ${facts.orderCount} 笔订单，必须保留审计数据`);
    if (facts.productCount > 0) blockers.push(`已关联 ${facts.productCount} 个商品，请先调整销售范围`);
    if (facts.customerCount > 0) blockers.push(`已关联 ${facts.customerCount} 个客户，必须保留业务归属`);
    if (facts.extensionRecordCount > 0) {
        blockers.push(`存在 ${facts.extensionRecordCount} 条营销、返利、访客或支付扩展记录`);
    }
    if (facts.dedicatedRoleSharedAcrossChannels) blockers.push('店铺管理角色已被其他店铺共用');
    if (facts.administratorWithAdditionalRoles) blockers.push('店铺管理员还持有其他角色，不能自动移除');
    return blockers;
}

export function getStoreSuspendBlockers(
    facts: Pick<StoreDeprovisionFacts, 'isDefaultChannel' | 'isProvisioningTemplate' | 'isActiveChannel'>,
): string[] {
    const blockers: string[] = [];
    if (facts.isDefaultChannel) blockers.push('默认店铺不允许暂停营业');
    if (facts.isProvisioningTemplate) blockers.push('长期基础模板不允许暂停营业');
    if (facts.isActiveChannel) blockers.push('请先切换到其他店铺再暂停当前店铺');
    return blockers;
}

@Injectable()
export class StoreDeprovisionService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly channelService: ChannelService,
        private readonly administratorService: AdministratorService,
        private readonly roleService: RoleService,
        private readonly sellerService: SellerService,
        private readonly storeProfileService: StoreProfileService,
        private readonly passwordService: MerchantInitialPasswordService,
    ) {}

    async impact(ctx: RequestContext, profileId: ID): Promise<StoreDeprovisionImpact> {
        return (await this.analyze(ctx, profileId)).impact;
    }

    async suspend(ctx: RequestContext, profileId: ID, expectedUpdatedAt: Date, currentPassword: string) {
        await this.passwordService.assertCurrentPassword(ctx, currentPassword);
        const { impact } = await this.analyze(ctx, profileId);
        const blockers = getStoreSuspendBlockers(impact);
        if (blockers.length > 0) {
            throw new UserInputError(`店铺不能暂停：${blockers.join('；')}`);
        }
        return this.storeProfileService.update(ctx, {
            id: profileId,
            expectedUpdatedAt,
            status: 'SUSPENDED',
        });
    }

    async deprovision(ctx: RequestContext, input: DeprovisionStoreInput): Promise<DeprovisionStoreResult> {
        await this.passwordService.assertCurrentPassword(ctx, input.currentPassword);
        const analysis = await this.analyze(ctx, input.profileId);
        const { impact, profile, dedicatedRole, administrators, sellerChannelCount } = analysis;
        this.assertExpectedUpdatedAt(profile.updatedAt, input.expectedUpdatedAt);
        if (input.confirmCode.trim() !== impact.channelCode) {
            throw new UserInputError('输入的店铺编码与待清退店铺不一致');
        }
        if (!impact.canDeprovision) {
            throw new UserInputError(`店铺不能清退：${impact.blockers.join('；')}`);
        }

        for (const administrator of administrators) {
            await this.administratorService.softDelete(ctx, administrator.id);
        }
        let deletedRole = false;
        if (dedicatedRole) {
            const result = await this.roleService.delete(ctx, dedicatedRole.id);
            deletedRole = result.result === DeletionResult.DELETED;
        }
        const channelResult = await this.channelService.delete(ctx, impact.channelId);
        if (channelResult.result !== DeletionResult.DELETED) {
            throw new UserInputError(channelResult.message ?? '后端拒绝删除店铺 Channel');
        }
        let deletedSeller = false;
        if (profile.channel.sellerId && sellerChannelCount === 1) {
            const result = await this.sellerService.delete(ctx, profile.channel.sellerId);
            deletedSeller = result.result === DeletionResult.DELETED;
        }
        return {
            channelId: impact.channelId,
            channelCode: impact.channelCode,
            deletedAdministratorCount: administrators.length,
            deletedRole,
            deletedSeller,
        };
    }

    private async analyze(ctx: RequestContext, profileId: ID) {
        const profile = await this.connection.getRepository(ctx, StoreProfile).findOne({
            where: { id: profileId },
            relations: { channel: { seller: true } },
        });
        if (!profile) throw new UserInputError('待清退的店铺不存在');
        const channelId = profile.channelId;
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const dedicatedRole = await this.connection.getRepository(ctx, Role).findOne({
            where: { code: `${profile.channel.code}-store-admin` },
            relations: { channels: true },
        });
        const administrators = dedicatedRole
            ? await this.connection
                  .getRepository(ctx, Administrator)
                  .createQueryBuilder('administrator')
                  .innerJoinAndSelect('administrator.user', 'user')
                  .innerJoinAndSelect('user.roles', 'role')
                  .where('role.id = :roleId', { roleId: dedicatedRole.id })
                  .andWhere('administrator.deletedAt IS NULL')
                  .getMany()
            : [];
        const administratorsWithAllRoles = dedicatedRole
            ? await this.connection.getRepository(ctx, Administrator).find({
                  where: { id: In(administrators.map(item => item.id)), deletedAt: IsNull() },
                  relations: { user: { roles: true } },
              })
            : [];
        const administratorWithAdditionalRoles = administratorsWithAllRoles.some(administrator =>
            administrator.user.roles.some(role => !idsAreEqual(role.id, dedicatedRole?.id)),
        );

        const [orderCount, productCount, customerCount, domainCount, sellerChannelCount, extensionCounts] =
            await Promise.all([
                this.countChannelRelation(ctx, Order, 'order', channelId),
                this.countChannelRelation(ctx, Product, 'product', channelId),
                this.countChannelRelation(ctx, Customer, 'customer', channelId),
                this.connection.getRepository(ctx, StoreDomain).count({ where: { channelId } }),
                profile.channel.sellerId
                    ? this.connection.getRepository(ctx, Channel).count({
                          where: { sellerId: profile.channel.sellerId },
                      })
                    : Promise.resolve(0),
                Promise.all(
                    [
                        CouponLedgerEntry,
                        CouponOrderAllocation,
                        CustomerCoupon,
                        ReferralAccount,
                        ReferralBalanceUse,
                        ReferralLedgerEntry,
                        ReferralPosterTemplate,
                        ReferralProgramConfig,
                        ReferralRelationship,
                        ReferralReward,
                        ReferralWalletUsage,
                        ReferralWallet,
                        ReferralWithdrawal,
                        StoreCouponCampaignConfig,
                        StorefrontDailyVisitor,
                        StorefrontPromotionPage,
                        StorefrontUsdtCheckoutQuote,
                        StorefrontUsdtPaymentIntent,
                    ].map(entity =>
                        this.connection.getRepository(ctx, entity).count({ where: { channelId } as never }),
                    ),
                ),
            ]);
        const extensionRecordCount = extensionCounts.reduce((total, count) => total + count, 0);
        const facts: StoreDeprovisionFacts = {
            status: profile.status,
            isDefaultChannel: idsAreEqual(channelId, defaultChannel.id),
            isProvisioningTemplate: Boolean(
                (profile.channel.customFields as { isStoreProvisioningTemplate?: boolean } | undefined)
                    ?.isStoreProvisioningTemplate,
            ),
            isActiveChannel: idsAreEqual(channelId, ctx.channelId),
            orderCount,
            productCount,
            customerCount,
            extensionRecordCount,
            dedicatedRoleSharedAcrossChannels: Boolean(
                dedicatedRole &&
                (dedicatedRole.channels.length !== 1 ||
                    !idsAreEqual(dedicatedRole.channels[0]?.id, channelId)),
            ),
            administratorWithAdditionalRoles,
        };
        const blockers = getStoreDeprovisionBlockers(facts);
        return {
            profile,
            dedicatedRole,
            administrators: administratorsWithAllRoles,
            sellerChannelCount,
            impact: {
                profileId: profile.id,
                channelId,
                channelCode: profile.channel.code,
                status: profile.status,
                isDefaultChannel: facts.isDefaultChannel,
                isProvisioningTemplate: facts.isProvisioningTemplate,
                isActiveChannel: facts.isActiveChannel,
                orderCount,
                productCount,
                customerCount,
                administratorCount: administrators.length,
                domainCount,
                extensionRecordCount,
                sellerWillBeDeleted: Boolean(profile.channel.sellerId && sellerChannelCount === 1),
                roleWillBeDeleted: Boolean(dedicatedRole && !facts.dedicatedRoleSharedAcrossChannels),
                blockers,
                canDeprovision: blockers.length === 0,
            } satisfies StoreDeprovisionImpact,
        };
    }

    private countChannelRelation(
        ctx: RequestContext,
        entity: typeof Order | typeof Product | typeof Customer,
        alias: string,
        channelId: ID,
    ) {
        return this.connection
            .getRepository(ctx, entity)
            .createQueryBuilder(alias)
            .innerJoin(`${alias}.channels`, 'channel', 'channel.id = :channelId', { channelId })
            .getCount();
    }

    private assertExpectedUpdatedAt(current: Date, expected: Date | string) {
        const expectedDate = expected instanceof Date ? expected : new Date(expected);
        if (!Number.isFinite(expectedDate.getTime()) || current.getTime() !== expectedDate.getTime()) {
            throw new UserInputError('CONCURRENT_MODIFICATION: 店铺资料已被更新，请重新读取影响预览');
        }
    }
}
