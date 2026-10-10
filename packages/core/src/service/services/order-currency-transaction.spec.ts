import 'reflect-metadata';

import { CurrencyCode, HistoryEntryType, LanguageCode } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { setImmediate } from 'node:timers';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { TRANSACTION_MANAGER_KEY } from '../../common/constants';
import { UserInputError } from '../../common/error/errors';
import { ConfigService } from '../../config/config.service';
import { TransactionWrapper } from '../../connection/transaction-wrapper';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { Order } from '../../entity/order/order.entity';
import { OrderEvent } from '../../event-bus/events/order-event';
import { HealthController } from '../../health-check/health-check.controller';

import { ChannelService } from './channel.service';
import { OrderService } from './order.service';

const CACHE_TTL = 30_000;

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => (resolve = done));
    return { promise, resolve };
}

interface Lease {
    id: number;
    release: () => void;
}

/** Only the finite connection slots are simulated; no driver or socket is opened. */
class TransactionPool {
    private readonly free = Array.from({ length: 10 }, (_, id) => id);
    private readonly held = new Set<Lease>();
    private readonly waiting: Array<(lease: Lease) => void> = [];

    get occupied() {
        return this.held.size;
    }

    get queued() {
        return this.waiting.length;
    }

    acquire(): Promise<Lease> {
        const id = this.free.shift();
        return id === undefined
            ? new Promise(resolve => this.waiting.push(resolve))
            : Promise.resolve(this.lease(id));
    }

    releaseAll() {
        for (const lease of [...this.held]) lease.release();
    }

    private lease(id: number): Lease {
        const lease: Lease = {
            id,
            release: () => {
                if (!this.held.delete(lease)) return;
                const next = this.waiting.shift();
                if (next) next(this.lease(id));
                else this.free.push(id);
            },
        };
        this.held.add(lease);
        return lease;
    }
}

async function fixture() {
    const pool = new TransactionPool();
    const channels = [
        new Channel({
            id: 'default',
            code: DEFAULT_CHANNEL_CODE,
            token: 'synthetic-default',
            defaultCurrencyCode: CurrencyCode.CNY,
            defaultLanguageCode: LanguageCode.en,
            availableCurrencyCodes: [CurrencyCode.CNY, CurrencyCode.MYR],
        }),
        new Channel({
            id: 'store',
            code: 'synthetic-store',
            token: 'synthetic-store',
            defaultCurrencyCode: CurrencyCode.CNY,
            defaultLanguageCode: LanguageCode.en,
            availableCurrencyCodes: [CurrencyCode.CNY, CurrencyCode.MYR],
        }),
    ];
    const ctx = new RequestContext({
        apiType: 'shop',
        channel: channels[1],
        currencyCode: CurrencyCode.CNY,
        isAuthorized: true,
        authorizedAsOwnerOnly: true,
    });
    const stats = { starts: 0, commits: 0, rollbacks: 0, releases: 0, outsideReads: 0, reusedReads: 0 };

    const repository = (lease?: Lease) =>
        ({
            getManyAndCount: async () => {
                if (lease) {
                    stats.reusedReads++;
                    return [channels, channels.length];
                }
                stats.outsideReads++;
                const acquired = await pool.acquire();
                try {
                    return [channels, channels.length];
                } finally {
                    acquired.release();
                }
            },
        }) as unknown as Repository<Channel>;
    const dataSource = {
        getRepository: () => repository(),
        createQueryRunner: () => {
            let lease: Lease | undefined;
            const runner = {
                isTransactionActive: false,
                isReleased: false,
                startTransaction: async () => {
                    lease = await pool.acquire();
                    runner.isTransactionActive = true;
                    stats.starts++;
                },
                commitTransaction: () => {
                    runner.isTransactionActive = false;
                    stats.commits++;
                    return Promise.resolve();
                },
                rollbackTransaction: () => {
                    runner.isTransactionActive = false;
                    stats.rollbacks++;
                    return Promise.resolve();
                },
                release: () => {
                    runner.isReleased = true;
                    stats.releases++;
                    lease?.release();
                    return Promise.resolve();
                },
                manager: {
                    getRepository: () => {
                        if (!lease || !runner.isTransactionActive) throw new Error('No active transaction');
                        return repository(lease);
                    },
                    queryRunner: undefined as unknown as QueryRunner,
                },
            };
            runner.manager.queryRunner = runner as unknown as QueryRunner;
            return runner;
        },
    } as unknown as DataSource;
    const wrapper = new TransactionWrapper();
    const connection = new TransactionalConnection(dataSource, wrapper, {
        authOptions: { entityAccessControlStrategy: {} },
    } as ConfigService);
    const channelService = Object.assign(Object.create(ChannelService.prototype), {
        configService: { entityOptions: { channelCacheTtl: CACHE_TTL } },
        // Retain real transaction-aware repository routing beneath the Channel/cache methods.
        listQueryBuilder: {
            build: (_entity: unknown, _options: unknown, options: { ctx: RequestContext }) =>
                connection.getRepository(options.ctx, Channel),
        },
    }) as ChannelService;
    (channelService as any).allChannels = await channelService.createCache();
    const order = new Order({
        id: 'order',
        state: 'AddingItems',
        currencyCode: CurrencyCode.CNY,
        lines: [{ id: 'line', quantity: 1, unitPrice: 1000 }],
    });
    const repriced = new Order({ ...order, lines: [{ id: 'line', quantity: 1, unitPrice: 640 }] });
    const history = vi.fn().mockResolvedValue(undefined);
    const prices = vi.fn(
        (_ctx: RequestContext, current: Order, _lines: Order['lines'], _relations?: RelationPaths<Order>) => {
            const updated = current === order ? repriced : new Order({ ...current });
            updated.currencyCode = current.currencyCode;
            return Promise.resolve(updated);
        },
    );
    const publish = vi.fn().mockResolvedValue(undefined);
    const loadOrder = vi.fn().mockResolvedValue(order);
    const orderService = Object.assign(Object.create(OrderService.prototype), {
        channelService,
        getOrderOrThrow: loadOrder,
        historyService: { createHistoryEntryForOrder: history },
        applyPriceAdjustments: prices,
        eventBus: { publish },
    }) as OrderService;
    const transaction = <T>(work: (tx: RequestContext) => Promise<T>) =>
        wrapper.executeInTransaction(ctx, work, 'auto', undefined, dataSource);
    const expireCache = () => vi.setSystemTime(Date.now() + CACHE_TTL + 1);
    return {
        pool,
        stats,
        channelService,
        orderService,
        order,
        repriced,
        ctx,
        history,
        prices,
        publish,
        loadOrder,
        transaction,
        expireCache,
    };
}

