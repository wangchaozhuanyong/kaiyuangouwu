import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { RegisterCustomerInput } from '@vendure/common/lib/generated-shop-types';
import { CurrencyCode } from '@vendure/common/lib/generated-types';
import {
    Asset,
    Customer,
    CustomerService,
    EventBus,
    ID,
    isGraphQlErrorResult,
    Order,
    OrderService,
    OrderStateTransitionEvent,
    Refund,
    RefundStateTransitionEvent,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { LessThanOrEqual, LockNotSupportedOnGivenDriverError } from 'typeorm';

import { STOREFRONT_PROMOTION_OPTIONS } from '../constants';
import { ReferralAccount } from '../entities/referral-account.entity';
import { ReferralBalanceUse } from '../entities/referral-balance-use.entity';
import { ReferralLedgerEntry } from '../entities/referral-ledger-entry.entity';
import { ReferralPosterTemplate } from '../entities/referral-poster-template.entity';
import { ReferralProgramConfig } from '../entities/referral-program-config.entity';
import { ReferralRelationship } from '../entities/referral-relationship.entity';
import { ReferralReward } from '../entities/referral-reward.entity';
import { ReferralWallet } from '../entities/referral-wallet.entity';
import { ReferralWithdrawal } from '../entities/referral-withdrawal.entity';
import { StorefrontDailyVisitor } from '../entities/storefront-daily-visitor.entity';
import { convertChannelAmount } from '../store-currency-price-selection-strategy';
import { StorefrontPromotionPluginOptions } from '../types';

import {
    calculateEligibleReferralRefund,
    calculateReferralClawback,
    calculateReferralReward,
    referralRewardStatusAfterClawback,
} from './referral-calculation';
import { REFERRAL_METRIC_SETTLED_ORDER_STATES, settledOrderNetTotal } from './referral-metrics';
import { createReferralPaymentProof } from './referral-payment-proof';
import {
    REFERRAL_BALANCE_PAYMENT_METHOD_CODE,
    referralPosterTemplates,
    ReferralWithdrawalStatus,
} from './referral.constants';
import { resolveStorefrontVisitorIdentity } from './storefront-visitor-identity';

const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PAGE_SIZE = 200;

export interface UpdateReferralProgramInput {
    expectedUpdatedAt: Date;
    enabled: boolean;
    rewardRate: number;
    releaseDelayDays: number;
    minimumOrderAmount: number;
    maxRewardPerOrder?: number | null;
    allowBalanceSpend: boolean;
    attributionWindowDays: number;
    defaultPosterTemplate: string;
}

export interface SaveReferralPosterTemplateInput {
    name: string;
    enabled: boolean;
    position: number;
    layoutVariant: string;
    posterBackgroundAssetId?: ID | null;
    shareBackgroundAssetId?: ID | null;
    titleZh: string;
    titleEn: string;
    headlineZh: string;
    headlineEn: string;
    rewardTextZh: string;
    rewardTextEn: string;
    siteIntroZh: string;
    siteIntroEn: string;
    serviceTextZh: string;
    serviceTextEn: string;
    foregroundColor: string;
    accentColor: string;
    overlayOpacity: number;
}

export interface UpdateReferralPosterTemplateInput extends SaveReferralPosterTemplateInput {
    id: ID;
}

export interface CreateReferralWithdrawalInput {
    customerId: ID;
    currencyCode: CurrencyCode;
    amount: number;
    payoutMethod: string;
    payoutAccountMasked: string;
    note?: string | null;
}

export interface ProcessReferralWithdrawalInput {
    id: ID;
    status: ReferralWithdrawalStatus;
    externalReference?: string | null;
    note?: string | null;
}

interface WalletDeltaInput {
    eventType: string;
    idempotencyKey: string;
    availableDelta?: number;
    pendingDelta?: number;
    reservedDelta?: number;
    orderId?: ID | null;
    refundId?: ID | null;
    withdrawalId?: ID | null;
    actorId?: ID | null;
    actorType?: string;
    note?: string | null;
    metadata?: Record<string, any> | null;
    allowNegativeAvailable?: boolean;
}

@Injectable()
export class ReferralService implements OnApplicationBootstrap {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly orderService: OrderService,
        private readonly eventBus: EventBus,
        private readonly requestContextService: RequestContextService,
        @Inject(STOREFRONT_PROMOTION_OPTIONS)
        private readonly promotionOptions: Required<StorefrontPromotionPluginOptions>,
    ) {}

    onApplicationBootstrap(): void {
        this.eventBus.registerBlockingEventHandler({
            event: OrderStateTransitionEvent,
            id: 'referral-reward-on-payment-settled',
            handler: event => {
                if (event.toState === 'PaymentSettled') {
                    return this.rewardSettledOrder(event.ctx, event.order.id, event.createdAt);
                }
                if (event.toState === 'Cancelled') {
                    return this.handleCancelledOrder(event.ctx, event.order.id);
                }
                return Promise.resolve();
            },
        });
        this.eventBus.registerBlockingEventHandler({
            event: RefundStateTransitionEvent,
            id: 'referral-reconcile-settled-refund',
            handler: event =>
                event.toState === 'Settled'
                    ? this.handleSettledRefund(event.ctx, event.order.id, event.refund.id)
                    : Promise.resolve(),
        });
    }

    async publicProgram(ctx: RequestContext) {
        const config = await this.getConfig(ctx);
        return this.configView(ctx, config, false);
    }

    async adminProgram(ctx: RequestContext) {
        const config = await this.getOrCreateConfig(ctx);
        return this.configView(ctx, config, true);
    }

    async updateProgram(ctx: RequestContext, input: UpdateReferralProgramInput) {
        this.validateProgramInput(input);
        await this.validateDefaultPosterTemplate(ctx, input.defaultPosterTemplate);
        const existing = await this.getOrCreateConfig(ctx);
        const config = await this.lockConfigOrThrow(ctx, existing.id);
        this.assertExpectedUpdatedAt(config.updatedAt, input.expectedUpdatedAt);
        config.enabled = input.enabled;
        config.rewardRateBps = Math.round(input.rewardRate * 100);
        config.releaseDelayDays = input.releaseDelayDays;
        config.minimumOrderAmount = input.minimumOrderAmount;
        config.maxRewardPerOrder = input.maxRewardPerOrder ?? null;
        config.currencyCode = ctx.channel.defaultCurrencyCode;
        config.allowBalanceSpend = input.allowBalanceSpend;
        config.attributionWindowDays = input.attributionWindowDays;
        config.defaultPosterTemplate = input.defaultPosterTemplate;
        await this.connection.getRepository(ctx, ReferralProgramConfig).save(config, { reload: false });
        return this.configView(ctx, config, true);
    }

    async createPosterTemplate(ctx: RequestContext, input: SaveReferralPosterTemplateInput) {
        const repository = this.connection.getRepository(ctx, ReferralPosterTemplate);
        const existingTemplateCount = await repository.count({ where: { channelId: ctx.channelId } });
        const values = await this.normalizePosterTemplateInput(ctx, input);
        const saved = await repository.save(
            repository.create({
                ...values,
                channelId: ctx.channelId,
            }),
        );
        if (existingTemplateCount === 0 && saved.enabled) {
            const config = await this.getOrCreateConfig(ctx);
            config.defaultPosterTemplate = saved.id.toString();
            await this.connection.getRepository(ctx, ReferralProgramConfig).save(config, { reload: false });
        }
        return this.posterTemplateById(ctx, saved.id);
    }

    async updatePosterTemplate(ctx: RequestContext, input: UpdateReferralPosterTemplateInput) {
        const repository = this.connection.getRepository(ctx, ReferralPosterTemplate);
        const template = await repository.findOne({
            where: { id: input.id, channelId: ctx.channelId },
        });
        if (!template) throw new UserInputError('找不到该邀请海报模板');
        Object.assign(template, await this.normalizePosterTemplateInput(ctx, input));
        await repository.save(template, { reload: false });
        if (!template.enabled) {
            const config = await this.getOrCreateConfig(ctx);
            if (config.defaultPosterTemplate === template.id.toString()) {
                const replacement = await repository
                    .createQueryBuilder('posterTemplate')
                    .where('posterTemplate.channelId = :channelId', { channelId: ctx.channelId })
                    .andWhere('posterTemplate.enabled = :enabled', { enabled: true })
                    .andWhere('posterTemplate.id != :id', { id: template.id })
                    .orderBy('posterTemplate.position', 'ASC')
                    .addOrderBy('posterTemplate.id', 'ASC')
                    .getOne();
                config.defaultPosterTemplate = replacement?.id.toString() ?? 'BRAND_MINIMAL';
                await this.connection
                    .getRepository(ctx, ReferralProgramConfig)
                    .save(config, { reload: false });
            }
        }
        return this.posterTemplateById(ctx, template.id);
    }

    async deletePosterTemplate(ctx: RequestContext, id: ID) {
        const repository = this.connection.getRepository(ctx, ReferralPosterTemplate);
        const template = await repository.findOne({ where: { id, channelId: ctx.channelId } });
        if (!template) return { result: 'NOT_DELETED', message: '找不到该邀请海报模板' };
        const config = await this.getOrCreateConfig(ctx);
        const wasDefault = config.defaultPosterTemplate === template.id.toString();
        await repository.remove(template);
        if (wasDefault) {
            const replacement = await repository.findOne({
                where: { channelId: ctx.channelId, enabled: true },
                order: { position: 'ASC', id: 'ASC' },
            });
            config.defaultPosterTemplate = replacement?.id.toString() ?? 'BRAND_MINIMAL';
            await this.connection.getRepository(ctx, ReferralProgramConfig).save(config, { reload: false });
        }
        return { result: 'DELETED' };
    }

    async validateInviteCode(ctx: RequestContext, code?: string | null): Promise<boolean> {
        const normalized = normalizeInviteCode(code);
        if (!normalized) return true;
        const config = await this.getConfig(ctx);
        if (!config.enabled) return false;
        return Boolean(await this.findAccountByCode(ctx, normalized));
    }

    async registerCustomerWithReferral(
        ctx: RequestContext,
        input: RegisterCustomerInput,
        inviteCode?: string | null,
        source = 'CODE',
    ) {
        const normalizedCode = normalizeInviteCode(inviteCode);
        const config = await this.getConfig(ctx);
        let inviterAccount: ReferralAccount | null = null;
        if (normalizedCode && config.enabled) {
            inviterAccount = await this.findAccountByCode(ctx, normalizedCode);
            if (!inviterAccount) throw new UserInputError('邀请码不存在或已失效');
        }

        const emailAddress = input.emailAddress.trim().toLowerCase();
        const existedBefore = await this.connection
            .getRepository(ctx, Customer)
            .createQueryBuilder('customer')
            .innerJoin('customer.channels', 'registrationChannel')
            .where('registrationChannel.id = :channelId', { channelId: ctx.channelId })
            .andWhere('LOWER(customer.emailAddress) = :emailAddress', { emailAddress })
            .getOne();

        const result = await this.customerService.registerCustomerAccount(ctx, {
            ...input,
            emailAddress,
        });
        if (isGraphQlErrorResult(result)) {
            if (result.errorCode === 'EMAIL_ADDRESS_CONFLICT_ERROR') {
                // Match Vendure's built-in registration resolver so this custom
                // mutation cannot be used to enumerate existing accounts.
                return { success: true };
            }
            return result;
        }
        if (existedBefore || !inviterAccount) return { success: true };

        const invitee = await this.connection
            .getRepository(ctx, Customer)
            .createQueryBuilder('customer')
            .innerJoin('customer.channels', 'registrationChannel')
            .where('registrationChannel.id = :channelId', { channelId: ctx.channelId })
            .andWhere('LOWER(customer.emailAddress) = :emailAddress', { emailAddress })
            .getOne();
        if (invitee) {
            await this.bindRelationship(ctx, inviterAccount, invitee, source);
        }
        return { success: true };
    }

    async myOverview(ctx: RequestContext) {
        const config = await this.getConfig(ctx);
        if (!config.enabled) throw new UserInputError('邀请返利功能尚未开启');
        const customer = await this.activeCustomer(ctx);
        const account = await this.getOrCreateAccount(ctx, customer);
        const relationshipRepository = this.connection.getRepository(ctx, ReferralRelationship);
        const [wallets, relationships, ledger, rewardSummaries, invitedCount, purchasedInviteeCount] =
            await Promise.all([
                this.connection.getRepository(ctx, ReferralWallet).find({
                    where: { channelId: ctx.channelId, referralAccountId: account.id },
                    order: { currencyCode: 'ASC' },
                }),
                relationshipRepository.find({
                    where: { channelId: ctx.channelId, inviterCustomerId: customer.id },
                    relations: { inviteeCustomer: true },
                    order: { boundAt: 'DESC' },
                    take: 100,
                }),
                this.connection.getRepository(ctx, ReferralLedgerEntry).find({
                    where: { channelId: ctx.channelId, customerId: customer.id },
                    order: { createdAt: 'DESC' },
                    take: 100,
                }),
                this.connection
                    .getRepository(ctx, ReferralReward)
                    .createQueryBuilder('reward')
                    .select('reward.currencyCode', 'currencyCode')
                    .addSelect('COALESCE(SUM(reward.rewardAmount), 0)', 'grossReward')
                    .addSelect('COALESCE(SUM(reward.clawedBackAmount), 0)', 'clawedBack')
                    .where('reward.channelId = :channelId', { channelId: ctx.channelId })
                    .andWhere('reward.inviterCustomerId = :customerId', { customerId: customer.id })
                    .groupBy('reward.currencyCode')
                    .getRawMany<{
                        currencyCode: CurrencyCode;
                        grossReward: string | number;
                        clawedBack: string | number;
                    }>(),
                relationshipRepository.count({
                    where: { channelId: ctx.channelId, inviterCustomerId: customer.id },
                }),
                relationshipRepository
                    .createQueryBuilder('relationship')
                    .where('relationship.channelId = :channelId', { channelId: ctx.channelId })
                    .andWhere('relationship.inviterCustomerId = :customerId', { customerId: customer.id })
                    .andWhere('relationship.firstPaidOrderAt IS NOT NULL')
                    .getCount(),
            ]);
        return {
            enabled: config.enabled,
            rewardRate: config.rewardRateBps / 100,
            releaseDelayDays: config.releaseDelayDays,
            inviteCode: account.inviteCode,
            wallets,
            invitedCount,
            purchasedInviteeCount,
            rewardSummaries: rewardSummaries.map(summary => ({
                currencyCode: summary.currencyCode,
                grossReward: Number(summary.grossReward),
                clawedBackReward: Number(summary.clawedBack),
            })),
            invitees: relationships.map(item => ({
                id: item.id,
                displayName: maskedCustomerName(item.inviteeCustomer),
                boundAt: item.boundAt,
                firstPaidOrderAt: item.firstPaidOrderAt,
            })),
            ledger,
        };
    }

    async useBalance(ctx: RequestContext, amount: number) {
        if (!Number.isInteger(amount) || amount <= 0) throw new UserInputError('请输入有效的抵扣金额');
        const config = await this.getConfig(ctx);
        if (!config.allowBalanceSpend) throw new UserInputError('当前店铺已暂停使用返利余额');
        const customer = await this.activeCustomer(ctx);
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const activeOrder = await this.orderService.getActiveOrderForUser(ctx, ctx.activeUserId);
        if (!activeOrder || activeOrder.state !== 'ArrangingPayment') {
            throw new UserInputError('请先提交订单再使用返利余额');
        }
        const order = await this.orderService.findOne(ctx, activeOrder.id, ['customer', 'payments']);
        if (!order || !order.customer || order.customer.id.toString() !== customer.id.toString()) {
            throw new UserInputError('找不到待支付订单');
        }
        const existing = await this.connection.getRepository(ctx, ReferralBalanceUse).findOne({
            where: { channelId: ctx.channelId, orderId: order.id },
        });
        if (existing) throw new UserInputError('该订单已使用过返利余额');
        const alreadyCovered = (order.payments ?? [])
            .filter(payment => payment.state === 'Settled' || payment.state === 'Authorized')
            .reduce((total, payment) => total + payment.amount, 0);
        const outstanding = Math.max(0, order.totalWithTax - alreadyCovered);
        if (amount > outstanding) throw new UserInputError('抵扣金额不能超过待支付金额');

        const account = await this.getOrCreateAccount(ctx, customer);
        const wallet = await this.getOrCreateWallet(ctx, account, customer, order.currencyCode);
        if (wallet.availableBalance < amount) throw new UserInputError('返利可用余额不足');

        const use = await this.connection.getRepository(ctx, ReferralBalanceUse).save(
            new ReferralBalanceUse({
                channelId: ctx.channelId,
                walletId: wallet.id,
                customerId: customer.id,
                orderId: order.id,
                currencyCode: order.currencyCode,
                amount,
                refundedAmount: 0,
                status: 'RESERVED',
                reservedAt: new Date(),
                capturedAt: null,
                releasedAt: null,
            }),
        );
        await this.applyWalletDelta(ctx, wallet, {
            eventType: 'SPEND_RESERVED',
            idempotencyKey: `SPEND_RESERVED:${use.id}`,
            availableDelta: -amount,
            reservedDelta: amount,
            orderId: order.id,
            actorId: ctx.activeUserId,
            actorType: 'CUSTOMER',
            note: '客户在结算页冻结返利余额',
        });
        const proof = createReferralPaymentProof({
            reservationId: use.id.toString(),
            orderId: order.id.toString(),
            customerId: customer.id.toString(),
            currencyCode: order.currencyCode,
            amount,
            expiresAt: Date.now() + 2 * 60_000,
        });
        const paymentResult = await this.orderService.addPaymentToOrder(ctx, order.id, {
            method: REFERRAL_BALANCE_PAYMENT_METHOD_CODE,
            metadata: { proof },
        });
        if (isGraphQlErrorResult(paymentResult)) {
            throw new UserInputError(paymentResult.message);
        }
        await this.applyWalletDelta(ctx, wallet, {
            eventType: 'SPEND_CAPTURED',
            idempotencyKey: `SPEND_CAPTURED:${use.id}`,
            reservedDelta: -amount,
            orderId: order.id,
            actorId: ctx.activeUserId,
            actorType: 'CUSTOMER',
            note: '返利余额支付已确认',
        });
        use.status = 'CAPTURED';
        use.capturedAt = new Date();
        await this.connection.getRepository(ctx, ReferralBalanceUse).save(use, { reload: false });
        const refreshedWallet = await this.connection.getRepository(ctx, ReferralWallet).findOneByOrFail({
            id: wallet.id,
        });
        return { order: paymentResult, wallet: refreshedWallet, amount };
    }

    async recordVisit(ctx: RequestContext, visitorId?: string | null) {
        const channelId = ctx.channelId.toString();
        const identity = resolveStorefrontVisitorIdentity({
            req: ctx.req,
            channelId,
            visitorId,
            signingSecret: this.promotionOptions.signingSecret,
        });
        if (!identity) return { recorded: false, setCookie: null };
        let customer: Customer | undefined;
        if (ctx.activeUserId) customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        const businessDate = businessDateKey(new Date());
        const repository = this.connection.getRepository(ctx, StorefrontDailyVisitor);
        const visitorKeyHash = this.secureVisitorHash(
            channelId,
            customer ? `customer:${customer.id.toString()}` : identity.keyMaterial,
        );
        const aliasHashes = new Set<string>();
        if (identity.visitorId) {
            aliasHashes.add(this.secureVisitorHash(channelId, `device:${identity.visitorId}`));
            aliasHashes.add(legacyVisitorHash(`${channelId}:anonymous:${identity.visitorId}`));
        }
        if (identity.clientIp) {
            aliasHashes.add(this.secureVisitorHash(channelId, `ip:${identity.clientIp}`));
        }
        if (customer) {
            aliasHashes.add(legacyVisitorHash(`${channelId}:customer:${customer.id.toString()}`));
        }
        aliasHashes.delete(visitorKeyHash);
        const hashes = [visitorKeyHash, ...aliasHashes];
        const visitorWhere = hashes.map(hash => ({
            channelId: ctx.channelId,
            businessDate,
            visitorKeyHash: hash,
        }));
        let rows = await repository.find({
            where: visitorWhere,
        });
        for (const row of [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
            await this.lockRow(ctx, StorefrontDailyVisitor, row.id);
        }
        if (rows.length) {
            rows = await repository.find({
                where: visitorWhere,
            });
        }
        const now = new Date();
        const primary = rows.find(row => row.visitorKeyHash === visitorKeyHash) ?? rows[0];
        if (primary) {
            primary.visitorKeyHash = visitorKeyHash;
            primary.firstSeenAt = new Date(
                Math.min(...rows.map(row => row.firstSeenAt.getTime()), primary.firstSeenAt.getTime()),
            );
            primary.lastSeenAt = new Date(
                Math.max(now.getTime(), ...rows.map(row => row.lastSeenAt.getTime())),
            );
            primary.visitCount = rows.reduce((total, row) => total + row.visitCount, 0) + 1;
            primary.customerId = customer?.id ?? primary.customerId;
            await repository.save(primary, { reload: false });
            const duplicates = rows.filter(row => row.id !== primary.id);
            if (duplicates.length) await repository.remove(duplicates);
        } else {
            await repository.save(
                new StorefrontDailyVisitor({
                    channelId: ctx.channelId,
                    customerId: customer?.id ?? null,
                    businessDate,
                    visitorKeyHash,
                    firstSeenAt: now,
                    lastSeenAt: now,
                    visitCount: 1,
                }),
                { reload: false },
            );
        }
        return { recorded: true, setCookie: identity.setCookie };
    }

    private secureVisitorHash(channelId: string, keyMaterial: string): string {
        return createHmac('sha256', this.promotionOptions.signingSecret)
            .update(`${channelId}:${keyMaterial}`)
            .digest('hex');
    }

    async createWithdrawal(ctx: RequestContext, input: CreateReferralWithdrawalInput) {
        if (!Number.isInteger(input.amount) || input.amount <= 0) {
            throw new UserInputError('提款金额必须大于0');
        }
        const customer = await this.customerService.findOne(ctx, input.customerId);
        if (!customer) throw new UserInputError('客户不存在');
        const account = await this.getOrCreateAccount(ctx, customer);
        const wallet = await this.getOrCreateWallet(ctx, account, customer, input.currencyCode);
        if (wallet.availableBalance < input.amount) throw new UserInputError('客户可用余额不足');
        const withdrawal = await this.connection.getRepository(ctx, ReferralWithdrawal).save(
            new ReferralWithdrawal({
                channelId: ctx.channelId,
                walletId: wallet.id,
                customerId: customer.id,
                code: withdrawalCode(),
                currencyCode: input.currencyCode,
                amount: input.amount,
                status: 'PENDING',
                payoutMethod: requiredText(input.payoutMethod, '提款方式', 32),
                payoutAccountMasked: requiredText(input.payoutAccountMasked, '脱敏收款账户', 160),
                externalReference: null,
                note: optionalText(input.note, 500),
                requestedByAdministratorId: ctx.activeUserId ?? null,
                processedByAdministratorId: null,
                approvedAt: null,
                paidAt: null,
                rejectedAt: null,
                cancelledAt: null,
            }),
        );
        await this.applyWalletDelta(ctx, wallet, {
            eventType: 'WITHDRAWAL_RESERVED',
            idempotencyKey: `WITHDRAWAL_RESERVED:${withdrawal.id}`,
            availableDelta: -input.amount,
            reservedDelta: input.amount,
            withdrawalId: withdrawal.id,
            actorId: ctx.activeUserId,
            actorType: 'ADMIN',
            note: '客服代客户创建人工提款申请',
        });
        return this.withdrawalView(withdrawal, customer);
    }

    async processWithdrawal(ctx: RequestContext, input: ProcessReferralWithdrawalInput) {
        await this.lockRow(ctx, ReferralWithdrawal, input.id);
        const withdrawal = await this.connection.getRepository(ctx, ReferralWithdrawal).findOne({
            where: { id: input.id, channelId: ctx.channelId },
            relations: { customer: true, wallet: true },
        });
        if (!withdrawal) throw new UserInputError('提款申请不存在');
        const nextStatus = input.status;
        const currentStatus = withdrawal.status as ReferralWithdrawalStatus;
        const allowed: Record<ReferralWithdrawalStatus, ReferralWithdrawalStatus[]> = {
            PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
            APPROVED: ['PAID', 'REJECTED', 'CANCELLED'],
            PAID: [],
            REJECTED: [],
            CANCELLED: [],
        };
        if (!allowed[currentStatus]?.includes(nextStatus)) {
            throw new UserInputError('当前提款状态不允许执行此操作');
        }
        const now = new Date();
        if (nextStatus === 'APPROVED') withdrawal.approvedAt = now;
        if (nextStatus === 'PAID') {
            if (!input.externalReference?.trim()) throw new UserInputError('请填写外部打款流水号');
            withdrawal.paidAt = now;
            await this.applyWalletDelta(ctx, withdrawal.wallet, {
                eventType: 'WITHDRAWAL_PAID',
                idempotencyKey: `WITHDRAWAL_PAID:${withdrawal.id}`,
                reservedDelta: -withdrawal.amount,
                withdrawalId: withdrawal.id,
                actorId: ctx.activeUserId,
                actorType: 'ADMIN',
                note: '人工提款已完成打款',
            });
        }
        if (nextStatus === 'REJECTED' || nextStatus === 'CANCELLED') {
            if (nextStatus === 'REJECTED') withdrawal.rejectedAt = now;
            else withdrawal.cancelledAt = now;
            await this.applyWalletDelta(ctx, withdrawal.wallet, {
                eventType: nextStatus === 'REJECTED' ? 'WITHDRAWAL_REJECTED' : 'WITHDRAWAL_CANCELLED',
                idempotencyKey: `${nextStatus}:${withdrawal.id}`,
                availableDelta: withdrawal.amount,
                reservedDelta: -withdrawal.amount,
                withdrawalId: withdrawal.id,
                actorId: ctx.activeUserId,
                actorType: 'ADMIN',
                note: nextStatus === 'REJECTED' ? '人工提款已驳回' : '人工提款已取消',
            });
        }
        withdrawal.status = nextStatus;
        withdrawal.externalReference = optionalText(input.externalReference, 160);
        withdrawal.note = optionalText(input.note, 500) ?? withdrawal.note;
        withdrawal.processedByAdministratorId = ctx.activeUserId ?? null;
        await this.connection.getRepository(ctx, ReferralWithdrawal).save(withdrawal, { reload: false });
        return this.withdrawalView(withdrawal, withdrawal.customer);
    }

    async adjustBalance(
        ctx: RequestContext,
        customerId: ID,
        currencyCode: CurrencyCode,
        amount: number,
        reason: string,
    ) {
        if (!Number.isInteger(amount) || amount === 0) throw new UserInputError('调整金额不能为0');
        const customer = await this.customerService.findOne(ctx, customerId);
        if (!customer) throw new UserInputError('客户不存在');
        const account = await this.getOrCreateAccount(ctx, customer);
        const wallet = await this.getOrCreateWallet(ctx, account, customer, currencyCode);
        return this.applyWalletDelta(ctx, wallet, {
            eventType: 'ADMIN_ADJUSTMENT',
            idempotencyKey: `ADMIN_ADJUSTMENT:${randomBytes(16).toString('hex')}`,
            availableDelta: amount,
            actorId: ctx.activeUserId,
            actorType: 'ADMIN',
            note: requiredText(reason, '调整原因', 500),
            allowNegativeAvailable: true,
        });
    }

    async adminRelationships(ctx: RequestContext, skip = 0, take = 100) {
        const [items, totalItems] = await this.connection
            .getRepository(ctx, ReferralRelationship)
            .findAndCount({
                where: { channelId: ctx.channelId },
                relations: { inviterCustomer: true, inviteeCustomer: true },
                order: { boundAt: 'DESC' },
                skip: Math.max(0, skip),
                take: pageSize(take),
            });
        return {
            totalItems,
            items: items.map(item => ({
                ...item,
                inviterName: customerName(item.inviterCustomer),
                inviterEmail: item.inviterCustomer.emailAddress,
                inviteeName: customerName(item.inviteeCustomer),
                inviteeEmail: item.inviteeCustomer.emailAddress,
            })),
        };
    }

    async adminInviterSummaries(ctx: RequestContext, skip = 0, take = 50) {
        const repository = this.connection.getRepository(ctx, ReferralRelationship);
        const rows = await repository
            .createQueryBuilder('relationship')
            .innerJoin('relationship.inviterCustomer', 'customer')
            .innerJoin(
                ReferralAccount,
                'account',
                'account.customerId = relationship.inviterCustomerId AND account.channelId = relationship.channelId',
            )
            .select('relationship.inviterCustomerId', 'customerId')
            .addSelect('customer.firstName', 'firstName')
            .addSelect('customer.lastName', 'lastName')
            .addSelect('customer.emailAddress', 'emailAddress')
            .addSelect('account.inviteCode', 'inviteCode')
            .addSelect('COUNT(relationship.id)', 'invitedCount')
            .addSelect(
                'SUM(CASE WHEN relationship.firstPaidOrderAt IS NULL THEN 0 ELSE 1 END)',
                'purchasedInviteeCount',
            )
            .where('relationship.channelId = :channelId', { channelId: ctx.channelId })
            .groupBy('relationship.inviterCustomerId')
            .addGroupBy('customer.firstName')
            .addGroupBy('customer.lastName')
            .addGroupBy('customer.emailAddress')
            .addGroupBy('account.inviteCode')
            .orderBy('invitedCount', 'DESC')
            .addOrderBy('relationship.inviterCustomerId', 'ASC')
            .skip(Math.max(0, skip))
            .take(pageSize(take))
            .getRawMany<{
                customerId: string | number;
                firstName: string;
                lastName: string;
                emailAddress: string;
                inviteCode: string;
                invitedCount: string | number;
                purchasedInviteeCount: string | number;
            }>();
        const total = await repository
            .createQueryBuilder('relationship')
            .select('COUNT(DISTINCT relationship.inviterCustomerId)', 'count')
            .where('relationship.channelId = :channelId', { channelId: ctx.channelId })
            .getRawOne<{ count: string | number }>();
        return {
            totalItems: Number(total?.count ?? 0),
            items: rows.map(row => ({
                customerId: row.customerId,
                customerName: `${row.lastName ?? ''}${row.firstName ?? ''}`.trim() || row.emailAddress,
                customerEmail: row.emailAddress,
                inviteCode: row.inviteCode,
                invitedCount: Number(row.invitedCount),
                purchasedInviteeCount: Number(row.purchasedInviteeCount),
            })),
        };
    }

    async adminLedger(ctx: RequestContext, skip = 0, take = 100) {
        const [items, totalItems] = await this.connection
            .getRepository(ctx, ReferralLedgerEntry)
            .findAndCount({
                where: { channelId: ctx.channelId },
                relations: { customer: true },
                order: { createdAt: 'DESC' },
                skip: Math.max(0, skip),
                take: pageSize(take),
            });
        return {
            totalItems,
            items: items.map(item => ({
                ...item,
                customerName: customerName(item.customer),
                customerEmail: item.customer.emailAddress,
            })),
        };
    }

    async adminRewards(ctx: RequestContext, skip = 0, take = 100) {
        const [items, totalItems] = await this.connection.getRepository(ctx, ReferralReward).findAndCount({
            where: { channelId: ctx.channelId },
            relations: { inviterCustomer: true, inviteeCustomer: true, order: true },
            order: { earnedAt: 'DESC' },
            skip: Math.max(0, skip),
            take: pageSize(take),
        });
        return {
            totalItems,
            items: items.map(item => ({
                ...item,
                orderCode: item.order.code,
                inviterName: customerName(item.inviterCustomer),
                inviterEmail: item.inviterCustomer.emailAddress,
                inviteeName: customerName(item.inviteeCustomer),
                inviteeEmail: item.inviteeCustomer.emailAddress,
                rewardRate: item.rewardRateBps / 100,
            })),
        };
    }

    async adminWithdrawals(ctx: RequestContext, skip = 0, take = 100) {
        const [items, totalItems] = await this.connection
            .getRepository(ctx, ReferralWithdrawal)
            .findAndCount({
                where: { channelId: ctx.channelId },
                relations: { customer: true },
                order: { createdAt: 'DESC' },
                skip: Math.max(0, skip),
                take: pageSize(take),
            });
        return { totalItems, items: items.map(item => this.withdrawalView(item, item.customer)) };
    }

    async adminCustomerWallets(ctx: RequestContext, customerId: ID) {
        return this.connection.getRepository(ctx, ReferralWallet).find({
            where: { channelId: ctx.channelId, customerId },
            order: { currencyCode: 'ASC' },
        });
    }

    async todayMetrics(ctx: RequestContext) {
        const { businessDate, start, end } = businessDayRange(new Date());
        // Vendure's base createdAt/updatedAt columns are database-generated UTC values stored in
        // timestamp-without-time-zone columns. Pass UTC wall-clock strings for those columns so a
        // non-UTC Node.js process does not shift the business-day boundary during driver encoding.
        const utcStart = utcDatabaseTimestamp(start);
        const utcEnd = utcDatabaseTimestamp(end);
        const orders = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('referralOrder')
            .innerJoin('referralOrder.channels', 'orderChannel', 'orderChannel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .innerJoin(
                'referralOrder.payments',
                'settledTodayPayment',
                'settledTodayPayment.state = :settledPaymentState AND settledTodayPayment.updatedAt >= :utcStart AND settledTodayPayment.updatedAt < :utcEnd',
                { settledPaymentState: 'Settled', utcStart, utcEnd },
            )
            .leftJoinAndSelect('referralOrder.payments', 'metricPayment')
            .leftJoinAndSelect('metricPayment.refunds', 'metricRefund')
            .where('referralOrder.state IN (:...settledStates)', {
                settledStates: REFERRAL_METRIC_SETTLED_ORDER_STATES,
            })
            .select([
                'referralOrder.id',
                'referralOrder.customerId',
                'referralOrder.currencyCode',
                'referralOrder.subTotalWithTax',
                'referralOrder.shippingWithTax',
                'referralOrder.orderPlacedAt',
                'metricPayment.id',
                'metricPayment.amount',
                'metricPayment.state',
                'metricPayment.updatedAt',
                'metricRefund.id',
                'metricRefund.total',
                'metricRefund.state',
            ])
            .getMany();
        const netOrders = orders
            .map(order => ({ order, netTotal: settledOrderNetTotal(order) }))
            .filter(item => item.netTotal > 0);
        const netOrderIds = netOrders.map(({ order }) => order.id.toString());
        const buyerIds = Array.from(
            new Set(
                netOrders.flatMap(({ order }) => (order.customerId ? [order.customerId.toString()] : [])),
            ),
        );
        let returningCustomerIds = new Set<string>();
        if (buyerIds.length) {
            const previousBuyers = await this.connection
                .getRepository(ctx, Order)
                .createQueryBuilder('referralOrder')
                .innerJoin('referralOrder.channels', 'orderChannel', 'orderChannel.id = :channelId', {
                    channelId: ctx.channelId,
                })
                .where('referralOrder.customerId IN (:...buyerIds)', { buyerIds })
                .andWhere('referralOrder.id NOT IN (:...currentOrderIds)', {
                    currentOrderIds: netOrderIds,
                })
                .andWhere('referralOrder.orderPlacedAt < :start', { start })
                .andWhere('referralOrder.state IN (:...settledStates)', {
                    settledStates: REFERRAL_METRIC_SETTLED_ORDER_STATES,
                })
                .select('referralOrder.customerId', 'customerId')
                .distinct(true)
                .getRawMany<{ customerId: string | number }>();
            returningCustomerIds = new Set(previousBuyers.map(item => item.customerId.toString()));
        }
        const [newCustomerCount, visitorCount, todayInvitedCount, todayInvitedPurchaserCount] =
            await Promise.all([
                this.connection
                    .getRepository(ctx, Customer)
                    .createQueryBuilder('customer')
                    .innerJoin('customer.channels', 'customerChannel', 'customerChannel.id = :channelId', {
                        channelId: ctx.channelId,
                    })
                    .innerJoin('customer.user', 'customerUser')
                    .where('customerUser.createdAt >= :utcStart', { utcStart })
                    .andWhere('customerUser.createdAt < :utcEnd', { utcEnd })
                    .getCount(),
                this.connection.getRepository(ctx, StorefrontDailyVisitor).count({
                    where: { channelId: ctx.channelId, businessDate },
                }),
                this.connection
                    .getRepository(ctx, ReferralRelationship)
                    .createQueryBuilder('relationship')
                    .where('relationship.channelId = :channelId', { channelId: ctx.channelId })
                    .andWhere('relationship.boundAt >= :start', { start })
                    .andWhere('relationship.boundAt < :end', { end })
                    .getCount(),
                this.connection
                    .getRepository(ctx, ReferralRelationship)
                    .createQueryBuilder('relationship')
                    .where('relationship.channelId = :channelId', { channelId: ctx.channelId })
                    .andWhere('relationship.firstPaidOrderAt >= :start', { start })
                    .andWhere('relationship.firstPaidOrderAt < :end', { end })
                    .getCount(),
            ]);
        const salesByCurrency = Array.from(
            netOrders.reduce((totals, { order, netTotal }) => {
                totals.set(order.currencyCode, (totals.get(order.currencyCode) ?? 0) + netTotal);
                return totals;
            }, new Map<CurrencyCode, number>()),
            ([currencyCode, sales]) => ({ currencyCode, sales }),
        );
        return {
            businessDate,
            visitorCount,
            newCustomerCount,
            consumerCount: buyerIds.length,
            firstTimeConsumerCount: buyerIds.filter(id => !returningCustomerIds.has(id)).length,
            returningConsumerCount: buyerIds.filter(id => returningCustomerIds.has(id)).length,
            orderCount: netOrders.length,
            todayInvitedCount,
            todayInvitedPurchaserCount,
            salesByCurrency,
        };
    }

    async reconcile(): Promise<{ releasedRewards: number }> {
        const rewards = await this.connection.rawConnection.getRepository(ReferralReward).find({
            where: { status: 'PENDING', availableAt: LessThanOrEqual(new Date()) },
            relations: { channel: true },
            take: 500,
            order: { availableAt: 'ASC' },
        });
        let releasedRewards = 0;
        for (const reward of rewards) {
            const outerCtx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: reward.channel,
            });
            await this.connection.withTransaction(outerCtx, async ctx => {
                if (await this.releaseReward(ctx, reward.id)) releasedRewards += 1;
            });
        }
        return { releasedRewards };
    }

    async auditAllBalances() {
        const audit = await this.auditWalletRepository(
            this.connection.rawConnection.getRepository(ReferralWallet),
            this.connection.rawConnection.getRepository(ReferralLedgerEntry),
        );
        return {
            auditedWallets: audit.auditedWallets,
            balanceAnomalies: audit.items.length,
        };
    }

    async balanceAudit(ctx: RequestContext) {
        return this.auditWalletRepository(
            this.connection.getRepository(ctx, ReferralWallet),
            this.connection.getRepository(ctx, ReferralLedgerEntry),
            ctx.channelId,
        );
    }

    private async auditWalletRepository(
        walletRepository: ReturnType<TransactionalConnection['getRepository']>,
        ledgerRepository: ReturnType<TransactionalConnection['getRepository']>,
        channelId?: ID,
    ) {
        const wallets = (await walletRepository.find({
            ...(channelId ? { where: { channelId } } : {}),
            relations: { customer: true },
            take: 5_000,
            order: { id: 'ASC' },
        })) as ReferralWallet[];
        const ledgerQuery = ledgerRepository
            .createQueryBuilder('entry')
            .select('entry.walletId', 'walletId')
            .addSelect('COALESCE(SUM(entry.availableDelta), 0)', 'availableBalance')
            .addSelect('COALESCE(SUM(entry.pendingDelta), 0)', 'pendingBalance')
            .addSelect('COALESCE(SUM(entry.reservedDelta), 0)', 'reservedBalance')
            .groupBy('entry.walletId');
        if (channelId) ledgerQuery.where('entry.channelId = :channelId', { channelId });
        const ledgerBalances = await ledgerQuery.getRawMany<{
            walletId: string | number;
            availableBalance: string | number;
            pendingBalance: string | number;
            reservedBalance: string | number;
        }>();
        const ledgerByWallet = new Map(ledgerBalances.map(item => [item.walletId.toString(), item]));
        const items = wallets.flatMap(wallet => {
            const ledger = ledgerByWallet.get(wallet.id.toString());
            const ledgerAvailableBalance = Number(ledger?.availableBalance ?? 0);
            const ledgerPendingBalance = Number(ledger?.pendingBalance ?? 0);
            const ledgerReservedBalance = Number(ledger?.reservedBalance ?? 0);
            const availableDifference = wallet.availableBalance - ledgerAvailableBalance;
            const pendingDifference = wallet.pendingBalance - ledgerPendingBalance;
            const reservedDifference = wallet.reservedBalance - ledgerReservedBalance;
            if (!availableDifference && !pendingDifference && !reservedDifference) return [];
            return [
                {
                    walletId: wallet.id,
                    customerId: wallet.customerId,
                    customerName: customerName(wallet.customer),
                    customerEmail: wallet.customer.emailAddress,
                    currencyCode: wallet.currencyCode,
                    actualAvailableBalance: wallet.availableBalance,
                    actualPendingBalance: wallet.pendingBalance,
                    actualReservedBalance: wallet.reservedBalance,
                    ledgerAvailableBalance,
                    ledgerPendingBalance,
                    ledgerReservedBalance,
                    availableDifference,
                    pendingDifference,
                    reservedDifference,
                },
            ];
        });
        return { auditedWallets: wallets.length, items };
    }

    private async rewardSettledOrder(ctx: RequestContext, orderId: ID, settledAt: Date): Promise<void> {
        const order = await this.orderService.findOne(ctx, orderId, [
            'customer',
            'payments',
            'payments.refunds',
            'shippingLines',
        ]);
        if (!order?.customer || order.totalWithTax <= 0) return;
        const relationship = await this.connection.getRepository(ctx, ReferralRelationship).findOne({
            where: { channelId: ctx.channelId, inviteeCustomerId: order.customer.id },
        });
        if (!relationship) return;
        if (!relationship.firstPaidOrderAt) {
            relationship.firstPaidOrderAt = settledAt;
            await this.connection.getRepository(ctx, ReferralRelationship).save(relationship, {
                reload: false,
            });
        }
        const config = await this.getConfig(ctx);
        if (!config.enabled) return;
        const existing = await this.connection.getRepository(ctx, ReferralReward).findOne({
            where: { channelId: ctx.channelId, orderId },
        });
        if (existing) return;
        if (config.rewardRateBps <= 0) return;

        const productNet = Math.max(0, order.totalWithTax - order.shippingWithTax);
        const settledPayments = (order.payments ?? []).filter(payment => payment.state === 'Settled');
        const settledTotal = settledPayments.reduce((total, payment) => total + payment.amount, 0);
        const externalSettled = settledPayments
            .filter(payment => payment.method !== REFERRAL_BALANCE_PAYMENT_METHOD_CODE)
            .reduce((total, payment) => total + payment.amount, 0);
        const minimumOrderAmount = convertChannelAmount(
            ctx,
            config.minimumOrderAmount,
            config.currencyCode,
            order.currencyCode,
        );
        const maxRewardPerOrder =
            config.maxRewardPerOrder == null
                ? null
                : convertChannelAmount(
                      ctx,
                      config.maxRewardPerOrder,
                      config.currencyCode,
                      order.currencyCode,
                  );
        if (minimumOrderAmount == null || (config.maxRewardPerOrder != null && maxRewardPerOrder == null)) {
            return;
        }
        const { eligibleAmount, rewardAmount } = calculateReferralReward({
            productNet,
            settledTotal: settledTotal || order.totalWithTax,
            externalSettled,
            rewardRateBps: config.rewardRateBps,
            minimumOrderAmount,
            maxRewardPerOrder,
        });
        if (rewardAmount <= 0) return;

        const inviter = await this.customerService.findOne(ctx, relationship.inviterCustomerId);
        if (!inviter) return;
        const account = await this.getOrCreateAccount(ctx, inviter);
        const wallet = await this.getOrCreateWallet(ctx, account, inviter, order.currencyCode);
        const earnedAt = new Date();
        const availableAt = new Date(earnedAt.getTime() + config.releaseDelayDays * 86_400_000);
        const availableImmediately = config.releaseDelayDays === 0;
        const reward = await this.connection.getRepository(ctx, ReferralReward).save(
            new ReferralReward({
                channelId: ctx.channelId,
                inviterCustomerId: inviter.id,
                inviteeCustomerId: order.customer.id,
                orderId: order.id,
                currencyCode: order.currencyCode,
                rewardRateBps: config.rewardRateBps,
                eligibleAmount,
                rewardAmount,
                releasedAmount: availableImmediately ? rewardAmount : 0,
                clawedBackAmount: 0,
                settledRefundTotal: 0,
                settledEligibleRefundTotal: 0,
                orderTotalWithTax: order.totalWithTax,
                status: availableImmediately ? 'AVAILABLE' : 'PENDING',
                earnedAt,
                availableAt,
                releasedAt: availableImmediately ? earnedAt : null,
            }),
        );
        await this.applyWalletDelta(ctx, wallet, {
            eventType: availableImmediately ? 'REWARD_AVAILABLE' : 'REWARD_PENDING',
            idempotencyKey: `REWARD_EARNED:${reward.id}:${order.id}`,
            availableDelta: availableImmediately ? rewardAmount : 0,
            pendingDelta: availableImmediately ? 0 : rewardAmount,
            orderId: order.id,
            actorType: 'SYSTEM',
            note: availableImmediately ? '邀请订单返利已生效' : '邀请订单返利待生效',
            metadata: { rewardId: reward.id.toString(), rewardRateBps: config.rewardRateBps, eligibleAmount },
        });
    }

    private async handleSettledRefund(ctx: RequestContext, orderId: ID, refundId: ID): Promise<void> {
        await this.clawBackRewardForRefund(ctx, orderId, refundId);
        await this.restoreBalanceUseForRefund(ctx, orderId, refundId);
    }

    private async clawBackRewardForRefund(ctx: RequestContext, orderId: ID, refundId: ID): Promise<void> {
        const rewardId = await this.connection.getRepository(ctx, ReferralReward).findOne({
            where: { channelId: ctx.channelId, orderId },
            select: { id: true },
        });
        if (!rewardId) return;
        await this.lockRow(ctx, ReferralReward, rewardId.id);
        const reward = await this.connection.getRepository(ctx, ReferralReward).findOne({
            where: { id: rewardId.id },
        });
        if (!reward) return;
        const order = await this.orderService.findOne(ctx, orderId, ['payments', 'payments.refunds']);
        if (!order) return;
        const settledRefunds = (order.payments ?? [])
            .flatMap(payment =>
                (payment.refunds ?? []).map(refund => ({ paymentMethod: payment.method, refund })),
            )
            .filter(item => item.refund.state === 'Settled');
        const settledRefundTotal = settledRefunds.reduce((total, item) => total + item.refund.total, 0);
        const settledEligibleRefundTotal = Math.min(
            reward.eligibleAmount,
            settledRefunds
                .filter(item => item.paymentMethod !== REFERRAL_BALANCE_PAYMENT_METHOD_CODE)
                .reduce((total, item) => total + calculateEligibleReferralRefund(item.refund), 0),
        );
        const targetClawback = calculateReferralClawback(
            reward.rewardAmount,
            settledEligibleRefundTotal,
            reward.eligibleAmount,
        );
        const delta = targetClawback - reward.clawedBackAmount;
        if (delta > 0) {
            const inviter = await this.customerService.findOne(ctx, reward.inviterCustomerId);
            if (!inviter) return;
            const account = await this.getOrCreateAccount(ctx, inviter);
            const wallet = await this.getOrCreateWallet(ctx, account, inviter, reward.currencyCode);
            const pendingOutstanding = Math.max(
                0,
                reward.rewardAmount - reward.releasedAmount - reward.clawedBackAmount,
            );
            const pendingDelta = Math.min(delta, pendingOutstanding);
            const availableDelta = delta - pendingDelta;
            await this.applyWalletDelta(ctx, wallet, {
                eventType: 'REFUND_CLAWBACK',
                idempotencyKey: `REFUND_CLAWBACK:${reward.id}:${refundId}`,
                availableDelta: -availableDelta,
                pendingDelta: -pendingDelta,
                orderId,
                refundId,
                actorType: 'SYSTEM',
                note: '被邀请人订单已退款，按比例扣回返利',
                allowNegativeAvailable: true,
                metadata: { rewardId: reward.id.toString(), settledRefundTotal, settledEligibleRefundTotal },
            });
        }
        reward.clawedBackAmount = targetClawback;
        reward.settledRefundTotal = settledRefundTotal;
        reward.settledEligibleRefundTotal = settledEligibleRefundTotal;
        reward.status = referralRewardStatusAfterClawback({
            rewardAmount: reward.rewardAmount,
            clawedBackAmount: targetClawback,
            releasedAmount: reward.releasedAmount,
        });
        await this.connection.getRepository(ctx, ReferralReward).save(reward, { reload: false });
    }

    private async restoreBalanceUseForRefund(ctx: RequestContext, orderId: ID, refundId: ID): Promise<void> {
        const refund = await this.connection.getRepository(ctx, Refund).findOne({
            where: { id: refundId },
            relations: { payment: true },
        });
        if (!refund || refund.payment?.method !== REFERRAL_BALANCE_PAYMENT_METHOD_CODE) return;
        const use = await this.connection.getRepository(ctx, ReferralBalanceUse).findOne({
            where: { channelId: ctx.channelId, orderId },
            relations: { wallet: true },
        });
        if (!use) return;
        const delta = Math.min(refund.total, Math.max(0, use.amount - use.refundedAmount));
        if (delta <= 0) return;
        await this.applyWalletDelta(ctx, use.wallet, {
            eventType: 'SPEND_REFUNDED',
            idempotencyKey: `SPEND_REFUNDED:${use.id}:${refundId}`,
            availableDelta: delta,
            orderId,
            refundId,
            actorType: 'SYSTEM',
            note: '订单退款已退回返利余额',
        });
        use.refundedAmount += delta;
        use.status = use.refundedAmount >= use.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        await this.connection.getRepository(ctx, ReferralBalanceUse).save(use, { reload: false });
    }

    private async handleCancelledOrder(ctx: RequestContext, orderId: ID): Promise<void> {
        const rewardId = await this.connection.getRepository(ctx, ReferralReward).findOne({
            where: { channelId: ctx.channelId, orderId },
            select: { id: true },
        });
        if (rewardId) await this.lockRow(ctx, ReferralReward, rewardId.id);
        const reward = rewardId
            ? await this.connection.getRepository(ctx, ReferralReward).findOne({ where: { id: rewardId.id } })
            : null;
        if (reward && reward.clawedBackAmount < reward.rewardAmount) {
            const inviter = await this.customerService.findOne(ctx, reward.inviterCustomerId);
            if (inviter) {
                const account = await this.getOrCreateAccount(ctx, inviter);
                const wallet = await this.getOrCreateWallet(ctx, account, inviter, reward.currencyCode);
                const delta = reward.rewardAmount - reward.clawedBackAmount;
                const pendingOutstanding = Math.max(
                    0,
                    reward.rewardAmount - reward.releasedAmount - reward.clawedBackAmount,
                );
                const pendingDelta = Math.min(delta, pendingOutstanding);
                await this.applyWalletDelta(ctx, wallet, {
                    eventType: 'ORDER_CANCEL_CLAWBACK',
                    idempotencyKey: `ORDER_CANCEL_CLAWBACK:${reward.id}:${orderId}`,
                    availableDelta: -(delta - pendingDelta),
                    pendingDelta: -pendingDelta,
                    orderId,
                    actorType: 'SYSTEM',
                    note: '被邀请人订单已取消，扣回全部返利',
                    allowNegativeAvailable: true,
                });
                reward.clawedBackAmount = reward.rewardAmount;
                reward.status = 'REVERSED';
                await this.connection.getRepository(ctx, ReferralReward).save(reward, { reload: false });
            }
        }

        const use = await this.connection.getRepository(ctx, ReferralBalanceUse).findOne({
            where: { channelId: ctx.channelId, orderId },
            relations: { wallet: true },
        });
        if (use && use.refundedAmount < use.amount && use.status !== 'RELEASED') {
            const delta = use.amount - use.refundedAmount;
            await this.applyWalletDelta(ctx, use.wallet, {
                eventType: 'SPEND_CANCELLED',
                idempotencyKey: `SPEND_CANCELLED:${use.id}:${orderId}`,
                availableDelta: delta,
                reservedDelta: use.status === 'RESERVED' ? -delta : 0,
                orderId,
                actorType: 'SYSTEM',
                note: '订单取消，退回返利余额',
            });
            use.refundedAmount = use.amount;
            use.status = 'RELEASED';
            use.releasedAt = new Date();
            await this.connection.getRepository(ctx, ReferralBalanceUse).save(use, { reload: false });
        }
    }

    private async releaseReward(ctx: RequestContext, rewardId: ID): Promise<boolean> {
        await this.lockRow(ctx, ReferralReward, rewardId);
        const reward = await this.connection.getRepository(ctx, ReferralReward).findOneBy({ id: rewardId });
        if (!reward || reward.status !== 'PENDING' || reward.availableAt > new Date()) return false;
        const amount = reward.rewardAmount - reward.clawedBackAmount - reward.releasedAmount;
        if (amount <= 0) {
            reward.status = 'REVERSED';
            await this.connection.getRepository(ctx, ReferralReward).save(reward, { reload: false });
            return false;
        }
        const inviter = await this.customerService.findOne(ctx, reward.inviterCustomerId);
        if (!inviter) return false;
        const account = await this.getOrCreateAccount(ctx, inviter);
        const wallet = await this.getOrCreateWallet(ctx, account, inviter, reward.currencyCode);
        await this.applyWalletDelta(ctx, wallet, {
            eventType: 'REWARD_RELEASED',
            idempotencyKey: `REWARD_RELEASED:${reward.id}`,
            availableDelta: amount,
            pendingDelta: -amount,
            orderId: reward.orderId,
            actorType: 'SYSTEM',
            note: '邀请返利结算期结束，转为可用余额',
        });
        reward.releasedAmount += amount;
        reward.releasedAt = new Date();
        reward.status = reward.clawedBackAmount > 0 ? 'PARTIALLY_REVERSED' : 'AVAILABLE';
        await this.connection.getRepository(ctx, ReferralReward).save(reward, { reload: false });
        return true;
    }

    private async bindRelationship(
        ctx: RequestContext,
        inviterAccount: ReferralAccount,
        invitee: Customer,
        source: string,
    ): Promise<void> {
        if (inviterAccount.customerId.toString() === invitee.id.toString()) {
            throw new UserInputError('不能使用自己的邀请码');
        }
        const existing = await this.connection.getRepository(ctx, ReferralRelationship).findOne({
            where: { channelId: ctx.channelId, inviteeCustomerId: invitee.id },
        });
        if (existing) return;
        await this.connection.getRepository(ctx, ReferralRelationship).save(
            new ReferralRelationship({
                channelId: ctx.channelId,
                inviterCustomerId: inviterAccount.customerId,
                inviteeCustomerId: invitee.id,
                inviteCodeSnapshot: inviterAccount.inviteCode,
                source: ['LINK', 'POSTER', 'CODE'].includes(source) ? source : 'CODE',
                boundAt: new Date(),
                firstPaidOrderAt: null,
            }),
            { reload: false },
        );
    }

    private async getConfig(ctx: RequestContext): Promise<ReferralProgramConfig> {
        const existing = await this.connection.getRepository(ctx, ReferralProgramConfig).findOne({
            where: { channelId: ctx.channelId },
        });
        return (
            existing ??
            new ReferralProgramConfig({
                channelId: ctx.channelId,
                enabled: false,
                rewardRateBps: 500,
                releaseDelayDays: 7,
                minimumOrderAmount: 0,
                currencyCode: ctx.channel.defaultCurrencyCode,
                maxRewardPerOrder: null,
                allowBalanceSpend: true,
                attributionWindowDays: 30,
                defaultPosterTemplate: 'BRAND_MINIMAL',
            })
        );
    }

    private async getOrCreateConfig(ctx: RequestContext): Promise<ReferralProgramConfig> {
        const config = await this.getConfig(ctx);
        if (config.id) return config;
        return this.connection.getRepository(ctx, ReferralProgramConfig).save(config);
    }

    private async lockConfigOrThrow(ctx: RequestContext, id: ID): Promise<ReferralProgramConfig> {
        const repository = this.connection.getRepository(ctx, ReferralProgramConfig);
        if (supportsReferralPessimisticLock(this.connection.rawConnection.options.type)) {
            try {
                const locked = await repository
                    .createQueryBuilder('config')
                    .setLock('pessimistic_write')
                    .where('config.id = :id', { id })
                    .andWhere('config.channelId = :channelId', { channelId: ctx.channelId })
                    .getOne();
                if (!locked) throw new UserInputError('邀请返利配置不存在');
            } catch (error) {
                if (!isLockNotSupportedError(error)) throw error;
            }
        }
        const config = await repository.findOne({ where: { id, channelId: ctx.channelId } });
        if (!config) throw new UserInputError('邀请返利配置不存在');
        return config;
    }

    private assertExpectedUpdatedAt(current: Date, expected: Date | string): void {
        const expectedDate = expected instanceof Date ? expected : new Date(expected);
        if (!Number.isFinite(expectedDate.getTime()) || current.getTime() !== expectedDate.getTime()) {
            throw new UserInputError(
                'CONCURRENT_MODIFICATION: 邀请返利配置已被其他管理员更新，请重新载入后合并修改',
            );
        }
    }

    private async configView(ctx: RequestContext, config: ReferralProgramConfig, includeDisabled: boolean) {
        const posterTemplateConfigs = await this.connection.getRepository(ctx, ReferralPosterTemplate).find({
            where: {
                channelId: ctx.channelId,
                ...(includeDisabled ? {} : { enabled: true }),
            },
            relations: {
                posterBackgroundAsset: true,
                shareBackgroundAsset: true,
            },
            order: { position: 'ASC', id: 'ASC' },
        });
        const minimumOrderAmount =
            convertChannelAmount(ctx, config.minimumOrderAmount, config.currencyCode, ctx.currencyCode) ?? 0;
        const maxRewardPerOrder =
            config.maxRewardPerOrder == null
                ? null
                : convertChannelAmount(ctx, config.maxRewardPerOrder, config.currencyCode, ctx.currencyCode);
        return {
            channelId: config.channelId,
            updatedAt: config.updatedAt,
            enabled: config.enabled,
            rewardRate: config.rewardRateBps / 100,
            releaseDelayDays: config.releaseDelayDays,
            currencyCode: ctx.currencyCode,
            minimumOrderAmount,
            maxRewardPerOrder,
            allowBalanceSpend: config.allowBalanceSpend,
            attributionWindowDays: config.attributionWindowDays,
            defaultPosterTemplate: config.defaultPosterTemplate,
            posterTemplates: [...referralPosterTemplates],
            posterTemplateConfigs,
        };
    }

    private validateProgramInput(input: UpdateReferralProgramInput): void {
        if (!Number.isFinite(input.rewardRate) || input.rewardRate < 0 || input.rewardRate > 100) {
            throw new UserInputError('返利比例必须在0至100之间');
        }
        if (
            !Number.isInteger(input.releaseDelayDays) ||
            input.releaseDelayDays < 0 ||
            input.releaseDelayDays > 30
        ) {
            throw new UserInputError('结算等待天数必须在0至30之间');
        }
        if (!Number.isInteger(input.minimumOrderAmount) || input.minimumOrderAmount < 0) {
            throw new UserInputError('最低有效消费金额无效');
        }
        if (
            input.maxRewardPerOrder != null &&
            (!Number.isInteger(input.maxRewardPerOrder) || input.maxRewardPerOrder <= 0)
        ) {
            throw new UserInputError('单笔返利上限必须大于0');
        }
        if (
            !Number.isInteger(input.attributionWindowDays) ||
            input.attributionWindowDays < 1 ||
            input.attributionWindowDays > 365
        ) {
            throw new UserInputError('邀请来源有效期必须在1至365天之间');
        }
    }

    private async validateDefaultPosterTemplate(ctx: RequestContext, id: string): Promise<void> {
        if (referralPosterTemplates.includes(id as never)) return;
        const template = await this.connection.getRepository(ctx, ReferralPosterTemplate).findOne({
            where: { id, channelId: ctx.channelId, enabled: true },
        });
        if (!template) throw new UserInputError('默认海报模板无效或已停用');
    }

    private async normalizePosterTemplateInput(ctx: RequestContext, input: SaveReferralPosterTemplateInput) {
        if (!Number.isInteger(input.position) || input.position < 0 || input.position > 100_000) {
            throw new UserInputError('模板排序必须是0至100000之间的整数');
        }
        if (input.layoutVariant !== 'STANDARD_CENTER') {
            throw new UserInputError('海报版式无效');
        }
        if (
            !Number.isInteger(input.overlayOpacity) ||
            input.overlayOpacity < 0 ||
            input.overlayOpacity > 80
        ) {
            throw new UserInputError('遮罩透明度必须在0至80之间');
        }
        const posterBackgroundAsset = await this.assetForChannel(ctx, input.posterBackgroundAssetId);
        const shareBackgroundAsset = await this.assetForChannel(ctx, input.shareBackgroundAssetId);
        return {
            name: requiredText(input.name, '模板名称', 128),
            enabled: input.enabled,
            position: input.position,
            layoutVariant: input.layoutVariant,
            posterBackgroundAssetId: posterBackgroundAsset?.id ?? null,
            shareBackgroundAssetId: shareBackgroundAsset?.id ?? null,
            titleZh: requiredText(input.titleZh, '中文小标题', 80),
            titleEn: requiredText(input.titleEn, '英文小标题', 80),
            headlineZh: requiredText(input.headlineZh, '中文主标题', 180),
            headlineEn: requiredText(input.headlineEn, '英文主标题', 180),
            rewardTextZh: requiredText(input.rewardTextZh, '中文奖励文案', 220),
            rewardTextEn: requiredText(input.rewardTextEn, '英文奖励文案', 220),
            siteIntroZh: clippedText(input.siteIntroZh, 260),
            siteIntroEn: clippedText(input.siteIntroEn, 260),
            serviceTextZh: clippedText(input.serviceTextZh, 260),
            serviceTextEn: clippedText(input.serviceTextEn, 260),
            foregroundColor: posterColor(input.foregroundColor, '主文字颜色'),
            accentColor: posterColor(input.accentColor, '强调颜色'),
            overlayOpacity: input.overlayOpacity,
        };
    }

    private async assetForChannel(ctx: RequestContext, id?: ID | null): Promise<Asset | null> {
        if (id == null || id === '') return null;
        const asset = await this.connection
            .getRepository(ctx, Asset)
            .createQueryBuilder('asset')
            .innerJoin('asset.channels', 'assetChannel', 'assetChannel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('asset.id = :id', { id })
            .getOne();
        if (!asset) throw new UserInputError('图片不存在或不属于当前店铺');
        if (!asset.mimeType?.startsWith('image/')) throw new UserInputError('海报背景必须是图片');
        return asset;
    }

    private async posterTemplateById(ctx: RequestContext, id: ID): Promise<ReferralPosterTemplate> {
        const template = await this.connection.getRepository(ctx, ReferralPosterTemplate).findOne({
            where: { id, channelId: ctx.channelId },
            relations: { posterBackgroundAsset: true, shareBackgroundAsset: true },
        });
        if (!template) throw new UserInputError('找不到该邀请海报模板');
        return template;
    }

    private async activeCustomer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('找不到当前客户');
        return customer;
    }

    private findAccountByCode(ctx: RequestContext, inviteCode: string): Promise<ReferralAccount | null> {
        return this.connection.getRepository(ctx, ReferralAccount).findOne({
            where: { channelId: ctx.channelId, inviteCode },
        });
    }

    private async getOrCreateAccount(ctx: RequestContext, customer: Customer): Promise<ReferralAccount> {
        const repository = this.connection.getRepository(ctx, ReferralAccount);
        const existing = await repository.findOne({
            where: { channelId: ctx.channelId, customerId: customer.id },
        });
        if (existing) return existing;
        for (let attempt = 0; attempt < 12; attempt++) {
            const inviteCode = generateInviteCode();
            const duplicate = await repository.findOne({ where: { channelId: ctx.channelId, inviteCode } });
            if (duplicate) continue;
            try {
                return await repository.save(
                    new ReferralAccount({ channelId: ctx.channelId, customerId: customer.id, inviteCode }),
                );
            } catch (error) {
                const raced = await repository.findOne({
                    where: { channelId: ctx.channelId, customerId: customer.id },
                });
                if (raced) return raced;
                if (attempt === 11) throw error;
            }
        }
        throw new UserInputError('生成邀请码失败，请重试');
    }

    private async getOrCreateWallet(
        ctx: RequestContext,
        account: ReferralAccount,
        customer: Customer,
        currencyCode: CurrencyCode,
    ): Promise<ReferralWallet> {
        const repository = this.connection.getRepository(ctx, ReferralWallet);
        const existing = await repository.findOne({
            where: { referralAccountId: account.id, currencyCode },
        });
        if (existing) return existing;
        try {
            return await repository.save(
                new ReferralWallet({
                    channelId: ctx.channelId,
                    referralAccountId: account.id,
                    customerId: customer.id,
                    currencyCode,
                    availableBalance: 0,
                    pendingBalance: 0,
                    reservedBalance: 0,
                }),
            );
        } catch (error) {
            const raced = await repository.findOne({
                where: { referralAccountId: account.id, currencyCode },
            });
            if (raced) return raced;
            throw error;
        }
    }

    private async applyWalletDelta(
        ctx: RequestContext,
        wallet: ReferralWallet,
        input: WalletDeltaInput,
    ): Promise<ReferralWallet> {
        const ledgerRepository = this.connection.getRepository(ctx, ReferralLedgerEntry);
        const duplicate = await ledgerRepository.findOne({ where: { idempotencyKey: input.idempotencyKey } });
        if (duplicate) {
            return this.connection.getRepository(ctx, ReferralWallet).findOneByOrFail({ id: wallet.id });
        }
        await this.lockRow(ctx, ReferralWallet, wallet.id);
        const repository = this.connection.getRepository(ctx, ReferralWallet);
        const fresh = await repository.findOneByOrFail({ id: wallet.id });
        const availableDelta = input.availableDelta ?? 0;
        const pendingDelta = input.pendingDelta ?? 0;
        const reservedDelta = input.reservedDelta ?? 0;
        const nextAvailable = fresh.availableBalance + availableDelta;
        const nextPending = fresh.pendingBalance + pendingDelta;
        const nextReserved = fresh.reservedBalance + reservedDelta;
        if (!input.allowNegativeAvailable && nextAvailable < 0) throw new UserInputError('返利可用余额不足');
        if (nextPending < 0 || nextReserved < 0) throw new UserInputError('返利账户状态异常，请联系管理员');
        fresh.availableBalance = nextAvailable;
        fresh.pendingBalance = nextPending;
        fresh.reservedBalance = nextReserved;
        await repository.save(fresh, { reload: false });
        await ledgerRepository.save(
            new ReferralLedgerEntry({
                channelId: ctx.channelId,
                walletId: fresh.id,
                customerId: fresh.customerId,
                currencyCode: fresh.currencyCode,
                eventType: input.eventType,
                availableDelta,
                pendingDelta,
                reservedDelta,
                availableAfter: nextAvailable,
                pendingAfter: nextPending,
                reservedAfter: nextReserved,
                idempotencyKey: input.idempotencyKey,
                orderId: input.orderId ?? null,
                refundId: input.refundId ?? null,
                withdrawalId: input.withdrawalId ?? null,
                actorId: input.actorId ?? null,
                actorType: input.actorType ?? 'SYSTEM',
                note: input.note ?? null,
                metadata: input.metadata ?? null,
            }),
            { reload: false },
        );
        return fresh;
    }

    private async lockRow<T extends { id: ID }>(
        ctx: RequestContext,
        entity: new (...args: never[]) => T,
        id: ID,
    ): Promise<void> {
        if (!supportsReferralPessimisticLock(this.connection.rawConnection.options.type)) return;
        try {
            await this.connection
                .getRepository(ctx, entity)
                .createQueryBuilder('lockedRow')
                .setLock('pessimistic_write')
                .where('lockedRow.id = :id', { id })
                .getOne();
        } catch (error) {
            if (!isLockNotSupportedError(error)) throw error;
        }
    }

    private withdrawalView(withdrawal: ReferralWithdrawal, customer: Customer) {
        return {
            ...withdrawal,
            customerName: customerName(customer),
            customerEmail: customer.emailAddress,
        };
    }
}

