import { Customer, Order } from '@vendure/core';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ReferralAccount } from '../entities/referral-account.entity';
import { ReferralLedgerEntry } from '../entities/referral-ledger-entry.entity';
import { ReferralRelationship } from '../entities/referral-relationship.entity';
import { ReferralReward } from '../entities/referral-reward.entity';
import { ReferralWallet } from '../entities/referral-wallet.entity';
import { ReferralWithdrawal } from '../entities/referral-withdrawal.entity';

import { ReferralReportQuery } from './referral-report-query';
import { ReferralService } from './referral.service';

// Minimal schema adapters exercise actual TypeORM queries and service audit code in an isolated DB.
const id = { type: Number, primary: true } as const;
const number = { type: Number } as const;
const text = { type: String } as const;
const nullableDate = { type: Date, nullable: true } as const;
const relation = (target: string, column: string) => ({
    type: 'many-to-one' as const,
    target,
    joinColumn: { name: column },
});
const ds = new DataSource({
    type: 'sqljs',
    synchronize: true,
    entities: [
        new EntitySchema({
            name: 'Customer',
            target: Customer,
            columns: { id, firstName: text, lastName: text, emailAddress: text },
        }),
        new EntitySchema({
            name: 'Order',
            target: Order,
            columns: { id, code: text, salesChannelId: number },
        }),
        new EntitySchema({
            name: 'ReferralAccount',
            target: ReferralAccount,
            columns: { id, channelId: number, customerId: number, inviteCode: text },
        }),
        new EntitySchema<ReferralRelationship>({
            name: 'ReferralRelationship',
            target: ReferralRelationship,
            columns: {
                id,
                channelId: number,
                inviterCustomerId: number,
                inviteeCustomerId: number,
                inviteCodeSnapshot: text,
                boundAt: nullableDate,
                firstPaidOrderAt: nullableDate,
            },
            relations: {
                inviterCustomer: relation('Customer', 'inviterCustomerId'),
                inviteeCustomer: relation('Customer', 'inviteeCustomerId'),
            },
        }),
        new EntitySchema<ReferralReward>({
            name: 'ReferralReward',
            target: ReferralReward,
            columns: {
                id,
                channelId: number,
                inviterCustomerId: number,
                inviteeCustomerId: number,
                orderId: number,
                earnedAt: nullableDate,
                rewardRateBps: { type: Number, default: 1000 },
            },
            relations: {
                inviterCustomer: relation('Customer', 'inviterCustomerId'),
                inviteeCustomer: relation('Customer', 'inviteeCustomerId'),
                order: relation('Order', 'orderId'),
            },
        }),
        new EntitySchema<ReferralWithdrawal>({
            name: 'ReferralWithdrawal',
            target: ReferralWithdrawal,
            columns: {
                id,
                channelId: number,
                customerId: number,
                code: text,
                externalReference: { ...text, nullable: true },
                createdAt: nullableDate,
            },
            relations: { customer: relation('Customer', 'customerId') },
        }),
        new EntitySchema<ReferralLedgerEntry>({
            name: 'ReferralLedgerEntry',
            target: ReferralLedgerEntry,
            columns: {
                id,
                channelId: number,
                customerId: number,
                walletId: number,
                eventType: text,
                note: { ...text, nullable: true },
                orderId: { ...number, nullable: true },
                withdrawalId: { ...number, nullable: true },
                createdAt: nullableDate,
                availableDelta: { type: Number, default: 0 },
                pendingDelta: { type: Number, default: 0 },
                reservedDelta: { type: Number, default: 0 },
            },
            relations: { customer: relation('Customer', 'customerId') },
        }),
        new EntitySchema<ReferralWallet>({
            name: 'ReferralWallet',
            target: ReferralWallet,
            columns: {
                id,
                channelId: number,
                customerId: number,
                currencyCode: text,
                availableBalance: { type: Number, default: 0 },
                pendingBalance: { type: Number, default: 0 },
                reservedBalance: { type: Number, default: 0 },
            },
            relations: { customer: relation('Customer', 'customerId') },
        }),
    ],
});
const connection = {
    rawConnection: ds,
    getRepository: (_ctx: unknown, entity: any) => ds.getRepository(entity),
};
const reports = new ReferralReportQuery(connection as any);
const ctx = { channelId: 1 } as any;
beforeAll(async () => {
    await ds.initialize();
    for (let i = 1; i <= 4; i++) {
        await ds.getRepository(Customer).save({
            id: i,
            firstName: '甲',
            lastName: `张${i}`,
            emailAddress: i === 3 ? 'literal_%!@example.invalid' : `person${i}@example.invalid`,
        });
        await ds.getRepository(Order).save({ id: i, code: `ORDER-${i}`, salesChannelId: i === 4 ? 2 : 1 });
        await ds
            .getRepository(ReferralAccount)
            .save({ id: i, channelId: i === 4 ? 2 : 1, customerId: i, inviteCode: `INVITE-${i}` });
        await ds.getRepository(ReferralRelationship).save({
            id: i,
            channelId: i === 4 ? 2 : 1,
            inviterCustomerId: i,
            inviteeCustomerId: i,
            inviteCodeSnapshot: `INVITE-${i}`,
            boundAt: new Date('2026-10-04T00:00:00Z'),
            firstPaidOrderAt: null,
        });
        await ds.getRepository(ReferralReward).save({
            id: i,
            channelId: i === 4 ? 2 : 1,
            inviterCustomerId: i,
            inviteeCustomerId: i,
            orderId: i,
            earnedAt: new Date('2026-10-04T00:00:00Z'),
        });
        await ds.getRepository(ReferralWithdrawal).save({
            id: i,
            channelId: i === 4 ? 2 : 1,
            customerId: i,
            code: `WITHDRAW-${i}`,
            externalReference: `BANK-${i}`,
            createdAt: new Date('2026-10-04T00:00:00Z'),
        });
        await ds.getRepository(ReferralLedgerEntry).save({
            id: i,
            channelId: i === 4 ? 2 : 1,
            customerId: i,
            walletId: i,
            eventType: 'REWARD_AVAILABLE',
            note: null,
            orderId: i,
            withdrawalId: i,
            createdAt: new Date('2026-10-04T00:00:00Z'),
        });
    }
});
afterAll(async () => {
    if (ds.isInitialized) await ds.destroy();
});

