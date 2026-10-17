import { ExecutionContext } from '@nestjs/common';
import {
    ConfigService,
    internal_setRequestContext,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { AdminNotificationService } from '@vendure/operations-dashboard-plugin';
import { Request, Response } from 'express';
import { buildSchema, graphql, GraphQLResolveInfo } from 'graphql';
import { createHmac, randomBytes } from 'node:crypto';
import 'reflect-metadata';
import { firstValueFrom, of } from 'rxjs';
import sharp from 'sharp';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddShopAbuseProtection1792180800000 } from '../../../dev-server/migrations/1792180800000-add-shop-abuse-protection';

import { ShopAbuseBucket, ShopAbuseChallenge } from './entities';
import { ShopAbuseInterceptor } from './interceptor';
import { cooldownMs, protectedOperation, riskWindow } from './policy';
import { ShopAbuseProtectionService } from './service';
import { ShopAbuseStore } from './store';

const secret = 'synthetic-test-signing-secret-never-used-live';
const digest = (...parts: string[]) =>
    createHmac('sha256', secret)
        .update(JSON.stringify(['shop-abuse-v1', ...parts]))
        .digest('hex');
const base = {
    id: { type: Number, primary: true, generated: true },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
} as const;
const schemas = [
    new EntitySchema({
        name: 'ShopAbuseBucket',
        target: ShopAbuseBucket,
        tableName: 'shop_abuse_bucket',
        columns: {
            ...base,
            bucket: { type: String },
            attempts: { type: Number },
            expiresAt: { type: Date },
            blockedUntil: { type: Date, nullable: true },
        },
    }),
    new EntitySchema({
        name: 'ShopAbuseChallenge',
        target: ShopAbuseChallenge,
        tableName: 'shop_abuse_challenge',
        columns: {
            ...base,
            publicId: { type: String },
            bindingHash: { type: String },
            answerDigest: { type: String },
            expiresAt: { type: Date },
            consumedAt: { type: Date, nullable: true },
        },
    }),
];
type TestContext = RequestContext & { req: Request & { ip: string; res: Response } };
function context(ip = '203.0.113.2', channelId = '1', headers = {}): TestContext {
    return {
        channelId,
        apiType: 'shop',
        req: { ip, headers, res: { setHeader: vi.fn() } },
    } as unknown as TestContext;
}
const op = (field = 'login', username = 'person@example.test') => {
    const result = protectedOperation(
        field,
        field.includes('Gpt')
            ? { code: username }
            : { username, input: { emailAddress: username }, emailAddress: username },
    );
    if (!result) throw new Error('Unknown test operation');
    return result;
};

