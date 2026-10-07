import {
    Channel,
    Order,
    OrderService,
    Payment,
    PaymentMethod,
    PaymentMethodService,
    PaymentService,
    StorePaymentMethodState,
} from '@vendure/core';
import { createConnection } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { DataSource, EntitySchema, EntitySchemaColumnOptions, getMetadataArgsStorage } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontUsdtCheckoutQuote } from '../entities/storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from '../entities/storefront-usdt-payment-intent.entity';

import { usdtTrc20PaymentHandler } from './usdt-payment-handler';
import { configureUsdtPaymentProofSecret } from './usdt-payment-proof';
import {
    USDT_TRC20_CONTRACT_ADDRESS,
    USDT_TRC20_PAYMENT_HANDLER_CODE,
    USDT_TRC20_PAYMENT_METHOD_CODE,
} from './usdt-payment.constants';
import { createMatchKey, UsdtPaymentService } from './usdt-payment.service';
import { ConfirmedTrc20Transfer } from './usdt-trc20-client';
import { fingerprintReceivingAddress } from './usdt-wallet-configuration.service';

const address = USDT_TRC20_CONTRACT_ADDRESS;
const fingerprint = fingerprintReceivingAddress(address);
const now = new Date('2026-09-06T12:00:00Z');
const wallet = {
    network: 'TRC20',
    tokenContractAddress: address,
    receivingAddress: address,
    receivingAddressFingerprint: fingerprint,
};

// Use the production intent columns/indexes and real SQL/row locks; other Vendure services are
// controlled at the boundary so these tests never contact a chain or modify a business database.
const columns: Record<string, EntitySchemaColumnOptions> = {
    id: { type: Number, primary: true, generated: true },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
    channelId: { type: Number },
    orderId: { type: Number },
    quoteId: { type: Number },
    paymentId: { type: Number, nullable: true },
};
for (const column of getMetadataArgsStorage().columns.filter(
    item => item.target === StorefrontUsdtPaymentIntent,
)) {
    columns[column.propertyName] = column.options as EntitySchemaColumnOptions;
}
const intentSchema = new EntitySchema({
    name: 'StorefrontUsdtPaymentIntent',
    target: StorefrontUsdtPaymentIntent,
    tableName: 'storefront_usdt_payment_intent',
    columns,
    indices: getMetadataArgsStorage()
        .indices.filter(item => item.target === StorefrontUsdtPaymentIntent)
        .map(index => ({ name: index.name, columns: index.columns as string[], unique: index.unique })),
    relations: {
        channel: { type: 'many-to-one', target: 'Channel', joinColumn: { name: 'channelId' } },
        quote: {
            type: 'many-to-one',
            target: 'StorefrontUsdtCheckoutQuote',
            joinColumn: { name: 'quoteId' },
        },
    },
});
const quoteSchema = new EntitySchema({
    name: 'StorefrontUsdtCheckoutQuote',
    target: StorefrontUsdtCheckoutQuote,
    tableName: 'storefront_usdt_checkout_quote',
    columns: {
        id: { type: Number, primary: true, generated: true },
        channelId: { type: Number },
        orderId: { type: Number },
        usdtAmount: { type: 'decimal', precision: 24, scale: 6 },
        fiatCurrencyCode: { type: String },
        fiatAmount: { type: Number },
        expiresAt: { type: Date },
    },
});
const channelSchema = new EntitySchema({
    name: 'Channel',
    target: Channel,
    tableName: 'channel',
    columns: { id: { type: Number, primary: true }, code: { type: String } },
});
const methodSchema = new EntitySchema<PaymentMethod>({
    name: 'PaymentMethod',
    target: PaymentMethod,
    tableName: 'payment_method',
    columns: {
        id: { type: Number, primary: true },
        code: { type: String },
        enabled: { type: Boolean },
        handler: { type: 'simple-json' },
    },
    relations: {
        channels: { type: 'many-to-many', target: 'Channel', joinTable: true },
    },
});
const switchSchema = new EntitySchema({
    name: 'StorePaymentMethodState',
    target: StorePaymentMethodState,
    tableName: 'store_payment_method_state',
    columns: {
        id: { type: Number, primary: true, generated: true },
        channelId: { type: Number },
        paymentMethodId: { type: Number },
        enabled: { type: Boolean },
    },
});
const orderSchema = new EntitySchema<Order>({
    name: 'Order',
    target: Order,
    tableName: 'order',
    columns: { id: { type: Number, primary: true }, salesChannelId: { type: Number, nullable: true } },
    relations: { payments: { type: 'one-to-many', target: 'Payment', inverseSide: 'order' } },
});
const paymentSchema = new EntitySchema<Payment>({
    name: 'Payment',
    target: Payment,
    tableName: 'payment',
    columns: {
        id: { type: Number, primary: true, generated: true },
        amount: { type: Number },
        state: { type: String },
        method: { type: String },
        transactionId: { type: String, nullable: true },
        metadata: { type: 'simple-json' },
        errorMessage: { type: String, nullable: true },
    },
    relations: { order: { type: 'many-to-one', target: 'Order', joinColumn: true } },
});
type TestContext = { channelId?: number; manager?: DataSource['manager'] };

