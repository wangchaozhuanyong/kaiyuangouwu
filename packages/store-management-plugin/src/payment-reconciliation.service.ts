import { Injectable } from '@nestjs/common';
import { EventBus, idsAreEqual, Payment, RequestContext, TransactionalConnection } from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { In } from 'typeorm';

import { StoreUsdtManualRefund } from './entities/store-usdt-manual-refund.entity';
import { StoreUsdtReconciliationAction } from './entities/store-usdt-reconciliation-action.entity';
import { StorefrontUsdtPaymentIntent } from './entities/storefront-usdt-payment-intent.entity';
import { USDT_PAYMENT_INTENT_STATUS, USDT_TRC20_PAYMENT_METHOD_CODE } from './usdt/usdt-payment.constants';

const AUDIT_LIMIT = 5_000;
const MANUAL_REVIEW_OVERDUE_MS = 24 * 60 * 60 * 1000;

export interface PaymentReconciliationResult {
    runAt: string;
    scannedIntentCount: number;
    scannedPaymentCount: number;
    scannedRefundCount: number;
    scannedResolutionActionCount: number;
    unsettledIntentIds: string[];
    unlinkedPaymentIds: string[];
    invalidRefundIds: string[];
    invalidResolutionIntentIds: string[];
    manualReviewCount: number;
    overdueManualReviewIds: string[];
    truncated: boolean;
    healthy: boolean;
}

