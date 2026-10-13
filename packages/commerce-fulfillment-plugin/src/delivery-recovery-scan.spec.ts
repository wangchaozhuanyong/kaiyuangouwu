import { ConfigService } from '@vendure/core';
import { DataSource, EntitySchema, In, LessThanOrEqual } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileAutoCardDeliveriesTask } from './auto-card-tasks';
import { AutoCardService } from './auto-card.service';
import { DeliveryRecoveryCursors, scanDeliveryRecoveryPage } from './delivery-recovery-scan';
import { reconcileManualDigitalDeliveriesTask } from './manual-digital-delivery-tasks';
import { ManualDigitalDeliveryService } from './manual-digital-delivery.service';

interface Candidate {
    id: number;
    createdAt: Date;
    state: string;
    attemptCount: number;
    lastDispatchedAt: Date | null;
    expectedAt: Date;
    fulfillmentId: string | null;
    channelId: string;
    channel: { id: string };
}
const channel = new EntitySchema({
    name: 'RecoveryChannel',
    columns: { id: { type: String, primary: true } },
});
const candidate = new EntitySchema<Candidate>({
    name: 'RecoveryDelivery',
    columns: {
        id: { type: Number, primary: true },
        createdAt: { type: Date },
        state: { type: String },
        attemptCount: { type: Number },
        lastDispatchedAt: { type: Date, nullable: true },
        expectedAt: { type: Date },
        fulfillmentId: { type: String, nullable: true },
        channelId: { type: String },
    },
    relations: {
        channel: { type: 'many-to-one', target: 'RecoveryChannel', joinColumn: { name: 'channelId' } },
    },
});
const database = new DataSource({ type: 'sqljs', entities: [channel, candidate], synchronize: true });

