import { RequestContext, TransactionalConnection } from '@vendure/core';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddGptRecharge1792152000000 } from '../../../dev-server/migrations/1792152000000-add-gpt-recharge';

import { GptRechargeConfig, GptRechargeReceipt } from './entities';
import { GptRechargeShopResolver } from './plugin';
import {
    allowedRechargeOrigin,
    openRechargeSecret,
    rechargeCredentialMatches,
    sealRechargeSecret,
    validateRechargeSession,
} from './security';
import { GptRechargeService } from './service';
const source = 'https://executor.example.test';
const key = 'synthetic-service-credential-for-test-only';
const session = JSON.stringify({
    user: { id: 'demo', email: 'demo@example.test' },
    accessToken: 'synthetic-not-a-real-access-token',
});
const upstream = {
    id: '11111111-1111-4111-8111-111111111111',
    taskToken: 'synthetic-task-token',
    plan: 'plus',
    status: 'queued',
    updatedAt: '2026-10-16T10:00:00.000Z',
    result: { url: source, card: 'private' },
};
const ctx = (channelId = 1) =>
    ({ channelId, req: { ip: '203.0.113.10', res: { setHeader: vi.fn() } } }) as unknown as RequestContext;
const base = {
    id: { type: Number, primary: true, generated: true },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
    channelId: { type: Number },
    revision: { type: Number, default: 0 },
} as const;
const schemas = [
    new EntitySchema({
        name: 'GptRechargeConfig',
        target: GptRechargeConfig,
        tableName: 'gpt_recharge_config',
        columns: {
            ...base,
            enabled: { type: Boolean },
            upstreamOrigin: { type: String },
            encryptedServiceKey: { type: String },
        },
    }),
    new EntitySchema({
        name: 'GptRechargeReceipt',
        target: GptRechargeReceipt,
        tableName: 'gpt_recharge_receipt',
        columns: {
            ...base,
            publicId: { type: String },
            codeFingerprint: { type: String },
            status: { type: String },
            plan: { type: String },
            encryptedUpstreamTask: { type: String, nullable: true },
            upstreamUpdatedAt: { type: Date, nullable: true },
        },
    }),
];
describe('GPT recharge real SQL migration and service boundary', () => {
    let db: DataSource;
    let service: GptRechargeService;
    let remote: typeof upstream | null;
    let plan: string;
    let mode: string;
    let submits: number;
    let access: { assertEnabled: ReturnType<typeof vi.fn>; isEnabled: ReturnType<typeof vi.fn> };
    beforeEach(async () => {
        vi.stubEnv('GPT_RECHARGE_ENCRYPTION_KEY', 'ab'.repeat(32));
        vi.stubEnv('GPT_RECHARGE_ALLOWED_ORIGINS', source);
        db = await new DataSource({ type: 'sqljs', entities: schemas, synchronize: false }).initialize();
        await new AddGptRecharge1792152000000().up(db.createQueryRunner());
        access = {
            assertEnabled: vi.fn().mockResolvedValue(undefined),
            isEnabled: vi.fn().mockResolvedValue(true),
        };
        service = new GptRechargeService(
            { getRepository: (_ctx, entity) => db.getRepository(entity) } as TransactionalConnection,
            access as never,
        );
        await service.saveConfig(ctx(), {
            enabled: true,
            upstreamOrigin: source,
            serviceKey: key,
            expectedRevision: -1,
        });
        remote = null;
        plan = 'plus';
        mode = 'ok';
        submits = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string, init: RequestInit) => {
                const action = url.split('/').at(-1);
                if (action === 'config')
                    return Promise.resolve(Response.json({ maintenance: false, supplier: source }));
                if (action === 'query' || action === 'verify')
                    return Promise.resolve(
                        Response.json({ plan, status: remote ? 'reserved' : 'available', task: remote }),
                    );
                if (action === 'task') return Promise.resolve(Response.json(remote ?? upstream));
                submits++;
                expect(Object.keys(JSON.parse(init.body as string)).sort()).toEqual(['code', 'session']);
                if (mode === 'unknown') return Promise.reject(new Error(`transport ${source} ${key}`));
                if (mode === 'rejected') return Promise.resolve(Response.json({ rejected: true }));
                remote = { ...upstream, plan };
                return Promise.resolve(Response.json(remote));
            }),
        );
    });
    afterEach(async () => {
        await db?.destroy();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });
    it.each(['plus', 'pro_5x', 'pro_20x'])(
        'uses code-bound %s and stores no plaintext credentials',
        async value => {
            plan = value;
            const result = await service.submit(ctx(), 'fixture-code', session);
            expect(result.plan).toBe(plan);
            expect(result.id).not.toBe(upstream.id);
            expect(Object.keys(result).sort()).toEqual(['credential', 'id', 'plan', 'status', 'updatedAt']);
            expect(JSON.stringify(result)).not.toContain(source);
            expect(JSON.stringify(result)).not.toContain(upstream.taskToken);
            const stored = JSON.stringify(await db.getRepository(GptRechargeReceipt).find());
            for (const secretValue of ['fixture-code', session, upstream.taskToken, upstream.id])
                expect(stored).not.toContain(secretValue);
        },
    );
    it('concurrent submit claims only one dispatch', async () => {
        const results = await Promise.all([
            service.submit(ctx(), 'parallel', session),
            service.submit(ctx(), 'parallel', session),
        ]);
        expect(submits).toBe(1);
        expect(new Set(results.map(row => row.id)).size).toBe(1);
        expect(await db.getRepository(GptRechargeReceipt).count()).toBe(1);
    });
    it('never repeats an ambiguous submit and recovers by code', async () => {
        mode = 'unknown';
        await expect(service.submit(ctx(), 'unknown', session)).rejects.toThrow('提交结果待核对');
        expect((await service.submit(ctx(), 'unknown', session)).status).toBe('awaiting_review');
        expect(submits).toBe(1);
        expect((await service.query(ctx(), 'unknown')).task?.status).toBe('awaiting_review');
        remote = { ...upstream, status: 'succeeded' };
        expect((await service.query(ctx(), 'unknown')).task?.status).toBe('succeeded');
        expect(submits).toBe(1);
    });
    it('a proven rejection permits corrected input', async () => {
        mode = 'rejected';
        await expect(service.submit(ctx(), 'retry', session)).rejects.toMatchObject({
            code: 'GPT_RECHARGE_NOT_ACCEPTED',
        });
        mode = 'ok';
        expect((await service.submit(ctx(), 'retry', session)).status).toBe('queued');
        expect(submits).toBe(2);
    });
    it('rejects other channels and forged credentials', async () => {
        const task = await service.submit(ctx(), 'isolation', session);
        await expect(service.task(ctx(2), task.id, task.credential)).rejects.toThrow();
        await expect(service.task(ctx(), task.id, 'f'.repeat(64))).rejects.toThrow();
        await expect(service.task(ctx(), task.id, '中'.repeat(64))).rejects.toThrow();
    });
    it('binds used codes to their first storefront, including concurrent claims', async () => {
        await service.saveConfig(ctx(2), {
            enabled: true,
            upstreamOrigin: source,
            serviceKey: key,
            expectedRevision: -1,
        });
        await service.submit(ctx(), 'owned', session);
        for (const operation of [
            () => service.verify(ctx(2), 'owned'),
            () => service.query(ctx(2), 'owned'),
            () => service.submit(ctx(2), 'owned', session),
        ])
            await expect(operation()).rejects.toThrow();
        const before = submits;
        remote = null;
        const claims = await Promise.allSettled([
            service.submit(ctx(), 'race', session),
            service.submit(ctx(2), 'race', session),
        ]);
        expect(claims.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        // The unique code claim permits exactly one dispatch across both stores.
        expect(submits).toBe(before + 1);
        expect(await db.getRepository(GptRechargeReceipt).count()).toBe(2);
    });
    it('late progress cannot overwrite a newer result', async () => {
        await service.submit(ctx(), 'late', session);
        remote = { ...upstream, status: 'succeeded', updatedAt: '2026-10-16T10:05:00.000Z' };
        expect((await service.query(ctx(), 'late')).task?.status).toBe('succeeded');
        remote = { ...upstream, status: 'running' };
        expect((await service.query(ctx(), 'late')).task?.status).toBe('succeeded');
    });
    it('protects private config versions and disables new tasks', async () => {
        expect(await service.adminConfig(ctx())).toEqual({
            enabled: true,
            upstreamOrigin: source,
            credentialConfigured: true,
            revision: 0,
        });
        await service.saveConfig(ctx(), { enabled: false, upstreamOrigin: source, expectedRevision: 0 });
        await expect(
            service.saveConfig(ctx(), { enabled: true, upstreamOrigin: source, expectedRevision: 0 }),
        ).rejects.toThrow('配置未保存');
        await expect(service.submit(ctx(), 'closed', session)).rejects.toThrow('暂未开放');
        expect(await service.publicConfig(ctx())).toEqual({ enabled: false, maintenance: false });
        expect(submits).toBe(0);
    });
    it('requires published access before contacting the executor', async () => {
        access.assertEnabled.mockRejectedValueOnce(new Error('disabled'));
        await expect(service.verify(ctx(), 'code')).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });
    it('sanitizes unexpected failures at GraphQL boundary', async () => {
        const resolver = new GptRechargeShopResolver({
            verify: () => {
                return Promise.reject(new Error(`${source} ${key}`));
            },
        } as never);
        await expect(resolver.verifyGptRechargeCode(ctx(), 'code')).rejects.toThrow('充值服务暂不可用');
    });
});
describe('secret and destination security', () => {
    beforeEach(() => {
        vi.stubEnv('GPT_RECHARGE_ENCRYPTION_KEY', 'ab'.repeat(32));
        vi.stubEnv('GPT_RECHARGE_ALLOWED_ORIGINS', source);
    });
    afterEach(() => vi.unstubAllEnvs());
    it('binds encryption to the store and rejects destination injection', () => {
        const value = sealRechargeSecret('fixture', 'a');
        expect(openRechargeSecret(value, 'a')).toBe('fixture');
        expect(() => openRechargeSecret(value, 'b')).toThrow();
        for (const url of [
            'http://executor.example.test',
            'https://evil.example.test',
            'https://u:p@executor.example.test',
            `${source}/private`,
            `${source}?redirect=x`,
        ])
            expect(() => allowedRechargeOrigin(url)).toThrow();
        expect(rechargeCredentialMatches('a'.repeat(64), '中'.repeat(64))).toBe(false);
    });
    it('rejects invalid incomplete and expired JSON before dispatch', () => {
        for (const value of [
            '{',
            '{}',
            JSON.stringify({
                user: { id: 'u', email: 'u@test' },
                accessToken: 'x'.repeat(22),
                expires: '2000-01-01',
            }),
        ])
            expect(() => validateRechargeSession(value)).toThrow();
        expect(() => validateRechargeSession(session)).not.toThrow();
    });
});
