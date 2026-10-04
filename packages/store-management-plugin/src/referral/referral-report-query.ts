import { CONTROLLED_TEST_PAYMENT_METHOD_SQL_LIKE } from '@vendure/common/lib/controlled-test-payment';
import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { CustomerStoreEntry, ID, Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

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

    async adminRelationships(ctx: RequestContext, skip = 0, take = 100, search?: string) {
        const query = this.connection
            .getRepository(ctx, ReferralRelationship)
            .createQueryBuilder('relationship')
            .leftJoinAndSelect('relationship.inviterCustomer', 'inviter')
            .leftJoinAndSelect('relationship.inviteeCustomer', 'invitee')
            .where('relationship.channelId = :channelId', { channelId: ctx.channelId });
        this.applySearch(
            query,
            [
                ...this.customerSearchColumns('inviter'),
                ...this.customerSearchColumns('invitee'),
                'relationship.inviteCodeSnapshot',
            ],
            search,
        );
        const [items, totalItems] = await query
            .orderBy('relationship.boundAt', 'DESC')
            .addOrderBy('relationship.id', 'DESC')
            .skip(Math.max(0, skip))
            .take(pageSize(take))
            .getManyAndCount();
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

    async adminInviterSummaries(ctx: RequestContext, skip = 0, take = 50, search?: string) {
        const query = this.connection
            .getRepository(ctx, ReferralRelationship)
            .createQueryBuilder('relationship')
            .innerJoin('relationship.inviterCustomer', 'customer')
            .innerJoin(
                ReferralAccount,
                'account',
                'account.customerId = relationship.inviterCustomerId AND account.channelId = relationship.channelId',
            )
            .where('relationship.channelId = :channelId', { channelId: ctx.channelId });
        this.applySearch(query, [...this.customerSearchColumns('customer'), 'account.inviteCode'], search);
        const rows = await query
            .clone()
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
            .groupBy('relationship.inviterCustomerId')
            .addGroupBy('customer.firstName')
            .addGroupBy('customer.lastName')
            .addGroupBy('customer.emailAddress')
            .addGroupBy('account.inviteCode')
            .orderBy('invitedCount', 'DESC')
            .addOrderBy('relationship.inviterCustomerId', 'ASC')
            // Raw aggregate queries require SQL limit/offset, not entity skip/take.
            .offset(Math.max(0, skip))
            .limit(pageSize(take))
            .getRawMany<{
                customerId: string | number;
                firstName: string;
                lastName: string;
                emailAddress: string;
                inviteCode: string;
                invitedCount: string | number;
                purchasedInviteeCount: string | number;
            }>();
        const total = await query
            .clone()
            .select('COUNT(DISTINCT relationship.inviterCustomerId)', 'count')
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

    async adminLedger(ctx: RequestContext, skip = 0, take = 100, search?: string) {
        const query = this.connection
            .getRepository(ctx, ReferralLedgerEntry)
            .createQueryBuilder('entry')
            .leftJoinAndSelect('entry.customer', 'customer')
            .where('entry.channelId = :channelId', { channelId: ctx.channelId });
        if (search?.trim()) {
            query
                .leftJoin(
                    Order,
                    'ledgerOrder',
                    'ledgerOrder.id = entry.orderId AND ledgerOrder.salesChannelId = entry.channelId',
                )
                .leftJoin(
                    ReferralWithdrawal,
                    'withdrawal',
                    'withdrawal.id = entry.withdrawalId AND withdrawal.channelId = entry.channelId',
                );
            this.applySearch(
                query,
                [
                    ...this.customerSearchColumns('customer'),
                    'entry.eventType',
                    'entry.note',
                    'ledgerOrder.code',
                    'withdrawal.code',
                ],
                search,
                ['entry.id', 'entry.orderId', 'entry.withdrawalId'],
            );
        }
        const [items, totalItems] = await query
            .orderBy('entry.createdAt', 'DESC')
            .addOrderBy('entry.id', 'DESC')
            .skip(Math.max(0, skip))
            .take(pageSize(take))
            .getManyAndCount();
        return {
            totalItems,
            items: items.map(item => ({
                ...item,
                customerName: customerName(item.customer),
                customerEmail: item.customer.emailAddress,
            })),
        };
    }

    async adminRewards(ctx: RequestContext, skip = 0, take = 100, search?: string) {
        const query = this.connection
            .getRepository(ctx, ReferralReward)
            .createQueryBuilder('reward')
            .leftJoinAndSelect('reward.inviterCustomer', 'inviter')
            .leftJoinAndSelect('reward.inviteeCustomer', 'invitee')
            .leftJoinAndSelect('reward.order', 'rewardOrder')
            .where('reward.channelId = :channelId', { channelId: ctx.channelId });
        this.applySearch(
            query,
            [
                ...this.customerSearchColumns('inviter'),
                ...this.customerSearchColumns('invitee'),
                'rewardOrder.code',
            ],
            search,
        );
        const [items, totalItems] = await query
            .orderBy('reward.earnedAt', 'DESC')
            .addOrderBy('reward.id', 'DESC')
            .skip(Math.max(0, skip))
            .take(pageSize(take))
            .getManyAndCount();
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

    async adminWithdrawals(ctx: RequestContext, skip = 0, take = 100, search?: string) {
        const query = this.connection
            .getRepository(ctx, ReferralWithdrawal)
            .createQueryBuilder('withdrawal')
            .leftJoinAndSelect('withdrawal.customer', 'customer')
            .where('withdrawal.channelId = :channelId', { channelId: ctx.channelId });
        this.applySearch(
            query,
            [...this.customerSearchColumns('customer'), 'withdrawal.code', 'withdrawal.externalReference'],
            search,
        );
        const [items, totalItems] = await query
            .orderBy('withdrawal.createdAt', 'DESC')
            .addOrderBy('withdrawal.id', 'DESC')
            .skip(Math.max(0, skip))
            .take(pageSize(take))
            .getManyAndCount();
        return { totalItems, items: items.map(item => withdrawalView(item, item.customer)) };
    }

    private customerSearchColumns(alias: string): string[] {
        const last = `COALESCE(${alias}.lastName, '')`;
        const first = `COALESCE(${alias}.firstName, '')`;
        const driver = this.connection.rawConnection.options.type;
        const fullName =
            driver === 'mysql' || driver === 'mariadb'
                ? `CONCAT(${last}, ${first})`
                : driver === 'mssql'
                  ? `(${last} + ${first})`
                  : `(${last} || ${first})`;
        return [`${alias}.firstName`, `${alias}.lastName`, `${alias}.emailAddress`, fullName];
    }

    private applySearch<T extends ObjectLiteral>(
        query: SelectQueryBuilder<T>,
        columns: string[],
        search?: string,
        identifiers: string[] = [],
    ): void {
        const term = search?.trim().slice(0, 255).toLowerCase();
        if (!term) return;
        // Parameterize input and treat SQL LIKE wildcards as literal characters.
        const clauses = columns.map(column => `LOWER(${column}) LIKE :referralSearch ESCAPE '!'`);
        const parameters: Record<string, string> = {
            referralSearch: `%${term.replace(/[!%_]/g, value => `!${value}`)}%`,
        };
        if (/^[0-9]{1,20}$/.test(term) && identifiers.length) {
            const driver = this.connection.rawConnection.options.type;
            const idType =
                driver === 'mysql' || driver === 'mariadb'
                    ? 'CHAR'
                    : driver === 'mssql'
                      ? 'NVARCHAR(255)'
                      : 'TEXT';
            // Compare ID text so a long numeric keyword cannot overflow an integer DB column.
            clauses.push(...identifiers.map(column => `CAST(${column} AS ${idType}) = :referralSearchId`));
            parameters.referralSearchId = term.replace(/^0+(?=\d)/, '');
        }
        query.andWhere(`(${clauses.join(' OR ')})`, parameters);
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
            .innerJoin('referralOrder.salesChannel', 'orderChannel', 'orderChannel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .innerJoin(
                'referralOrder.payments',
                'settledTodayPayment',
                [
                    'settledTodayPayment.state = :settledPaymentState',
                    'settledTodayPayment.method NOT LIKE :controlledTestMethod',
                    'settledTodayPayment.updatedAt >= :utcStart',
                    'settledTodayPayment.updatedAt < :utcEnd',
                ].join(' AND '),
                {
                    settledPaymentState: 'Settled',
                    controlledTestMethod: CONTROLLED_TEST_PAYMENT_METHOD_SQL_LIKE,
                    utcStart,
                    utcEnd,
                },
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
                'metricPayment.method',
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
                .innerJoin('referralOrder.salesChannel', 'orderChannel', 'orderChannel.id = :channelId', {
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
                .innerJoin(
                    'referralOrder.payments',
                    'previousSettledPayment',
                    'previousSettledPayment.state = :settledPaymentState AND previousSettledPayment.method NOT LIKE :controlledTestMethod',
                    {
                        settledPaymentState: 'Settled',
                        controlledTestMethod: CONTROLLED_TEST_PAYMENT_METHOD_SQL_LIKE,
                    },
                )
                .select('referralOrder.customerId', 'customerId')
                .distinct(true)
                .getRawMany<{ customerId: string | number }>();
            returningCustomerIds = new Set(previousBuyers.map(item => item.customerId.toString()));
        }
        const [newCustomerCount, visitorCount, todayInvitedCount, todayInvitedPurchaserCount] =
            await Promise.all([
                this.connection
                    .getRepository(ctx, CustomerStoreEntry)
                    .createQueryBuilder('storeEntry')
                    .innerJoin('storeEntry.customer', 'customer', 'customer.deletedAt IS NULL')
                    .where('storeEntry.channelId = :channelId', { channelId: ctx.channelId })
                    .andWhere('storeEntry.firstSeenAt >= :start', { start })
                    .andWhere('storeEntry.firstSeenAt < :end', { end })
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