describe('referral server report pagination and search', () => {
    it('returns distinct aggregate pages with stable ordering and a matching total', async () => {
        const first = await reports.adminInviterSummaries(ctx, 0, 1);
        const second = await reports.adminInviterSummaries(ctx, 1, 1);
        expect(first.totalItems).toBe(3);
        expect(first.items.map(item => Number(item.customerId))).toEqual([1]);
        expect(second.items.map(item => Number(item.customerId))).toEqual([2]);
    });
    it('finds a promoter or invitee from a later page before paging and counts only matches', async () => {
        expect(await reports.adminInviterSummaries(ctx, 0, 1, 'invite-3')).toMatchObject({
            totalItems: 1,
            items: [{ customerId: 3 }],
        });
        expect(await reports.adminRelationships(ctx, 0, 1, '张3甲')).toMatchObject({
            totalItems: 1,
            items: [{ id: 3 }],
        });
        expect(await reports.adminRelationships(ctx, 0, 1, 'person4')).toMatchObject({
            totalItems: 0,
            items: [],
        });
    });
    it('escapes wildcard and quoted input and preserves case-insensitive email search', async () => {
        expect((await reports.adminInviterSummaries(ctx, 0, 20, '_%!')).totalItems).toBe(1);
        expect((await reports.adminInviterSummaries(ctx, 0, 20, "' OR 1=1 --")).totalItems).toBe(0);
        expect((await reports.adminRelationships(ctx, 0, 1, 'PERSON2@EXAMPLE.INVALID')).items[0].id).toBe(2);
    });
    it('searches rewards by order code and both customers before paging', async () => {
        expect(await reports.adminRewards(ctx, 0, 1, 'ORDER-3')).toMatchObject({
            totalItems: 1,
            items: [{ id: 3 }],
        });
        expect((await reports.adminRewards(ctx, 0, 1, '张2甲')).items[0].id).toBe(2);
        expect((await reports.adminRewards(ctx, 0, 1, 'ORDER-4')).totalItems).toBe(0);
    });
    it('searches ledger by business order/withdrawal code and receipt ID', async () => {
        expect((await reports.adminLedger(ctx, 0, 1, 'ORDER-3')).items[0].id).toBe(3);
        expect((await reports.adminLedger(ctx, 0, 1, 'WITHDRAW-2')).items[0].id).toBe(2);
        expect((await reports.adminLedger(ctx, 0, 1, '3')).items[0].id).toBe(3);
        expect((await reports.adminLedger(ctx, 0, 1, '0003')).items[0].id).toBe(3);
        expect((await reports.adminLedger(ctx, 0, 1, '99999999999999999999')).totalItems).toBe(0);
        expect((await reports.adminLedger(ctx, 0, 1, 'ORDER-4')).totalItems).toBe(0);
    });
    it('keeps a cross-store linked order code out of ledger search', async () => {
        await ds.getRepository(ReferralLedgerEntry).save({
            id: 5,
            channelId: 1,
            customerId: 1,
            walletId: 1,
            eventType: 'REWARD_AVAILABLE',
            orderId: 4,
        });
        expect((await reports.adminLedger(ctx, 0, 20, 'ORDER-4')).totalItems).toBe(0);
    });
    it('searches withdrawal code, customer and payout receipt without leaking another store', async () => {
        expect((await reports.adminWithdrawals(ctx, 0, 1, 'BANK-3')).items[0].id).toBe(3);
        expect((await reports.adminWithdrawals(ctx, 0, 1, '张2甲')).items[0].id).toBe(2);
        expect((await reports.adminWithdrawals(ctx, 0, 1, 'WITHDRAW-4')).totalItems).toBe(0);
    });
});

describe('referral complete wallet audit', () => {
    it('audits beyond 5000 wallets, finds a tail anomaly and respects store scope', async () => {
        const wallets = Array.from({ length: 5002 }, (_, i) => ({
            id: i + 1,
            channelId: i === 5001 ? 2 : 1,
            customerId: 1,
            currencyCode: 'MYR' as any,
            availableBalance: i === 5000 ? 7 : 0,
        }));
        for (let index = 0; index < wallets.length; index += 100)
            await ds.getRepository(ReferralWallet).insert(wallets.slice(index, index + 100));
        const service = Object.assign(Object.create(ReferralService.prototype), { connection });
        const result = await service.balanceAudit(ctx);
        expect(result.auditedWallets).toBe(5001);
        expect(result.items).toMatchObject([{ walletId: 5001, availableDifference: 7 }]);
        expect(result.items).toHaveLength(1);
        const total = await service.auditAllBalances();
        expect(total).toEqual({ auditedWallets: 5002, balanceAnomalies: 1 });
        expect(await service.balanceAudit({ channelId: 3 })).toEqual({ auditedWallets: 0, items: [] });
    });
});
