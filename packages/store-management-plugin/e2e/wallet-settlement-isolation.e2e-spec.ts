import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ChannelService,
    Customer,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    mergeConfig,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment } from '@vendure/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { ReferralLedgerEntry } from '../src/entities/referral-ledger-entry.entity';
import { ReferralWalletUsage } from '../src/entities/referral-wallet-usage.entity';
import { ReferralWallet } from '../src/entities/referral-wallet.entity';
import { ReferralWalletSpendService } from '../src/referral/referral-wallet-spend.service';
import { StoreManagementPlugin } from '../src/store-management.plugin';

const { server } = createTestEnvironment(
    mergeConfig(testConfig(), {
        apiOptions: { port: 37381 },
        plugins: [
            StorefrontCartPlugin,
            ContentTranslationPlugin.init({
                provider: {
                    name: 'local-no-network',
                    isConfigured: () => false,
                    translate: () => {
                        throw new Error('External provider prohibited in this test');
                    },
                },
            }),
            StoreManagementPlugin.init({ enabled: false, signingSecret: randomUUID() }),
        ],
    }),
);
let connection: TransactionalConnection;
let spend: ReferralWalletSpendService;
let ctxA: RequestContext;
let ctxB: RequestContext;
let customer: Customer;
let wallet: ReferralWallet;
const openingBalance = 100000;

function reservation() {
    return {
        customerId: customer.id,
        currencyCode: CurrencyCode.GBP,
        amount: 100,
        resourceType: 'LOCAL_TEST',
        resourceId: randomUUID(),
        idempotencyKey: randomUUID(),
    };
}
async function snapshot() {
    return {
        wallet: await connection.getRepository(ctxA, ReferralWallet).findOneByOrFail({ id: wallet.id }),
        usages: await connection.getRepository(ctxA, ReferralWalletUsage).find({ order: { id: 'ASC' } }),
        ledger: await connection.getRepository(ctxA, ReferralLedgerEntry).find({ order: { id: 'ASC' } }),
    };
}

beforeAll(async () => {
    await server.init({ initialData, customerCount: 2 });
    connection = server.app.get(TransactionalConnection);
    spend = server.app.get(ReferralWalletSpendService);
    ctxA = await server.app.get(RequestContextService).create({ apiType: 'admin' });
    const channel = await server.app.get(ChannelService).create(ctxA, {
        code: 'wallet-isolation-b',
        token: 'wallet_isolation_b',
        defaultLanguageCode: LanguageCode.en,
        currencyCode: CurrencyCode.GBP,
        pricesIncludeTax: true,
    });
    expect('id' in channel).toBe(true);
    ctxB = await server.app
        .get(RequestContextService)
        .create({ apiType: 'admin', channelOrToken: 'wallet_isolation_b' });
    customer = await connection.getRepository(ctxA, Customer).findOneOrFail({ where: {} });
    await server.app.get(ChannelService).assignToChannels(ctxA, Customer, customer.id, [ctxB.channelId]);
    const account = await Reflect.get(spend, 'getOrCreateAccount').call(spend, ctxA, customer);
    wallet = await Reflect.get(spend, 'getOrCreateWallet').call(
        spend,
        ctxA,
        account,
        customer,
        CurrencyCode.GBP,
    );
    await connection
        .getRepository(ctxA, ReferralWallet)
        .update(wallet.id, { availableBalance: openingBalance });
}, 120000);
afterAll(async () => {
    await server.destroy();
});

it('normalizes reservations consistently and rejects changed amount, member, resource or store', async () => {
    const input = reservation();
    const usage = await spend.reserve(ctxA, {
        ...input,
        idempotencyKey: ' ' + input.idempotencyKey + ' ',
        resourceId: ' ' + input.resourceId + ' ',
    });
    expect((await spend.reserve(ctxA, input)).id).toBe(usage.id);
    const other = (await connection.getRepository(ctxA, Customer).find()).find(row => row.id !== customer.id);
    if (!other) throw new Error('Expected a second synthetic customer');
    for (const changed of [
        { amount: 99 },
        { customerId: other.id },
        { resourceId: 'different' },
        { currencyCode: CurrencyCode.USD },
    ]) {
        await expect(spend.reserve(ctxA, { ...input, ...changed })).rejects.toThrow();
    }
    await expect(spend.reserve(ctxB, input)).rejects.toThrow();
});

