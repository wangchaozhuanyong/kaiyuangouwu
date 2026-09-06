import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { Customer, ID, Order, RequestContext, TransactionalConnection } from '@vendure/core';

import { ReferralAccount } from '../entities/referral-account.entity';
import { ReferralLedgerEntry } from '../entities/referral-ledger-entry.entity';
import { ReferralRelationship } from '../entities/referral-relationship.entity';
import { ReferralReward } from '../entities/referral-reward.entity';
import { ReferralWallet } from '../entities/referral-wallet.entity';
import { ReferralWithdrawal } from '../entities/referral-withdrawal.entity';
import { StorefrontDailyVisitor } from '../entities/storefront-daily-visitor.entity';

import { REFERRAL_METRIC_SETTLED_ORDER_STATES, settledOrderNetTotal } from './referral-metrics';
import {
    businessDayRange,
    customerName,
    pageSize,
    utcDatabaseTimestamp,
    withdrawalView,
} from './referral-view-helpers';

export class ReferralReportQuery {
    constructor(private readonly connection: TransactionalConnection) {}

    async adminRelationships(ctx: RequestContext, skip = 0, take = 100) {
        const [items, totalItems] = await this.connection
            .getRepository(ctx, ReferralRelationship)
            .findAndCount({
                where: { channelId: ctx.channelId },
                relations: { inviterCustomer: true, inviteeCustomer: true },
                order: { boundAt: 'DESC', id: 'DESC' },
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
                order: { createdAt: 'DESC', id: 'DESC' },
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
            order: { earnedAt: 'DESC', id: 'DESC' },
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
                order: { createdAt: 'DESC', id: 'DESC' },
                skip: Math.max(0, skip),
                take: pageSize(take),
            });
        return { totalItems, items: items.map(item => withdrawalView(item, item.customer)) };
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
}