describe('durable bounded digital-delivery recovery pages', () => {
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    beforeAll(async () => {
        await database.initialize();
        await database.getRepository(channel).save([{ id: 'store-a' }, { id: 'store-b' }]);
    });
    beforeEach(async () => {
        await database.getRepository(candidate).createQueryBuilder().delete().execute();
    });
    afterAll(async () => {
        if (database.isInitialized) await database.destroy();
    });
    function row(id: number, state: string, channelId = 'store-a'): Candidate {
        return {
            id,
            createdAt: timestamp,
            state,
            attemptCount: 0,
            lastDispatchedAt: null,
            expectedAt: timestamp,
            fulfillmentId: null,
            channelId,
            channel: { id: channelId },
        };
    }

    it('preserves raw microseconds and reaches a different store behind 200 same-time blocked rows', async () => {
        const repository = database.getRepository(candidate);
        await repository.save([
            ...Array.from({ length: 200 }, (_, i) => row(i + 1, 'WAITING_STOCK')),
            row(201, 'WAITING_STOCK', 'store-b'),
        ]);
        const rawTimestamp = '2026-01-01 00:00:00.123456';
        await repository
            .createQueryBuilder()
            .update()
            .set({ createdAt: () => "'2026-01-01 00:00:00.123456'" })
            .execute();
        let cursors: DeliveryRecoveryCursors = {};
        const visited: number[] = [];
        for (let run = 0; run < 4; run++) {
            // Rehydrate, as when the next invocation runs in a different worker process.
            cursors = JSON.parse(JSON.stringify(cursors));
            const page = await scanDeliveryRecoveryPage(
                repository,
                [{ state: 'WAITING_STOCK' }],
                cursors,
                'stock',
                66,
                { channel: true },
            );
            expect(page.length).toBeLessThanOrEqual(66);
            expect(cursors.stock?.createdAt).toBe(rawTimestamp);
            visited.push(...page.map(item => item.id));
        }
        expect(visited).toEqual(Array.from({ length: 201 }, (_, i) => i + 1));
        const wrap = await scanDeliveryRecoveryPage(
            repository,
            [{ state: 'WAITING_STOCK' }],
            cursors,
            'stock',
            66,
            { channel: true },
        );
        expect(wrap[0].id).toBe(1);
    });

    it('wraps to a previously ineligible retry behind the cursor when it becomes due', async () => {
        const repository = database.getRepository(candidate);
        await repository.save([row(1, 'RETRYING'), row(2, 'RETRYING')]);
        await repository.update({ id: 1 }, { lastDispatchedAt: new Date('2099-01-01') });
        const criteria = [{ state: 'RETRYING', lastDispatchedAt: LessThanOrEqual(new Date('2026-01-01')) }];
        await repository.update({ id: 2 }, { lastDispatchedAt: timestamp });
        const cursors: DeliveryRecoveryCursors = {};
        expect(
            (await scanDeliveryRecoveryPage(repository, criteria, cursors, 'email', 67, {})).map(
                item => item.id,
            ),
        ).toEqual([2]);
        await repository.update({ id: 1 }, { lastDispatchedAt: timestamp });
        expect(
            (await scanDeliveryRecoveryPage(repository, criteria, cursors, 'email', 67, {})).map(
                item => item.id,
            ),
        ).toEqual([1, 2]);
    });

    it.each(['manual', 'auto'] as const)(
        '%s separates retry and fulfillment from 200 blocked tasks and queries only due retries',
        async kind => {
            const repository = database.getRepository(candidate);
            await repository.save([
                ...Array.from({ length: 200 }, (_, i) =>
                    row(i + 1, kind === 'manual' ? 'DRAFT' : 'WAITING_STOCK'),
                ),
                row(201, kind === 'manual' ? 'EMAIL_FAILED' : 'RETRYING', 'store-b'),
                row(202, 'SENT', 'store-b'),
                { ...row(203, kind === 'manual' ? 'SENDING' : 'RETRYING'), lastDispatchedAt: new Date() },
                { ...row(204, kind === 'manual' ? 'EMAIL_FAILED' : 'RETRYING'), attemptCount: 5 },
            ]);
            const service = Object.create(
                kind === 'manual' ? ManualDigitalDeliveryService.prototype : AutoCardService.prototype,
            );
            const visited: number[] = [];
            let locked = false;
            const lock = async (id: number) => {
                expect(locked).toBe(true);
                visited.push(id);
                const item = await repository.findOneByOrFail({ id });
                return Object.assign(item, {
                    order: {
                        state: 'PaymentSettled',
                        active: false,
                        payments: [{ state: 'Settled', method: 'real-provider', amount: 1000, refunds: [] }],
                    },
                    orderLine: { id: 'line-1', quantity: 1 },
                });
            };
            service.connection = {
                rawConnection: { getRepository: () => repository },
                getRepository: () => repository,
                withTransaction: async (_ctx: unknown, callback: any) => {
                    locked = true;
                    try {
                        return await callback({});
                    } finally {
                        locked = false;
                    }
                },
            };
            service.requestContextService = {
                create: (options: any) => Promise.resolve({ channelId: options.channelOrToken.id }),
            };
            service.completeFulfillment = vi.fn(async (_ctx: unknown, item: Candidate) => {
                item.fulfillmentId = 'done';
                await repository.save(item);
            });
            if (kind === 'manual') {
                service.withLockedDelivery = async (_ctx: unknown, id: number, callback: any) => {
                    locked = true;
                    try {
                        return await callback({}, await lock(id));
                    } finally {
                        locked = false;
                    }
                };
                service.publishOverdue = vi.fn(() => Promise.resolve());
                service.addEvent = vi.fn(() => Promise.resolve());
                service.eventBus = { publish: vi.fn(() => Promise.resolve()) };
            } else {
                service.lockDeliveryOrThrow = async (_ctx: unknown, id: number) => lock(id);
                service.allocateExistingDelivery = vi.fn((_ctx: unknown, item: Candidate) =>
                    Promise.resolve(item),
                );
                service.dispatch = vi.fn(async (_ctx: unknown, item: Candidate) => {
                    item.lastDispatchedAt = new Date();
                    await repository.save(item);
                });
            }
            const first = await service.reconcilePending({});
            expect(first.redispatched).toBe(1);
            expect(first.completedFulfillments).toBe(1);
            expect(visited).toContain(201);
            expect(visited).toContain(202);
            expect(visited).not.toContain(203);
            expect(visited).not.toContain(204);
            expect(visited.length).toBeLessThanOrEqual(200);
            if (kind === 'manual') expect(service.eventBus.publish).toHaveBeenCalledTimes(1);
            else expect(service.dispatch).toHaveBeenCalledTimes(1);
        },
    );

    it.each(['manual', 'auto'] as const)(
        '%s scheduled task resumes the durable cursor after worker replacement',
        async kind => {
            const task =
                kind === 'manual' ? reconcileManualDigitalDeliveriesTask : reconcileAutoCardDeliveriesTask;
            const serviceType = kind === 'manual' ? ManualDigitalDeliveryService : AutoCardService;
            let lastResult: any = { scanCursors: { email: { createdAt: timestamp.toISOString(), id: 67 } } };
            const received: number[] = [];
            for (let worker = 0; worker < 2; worker++) {
                const injector = {
                    get: (type: unknown) => {
                        if (type === ConfigService)
                            return {
                                schedulerOptions: {
                                    schedulerStrategy: {
                                        getTask: (id: string) => {
                                            expect(id).toBe(task.id);
                                            return Promise.resolve({
                                                lastResult: JSON.parse(JSON.stringify(lastResult)),
                                            });
                                        },
                                    },
                                },
                            };
                        if (type === serviceType)
                            return {
                                reconcilePending: (cursors: DeliveryRecoveryCursors) => {
                                    received.push(Number(cursors.email?.id));
                                    cursors.email = {
                                        createdAt: timestamp.toISOString(),
                                        id: Number(cursors.email?.id) + 67,
                                    };
                                    return Promise.resolve({ redispatched: 0, completedFulfillments: 0 });
                                },
                            };
                        throw new Error('Unexpected dependency');
                    },
                };
                lastResult = await task.options.execute({
                    injector: injector as any,
                    scheduledContext: {} as any,
                    params: {},
                });
            }
            expect(received).toEqual([67, 134]);
            expect(lastResult.scanCursors.email.id).toBe(201);
            expect(task.options.preventOverlap).not.toBe(false);
        },
    );

    it('ignores a malformed persisted cursor safely without skipping queued rows', async () => {
        const repository = database.getRepository(candidate);
        await repository.save([row(1, 'WAITING_STOCK')]);
        const page = await scanDeliveryRecoveryPage(
            repository,
            [{ state: In(['WAITING_STOCK']) }],
            { stock: { createdAt: 'broken', id: 99 } },
            'stock',
            66,
            {},
        );
        expect(page.map(item => item.id)).toEqual([1]);
    });
});