async function isolatedMysqlDatabase(): Promise<string> {
    const port = Number(process.env.USDT_TEST_PORT);
    if (
        process.env.ORDER_CLOSURE_MYSQL !== '1' ||
        port !== 37406 ||
        !process.env.ORDER_CLOSURE_MYSQL_PASSWORD
    )
        throw new Error('USDT MySQL tests require the owned isolated order-closure runner');
    const database = `usdt_preview_${randomUUID().replace(/-/gu, '')}`;
    const connection = await createConnection({
        host: '127.0.0.1',
        port,
        user: 'root',
        password: process.env.ORDER_CLOSURE_MYSQL_PASSWORD,
    });
    try {
        // Only create a new randomly named database in our owned disposable server. Never drop
        // existing tables or reuse a configured application database, even between test cases.
        await connection.query(`CREATE DATABASE \`${database}\``);
    } finally {
        await connection.end();
    }
    return database;
}

describe('USDT amount lifecycle on a real database', () => {
    let db: DataSource;
    let service: UsdtPaymentService;
    let connection: any;
    let realPayments: boolean;
    const orderService = {
        addPaymentToOrderFromAcceptedIntent: vi.fn(),
        lockOrderForRefund: vi.fn(async (ctx: TestContext, orderId: number) => {
            // Mirror the production no-op UPDATE lock on the same transaction before locking the intent.
            if (!ctx.manager) throw new Error('Order lock requires the mutation transaction');
            const repository = ctx.manager.getRepository(Order);
            await repository.findOneByOrFail({ id: orderId });
            await repository
                .createQueryBuilder()
                .update()
                .set({ id: () => 'id' })
                .where('id = :id', { id: orderId })
                .execute();
        }),
        withOrderMutationTransaction: (_ctx: TestContext, work: (ctx: TestContext) => Promise<unknown>) =>
            db.options.type === 'sqljs'
                ? (_ctx.manager ?? db.manager).transaction(manager => work({ ..._ctx, manager }))
                : (_ctx.manager ?? db.manager).transaction('READ COMMITTED', manager =>
                      work({ ..._ctx, manager }),
                  ),
    };
    const eventBus = { publish: vi.fn() };
    const chain = { scanIncomingTransfers: vi.fn(), solidifiedTransaction: vi.fn() };
    let nextOrder: number;

    beforeEach(async () => {
        const driver = process.env.USDT_TEST_DB ?? 'sqljs';
        if (!['sqljs', 'mysql'].includes(driver)) throw new Error('Unsupported isolated test DB');
        db = new DataSource({
            ...(driver === 'sqljs'
                ? { type: 'sqljs' as const }
                : {
                      type: 'mysql' as const,
                      host: '127.0.0.1',
                      port: Number(process.env.USDT_TEST_PORT),
                      username: 'root',
                      password: process.env.ORDER_CLOSURE_MYSQL_PASSWORD,
                      database: await isolatedMysqlDatabase(),
                  }),
            entities: [
                intentSchema,
                quoteSchema,
                channelSchema,
                orderSchema,
                methodSchema,
                switchSchema,
                paymentSchema,
            ],
            synchronize: true,
            dropSchema: false,
        });
        await db.initialize();
        await db.getRepository(Channel).save([
            { id: 1, code: 'test' },
            { id: 2, code: '__default_channel__' },
        ]);
        await db.getRepository(PaymentMethod).save({
            id: 1,
            code: USDT_TRC20_PAYMENT_METHOD_CODE,
            enabled: true,
            channels: [{ id: 2 }],
            handler: { code: USDT_TRC20_PAYMENT_HANDLER_CODE, args: [] },
        });
        await db
            .getRepository(StorePaymentMethodState)
            .save({ channelId: 1, paymentMethodId: 1, enabled: true });
        nextOrder = 1;
        realPayments = false;
        vi.clearAllMocks();
        chain.scanIncomingTransfers.mockResolvedValue({ complete: true, transfers: [] });
        chain.solidifiedTransaction.mockImplementation((id: string) => ({
            transactionId: id,
            blockNumber: 100,
        }));
        orderService.addPaymentToOrderFromAcceptedIntent.mockResolvedValue({ id: 1 });
        configureUsdtPaymentProofSecret('isolated-usdt-reuse-test-proof-secret-long-enough');
        connection = {
            platformStoreGovernanceEnabled: true,
            getRepository: (ctx: TestContext, entity: typeof StorefrontUsdtPaymentIntent) =>
                entity === (Payment as unknown) && !realPayments
                    ? {
                          findOne: async ({ where }: { where: { transactionId: string } }) => {
                              const paid = await (ctx.manager ?? db.manager)
                                  .getRepository(StorefrontUsdtPaymentIntent)
                                  .findOneByOrFail({
                                      transactionId: where.transactionId.replace(/^tron:/u, ''),
                                  });
                              return { id: 1, state: 'Settled', order: { id: paid.orderId } };
                          },
                      }
                    : (ctx.manager ?? db.manager).getRepository(entity),
            getEntityOrThrow: (ctx: TestContext, entity: typeof StorefrontUsdtCheckoutQuote, id: number) =>
                (ctx.manager ?? db.manager).getRepository(entity).findOneByOrFail({ id }),
            withTransaction: (_ctx: TestContext, work: (ctx: TestContext) => Promise<unknown>) =>
                db.transaction(manager => work({ ..._ctx, manager })),
        };
        service = new UsdtPaymentService(
            connection as never,
            orderService as never,
            {
                create: ({ channelOrToken }: { channelOrToken: Channel }) =>
                    Promise.resolve({ channelId: channelOrToken.id, channel: channelOrToken }),
            } as never,
            { requireConfigured: () => Promise.resolve(wallet) } as never,
            chain as never,
            eventBus as never,
            { assertNewRealPaymentAllowed: vi.fn().mockResolvedValue(undefined) } as never,
        );
    });
    afterEach(async () => {
        if (db?.isInitialized) await db.destroy();
    });

    async function quote(expiresAt = new Date(now.getTime() + 600_000)) {
        const orderId = nextOrder++;
        await db.getRepository(Order).save({ id: orderId, salesChannelId: 1 });
        return db.getRepository(StorefrontUsdtCheckoutQuote).save({
            channelId: 1,
            orderId,
            usdtAmount: '13.850000',
            fiatCurrencyCode: 'CNY',
            fiatAmount: 10_000,
            expiresAt,
        });
    }
    async function intent(options: Partial<StorefrontUsdtPaymentIntent> = {}) {
        const q = await quote(options.expiresAt);
        const record = await service.ensureIntent({ channelId: q.channelId } as never, q);
        await db.getRepository(StorefrontUsdtPaymentIntent).update(record.id, {
            createdAt: new Date(now.getTime() - 300_000),
            ...options,
        });
        return db.getRepository(StorefrontUsdtPaymentIntent).findOneByOrFail({ id: record.id });
    }
    function transfer(record: StorefrontUsdtPaymentIntent): ConfirmedTrc20Transfer {
        return {
            transactionId: 'a'.repeat(64),
            from: 'test-sender',
            to: address,
            amount: record.expectedUsdtAmount,
            blockTimestamp: now,
        };
    }

    it.each([
        [false, true],
        [true, false],
        [false, false],
    ])(
        'rejects new intents with current platform=%s store=%s before inserting acceptance evidence',
        async (platform, store) => {
            const q = await quote();
            await db.getRepository(PaymentMethod).update(1, { enabled: platform });
            await db.getRepository(StorePaymentMethodState).update({ channelId: 1 }, { enabled: store });
            await expect(service.ensureIntent({ channelId: 1 } as never, q)).rejects.toThrow(
                '本店未开启平台 USDT 支付',
            );
            expect(await db.getRepository(StorefrontUsdtPaymentIntent).count()).toBe(0);
        },
    );

    it('persists a real USDT payment from the accepted snapshot after both switches close', async () => {
        const accepted = await intent();
        expect(accepted.acceptedHandlerSnapshot).toMatchObject({
            version: 1,
            methodId: '1',
            methodCode: 'usdt-trc20',
        });
        await db.getRepository(PaymentMethod).update(1, { enabled: false });
        await db.getRepository(StorePaymentMethodState).update({ channelId: 1 }, { enabled: false });
        realPayments = true;
        const methods = new PaymentMethodService(
            connection,
            {} as never,
            {} as never,
            {} as never,
            eventBus as never,
            { getByCode: () => usdtTrc20PaymentHandler } as never,
            { getDefaultChannel: () => Promise.resolve({ id: 2 }) } as never,
            {} as never,
            {} as never,
            { translate: (value: unknown) => value } as never,
        );
        const payments = new PaymentService(
            connection,
            {
                transition: (_ctx: unknown, _order: unknown, payment: Payment, state: Payment['state']) => {
                    payment.state = state;
                    return Promise.resolve({ finalize: () => Promise.resolve() });
                },
            } as never,
            {} as never,
            methods,
            eventBus as never,
        );
        const order = {
            id: accepted.orderId,
            salesChannelId: 1,
            state: 'ArrangingPayment',
            totalWithTax: 10_000,
            shippingWithTax: 0,
            currencyCode: 'CNY',
            payments: [],
            lines: [],
            customFields: { paymentCurrencyCode: 'USDT' },
        } as unknown as Order;
        const orders = Object.assign(Object.create(OrderService.prototype), {
            connection,
            paymentService: payments,
            checkoutValidators: new Map(),
            assertInTransaction: vi.fn(),
            lockOrderForRefund: orderService.lockOrderForRefund,
            withOrderMutationTransaction: orderService.withOrderMutationTransaction,
            getOrderOrThrow: () => Promise.resolve(order),
            canAddPaymentToOrder: () => true,
            revalidateCouponCodesForOrder: () => Promise.resolve([]),
            getOrderPayments: () => Promise.resolve([]),
            findOne: () => Promise.resolve(order),
        }) as OrderService;
        const actualService = new UsdtPaymentService(
            connection,
            orders,
            { create: () => Promise.resolve({ channelId: 1, channel: { id: 1, code: 'test' } }) } as never,
            { requireConfigured: () => Promise.resolve(wallet) } as never,
            chain as never,
            eventBus as never,
        );
        chain.scanIncomingTransfers.mockResolvedValue({ complete: true, transfers: [transfer(accepted)] });
        const result = await actualService.scanPendingPayments({} as never, now);
        const afterMatch = await db
            .getRepository(StorefrontUsdtPaymentIntent)
            .findOneByOrFail({ id: accepted.id });
        expect(result, afterMatch.failureReason ?? undefined).toMatchObject({
            settledCount: 1,
            manualReviewCount: 0,
        });
        const recorded = await db.getRepository(Payment).findOneOrFail({
            where: { transactionId: `tron:${'a'.repeat(64)}` },
            relations: { order: true },
        });
        expect(recorded).toMatchObject({
            state: 'Settled',
            amount: 10_000,
            method: 'usdt-trc20',
            order: { id: accepted.orderId },
        });
        const received = recorded.metadata.verifiedUsdtPayment as {
            proof: string;
            orderId: string;
            fiatAmount: number;
        };
        expect(received).toMatchObject({ orderId: String(accepted.orderId), fiatAmount: 10_000 });
        expect(
            await db.getRepository(StorefrontUsdtPaymentIntent).findOneByOrFail({ id: accepted.id }),
        ).toMatchObject({ status: 'SETTLED', paymentId: recorded.id });
        const ctx = { channelId: 1, channel: { id: 1, code: 'test' } } as never;
        await expect(
            orders.withOrderMutationTransaction(ctx, tx =>
                orders.addPaymentToOrder(tx, accepted.orderId, {
                    method: 'usdt-trc20',
                    metadata: {
                        proof: received.proof,
                        existingPayment: true,
                        acceptedHandlerSnapshot: accepted.acceptedHandlerSnapshot,
                    },
                }),
            ),
        ).rejects.toThrow();
        expect(await db.getRepository(Payment).count()).toBe(1);
        const replay = await actualService.scanPendingPayments({} as never, now);
        expect(replay.settledCount).toBe(0);
        expect(await db.getRepository(Payment).count()).toBe(1);
    });

    it.each(['legacy', 'unknown-version', 'args-changed', 'deleted', 'same-code-recreated'] as const)(
        'retains the receipt in manual review for %s instead of constructing settlement scope',
        async change => {
            const accepted = await intent();
            if (change === 'legacy')
                await db
                    .getRepository(StorefrontUsdtPaymentIntent)
                    .update(accepted.id, { acceptedHandlerSnapshot: null });
            if (change === 'unknown-version') {
                const snapshot = accepted.acceptedHandlerSnapshot;
                if (!snapshot) throw new Error('Missing accepted handler snapshot in fixture');
                await db.getRepository(StorefrontUsdtPaymentIntent).update(accepted.id, {
                    acceptedHandlerSnapshot: { ...snapshot, version: 2 } as any,
                });
            }
            if (change === 'args-changed')
                await db.getRepository(PaymentMethod).update(1, {
                    handler: {
                        code: USDT_TRC20_PAYMENT_HANDLER_CODE,
                        args: [{ name: 'destination', value: 'changed' }],
                    },
                });
            if (change === 'deleted' || change === 'same-code-recreated') {
                await db
                    .getRepository(PaymentMethod)
                    .remove(await db.getRepository(PaymentMethod).findOneByOrFail({ id: 1 }));
                if (change === 'same-code-recreated')
                    await db.getRepository(PaymentMethod).save({
                        id: 7,
                        code: USDT_TRC20_PAYMENT_METHOD_CODE,
                        enabled: true,
                        channels: [{ id: 2 }],
                        handler: { code: USDT_TRC20_PAYMENT_HANDLER_CODE, args: [] },
                    });
            }
            chain.scanIncomingTransfers.mockResolvedValue({
                complete: true,
                transfers: [transfer(accepted)],
            });
            expect(await service.scanPendingPayments({} as never, now)).toMatchObject({
                settledCount: 0,
                manualReviewCount: 1,
            });
            expect(orderService.addPaymentToOrderFromAcceptedIntent).not.toHaveBeenCalled();
            expect(
                await db.getRepository(StorefrontUsdtPaymentIntent).findOneByOrFail({ id: accepted.id }),
            ).toMatchObject({
                status: 'MANUAL_REVIEW',
                transactionId: 'a'.repeat(64),
                receivedUsdtAmount: accepted.expectedUsdtAmount,
            });
            expect(await db.getRepository(Payment).count()).toBe(0);
        },
    );

    async function reserveSlots(count: number, expiresAt: Date) {
        const quotes: StorefrontUsdtCheckoutQuote[] = [];
        for (let index = 0; index < count; index++) quotes.push(await quote(expiresAt));
        const rows = quotes.map((q, index) => {
            const amount = `13.850${String(index + 1).padStart(3, '0')}`;
            const key = createMatchKey('TRC20', fingerprint, amount);
            return {
                ...wallet,
                channelId: 1,
                orderId: q.orderId,
                quoteId: q.id,
                matchKey: key,
                activeMatchKey: key,
                baseUsdtAmount: '13.850000',
                expectedUsdtAmount: amount,
                status: 'EXPIRED' as const,
                expiresAt,
                createdAt: new Date(expiresAt.getTime() - 600_000),
            };
        });
        for (let index = 0; index < rows.length; index += 100) {
            await db.getRepository(StorefrontUsdtPaymentIntent).insert(rows.slice(index, index + 100));
        }
    }

    it('does not reserve a payment amount while the local platform payment switch is off', async () => {
        await db.getRepository(StorePaymentMethodState).update({ channelId: 1 }, { enabled: false });
        await expect(service.ensureIntent({ channelId: 1 } as never, await quote())).rejects.toThrow(
            '未开启平台',
        );
        expect(await db.getRepository(StorefrontUsdtPaymentIntent).count()).toBe(0);
    });

    it.each([2, null])('rejects receipt replay if the persisted order owner is %s', async salesChannelId => {
        const current = await intent();
        const q = await db
            .getRepository(StorefrontUsdtCheckoutQuote)
            .findOneByOrFail({ id: current.quoteId });
        await db.getRepository(Order).update(current.orderId, { salesChannelId });
        await expect(service.ensureIntent({ channelId: 1 } as never, q)).rejects.toThrow();
        expect(await db.getRepository(StorefrontUsdtPaymentIntent).count()).toBe(1);
        expect(orderService.addPaymentToOrderFromAcceptedIntent).not.toHaveBeenCalled();
    });

    it('reclaims 999 historical slots without deleting history and allocates the next quote', async () => {
        const expiresAt = new Date(now.getTime() - 3_600_000);
        await reserveSlots(999, expiresAt);
        await expect(service.ensureIntent({ channelId: 1 } as never, await quote())).rejects.toThrow(
            '已用完',
        );
        await service.scanPendingPayments({} as never, now);
        const next = await service.ensureIntent({ channelId: 1 } as never, await quote());
        expect(next.activeMatchKey).toBe(next.matchKey);
        expect(await db.getRepository(StorefrontUsdtPaymentIntent).count()).toBe(1000);
    }, 30_000);

    it.runIf(process.env.USDT_TEST_DB !== undefined)(
        'allows only one of two quotes competing for the last amount in request transactions',
        async () => {
            await reserveSlots(998, new Date(now.getTime() + 600_000));
            const quotes = await Promise.all([quote(), quote()]);
            const outcomes = await Promise.allSettled(
                quotes.map(q =>
                    db.transaction(manager =>
                        service.ensureIntent({ channelId: q.channelId, manager } as never, q),
                    ),
                ),
            );
            expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
            const failed = outcomes.find(result => result.status === 'rejected');
            expect(failed?.status === 'rejected' && failed.reason.message).toContain('已用完');
            expect(await db.getRepository(StorefrontUsdtPaymentIntent).count()).toBe(999);
        },
        30_000,
    );

    it('does not release a pending amount until the discovery grace has elapsed', async () => {
        const row = await intent({ expiresAt: new Date(now.getTime() - 60_000) });
        await service.scanPendingPayments({} as never, now);
        expect(
            await db.getRepository(StorefrontUsdtPaymentIntent).findOneByOrFail({ id: row.id }),
        ).toMatchObject({ status: 'PENDING', activeMatchKey: row.matchKey });
    });

    it('keeps expired reservations when the scan is truncated or fails', async () => {
        const row = await intent({ expiresAt: new Date(now.getTime() - 3_600_000) });
        chain.scanIncomingTransfers.mockResolvedValueOnce({ complete: false, transfers: [] });
        await service.scanPendingPayments({} as never, now);
        chain.scanIncomingTransfers.mockRejectedValueOnce(new Error('scan unavailable'));
        await expect(service.scanPendingPayments({} as never, now)).rejects.toThrow('scan unavailable');
        expect(
            await db.getRepository(StorefrontUsdtPaymentIntent).findOneByOrFail({ id: row.id }),
        ).toMatchObject({ status: 'PENDING', activeMatchKey: row.matchKey });
    });

    it('reconciles a timely transfer after prolonged worker downtime before expiring its window', async () => {
        const row = await intent({
            createdAt: new Date(now.getTime() - 7_200_000),
            expiresAt: new Date(now.getTime() - 3_600_000),
        });
        chain.scanIncomingTransfers.mockResolvedValue({
            complete: true,
            transfers: [{ ...transfer(row), blockTimestamp: new Date(now.getTime() - 3_900_000) }],
        });
        const result = await service.scanPendingPayments({} as never, now);
        expect(orderService.lockOrderForRefund).toHaveBeenCalledWith(
            expect.objectContaining({ manager: expect.anything() }),
            row.orderId,
        );
        expect(result.settledCount).toBe(1);
        expect(
            await db.getRepository(StorefrontUsdtPaymentIntent).findOneByOrFail({ id: row.id }),
        ).toMatchObject({ status: 'SETTLED', activeMatchKey: null });
    });

    it('does not reclaim an unfinalized matching transfer', async () => {
        const row = await intent({
            createdAt: new Date(now.getTime() - 7_200_000),
            expiresAt: new Date(now.getTime() - 3_600_000),
        });
        chain.scanIncomingTransfers.mockResolvedValue({
            complete: true,
            transfers: [{ ...transfer(row), blockTimestamp: new Date(now.getTime() - 3_900_000) }],
        });
        chain.solidifiedTransaction.mockResolvedValue(null);
        await service.scanPendingPayments({} as never, now);
        expect(
            await db.getRepository(StorefrontUsdtPaymentIntent).findOneByOrFail({ id: row.id }),
        ).toMatchObject({ status: 'PENDING', activeMatchKey: row.matchKey });
    });

    it('claims reused-amount transfers for manual review without paying the new order', async () => {
        const historical = await intent({ status: 'EXPIRED', activeMatchKey: null });
        const current = await intent({
            matchKey: historical.matchKey,
            activeMatchKey: historical.matchKey,
            expectedUsdtAmount: historical.expectedUsdtAmount,
        });
        chain.scanIncomingTransfers.mockResolvedValue({ complete: true, transfers: [transfer(current)] });
        await service.scanPendingPayments({} as never, now);
        expect(
            await db.getRepository(StorefrontUsdtPaymentIntent).findOneByOrFail({ id: current.id }),
        ).toMatchObject({
            status: 'MANUAL_REVIEW',
            activeMatchKey: current.matchKey,
            transactionId: 'a'.repeat(64),
        });
        expect(orderService.addPaymentToOrderFromAcceptedIntent).not.toHaveBeenCalled();
        expect(eventBus.publish).toHaveBeenCalled();
        await service.scanPendingPayments({} as never, now);
        expect(orderService.addPaymentToOrderFromAcceptedIntent).not.toHaveBeenCalled();
    });

    it('never pays a second order using an already claimed transaction', async () => {
        await intent({ status: 'MANUAL_REVIEW', transactionId: 'a'.repeat(64) });
        const current = await intent();
        chain.scanIncomingTransfers.mockResolvedValue({ complete: true, transfers: [transfer(current)] });
        await service.scanPendingPayments({} as never, now);
        expect(orderService.addPaymentToOrderFromAcceptedIntent).not.toHaveBeenCalled();
        expect(
            await db.getRepository(StorefrontUsdtPaymentIntent).findOneByOrFail({ id: current.id }),
        ).toMatchObject({ status: 'PENDING', transactionId: null });
    });

    it.runIf(process.env.USDT_TEST_DB !== undefined)(
        'returns one intent for concurrent requests for the same quote',
        async () => {
            const q = await quote();
            const intents = await Promise.all(
                Array.from({ length: 12 }, () =>
                    service.ensureIntent({ channelId: q.channelId } as never, q),
                ),
            );
            expect(new Set(intents.map(record => record.id)).size).toBe(1);
            expect(await db.getRepository(StorefrontUsdtPaymentIntent).count()).toBe(1);
        },
    );

    it.runIf(process.env.USDT_TEST_DB !== undefined)(
        'keeps concurrent quote allocations unique across channels sharing a wallet',
        async () => {
            const otherChannelId = 3; // Preserve channel 2 as the platform default.
            await db.getRepository(Channel).save({ id: otherChannelId, code: 'other-test' });
            const quotes = await Promise.all(Array.from({ length: 12 }, () => quote()));
            for (const q of quotes.slice(6)) {
                q.channelId = otherChannelId;
                await db.getRepository(Order).update(q.orderId, { salesChannelId: otherChannelId });
                await db.getRepository(StorefrontUsdtCheckoutQuote).save(q);
            }
            // The second shop must opt in before this fixture can exercise shared-wallet allocation.
            await expect(
                service.ensureIntent({ channelId: otherChannelId } as never, quotes[6]),
            ).rejects.toThrow('本店未开启平台 USDT 支付');
            expect(await db.getRepository(StorefrontUsdtPaymentIntent).count()).toBe(0);
            await db
                .getRepository(StorePaymentMethodState)
                .save({ channelId: otherChannelId, paymentMethodId: 1, enabled: true });
            const rows = await Promise.all(
                quotes.map(q =>
                    db.transaction(manager =>
                        service.ensureIntent({ channelId: q.channelId, manager } as never, q),
                    ),
                ),
            );
            expect(new Set(rows.map(row => row.activeMatchKey)).size).toBe(12);
            expect(await db.getRepository(StorefrontUsdtPaymentIntent).count()).toBe(12);
            expect(new Set(rows.map(row => row.channelId))).toEqual(new Set([1, otherChannelId]));
        },
    );

    it.runIf(process.env.USDT_TEST_DB !== undefined)(
        'settles once when workers scan concurrently',
        async () => {
            const current = await intent();
            chain.scanIncomingTransfers.mockResolvedValue({ complete: true, transfers: [transfer(current)] });
            await Promise.all([
                service.scanPendingPayments({} as never, now),
                service.scanPendingPayments({} as never, now),
            ]);
            expect(orderService.addPaymentToOrderFromAcceptedIntent).toHaveBeenCalledTimes(1);
            expect(
                await db.getRepository(StorefrontUsdtPaymentIntent).findOneByOrFail({ id: current.id }),
            ).toMatchObject({ status: 'SETTLED', transactionId: 'a'.repeat(64) });
        },
    );
});