it('rejects both new and replayed cross-store settlement without changing any state', async () => {
    const usage = await spend.reserve(ctxA, reservation());
    const input = { usageId: usage.id, amount: 40, operationKey: 'capture-once' };
    await spend.capture(ctxA, input);
    const before = await snapshot();
    await expect(spend.capture(ctxB, input)).rejects.toThrow('找不到余额预占记录');
    await expect(spend.capture(ctxB, { ...input, operationKey: 'fresh' })).rejects.toThrow(
        '找不到余额预占记录',
    );
    await expect(spend.capture(ctxA, { ...input, amount: 39 })).rejects.toThrow('幂等操作');
    expect(await snapshot()).toEqual(before);
});

it('records one settlement under concurrent identical requests', async () => {
    const input = reservation();
    const reserved = await Promise.all(Array.from({ length: 6 }, () => spend.reserve(ctxA, input)));
    expect(new Set(reserved.map(row => String(row.id))).size).toBe(1);
    const usage = reserved[0];
    const result = await Promise.all(
        Array.from({ length: 8 }, () =>
            spend.capture(ctxA, {
                usageId: usage.id,
                amount: 100,
                operationKey: 'concurrent',
            }),
        ),
    );
    expect(result.every(row => row.capturedAmount === 100)).toBe(true);
    const ledger = await connection.getRepository(ctxA, ReferralLedgerEntry).find({
        where: { idempotencyKey: 'WALLET_USAGE_CAPTURED:' + usage.id + ':concurrent' },
    });
    expect(ledger).toHaveLength(1);
});

it('sees a committed receipt even when a repeatable-read snapshot predates settlement', async () => {
    const usage = await spend.reserve(ctxA, reservation());
    const input = { usageId: usage.id, amount: 100, operationKey: 'old-snapshot' };
    await connection.withTransaction(ctxA, async txCtx => {
        // Establish the old consistent snapshot before a separate transaction commits.
        await connection.getRepository(txCtx, ReferralLedgerEntry).find();
        await spend.capture(ctxA, input);
        const replay = await spend.capture(txCtx, input);
        expect(replay.capturedAmount).toBe(100);
    });
});

it('replays capture after refund, keeps receipt metadata authoritative and accepts old whitespace', async () => {
    const usage = await spend.reserve(ctxA, reservation());
    const input = { usageId: usage.id, amount: 100, operationKey: 'capture-replay' };
    await spend.capture(ctxA, {
        ...input,
        metadata: { usageId: 'forged', operationKey: 'forged', amount: 1 },
    });
    const ledger = await connection.getRepository(ctxA, ReferralLedgerEntry).findOneByOrFail({
        idempotencyKey: 'WALLET_USAGE_CAPTURED:' + usage.id + ':capture-replay',
    });
    expect(ledger.metadata).toMatchObject({
        usageId: String(usage.id),
        operationKey: 'capture-replay',
        amount: 100,
    });
    await connection.getRepository(ctxA, ReferralLedgerEntry).update(ledger.id, {
        metadata: { usageId: String(usage.id), operationKey: ' capture-replay ' },
    });
    await spend.refundCaptured(ctxA, { usageId: usage.id, amount: 100, operationKey: 'refund-once' });
    const before = await snapshot();
    expect((await spend.capture(ctxA, { ...input, operationKey: ' capture-replay ' })).capturedAmount).toBe(
        0,
    );
    await spend.refundCaptured(ctxA, { usageId: usage.id, amount: 100, operationKey: 'refund-once' });
    expect(await snapshot()).toEqual(before);
});

it('rolls back balances and usage if ledger persistence fails', async () => {
    const usage = await spend.reserve(ctxA, reservation());
    const before = await snapshot();
    const spy = vi
        .spyOn(spend as any, 'writeLedger')
        .mockRejectedValueOnce(new Error('synthetic ledger failure'));
    try {
        await expect(
            spend.capture(ctxA, { usageId: usage.id, amount: 100, operationKey: 'rollback' }),
        ).rejects.toThrow('synthetic ledger failure');
    } finally {
        spy.mockRestore();
    }
    expect(await snapshot()).toEqual(before);
    await spend.capture(ctxA, { usageId: usage.id, amount: 100, operationKey: 'rollback' });
});

it('reconciles every wallet delta with the synthetic opening balance', async () => {
    const current = await snapshot();
    expect(openingBalance + current.ledger.reduce((sum, row) => sum + row.availableDelta, 0)).toBe(
        current.wallet.availableBalance,
    );
    expect(current.ledger.reduce((sum, row) => sum + row.reservedDelta, 0)).toBe(
        current.wallet.reservedBalance,
    );
    expect(
        current.usages.reduce((sum, row) => sum + row.amount - row.capturedAmount - row.releasedAmount, 0),
    ).toBe(current.wallet.reservedBalance);
});
