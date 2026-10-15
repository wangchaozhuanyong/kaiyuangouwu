import { CustomerHistoryEntry, NativeAuthenticationMethod, User } from '@vendure/core';
import { DataSource, EntityManager, EntitySchema } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataSubjectVerificationService } from './data-subject-verification.service';

interface ProofHistory {
    id: number;
    createdAt: Date;
    updatedAt: Date;
    type: string;
    isPublic: boolean;
    data: Record<string, unknown>;
    customer: { id: string };
}

const schemas = [
    new EntitySchema({
        name: 'ProofUser',
        columns: { id: { type: String, primary: true }, deletedAt: { type: Date, nullable: true } },
    }),
    new EntitySchema({ name: 'ProofCustomer', columns: { id: { type: String, primary: true } } }),
    new EntitySchema<ProofHistory>({
        name: 'ProofHistory',
        columns: {
            id: { type: Number, primary: true, generated: true },
            createdAt: { type: Date, createDate: true },
            updatedAt: { type: Date, updateDate: true },
            type: { type: String },
            isPublic: { type: Boolean },
            data: { type: 'simple-json' },
        },
        relations: {
            customer: { type: 'many-to-one', target: 'ProofCustomer', joinColumn: { name: 'customerId' } },
        },
    }),
];
type Ctx = { activeUserId: string; channelId: string; session: { id: string }; manager?: EntityManager };
const ctx: Ctx = { activeUserId: 'user-1', channelId: 'store-a', session: { id: 'session-a' } };
const port = Number(process.env.CLOSEOUT_MYSQL_PORT);
const mysql = process.env.CLOSEOUT_MYSQL_PORT !== undefined;
describe(mysql ? 'privacy proof real MySQL concurrency' : 'privacy proof SQLjs durable state', () => {
    let db: DataSource;
    let native = false;
    let customerId = 'customer-1';
    let service: DataSubjectVerificationService;
    let serial = Promise.resolve();
    const strategy = {
        name: 'google',
        customerActionClientId: vi.fn(() => Promise.resolve('123-test.apps.googleusercontent.com')),
        verifyCustomerAction: vi.fn(() => Promise.resolve(true)),
    };
    beforeAll(async () => {
        if (mysql && (!Number.isInteger(port) || port < 1024 || port > 65535))
            throw Error('Requires isolated local MySQL port');
        db = new DataSource(
            mysql
                ? {
                      type: 'mysql',
                      host: '127.0.0.1',
                      port,
                      username: 'root',
                      database: 'prelaunch_closeout_20261014',
                      timezone: 'Z',
                      entities: schemas,
                      synchronize: true,
                  }
                : { type: 'sqljs', entities: schemas, synchronize: true },
        );
        await db.initialize();
        const connection = {
            rawConnection: db,
            getRepository: (request: Ctx, target: { name: string }) => {
                const manager = request.manager || db.manager;
                if (target === User)
                    return {
                        findOne: () =>
                            Promise.resolve(
                                new User({
                                    id: request.activeUserId,
                                    deletedAt: null,
                                    authenticationMethods: native
                                        ? [new NativeAuthenticationMethod({ id: 'native' })]
                                        : [{ strategy: 'google' } as never],
                                }),
                            ),
                        createQueryBuilder: (alias: string) =>
                            manager.getRepository('ProofUser').createQueryBuilder(alias),
                    };
                return manager.getRepository(target === CustomerHistoryEntry ? 'ProofHistory' : target.name);
            },
            withTransaction: (request: Ctx, work: (tx: Ctx) => Promise<unknown>) => {
                const run = () => db.transaction(manager => work({ ...request, manager }));
                if (mysql) return run();
                const result = serial.then(run, run);
                serial = result.then(
                    () => undefined,
                    () => undefined,
                );
                return result;
            },
        };
        service = new DataSubjectVerificationService(
            connection as never,
            { findOneByUserId: () => Promise.resolve({ id: customerId, deletedAt: null }) } as never,
            { authOptions: { shopAuthenticationStrategy: [strategy] } } as never,
        );
    });
    beforeEach(async () => {
        vi.useRealTimers();
        native = false;
        customerId = 'customer-1';
        strategy.verifyCustomerAction.mockResolvedValue(true);
        strategy.verifyCustomerAction.mockClear();
        await db.getRepository('ProofHistory').clear();
        await db.getRepository('ProofUser').save({ id: 'user-1', deletedAt: null });
        await db.getRepository('ProofCustomer').save([{ id: 'customer-1' }, { id: 'customer-2' }]);
    });
    afterEach(() => vi.useRealTimers());
    afterAll(async () => db?.destroy());
    const start = () => service.start(ctx as never, 'ACCOUNT_CLOSURE');
    const proof = (challenge: any) => ({
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        credential: 'signed-proof',
    });
    it('retains native password verification without issuing a provider challenge', async () => {
        native = true;
        expect(await start()).toMatchObject({ mode: 'PASSWORD', challengeId: null });
        expect(await db.getRepository('ProofHistory').count()).toBe(0);
    });
    it('stores only private digests and consumes once', async () => {
        const challenge = await start();
        expect(challenge).toMatchObject({ mode: 'GOOGLE' });
        const rows = await db.getRepository('ProofHistory').find();
        expect(rows[0].isPublic).toBe(false);
        const text = JSON.stringify(rows);
        expect(text).not.toContain(challenge.challengeId);
        expect(text).not.toContain(challenge.nonce);
        expect(text).not.toContain('signed-proof');
        await service.consume(ctx as never, 'ACCOUNT_CLOSURE', proof(challenge));
        await expect(service.consume(ctx as never, 'ACCOUNT_CLOSURE', proof(challenge))).rejects.toThrow(
            '身份确认',
        );
    });
    it('allows exactly one concurrent consumer across separate transactions', async () => {
        const challenge = await start();
        const results = await Promise.allSettled([
            service.consume(ctx as never, 'ACCOUNT_CLOSURE', proof(challenge)),
            service.consume(ctx as never, 'ACCOUNT_CLOSURE', proof(challenge)),
        ]);
        expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    });
    it.each(['action', 'session', 'store', 'customer', 'nonce'])(
        'rejects a proof bound to another %s',
        async scenario => {
            const challenge = await start();
            const other = { ...ctx, session: { ...ctx.session } };
            if (scenario === 'session') other.session.id = 'session-b';
            if (scenario === 'store') other.channelId = 'store-b';
            if (scenario === 'customer') customerId = 'customer-2';
            const input = proof(challenge);
            if (scenario === 'nonce') input.nonce = 'x'.repeat(43);
            await expect(
                service.consume(other as never, scenario === 'action' ? 'EXPORT' : 'ACCOUNT_CLOSURE', input),
            ).rejects.toThrow('身份确认');
            expect(strategy.verifyCustomerAction).not.toHaveBeenCalled();
        },
    );
    it('rejects an expired challenge and invalid provider proof without consuming it', async () => {
        const challenge = await start();
        strategy.verifyCustomerAction.mockResolvedValue(false);
        await expect(service.consume(ctx as never, 'ACCOUNT_CLOSURE', proof(challenge))).rejects.toThrow(
            '身份确认',
        );
        expect((await db.getRepository('ProofHistory').find())[0].data.consumed).toBe(false);
        const rows = await db.getRepository('ProofHistory').find();
        rows[0].data.expiresAt = Date.now() - 1;
        await db.getRepository('ProofHistory').save(rows);
        strategy.verifyCustomerAction.mockClear();
        await expect(service.consume(ctx as never, 'ACCOUNT_CLOSURE', proof(challenge))).rejects.toThrow(
            '身份确认',
        );
        expect(strategy.verifyCustomerAction).not.toHaveBeenCalled();
    });
    it('limits requests before creating replacement challenge rows', async () => {
        await start();
        await expect(start()).rejects.toThrow('频繁');
        expect(await db.getRepository('ProofHistory').count()).toBe(1);
    });
});
