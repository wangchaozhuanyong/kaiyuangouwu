import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Address,
    AuthService,
    Channel,
    Customer,
    CustomerService,
    EventBus,
    ExternalAuthenticationMethod,
    NativeAuthenticationMethod,
    Order,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';
import { createHash } from 'node:crypto';
import { In, LessThanOrEqual } from 'typeorm';

import { DataRetentionService } from './data-retention.service';
import { BeforeAccountAnonymizationEvent } from './data-subject.events';
import { CustomerCoupon } from './entities/customer-coupon.entity';
import { DataSubjectRequest, DataSubjectRequestStatus } from './entities/data-subject-request.entity';
import { FraudRiskAppeal } from './entities/fraud-risk-appeal.entity';
import { FraudRiskCaseEvent } from './entities/fraud-risk-case-event.entity';
import { FraudRiskCase } from './entities/fraud-risk-case.entity';
import { ReferralAccount } from './entities/referral-account.entity';
import { ReferralWallet } from './entities/referral-wallet.entity';
import { ReferralWithdrawal } from './entities/referral-withdrawal.entity';
import { StorefrontOrderAttribution } from './entities/storefront-order-attribution.entity';
import { StorefrontUsdtPaymentIntent } from './entities/storefront-usdt-payment-intent.entity';

export const ACCOUNT_CLOSURE_COOLING_OFF_DAYS = 7;

const ACTIVE_CLOSURE_STATUSES: DataSubjectRequestStatus[] = ['PENDING', 'BLOCKED', 'FAILED'];
const CLOSURE_BATCH_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_ORDER_STATES = ['Delivered', 'Cancelled'];

export interface DataSubjectExportPayload {
    request: DataSubjectRequest;
    fileName: string;
    mimeType: string;
    content: string;
    sha256: string;
}