describe('order currency transaction context', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('completes concurrent currency transactions and a health Channel read when the pool is full', async () => {
        const f = await fixture();
        const proceed = deferred();
        type CurrencyResult = Awaited<ReturnType<OrderService['updateOrderCurrency']>>;
        const mutations: Array<Promise<PromiseSettledResult<CurrencyResult>>> = [];
        let health: Promise<PromiseSettledResult<{ status: string }>> | undefined;
        let healthFinished = false;
        try {
            f.loadOrder.mockImplementation(async (_ctx: RequestContext, id: string) => {
                await proceed.promise;
                return new Order({ id, state: 'AddingItems', currencyCode: CurrencyCode.CNY, lines: [] });
            });
            for (let index = 0; index < 10; index++) {
                // Observe errors immediately, then assert every outcome succeeds below.
                mutations.push(
                    f
                        .transaction(tx =>
                            f.orderService.updateOrderCurrency(tx, `order-${index}`, CurrencyCode.MYR),
                        )
                        .then(
                            value => ({ status: 'fulfilled' as const, value }),
                            reason => ({ status: 'rejected' as const, reason }),
                        ),
                );
            }
            // Synthetic setup must finish in one event-loop turn; failures still reach cleanup.
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(f.loadOrder).toHaveBeenCalledTimes(10);
            expect(f.stats.starts).toBe(10);
            expect(f.pool.occupied).toBe(10);
            expect(f.pool.queued).toBe(0);
            f.expireCache();
            // AuthGuard's Channel lookup precedes HealthController, so this read must also recover.
            health = f.channelService.getChannelFromToken('').then(
                () => {
                    healthFinished = true;
                    return { status: 'fulfilled' as const, value: new HealthController().check() };
                },
                reason => ({ status: 'rejected' as const, reason }),
            );
            expect(f.pool.queued).toBe(1);
            proceed.resolve();
            // All synthetic work uses promises; an event-loop turn drains it without a timeout race.
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(f.stats.commits).toBe(10);
            expect(f.stats.releases).toBe(10);
            expect(f.stats.reusedReads).toBe(10);
            expect(f.stats.rollbacks).toBe(0);
            expect(f.pool.occupied).toBe(0);
            expect(f.pool.queued).toBe(0);
            expect(healthFinished).toBe(true);
            expect(await health).toEqual({ status: 'fulfilled', value: { status: 'ok' } });
            expect(await Promise.all(mutations)).toEqual(
                Array.from({ length: 10 }, (_, index) => ({
                    status: 'fulfilled',
                    value: expect.objectContaining({ id: `order-${index}` }),
                })),
            );
        } finally {
            // Release only synthetic slots, including on the pre-fix failure, to leave no pending work.
            proceed.resolve();
            f.pool.releaseAll();
            await Promise.all([...mutations, ...(health ? [health] : [])]);
        }
    });

    it('returns the same-currency order before a stale Channel lookup or mutation side effects', async () => {
        const f = await fixture();
        f.expireCache();
        expect(
            await f.transaction(tx => f.orderService.updateOrderCurrency(tx, f.order.id, CurrencyCode.CNY)),
        ).toBe(f.order);
        expect(f.stats.outsideReads).toBe(1);
        expect(f.stats.reusedReads).toBe(0);
        expect(f.order.currencyCode).toBe(CurrencyCode.CNY);
        expect(f.history).not.toHaveBeenCalled();
        expect(f.prices).not.toHaveBeenCalled();
        expect(f.publish).not.toHaveBeenCalled();
    });

    it('rejects an unsupported currency before changing prices, history or events', async () => {
        const f = await fixture();
        f.expireCache();
        const result = f.transaction(tx =>
            f.orderService.updateOrderCurrency(tx, f.order.id, CurrencyCode.USD),
        );
        await expect(result).rejects.toBeInstanceOf(UserInputError);
        await expect(result).rejects.toMatchObject({ message: 'error.currency-not-available' });
        expect(f.order.currencyCode).toBe(CurrencyCode.CNY);
        expect(f.order.lines[0].unitPrice).toBe(1000);
        expect(f.history).not.toHaveBeenCalled();
        expect(f.prices).not.toHaveBeenCalled();
        expect(f.publish).not.toHaveBeenCalled();
        expect(f.stats.rollbacks).toBe(1);
        expect(f.pool.occupied).toBe(0);
    });

    it('reprices in a copied currency context while preserving the transaction for history and events', async () => {
        const f = await fixture();
        const relations = ['lines'] as const;
        let tx!: RequestContext;
        const result = await f.transaction(current => {
            tx = current;
            return f.orderService.updateOrderCurrency(current, f.order.id, CurrencyCode.MYR, [...relations]);
        });
        expect(result).toBe(f.repriced);
        expect(f.repriced.currencyCode).toBe(CurrencyCode.MYR);
        expect(f.repriced.lines[0].unitPrice).toBe(640);
        expect(f.history).toHaveBeenCalledExactlyOnceWith({
            ctx: tx,
            orderId: f.order.id,
            type: HistoryEntryType.ORDER_CURRENCY_UPDATED,
            data: { previousCurrency: CurrencyCode.CNY, newCurrency: CurrencyCode.MYR },
        });
        expect(f.prices).toHaveBeenCalledOnce();
        const [priceCtx, pricedOrder, lines, requestedRelations] = f.prices.mock.calls[0];
        expect(priceCtx).toBeInstanceOf(RequestContext);
        expect(priceCtx).not.toBe(tx);
        expect(priceCtx.currencyCode).toBe(CurrencyCode.MYR);
        expect(tx.currencyCode).toBe(CurrencyCode.CNY);
        expect(priceCtx.channel).toBe(tx.channel);
        expect((priceCtx as any)[TRANSACTION_MANAGER_KEY]).toBe((tx as any)[TRANSACTION_MANAGER_KEY]);
        expect(pricedOrder).toBe(f.order);
        expect(lines).toBe(f.order.lines);
        expect(requestedRelations).toEqual(relations);
        expect(f.publish).toHaveBeenCalledOnce();
        expect(f.publish.mock.calls[0][0]).toBeInstanceOf(OrderEvent);
        expect(f.publish.mock.calls[0][0]).toMatchObject({ ctx: tx, entity: f.repriced, type: 'updated' });
        expect(f.stats.commits).toBe(1);
        expect(f.pool.occupied).toBe(0);
    });
});