function generateInviteCode(): string {
    const bytes = randomBytes(8);
    return Array.from(bytes, byte => INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length]).join('');
}

function normalizeInviteCode(value?: string | null): string {
    return (value ?? '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 12);
}

function legacyVisitorHash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function businessDateKey(value: Date): string {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        })
            .formatToParts(value)
            .filter(part => ['year', 'month', 'day'].includes(part.type))
            .map(part => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function businessDayRange(value: Date): { businessDate: string; start: Date; end: Date } {
    const businessDate = businessDateKey(value);
    const start = new Date(`${businessDate}T00:00:00+08:00`);
    return { businessDate, start, end: new Date(start.getTime() + 86_400_000) };
}

function utcDatabaseTimestamp(value: Date): string {
    return value.toISOString().replace('T', ' ').replace('Z', '');
}

function customerName(customer: Customer): string {
    return `${customer.lastName ?? ''}${customer.firstName ?? ''}`.trim() || customer.emailAddress;
}

function maskedCustomerName(customer: Customer): string {
    const name = customerName(customer);
    if (name.includes('@')) {
        const [local, domain] = name.split('@');
        return `${local.slice(0, 2)}***@${domain}`;
    }
    return name.length <= 1 ? `${name}*` : `${name.slice(0, 1)}${'*'.repeat(Math.min(3, name.length - 1))}`;
}

function withdrawalCode(): string {
    const time = Date.now().toString(36).toUpperCase();
    return `RW-${time}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function requiredText(value: string, label: string, maxLength: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) {
        throw new UserInputError(`${label}不能为空且不能超过${maxLength}个字符`);
    }
    return normalized;
}

function optionalText(value: string | null | undefined, maxLength: number): string | null {
    const normalized = value?.trim() ?? '';
    return normalized ? normalized.slice(0, maxLength) : null;
}

function clippedText(value: string | null | undefined, maxLength: number): string {
    return (value?.trim() ?? '').slice(0, maxLength);
}

function posterColor(value: string, label: string): string {
    const normalized = value.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(normalized)) {
        throw new UserInputError(`${label}必须使用 #RRGGBB 格式`);
    }
    return normalized;
}

function pageSize(value: number): number {
    return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value || 100)));
}

export function supportsReferralPessimisticLock(driverType: unknown): boolean {
    return new Set([
        'aurora-mysql',
        'aurora-postgres',
        'cockroachdb',
        'mariadb',
        'mssql',
        'mysql',
        'oracle',
        'postgres',
    ]).has(String(driverType));
}

function isLockNotSupportedError(error: unknown): boolean {
    return (
        error instanceof LockNotSupportedOnGivenDriverError ||
        (error instanceof Error &&
            (error.name === 'LockNotSupportedOnGivenDriverError' ||
                error.message.toLowerCase().includes('locking not supported')))
    );
}