@Injectable()
export class DataSubjectService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly contexts: RequestContextService,
        private readonly authService: AuthService,
        private readonly customerService: CustomerService,
        private readonly dataRetention: DataRetentionService,
        private readonly eventBus: EventBus,
    ) {}

    async myRequests(ctx: RequestContext): Promise<DataSubjectRequest[]> {
        const customer = await this.activeCustomerOrThrow(ctx);
        return this.connection.getRepository(ctx, DataSubjectRequest).find({
            where: { subjectKeyHash: dataSubjectHash(customer.id) },
            order: { createdAt: 'DESC' },
            take: 50,
        });
    }

    async listRequests(ctx: RequestContext): Promise<DataSubjectRequest[]> {
        return this.connection.getRepository(ctx, DataSubjectRequest).find({
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }

    async exportMine(ctx: RequestContext, password: string): Promise<DataSubjectExportPayload> {
        const customer = await this.activeCustomerOrThrow(ctx);
        await this.verifyPassword(ctx, password);
        const repository = this.connection.getRepository(ctx, DataSubjectRequest);
        const now = new Date();
        const request = await repository.save(
            new DataSubjectRequest({
                channelId: ctx.channelId,
                customerId: customer.id,
                subjectKeyHash: dataSubjectHash(customer.id),
                requestType: 'EXPORT',
                status: 'PROCESSING',
                requestedAt: now,
                dueAt: now,
                nextAttemptAt: null,
                lastAttemptAt: now,
                attemptCount: 1,
                blockersJson: null,
                lastError: null,
                resultDigest: null,
                resultSummaryJson: null,
                completedAt: null,
                cancelledAt: null,
            }),
        );
        try {
            const payload = await this.buildExport(ctx, customer.id);
            const content = JSON.stringify(payload, null, 2);
            const digest = createHash('sha256').update(content).digest('hex');
            request.status = 'FULFILLED';
            request.resultDigest = digest;
            request.resultSummaryJson = JSON.stringify({
                addressCount: payload.addresses.length,
                orderCount: payload.orders.length,
                couponCount: payload.coupons.length,
                reviewCount: payload.reviews.length,
                afterSalesCount: payload.afterSales.length,
                imageJobCount: payload.imageStudio.jobs.length,
                consentRecordCount: payload.consentRecords.length,
                customerFollowUpCount: payload.customerOperations.followUps.length,
                orderAttributionCount: payload.analytics.orderAttributions.length,
                fraudRiskCaseCount: payload.fraudPrevention.cases.length,
            });
            request.completedAt = new Date();
            await repository.save(request, { reload: false });
            return {
                request,
                fileName: `my-data-${request.completedAt.toISOString().slice(0, 10)}.json`,
                mimeType: 'application/json',
                content,
                sha256: digest,
            };
        } catch (error) {
            request.status = 'FAILED';
            request.lastError = errorMessage(error).slice(0, 500);
            request.completedAt = new Date();
            await repository.save(request, { reload: false });
            throw new UserInputError('个人数据导出失败，请稍后重试');
        }
    }

    async requestAccountClosure(ctx: RequestContext, password: string): Promise<DataSubjectRequest> {
        const customer = await this.activeCustomerOrThrow(ctx);
        await this.verifyPassword(ctx, password);
        const repository = this.connection.getRepository(ctx, DataSubjectRequest);
        const subjectKeyHash = dataSubjectHash(customer.id);
        const existing = await repository.findOne({
            where: {
                subjectKeyHash,
                requestType: 'ACCOUNT_CLOSURE',
                status: In(ACTIVE_CLOSURE_STATUSES),
            },
            order: { createdAt: 'DESC' },
        });
        if (existing) return existing;
        const requestedAt = new Date();
        const dueAt = new Date(requestedAt.getTime() + ACCOUNT_CLOSURE_COOLING_OFF_DAYS * DAY_MS);
        return repository.save(
            new DataSubjectRequest({
                channelId: ctx.channelId,
                customerId: customer.id,
                subjectKeyHash,
                requestType: 'ACCOUNT_CLOSURE',
                status: 'PENDING',
                requestedAt,
                dueAt,
                nextAttemptAt: dueAt,
                lastAttemptAt: null,
                attemptCount: 0,
                blockersJson: null,
                lastError: null,
                resultDigest: null,
                resultSummaryJson: null,
                completedAt: null,
                cancelledAt: null,
            }),
        );
    }

    async cancelAccountClosure(ctx: RequestContext): Promise<DataSubjectRequest> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const repository = this.connection.getRepository(ctx, DataSubjectRequest);
        const request = await repository.findOne({
            where: {
                subjectKeyHash: dataSubjectHash(customer.id),
                requestType: 'ACCOUNT_CLOSURE',
                status: In(ACTIVE_CLOSURE_STATUSES),
            },
            order: { createdAt: 'DESC' },
        });
        if (!request) throw new UserInputError('当前没有可取消的账户注销申请');
        request.status = 'CANCELLED';
        request.cancelledAt = new Date();
        request.completedAt = request.cancelledAt;
        request.nextAttemptAt = null;
        request.lastError = null;
        return repository.save(request);
    }

    async retry(ctx: RequestContext, id: ID): Promise<DataSubjectRequest> {
        const repository = this.connection.getRepository(ctx, DataSubjectRequest);
        const request = await repository.findOne({ where: { id } });
        if (!request) throw new UserInputError('数据请求不存在');
        if (request.requestType !== 'ACCOUNT_CLOSURE' || !['BLOCKED', 'FAILED'].includes(request.status)) {
            throw new UserInputError('该数据请求当前不能重试');
        }
        request.status = 'PENDING';
        request.nextAttemptAt = new Date(Math.max(Date.now(), request.dueAt?.getTime() ?? 0));
        request.lastError = null;
        return repository.save(request);
    }

    async processDue(
        ctx: RequestContext,
    ): Promise<{ processed: number; fulfilled: number; blocked: number; failed: number }> {
        const due = await this.connection.getRepository(ctx, DataSubjectRequest).find({
            where: {
                requestType: 'ACCOUNT_CLOSURE',
                status: In(ACTIVE_CLOSURE_STATUSES),
                nextAttemptAt: LessThanOrEqual(new Date()),
            },
            order: { nextAttemptAt: 'ASC' },
            take: CLOSURE_BATCH_SIZE,
        });
        const result = { processed: 0, fulfilled: 0, blocked: 0, failed: 0 };
        for (const request of due) {
            result.processed += 1;
            const status = await this.processClosure(ctx, request.id);
            if (status === 'FULFILLED') result.fulfilled += 1;
            else if (status === 'BLOCKED') result.blocked += 1;
            else if (status === 'FAILED') result.failed += 1;
        }
        return result;
    }

    private async processClosure(
        scheduledCtx: RequestContext,
        requestId: ID,
    ): Promise<DataSubjectRequestStatus> {
        const seed = await this.connection
            .getRepository(scheduledCtx, DataSubjectRequest)
            .findOne({ where: { id: requestId } });
        if (!seed) return 'CANCELLED';
        const channel = await this.connection
            .getRepository(scheduledCtx, Channel)
            .findOne({ where: { id: seed.channelId } });
        if (!channel) return this.failClosure(scheduledCtx, seed, '申请所属店铺不存在');
        const ctx = await this.contexts.create({ apiType: 'admin', channelOrToken: channel });
        try {
            return await this.connection.withTransaction(ctx, async txCtx => {
                const repository = this.connection.getRepository(txCtx, DataSubjectRequest);
                const query = repository.createQueryBuilder('request').where('request.id = :id', {
                    id: requestId,
                });
                if (supportsPessimisticLock(this.connection.rawConnection.options.type)) {
                    query.setLock('pessimistic_write');
                }
                const request = await query.getOne();
                const now = new Date();
                if (
                    !request ||
                    request.requestType !== 'ACCOUNT_CLOSURE' ||
                    !ACTIVE_CLOSURE_STATUSES.includes(request.status) ||
                    !request.nextAttemptAt ||
                    request.nextAttemptAt > now
                ) {
                    return request?.status ?? 'CANCELLED';
                }
                request.attemptCount += 1;
                request.lastAttemptAt = now;
                const customer = await this.connection.getRepository(txCtx, Customer).findOne({
                    where: { id: request.customerId },
                    relations: ['channels', 'user'],
                    withDeleted: true,
                });
                if (!customer || customer.deletedAt) {
                    request.status = 'FULFILLED';
                    request.nextAttemptAt = null;
                    request.completedAt = now;
                    request.resultSummaryJson = JSON.stringify({ alreadyClosed: true });
                    await repository.save(request, { reload: false });
                    return request.status;
                }
                const blockers = await this.closureBlockers(txCtx, customer.id);
                if (blockers.length) {
                    request.status = 'BLOCKED';
                    request.blockersJson = JSON.stringify(blockers);
                    request.lastError = blockers.join('；').slice(0, 500);
                    request.nextAttemptAt = new Date(now.getTime() + DAY_MS);
                    await repository.save(request, { reload: false });
                    return request.status;
                }
                request.status = 'PROCESSING';
                request.blockersJson = null;
                request.lastError = null;
                await repository.save(request, { reload: false });

                for (const customerChannel of customer.channels) {
                    const channelCtx = await this.contexts.create({
                        apiType: 'admin',
                        channelOrToken: customerChannel,
                    });
                    await this.eventBus.publish(
                        new BeforeAccountAnonymizationEvent(
                            channelCtx,
                            customer.id,
                            `Account closure request ${String(request.id)}`,
                        ),
                    );
                }
                await this.dataRetention.quarantineAllCustomerAvatars(txCtx, customer.id);
                await this.removeOptionalCustomerRows(txCtx, 'CustomerDeliveryEmail', customer.id);
                await this.anonymizeOptionalCustomerRows(txCtx, 'StorefrontReview', customer.id, {
                    customerName: 'Deleted user',
                });
                await this.anonymizeOptionalCustomerRows(txCtx, 'CustomerOperationsProfile', customer.id, {
                    doNotContact: true,
                    nextFollowUpAt: null,
                });
                await this.anonymizeOptionalCustomerRows(txCtx, 'CustomerFollowUp', customer.id, {
                    status: 'DISMISSED',
                    title: 'Account closed',
                    note: '[removed by account closure]',
                    outcomeCode: 'DO_NOT_CONTACT',
                    outcomeNote: '[removed by account closure]',
                    completedAt: now,
                });
                await this.anonymizeOptionalCustomerRows(txCtx, 'CustomerFollowUpEvent', customer.id, {
                    note: '[removed by account closure]',
                    payloadJson: null,
                });
                await this.anonymizeFraudRiskRows(txCtx, customer.id);
                await this.clearOptionalCustomerReference(txCtx, 'StorefrontDailyVisitor', customer.id);
                await this.connection.getRepository(txCtx, Address).delete({ customer: { id: customer.id } });
                await this.customerService.softDelete(txCtx, customer.id);
                await this.anonymizeCustomer(txCtx, customer);

                request.status = 'FULFILLED';
                request.nextAttemptAt = null;
                request.completedAt = now;
                request.resultSummaryJson = JSON.stringify({
                    accountDisabled: true,
                    sessionsRevoked: true,
                    addressesRemoved: true,
                    profileAnonymized: true,
                    fraudAppealContentRemoved: true,
                    transactionalRecordsRetained: true,
                });
                await repository.save(request, { reload: false });
                return request.status;
            });
        } catch (error) {
            return this.failClosure(ctx, seed, errorMessage(error));
        }
    }

    private async failClosure(
        ctx: RequestContext,
        request: DataSubjectRequest,
        message: string,
    ): Promise<DataSubjectRequestStatus> {
        request.status = 'FAILED';
        request.attemptCount += 1;
        request.lastAttemptAt = new Date();
        request.lastError = message.slice(0, 500);
        request.nextAttemptAt = new Date(Date.now() + DAY_MS);
        await this.connection.getRepository(ctx, DataSubjectRequest).save(request, { reload: false });
        return request.status;
    }

    private async closureBlockers(ctx: RequestContext, customerId: ID): Promise<string[]> {
        const blockers: string[] = [];
        const openOrders = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .where('order.customerId = :customerId', { customerId })
            .andWhere('(order.active = :active OR order.state NOT IN (:...terminalStates))', {
                active: true,
                terminalStates: TERMINAL_ORDER_STATES,
            })
            .getCount();
        if (openOrders) blockers.push(`仍有 ${openOrders} 个未完成订单`);

        const withdrawals = await this.connection.getRepository(ctx, ReferralWithdrawal).count({
            where: { customerId, status: In(['PENDING', 'APPROVED']) },
        });
        if (withdrawals) blockers.push(`仍有 ${withdrawals} 个待处理提现`);

        const paymentIntents = await this.connection
            .getRepository(ctx, StorefrontUsdtPaymentIntent)
            .createQueryBuilder('intent')
            .innerJoin('intent.order', 'order')
            .where('order.customerId = :customerId', { customerId })
            .andWhere('intent.status IN (:...statuses)', { statuses: ['PENDING', 'MANUAL_REVIEW'] })
            .getCount();
        if (paymentIntents) blockers.push(`仍有 ${paymentIntents} 个待核对支付`);

        const fraudReviews = await this.connection.getRepository(ctx, FraudRiskCase).count({
            where: { customerId, status: In(['OPEN', 'IN_REVIEW', 'APPEALED']) },
        });
        if (fraudReviews) blockers.push(`仍有 ${fraudReviews} 个待处理风险复核`);

        const afterSales = await this.countOptionalCustomerRows(ctx, 'AfterSalesRequest', customerId, {
            state: ['PENDING', 'APPROVED'],
        });
        if (afterSales) blockers.push(`仍有 ${afterSales} 个待处理售后`);
        const imageJobs = await this.countOptionalCustomerRows(ctx, 'ImageGenerationJob', customerId, {
            state: ['QUEUED', 'RUNNING', 'UNKNOWN'],
        });
        if (imageJobs) blockers.push(`仍有 ${imageJobs} 个待完成或待确认的生图任务`);
        return blockers;
    }

    private async anonymizeCustomer(ctx: RequestContext, customer: Customer): Promise<void> {
        const pseudonym = `closed-${dataSubjectHash(customer.id).slice(0, 20)}`;
        const syntheticEmail = `${pseudonym}@invalid.local`;
        await this.connection.getRepository(ctx, Customer).update(
            { id: customer.id },
            {
                title: '',
                firstName: 'Deleted',
                lastName: 'User',
                phoneNumber: '',
                emailAddress: syntheticEmail,
            },
        );
        if (!customer.user) return;
        await this.connection
            .getRepository(ctx, User)
            .update(
                { id: customer.user.id },
                { identifier: syntheticEmail, customerIdentifier: null, verified: false },
            );
        const nativeMethods = await this.connection
            .getRepository(ctx, NativeAuthenticationMethod)
            .createQueryBuilder('method')
            .innerJoin('method.user', 'user')
            .where('user.id = :userId', { userId: customer.user.id })
            .getMany();
        for (const method of nativeMethods) {
            method.identifier = syntheticEmail;
            method.verificationToken = null;
            method.passwordResetToken = null;
            method.identifierChangeToken = null;
            method.pendingIdentifier = null;
            await this.connection.getRepository(ctx, NativeAuthenticationMethod).save(method, {
                reload: false,
            });
        }
        const externalMethods = await this.connection
            .getRepository(ctx, ExternalAuthenticationMethod)
            .createQueryBuilder('method')
            .innerJoin('method.user', 'user')
            .where('user.id = :userId', { userId: customer.user.id })
            .getMany();
        for (const method of externalMethods) {
            method.externalIdentifier = pseudonym;
            method.metadata = {};
            await this.connection.getRepository(ctx, ExternalAuthenticationMethod).save(method, {
                reload: false,
            });
        }
    }

    private async buildExport(ctx: RequestContext, customerId: ID) {
        const customer = await this.connection.getRepository(ctx, Customer).findOne({
            where: { id: customerId },
            relations: ['addresses', 'addresses.country', 'channels'],
        });
        if (!customer) throw new UserInputError('当前账号没有客户资料');
        const [orders, coupons, referralAccounts, referralWallets, withdrawals, requests, fraudRiskCases] =
            await Promise.all([
                this.connection.getRepository(ctx, Order).find({
                    where: { customerId },
                    relations: ['lines', 'payments', 'payments.refunds', 'fulfillments', 'channels'],
                    order: { createdAt: 'DESC' },
                }),
                this.connection.getRepository(ctx, CustomerCoupon).find({
                    where: { customerId },
                    order: { createdAt: 'DESC' },
                }),
                this.connection.getRepository(ctx, ReferralAccount).find({ where: { customerId } }),
                this.connection.getRepository(ctx, ReferralWallet).find({ where: { customerId } }),
                this.connection.getRepository(ctx, ReferralWithdrawal).find({
                    where: { customerId },
                    order: { createdAt: 'DESC' },
                }),
                this.connection.getRepository(ctx, DataSubjectRequest).find({
                    where: { subjectKeyHash: dataSubjectHash(customerId) },
                    order: { createdAt: 'DESC' },
                }),
                this.connection.getRepository(ctx, FraudRiskCase).find({
                    where: { customerId },
                    relations: { events: true, appeals: true },
                    order: { createdAt: 'DESC' },
                }),
            ]);
        const [
            reviews,
            afterSales,
            deliveryEmails,
            imageJobs,
            promptOptimizations,
            privateAssets,
            usageQuotas,
            referralLedger,
            referralBalanceUses,
            referralWalletUsage,
            couponLedger,
            couponAllocations,
            dailyVisits,
            consentRecords,
            customerOperationsProfiles,
            customerFollowUps,
            customerFollowUpEvents,
            orderAttributions,
        ] = await Promise.all([
            this.optionalCustomerRows(ctx, 'StorefrontReview', customerId, [
                'id',
                'createdAt',
                'updatedAt',
                'state',
                'rating',
                'title',
                'body',
                'customerName',
                'productName',
                'sku',
                'merchantResponse',
                'moderatedAt',
                'orderId',
                'orderLineId',
                'productId',
                'productVariantId',
                'channelId',
            ]),
            this.optionalCustomerRows(ctx, 'AfterSalesRequest', customerId, [
                'id',
                'createdAt',
                'updatedAt',
                'code',
                'type',
                'state',
                'reason',
                'description',
                'currencyCode',
                'requestedAmount',
                'approvedAmount',
                'resolution',
                'respondedAt',
                'completedAt',
                'cancelledAt',
                'refundedAt',
                'orderId',
                'refundId',
                'channelId',
            ]),
            this.optionalCustomerRows(ctx, 'CustomerDeliveryEmail', customerId, [
                'id',
                'createdAt',
                'updatedAt',
                'emailAddress',
                'label',
                'isDefault',
                'confirmedAt',
                'channelId',
            ]),
            this.optionalCustomerRows(ctx, 'ImageGenerationJob', customerId, [
                'id',
                'createdAt',
                'updatedAt',
                'channelId',
                'origin',
                'modelCodeSnapshot',
                'modelNameSnapshot',
                'originalPrompt',
                'finalPrompt',
                'promptSpec',
                'referenceMode',
                'aspectRatio',
                'resolution',
                'quantity',
                'unitPriceSnapshot',
                'reservedAmount',
                'expectedChargeAmount',
                'capturedAmount',
                'releasedAmount',
                'currencyCode',
                'state',
                'termsVersion',
                'termsAcceptedAt',
                'errorMessage',
                'completedAt',
            ]),
            this.optionalCustomerRows(ctx, 'ImagePromptOptimization', customerId, [
                'id',
                'createdAt',
                'updatedAt',
                'channelId',
                'inputPrompt',
                'optimizedPrompt',
                'promptSpec',
                'source',
                'recommendedModelCode',
                'recommendationReason',
                'billingMode',
                'chargedAmount',
                'currencyCode',
                'inputTokens',
                'outputTokens',
                'totalTokens',
                'latencyMs',
                'errorMessage',
            ]),
            this.optionalCustomerRows(ctx, 'ImagePrivateAsset', customerId, [
                'id',
                'createdAt',
                'updatedAt',
                'channelId',
                'kind',
                'originalName',
                'mimeType',
                'byteSize',
                'width',
                'height',
                'sha256',
                'expiresAt',
                'deletedAt',
            ]),
            this.optionalCustomerRows(ctx, 'ImageUsageQuotaBucket', customerId, [
                'id',
                'createdAt',
                'updatedAt',
                'channelId',
                'quotaType',
                'modelCode',
                'windowKey',
                'windowStartsAt',
                'windowEndsAt',
                'limitSnapshot',
                'unlimited',
                'reserved',
                'consumed',
                'released',
            ]),
            this.optionalCustomerRows(ctx, 'ReferralLedgerEntry', customerId, [
                'id',
                'createdAt',
                'channelId',
                'currencyCode',
                'eventType',
                'availableDelta',
                'pendingDelta',
                'reservedDelta',
                'availableAfter',
                'pendingAfter',
                'reservedAfter',
                'orderId',
                'refundId',
                'withdrawalId',
                'actorType',
                'note',
            ]),
            this.optionalCustomerRows(ctx, 'ReferralBalanceUse', customerId, [
                'id',
                'createdAt',
                'channelId',
                'orderId',
                'currencyCode',
                'amount',
                'refundedAmount',
                'status',
                'reservedAt',
                'capturedAt',
                'releasedAt',
            ]),
            this.optionalCustomerRows(ctx, 'ReferralWalletUsage', customerId, [
                'id',
                'createdAt',
                'channelId',
                'resourceType',
                'resourceId',
                'amount',
                'capturedAmount',
                'releasedAmount',
                'currencyCode',
                'status',
                'reservedAt',
                'settledAt',
            ]),
            this.optionalCustomerRows(ctx, 'CouponLedgerEntry', customerId, [
                'id',
                'createdAt',
                'channelId',
                'customerCouponId',
                'promotionId',
                'orderId',
                'refundId',
                'eventType',
                'actorType',
                'discountAmount',
                'note',
            ]),
            this.optionalCustomerRows(ctx, 'CouponOrderAllocation', customerId, [
                'id',
                'createdAt',
                'channelId',
                'customerCouponId',
                'promotionId',
                'orderId',
                'refundId',
                'status',
                'campaignName',
                'currencyCode',
                'discountAmount',
                'discountAmountWithTax',
                'refundedAmount',
                'orderTotalWithTax',
                'lineAllocations',
                'appliedAt',
                'usedAt',
                'releasedAt',
                'refundedAt',
            ]),
            this.optionalCustomerRows(ctx, 'StorefrontDailyVisitor', customerId, [
                'id',
                'createdAt',
                'updatedAt',
                'channelId',
                'businessDate',
                'firstSeenAt',
                'lastSeenAt',
                'visitCount',
            ]),
            this.optionalCustomerRows(ctx, 'DataConsentRecord', customerId, [
                'id',
                'createdAt',
                'channelId',
                'purpose',
                'action',
                'policyVersion',
                'policyDigest',
                'locale',
                'source',
                'recordedAt',
            ]),
            this.optionalCustomerRows(ctx, 'CustomerOperationsProfile', customerId, [
                'id',
                'createdAt',
                'updatedAt',
                'channelId',
                'segment',
                'churnRisk',
                'recencyScore',
                'frequencyScore',
                'monetaryScore',
                'recencyDays',
                'orderCount',
                'currencyCode',
                'grossRevenue',
                'refundTotal',
                'netLifetimeValue',
                'averageOrderValue',
                'currencyMetricsJson',
                'serviceInteractionCount',
                'afterSalesCount',
                'openAfterSalesCount',
                'lastOrderAt',
                'lastServiceAt',
                'nextFollowUpAt',
                'doNotContact',
                'reasonsJson',
                'evaluationVersion',
                'lastEvaluatedAt',
            ]),
            this.optionalCustomerRows(ctx, 'CustomerFollowUp', customerId, [
                'id',
                'createdAt',
                'updatedAt',
                'channelId',
                'profileId',
                'status',
                'source',
                'priority',
                'reasonCode',
                'title',
                'note',
                'dueAt',
                'outcomeCode',
                'outcomeNote',
                'completedAt',
            ]),
            this.optionalCustomerRows(ctx, 'CustomerFollowUpEvent', customerId, [
                'id',
                'createdAt',
                'channelId',
                'followUpId',
                'eventType',
                'actorType',
                'actorLabel',
                'note',
                'payloadJson',
            ]),
            orders.length
                ? this.connection.getRepository(ctx, StorefrontOrderAttribution).find({
                      where: { orderId: In(orders.map(order => order.id)) },
                      order: { createdAt: 'DESC' },
                  })
                : [],
        ]);
        return {
            format: 'website-personal-data-export',
            version: 1,
            generatedAt: new Date().toISOString(),
            scope: 'all stores linked to this customer account',
            profile: {
                id: String(customer.id),
                createdAt: iso(customer.createdAt),
                updatedAt: iso(customer.updatedAt),
                title: customer.title,
                firstName: customer.firstName,
                lastName: customer.lastName,
                emailAddress: customer.emailAddress,
                phoneNumber: customer.phoneNumber,
                channelIds: customer.channels.map(channel => String(channel.id)),
            },
            addresses: customer.addresses.map(address => ({
                id: String(address.id),
                createdAt: iso(address.createdAt),
                updatedAt: iso(address.updatedAt),
                fullName: address.fullName,
                company: address.company,
                streetLine1: address.streetLine1,
                streetLine2: address.streetLine2,
                city: address.city,
                province: address.province,
                postalCode: address.postalCode,
                countryCode: address.country?.code ?? null,
                phoneNumber: address.phoneNumber,
                defaultShippingAddress: address.defaultShippingAddress,
                defaultBillingAddress: address.defaultBillingAddress,
            })),
            deliveryEmails,
            orders: orders.map(order => ({
                id: String(order.id),
                code: order.code,
                createdAt: iso(order.createdAt),
                updatedAt: iso(order.updatedAt),
                orderPlacedAt: iso(order.orderPlacedAt),
                state: order.state,
                active: order.active,
                currencyCode: order.currencyCode,
                subTotal: order.subTotal,
                subTotalWithTax: order.subTotalWithTax,
                shipping: order.shipping,
                shippingWithTax: order.shippingWithTax,
                total: order.total,
                totalWithTax: order.totalWithTax,
                couponCodes: order.couponCodes,
                shippingAddress: order.shippingAddress,
                billingAddress: order.billingAddress,
                channelIds: order.channels.map(channel => String(channel.id)),
                lines: order.lines.map(line => ({
                    id: String(line.id),
                    productVariantId: String(line.productVariantId),
                    quantity: line.quantity,
                    orderPlacedQuantity: line.orderPlacedQuantity,
                    listPrice: line.listPrice,
                    listPriceIncludesTax: line.listPriceIncludesTax,
                    linePrice: line.linePrice,
                    linePriceWithTax: line.linePriceWithTax,
                })),
                payments: order.payments.map(payment => ({
                    id: String(payment.id),
                    createdAt: iso(payment.createdAt),
                    method: payment.method,
                    amount: payment.amount,
                    state: payment.state,
                    transactionId: payment.transactionId,
                    refunds: payment.refunds.map(refund => ({
                        id: String(refund.id),
                        createdAt: iso(refund.createdAt),
                        total: refund.total,
                        state: refund.state,
                        method: refund.method,
                        reason: refund.reason,
                        transactionId: refund.transactionId,
                    })),
                })),
                fulfillments: order.fulfillments.map(fulfillment => ({
                    id: String(fulfillment.id),
                    createdAt: iso(fulfillment.createdAt),
                    state: fulfillment.state,
                    method: fulfillment.method,
                    trackingCode: fulfillment.trackingCode,
                })),
            })),
            coupons: coupons.map(coupon => ({
                id: String(coupon.id),
                channelId: String(coupon.channelId),
                promotionId: String(coupon.promotionId),
                status: coupon.status,
                claimedAt: iso(coupon.claimedAt),
                validFrom: iso(coupon.validFrom),
                validUntil: iso(coupon.validUntil),
                lockedAt: iso(coupon.lockedAt),
                usedAt: iso(coupon.usedAt),
                returnedAt: iso(coupon.returnedAt),
            })),
            referrals: {
                accounts: referralAccounts.map(account => ({
                    id: String(account.id),
                    channelId: String(account.channelId),
                    inviteCode: account.inviteCode,
                    createdAt: iso(account.createdAt),
                })),
                wallets: referralWallets.map(wallet => ({
                    id: String(wallet.id),
                    channelId: String(wallet.channelId),
                    currencyCode: wallet.currencyCode,
                    availableBalance: wallet.availableBalance,
                    pendingBalance: wallet.pendingBalance,
                    reservedBalance: wallet.reservedBalance,
                    updatedAt: iso(wallet.updatedAt),
                })),
                withdrawals: withdrawals.map(withdrawal => ({
                    id: String(withdrawal.id),
                    code: withdrawal.code,
                    channelId: String(withdrawal.channelId),
                    currencyCode: withdrawal.currencyCode,
                    amount: withdrawal.amount,
                    status: withdrawal.status,
                    payoutMethod: withdrawal.payoutMethod,
                    payoutAccountMasked: withdrawal.payoutAccountMasked,
                    createdAt: iso(withdrawal.createdAt),
                    approvedAt: iso(withdrawal.approvedAt),
                    paidAt: iso(withdrawal.paidAt),
                    rejectedAt: iso(withdrawal.rejectedAt),
                    cancelledAt: iso(withdrawal.cancelledAt),
                })),
                ledger: referralLedger,
                balanceUses: referralBalanceUses,
                walletUsage: referralWalletUsage,
            },
            couponHistory: {
                ledger: couponLedger,
                allocations: couponAllocations,
            },
            imageStudio: {
                jobs: imageJobs,
                promptOptimizations,
                privateAssets,
                usageQuotas,
            },
            analytics: {
                dailyVisits,
                orderAttributions: orderAttributions.map(attribution => ({
                    orderId: String(attribution.orderId),
                    attributionModel: attribution.attributionModel,
                    source: attribution.source,
                    medium: attribution.medium,
                    campaign: attribution.campaign,
                    term: attribution.term,
                    content: attribution.content,
                    landingPath: attribution.landingPath,
                    referrerHost: attribution.referrerHost,
                    touchAt: iso(attribution.touchAt),
                })),
            },
            customerOperations: {
                profiles: customerOperationsProfiles,
                followUps: customerFollowUps,
                events: customerFollowUpEvents,
            },
            fraudPrevention: {
                cases: fraudRiskCases.map(riskCase => ({
                    id: String(riskCase.id),
                    createdAt: iso(riskCase.createdAt),
                    channelId: String(riskCase.channelId),
                    caseCode: riskCase.caseCode,
                    subjectType: riskCase.subjectType,
                    subjectId: riskCase.subjectId,
                    orderId: riskCase.orderId == null ? null : String(riskCase.orderId),
                    status: riskCase.status,
                    severity: riskCase.severity,
                    riskScore: riskCase.riskScore,
                    ruleVersion: riskCase.ruleVersion,
                    signalsJson: riskCase.signalsJson,
                    recommendedAction: riskCase.recommendedAction,
                    dueAt: iso(riskCase.dueAt),
                    decisionCode: riskCase.decisionCode,
                    decisionReason: riskCase.decisionReason,
                    decidedAt: iso(riskCase.decidedAt),
                    events: (riskCase.events ?? []).map(event => ({
                        id: String(event.id),
                        createdAt: iso(event.createdAt),
                        eventType: event.eventType,
                        actorType: event.actorType,
                        note: event.note,
                    })),
                    appeals: (riskCase.appeals ?? []).map(appeal => ({
                        id: String(appeal.id),
                        createdAt: iso(appeal.createdAt),
                        status: appeal.status,
                        reason: appeal.reason,
                        response: appeal.response,
                        reviewedAt: iso(appeal.reviewedAt),
                    })),
                })),
            },
            consentRecords,
            reviews,
            afterSales,
            dataRequests: requests.map(request => ({
                id: String(request.id),
                requestType: request.requestType,
                status: request.status,
                requestedAt: iso(request.requestedAt),
                dueAt: iso(request.dueAt),
                completedAt: iso(request.completedAt),
                cancelledAt: iso(request.cancelledAt),
            })),
            retentionNotice:
                'Order, payment, refund, fulfilment, fraud-prevention and dispute records may be retained where required for legal or operational obligations.',
        };
    }

    private async optionalCustomerRows(
        ctx: RequestContext,
        entityName: string,
        customerId: ID,
        fields: string[],
    ): Promise<Array<Record<string, unknown>>> {
        const metadata = this.connection.rawConnection.entityMetadatas.find(item => item.name === entityName);
        if (!metadata?.findColumnWithPropertyName('customerId')) return [];
        const target = metadata.target;
        const rows = await this.connection
            .getRepository(ctx, target as never)
            .createQueryBuilder('row')
            .where('row.customerId = :customerId', { customerId })
            .getMany();
        return rows.map(row => {
            const source = row as Record<string, unknown>;
            return Object.fromEntries(
                fields.filter(field => field in source).map(field => [field, exportValue(source[field])]),
            );
        });
    }

    private async countOptionalCustomerRows(
        ctx: RequestContext,
        entityName: string,
        customerId: ID,
        filters: Record<string, string[]>,
    ): Promise<number> {
        const metadata = this.connection.rawConnection.entityMetadatas.find(item => item.name === entityName);
        if (!metadata?.findColumnWithPropertyName('customerId')) return 0;
        const query = this.connection
            .getRepository(ctx, metadata.target)
            .createQueryBuilder('row')
            .where('row.customerId = :customerId', { customerId });
        for (const [field, values] of Object.entries(filters)) {
            if (!metadata.findColumnWithPropertyName(field)) continue;
            query.andWhere(`row.${field} IN (:...${field})`, { [field]: values });
        }
        return query.getCount();
    }

    private async removeOptionalCustomerRows(
        ctx: RequestContext,
        entityName: string,
        customerId: ID,
    ): Promise<void> {
        const metadata = this.connection.rawConnection.entityMetadatas.find(item => item.name === entityName);
        if (!metadata?.findColumnWithPropertyName('customerId')) return;
        await this.connection
            .getRepository(ctx, metadata.target)
            .createQueryBuilder()
            .delete()
            .where('customerId = :customerId', { customerId })
            .execute();
    }

    private async anonymizeOptionalCustomerRows(
        ctx: RequestContext,
        entityName: string,
        customerId: ID,
        values: Record<string, unknown>,
    ): Promise<void> {
        const metadata = this.connection.rawConnection.entityMetadatas.find(item => item.name === entityName);
        if (!metadata?.findColumnWithPropertyName('customerId')) return;
        const allowedValues = Object.fromEntries(
            Object.entries(values).filter(([field]) => metadata.findColumnWithPropertyName(field)),
        );
        if (!Object.keys(allowedValues).length) return;
        await this.connection
            .getRepository(ctx, metadata.target)
            .createQueryBuilder()
            .update(metadata.target)
            .set(allowedValues)
            .where('customerId = :customerId', { customerId })
            .execute();
    }

    private async clearOptionalCustomerReference(
        ctx: RequestContext,
        entityName: string,
        customerId: ID,
    ): Promise<void> {
        const metadata = this.connection.rawConnection.entityMetadatas.find(item => item.name === entityName);
        const customerColumn = metadata?.findColumnWithPropertyName('customerId');
        if (!metadata || !customerColumn?.isNullable) return;
        await this.connection
            .getRepository(ctx, metadata.target)
            .createQueryBuilder()
            .update(metadata.target)
            .set({ customerId: null })
            .where('customerId = :customerId', { customerId })
            .execute();
    }

    private async anonymizeFraudRiskRows(ctx: RequestContext, customerId: ID): Promise<void> {
        const cases = await this.connection.getRepository(ctx, FraudRiskCase).find({
            where: { customerId },
            select: { id: true },
        });
        const caseIds = cases.map(riskCase => riskCase.id);
        if (caseIds.length) {
            await this.connection
                .getRepository(ctx, FraudRiskCaseEvent)
                .createQueryBuilder()
                .update(FraudRiskCaseEvent)
                .set({ note: '[removed by account closure]', payloadJson: null })
                .where('riskCaseId IN (:...caseIds)', { caseIds })
                .execute();
        }
        await this.connection
            .getRepository(ctx, FraudRiskAppeal)
            .createQueryBuilder()
            .update(FraudRiskAppeal)
            .set({
                customerId: null,
                reason: '[removed by account closure]',
                response: null,
            })
            .where('customerId = :customerId', { customerId })
            .execute();
        await this.connection
            .getRepository(ctx, FraudRiskCase)
            .createQueryBuilder()
            .update(FraudRiskCase)
            .set({ customerId: null, decisionReason: '[removed by account closure]' })
            .where('customerId = :customerId', { customerId })
            .execute();
    }

    private async verifyPassword(ctx: RequestContext, password: string): Promise<void> {
        if (!ctx.activeUserId || !password) throw new UserInputError('请输入当前账户密码');
        const result = await this.authService.verifyUserPassword(ctx, ctx.activeUserId, password);
        if (result !== true) throw new UserInputError('当前账户密码不正确');
    }

    private async activeCustomerOrThrow(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('当前账号没有客户资料');
        return customer;
    }
}

export function dataSubjectHash(customerId: ID): string {
    return createHash('sha256')
        .update(`data-subject:${String(customerId)}`)
        .digest('hex');
}

function iso(value: Date | string | null | undefined): string | null {
    if (value == null) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function exportValue(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') return value.toString();
    return value;
}

function supportsPessimisticLock(driver: unknown): boolean {
    return !['sqljs', 'sqlite', 'better-sqlite3'].includes(String(driver));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