@Injectable()
export class PaymentReconciliationService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly eventBus: EventBus,
    ) {}

    async reconcile(ctx: RequestContext, runAt = new Date()): Promise<PaymentReconciliationResult> {
        const intentRepository = this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent);
        const paymentRepository = this.connection.getRepository(ctx, Payment);
        const refundRepository = this.connection.getRepository(ctx, StoreUsdtManualRefund);
        const [settledIntents, resolvedIntents, usdtPayments, manualRefunds, manualReviews] =
            await Promise.all([
                intentRepository.find({
                    where: { status: USDT_PAYMENT_INTENT_STATUS.settled },
                    relations: { payment: { order: true } },
                    order: { createdAt: 'DESC' },
                    take: AUDIT_LIMIT,
                }),
                intentRepository.find({
                    where: { status: USDT_PAYMENT_INTENT_STATUS.resolved },
                    order: { createdAt: 'DESC' },
                    take: AUDIT_LIMIT,
                }),
                paymentRepository.find({
                    where: { method: USDT_TRC20_PAYMENT_METHOD_CODE, state: 'Settled' },
                    relations: { order: true },
                    order: { createdAt: 'DESC' },
                    take: AUDIT_LIMIT,
                }),
                refundRepository.find({
                    relations: { refund: true, payment: { order: true }, order: true },
                    order: { createdAt: 'DESC' },
                    take: AUDIT_LIMIT,
                }),
                intentRepository.find({
                    where: { status: USDT_PAYMENT_INTENT_STATUS.manualReview },
                    order: { createdAt: 'ASC' },
                    take: AUDIT_LIMIT,
                }),
            ]);
        const intentsWithResolution = [
            ...settledIntents.filter(intent => intent.resolutionActionId != null),
            ...resolvedIntents,
        ];
        const resolutionActionIds = intentsWithResolution
            .map(intent => intent.resolutionActionId)
            .filter((id): id is NonNullable<typeof id> => id != null);
        const resolutionActions = resolutionActionIds.length
            ? await this.connection.getRepository(ctx, StoreUsdtReconciliationAction).find({
                  where: { id: In(resolutionActionIds) },
              })
            : [];
        const resolutionActionById = new Map(resolutionActions.map(action => [String(action.id), action]));
        const paymentIds = usdtPayments.map(payment => payment.id);
        const linkedIntents = paymentIds.length
            ? await intentRepository.find({ where: { paymentId: In(paymentIds) } })
            : [];
        const linkedByPayment = new Map<string, StorefrontUsdtPaymentIntent[]>();
        for (const intent of linkedIntents) {
            if (intent.paymentId == null) continue;
            const key = String(intent.paymentId);
            linkedByPayment.set(key, [...(linkedByPayment.get(key) ?? []), intent]);
        }
        const unsettledIntentIds = settledIntents
            .filter(intent => {
                const payment = intent.payment;
                return (
                    !payment ||
                    !idsAreEqual(payment.id, intent.paymentId) ||
                    payment.state !== 'Settled' ||
                    !idsAreEqual(payment.order?.id, intent.orderId) ||
                    payment.transactionId?.toLowerCase() !== `tron:${intent.transactionId}`.toLowerCase()
                );
            })
            .map(intent => String(intent.id));
        const unlinkedPaymentIds = usdtPayments
            .filter(payment => {
                const linked = linkedByPayment.get(String(payment.id)) ?? [];
                const intent = linked[0];
                return (
                    linked.length !== 1 ||
                    !intent ||
                    intent.status !== USDT_PAYMENT_INTENT_STATUS.settled ||
                    !idsAreEqual(intent.orderId, payment.order?.id) ||
                    `tron:${intent.transactionId}`.toLowerCase() !== payment.transactionId?.toLowerCase()
                );
            })
            .map(payment => String(payment.id));
        const invalidRefundIds = manualRefunds
            .filter(record => {
                const refund = record.refund;
                return (
                    !refund ||
                    refund.state !== 'Settled' ||
                    record.payment?.state !== 'Settled' ||
                    !idsAreEqual(record.paymentId, record.payment?.id) ||
                    !idsAreEqual(record.orderId, record.order?.id) ||
                    !idsAreEqual(record.orderId, record.payment?.order?.id) ||
                    !idsAreEqual(refund.paymentId, record.paymentId) ||
                    refund.transactionId?.toLowerCase() !== `tron:${record.transactionId}`.toLowerCase()
                );
            })
            .map(record => String(record.id));
        const invalidResolutionIntentIds = intentsWithResolution
            .filter(intent => {
                const action = resolutionActionById.get(String(intent.resolutionActionId));
                if (
                    !action ||
                    !idsAreEqual(action.intentId, intent.id) ||
                    !idsAreEqual(action.channelId, intent.channelId) ||
                    !idsAreEqual(action.orderId, intent.orderId) ||
                    !idsAreEqual(action.operatorUserId, intent.resolvedByUserId) ||
                    !intent.resolvedAt
                ) {
                    return true;
                }
                if (intent.status === USDT_PAYMENT_INTENT_STATUS.settled) {
                    return action.action !== 'RETRY_SETTLEMENT' || action.outcome !== 'SETTLED';
                }
                return (
                    intent.activeMatchKey != null ||
                    action.action !== 'CONFIRM_EXTERNAL_REFUND' ||
                    action.outcome !== 'RESOLVED' ||
                    action.network !== 'TRC20' ||
                    !action.transactionId ||
                    action.transactionId === intent.transactionId ||
                    action.usdtAmountBaseUnits !==
                        usdtBaseUnits(intent.receivedUsdtAmount ?? intent.expectedUsdtAmount) ||
                    !action.fromAddress ||
                    !action.toAddress ||
                    action.blockNumber == null ||
                    !action.blockTimestamp
                );
            })
            .map(intent => String(intent.id));
        const overdueCutoff = runAt.getTime() - MANUAL_REVIEW_OVERDUE_MS;
        const overdueManualReviewIds = manualReviews
            .filter(intent => intent.createdAt.getTime() <= overdueCutoff)
            .map(intent => String(intent.id));
        const truncated = [settledIntents, resolvedIntents, usdtPayments, manualRefunds, manualReviews].some(
            rows => rows.length === AUDIT_LIMIT,
        );
        const healthy =
            !truncated &&
            !unsettledIntentIds.length &&
            !unlinkedPaymentIds.length &&
            !invalidRefundIds.length &&
            !invalidResolutionIntentIds.length &&
            !overdueManualReviewIds.length;
        const result: PaymentReconciliationResult = {
            runAt: runAt.toISOString(),
            scannedIntentCount: settledIntents.length,
            scannedPaymentCount: usdtPayments.length,
            scannedRefundCount: manualRefunds.length,
            scannedResolutionActionCount: resolutionActions.length,
            unsettledIntentIds: unsettledIntentIds.slice(0, 100),
            unlinkedPaymentIds: unlinkedPaymentIds.slice(0, 100),
            invalidRefundIds: invalidRefundIds.slice(0, 100),
            invalidResolutionIntentIds: invalidResolutionIntentIds.slice(0, 100),
            manualReviewCount: manualReviews.length,
            overdueManualReviewIds: overdueManualReviewIds.slice(0, 100),
            truncated,
            healthy,
        };
        await this.publishResult(ctx, result);
        return result;
    }

    private async publishResult(ctx: RequestContext, result: PaymentReconciliationResult): Promise<void> {
        const businessDate = result.runAt.slice(0, 10);
        const hardIssueCount =
            result.unsettledIntentIds.length +
            result.unlinkedPaymentIds.length +
            result.invalidRefundIds.length +
            result.invalidResolutionIntentIds.length +
            Number(result.truncated);
        const hasIssue = hardIssueCount > 0 || result.overdueManualReviewIds.length > 0;
        await this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                mode: hasIssue ? 'INCIDENT_FIRING' : 'INCIDENT_RESOLVED',
                eventType: 'commerce.payment.daily_reconciliation',
                category: 'PAYMENT',
                severity: hardIssueCount > 0 ? 'P0' : 'P1',
                sourceType: 'PaymentDailyReconciliation',
                sourceId: businessDate,
                fingerprint: 'commerce.payment.daily_reconciliation',
                title: hasIssue ? '每日支付对账发现异常' : '每日支付对账已通过',
                payload: {
                    ...result,
                    adminPath: '/settings/usdt-payments',
                },
            }),
        );
    }
}

function usdtBaseUnits(value: string | null | undefined): string | null {
    if (value == null || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value)) return null;
    const [whole, fractional = ''] = value.split('.');
    return (BigInt(whole) * BigInt(1_000_000) + BigInt(fractional.padEnd(6, '0'))).toString();
}