describe('shared shop security admission and GraphQL boundary', () => {
    let db: DataSource;
    let store: ShopAbuseStore;
    let service: ShopAbuseProtectionService;
    let notifications: { upsertIncident: ReturnType<typeof vi.fn> };
    beforeEach(async () => {
        db = await new DataSource({ type: 'sqljs', entities: schemas, synchronize: false }).initialize();
        await new AddShopAbuseProtection1792180800000().up(db.createQueryRunner());
        store = new ShopAbuseStore({ rawConnection: db } as TransactionalConnection);
        notifications = { upsertIncident: vi.fn().mockResolvedValue(null) };
        service = new ShopAbuseProtectionService(
            store,
            { authOptions: { cookieOptions: { secret } } } as ConfigService,
            notifications as unknown as AdminNotificationService,
        );
    });
    afterEach(async () => {
        await db.destroy();
        vi.restoreAllMocks();
    });
    async function seedProof(
        ctx: TestContext,
        action = 'LOGIN',
        target = 'person@example.test',
        answer = 'ABC234',
    ) {
        const id = randomBytes(24).toString('hex');
        const bindingHash = digest('challenge-binding', String(ctx.channelId), ctx.req.ip, action, target);
        await store.createChallenge({
            publicId: id,
            bindingHash,
            answerDigest: digest('challenge-answer', id, answer),
            expiresAt: new Date(Date.now() + 120_000),
        });
        Object.assign(ctx.req.headers, { 'x-shop-abuse-id': id, 'x-shop-abuse-answer': answer });
        return id;
    }
    it('leaves ordinary attempts free of a challenge, then protects the same target across IP rotation', async () => {
        for (let n = 2; n < 5; n++) {
            const admitted = await service.before(context(`203.0.113.${n}`), op());
            await service.failed(admitted);
        }
        await expect(
            service.before(context('203.0.113.8'), op('login', ' PERSON@EXAMPLE.TEST ')),
        ).rejects.toMatchObject({ code: 'SHOP_ABUSE_CHALLENGE_REQUIRED' });
        const good = context('203.0.113.9');
        await seedProof(good);
        await expect(service.before(good, op())).resolves.toMatchObject({ operation: { action: 'LOGIN' } });
        await expect(service.before(good, op())).rejects.toMatchObject({
            code: 'SHOP_ABUSE_CHALLENGE_INVALID',
        });
    });
    it('a wrong answer burns the proof and changing store, action, source or target cannot borrow it', async () => {
        const ctx = context();
        const id = await seedProof(ctx);
        for (const changed of [
            context('203.0.113.3', '1', ctx.req.headers),
            context('203.0.113.2', '2', ctx.req.headers),
        ]) {
            await expect(service.before(changed, op())).rejects.toMatchObject({
                code: 'SHOP_ABUSE_CHALLENGE_INVALID',
            });
        }
        await expect(service.before(ctx, op('requestPasswordReset'))).rejects.toMatchObject({
            code: 'SHOP_ABUSE_CHALLENGE_INVALID',
        });
        await expect(service.before(ctx, op('login', 'other@example.test'))).rejects.toMatchObject({
            code: 'SHOP_ABUSE_CHALLENGE_INVALID',
        });
        ctx.req.headers['x-shop-abuse-answer'] = 'WRONG2';
        await expect(service.before(ctx, op())).rejects.toMatchObject({
            code: 'SHOP_ABUSE_CHALLENGE_INVALID',
        });
        ctx.req.headers['x-shop-abuse-answer'] = 'ABC234';
        await expect(service.before(ctx, op())).rejects.toMatchObject({
            code: 'SHOP_ABUSE_CHALLENGE_INVALID',
        });
        expect(
            (await db.getRepository(ShopAbuseChallenge).findOneByOrFail({ publicId: id })).consumedAt,
        ).toBeInstanceOf(Date);
    });
    it('verify and query share one budget, and a valid proof does not reset request limits', async () => {
        const ctx = context();
        for (let n = 0; n < 20; n++)
            await service.before(
                ctx,
                op(n % 2 ? 'queryGptRechargeCode' : 'verifyGptRechargeCode', `synthetic-${n}`),
            );
        await seedProof(ctx, 'RECHARGE_CODE', 'SYNTHETIC-LAST');
        await expect(
            service.before(ctx, op('verifyGptRechargeCode', 'synthetic-last')),
        ).rejects.toMatchObject({ code: 'SHOP_ABUSE_RATE_LIMITED' });
        await expect(
            service.before(context('203.0.113.3'), op('verifyGptRechargeCode', 'synthetic-last')),
        ).resolves.toBeDefined();
    });
    it('switching storefronts cannot reset shared account risk or source budgets', async () => {
        for (let n = 0; n < 3; n++) {
            await service.failed(await service.before(context(`203.0.113.${n + 2}`, String(n + 1)), op()));
        }
        await expect(service.before(context('198.51.100.9', '4'), op())).rejects.toMatchObject({
            code: 'SHOP_ABUSE_CHALLENGE_REQUIRED',
        });
        for (let n = 0; n < 20; n++)
            await service.before(
                context('198.51.100.50', String(n + 1)),
                op('login', `unrelated${n}@example.test`),
            );
        await expect(
            service.before(context('198.51.100.50', '21'), op('login', 'new@example.test')),
        ).rejects.toMatchObject({ code: 'SHOP_ABUSE_RATE_LIMITED' });
    });
    it('adds target and overall failure risk without permanently locking the victim account', async () => {
        const admission = await service.before(context(), op());
        for (let n = 0; n < 8; n++) await service.failed(admission);
        await expect(service.before(context(), op())).rejects.toMatchObject({
            code: 'SHOP_ABUSE_RATE_LIMITED',
            extensions: { retryAfterSeconds: 30 },
        });
        const owner = context('203.0.113.10');
        await seedProof(owner);
        await expect(service.before(owner, op())).resolves.toBeDefined();
        expect(cooldownMs(8)).toBe(30_000);
        expect(cooldownMs(16)).toBe(120_000);
        expect(cooldownMs(30)).toBe(900_000);
        expect(notifications.upsertIncident).toHaveBeenCalledTimes(1);
        const alert = JSON.stringify(notifications.upsertIncident.mock.calls);
        for (const raw of ['person@example.test', '203.0.113.2', 'ABC234']) expect(alert).not.toContain(raw);
    });
    it('email sending protection is identical for existing and nonexistent addresses', async () => {
        const ctx = context();
        for (let n = 0; n < 2; n++) await service.before(ctx, op('requestPasswordReset'));
        await expect(service.before(ctx, op('requestPasswordReset'))).rejects.toMatchObject({
            code: 'SHOP_ABUSE_CHALLENGE_REQUIRED',
        });
        await expect(
            service.before(context('203.0.113.8'), op('requestPasswordReset')),
        ).rejects.toMatchObject({ code: 'SHOP_ABUSE_CHALLENGE_REQUIRED' });
    });
    it('distributed failures eventually require a challenge even for new targets and new sources', async () => {
        const admission = await service.before(context(), op('verifyGptRechargeCode'));
        // Accumulate the shared signal directly to isolate the distributed policy from per-source limits.
        for (let n = 0; n < 50; n++) await store.signal(admission.globalHash, 60_000);
        await expect(
            service.before(context('198.51.100.12'), op('verifyGptRechargeCode', 'fresh-code')),
        ).rejects.toMatchObject({ code: 'SHOP_ABUSE_CHALLENGE_REQUIRED' });
        await expect(
            service.before(context('198.51.100.12', '2'), op('verifyGptRechargeCode', 'fresh-code')),
        ).resolves.toBeDefined();
    });
    it('distributed registration and email requests require a challenge at high volume even without business failures', async () => {
        for (let n = 0; n < 29; n++)
            await service.before(
                context(`198.51.100.${n + 1}`, String(n + 1)),
                op(
                    n % 2 ? 'registerCustomerWithReferral' : 'requestPasswordReset',
                    `synthetic${n}@example.test`,
                ),
            );
        await expect(
            service.before(
                context('198.51.100.80', '40'),
                op('registerCustomerWithReferral', 'fresh@example.test'),
            ),
        ).rejects.toMatchObject({ code: 'SHOP_ABUSE_CHALLENGE_REQUIRED' });
    });
    it('creates raster PNG only, persists keyed digests, and bounds image creation', async () => {
        const result = await service.challenge(context(), 'LOGIN', 'person@example.test');
        expect(result.imageDataUrl).toMatch(/^data:image\/png;base64,/);
        const png = Buffer.from(result.imageDataUrl.split(',')[1], 'base64');
        expect((await sharp(png).metadata()).format).toBe('png');
        expect(Object.keys(result).sort()).toEqual(['expiresAt', 'id', 'imageDataUrl']);
        const row = await db.getRepository(ShopAbuseChallenge).findOneByOrFail({ publicId: result.id });
        expect(row.answerDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(row.bindingHash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(await db.getRepository(ShopAbuseBucket).find())).not.toContain('203.0.113.2');
        expect(JSON.stringify(row)).not.toContain('person@example.test');
        for (let n = 1; n < 10; n++) await service.challenge(context(), 'LOGIN', 'person@example.test');
        await expect(service.challenge(context(), 'LOGIN', 'person@example.test')).rejects.toMatchObject({
            code: 'SHOP_ABUSE_RATE_LIMITED',
        });
    });
    it('fails closed on unavailable shared storage or an untrusted/missing source', async () => {
        vi.spyOn(store, 'consume').mockRejectedValueOnce(new Error('secret database location'));
        await expect(service.before(context(), op())).rejects.toMatchObject({
            code: 'SHOP_ABUSE_UNAVAILABLE',
        });
        await expect(service.before(context('invalid'), op())).rejects.toMatchObject({
            code: 'SHOP_ABUSE_UNAVAILABLE',
        });
    });
    it('charges real GraphQL fields behind aliases/operation names and stops execution before any business call', async () => {
        const interceptor = new ShopAbuseInterceptor(service);
        const setHeader = vi.fn();
        const resolver = vi.fn(() => ({ errorCode: 'INVALID_CREDENTIALS' }));
        const schema = buildSchema(
            'type Result { errorCode: String } type Query { ok: Boolean } type Mutation { login(username: String!): Result }',
        );
        const ctx = context();
        ctx.req.res.setHeader = setHeader;
        const rootValue = {
            login: async (args: Record<string, string>, _ctx: unknown, info: GraphQLResolveInfo) => {
                const handler = () => undefined;
                const nestArgs = [null, args, { req: ctx.req, res: ctx.req.res }, info];
                const execution = {
                    getType: () => 'graphql',
                    getHandler: () => handler,
                    getClass: () => class {},
                    getArgs: () => nestArgs,
                    getArgByIndex: (n: number) => nestArgs[n],
                } as unknown as ExecutionContext;
                internal_setRequestContext(ctx.req, ctx, execution);
                return firstValueFrom(
                    await interceptor.intercept(execution, { handle: () => of(Promise.resolve(resolver())) }),
                );
            },
        };
        const result = await graphql({
            schema,
            rootValue,
            source: `mutation harmlessCatalogRead {
                a: login(username:"person@example.test") {errorCode}
                b: login(username:"person@example.test") {errorCode}
                c: login(username:"person@example.test") {errorCode}
                d: login(username:"person@example.test") {errorCode}
            }`,
        });
        expect(resolver).toHaveBeenCalledTimes(3);
        expect(result.errors?.[0].extensions.code).toBe('SHOP_ABUSE_CHALLENGE_REQUIRED');
        expect(result.data?.d).toBeNull();
        expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
    it('post-execution accounting failure does not misreport an already executed write as a preflight rejection', async () => {
        const admission = await service.before(context(), op());
        vi.spyOn(store, 'signal').mockRejectedValueOnce(new Error('db unavailable'));
        await expect(service.observeFailure(admission)).resolves.toBeUndefined();
        expect(riskWindow).toBe(600_000);
    });
});

describe('complete schema operation mapping', () => {
    it.each([
        'login',
        'authenticate',
        'registerCustomerAccount',
        'registerCustomerWithReferral',
        'refreshCustomerVerification',
        'requestPasswordReset',
        'resetPassword',
        'verifyCustomerAccount',
        'updateCustomerPassword',
        'requestUpdateCustomerEmailAddress',
        'updateCustomerEmailAddress',
        'verifyGptRechargeCode',
        'queryGptRechargeCode',
        'submitGptRecharge',
        'gptRechargeConfig',
        'gptRechargeTask',
    ])('%s is protected at its actual root field', field =>
        expect(protectedOperation(field, {})).not.toBeNull(),
    );
    it('does not aggregate all Google users into one target failure counter', () =>
        expect(
            protectedOperation('authenticate', { input: { google: { token: 'synthetic' } } }),
        ).toMatchObject({ action: 'LOGIN', target: 'oauth:google', targetRisk: false }));
    it('does not take client-supplied action overrides or process unprotected fields', () =>
        expect(protectedOperation('products', { action: 'LOGIN' })).toBeNull());
    it('uses the authenticated owner identity for current-password checks, never a submitted user ID', () => {
        expect(
            protectedOperation('updateCustomerPassword', { userId: 'victim' }, 'actual-owner'),
        ).toMatchObject({ action: 'PASSWORD_UPDATE', target: 'user:actual-owner' });
        expect(protectedOperation('requestUpdateCustomerEmailAddress', { userId: 'victim' })).toMatchObject({
            target: '',
            targetRisk: false,
        });
    });
});
