import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AutoIncrementIdStrategy, RequestContext, TransactionalConnection } from '@vendure/core';
import { buildSchema, graphql, type GraphQLResolveInfo, print } from 'graphql';
import 'reflect-metadata';
import { of } from 'rxjs';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IdCodecService } from '../../../core/src/api/common/id-codec.service';
import { IdInterceptor } from '../../../core/src/api/middleware/id-interceptor';
import { type ConfigService } from '../../../core/src/config/config.service';
import { AddGptRecharge1792152000000 } from '../../../dev-server/migrations/1792152000000-add-gpt-recharge';

import { shopSchema } from './api-extensions';
import { GptRechargeConfig, GptRechargeReceipt } from './entities';
import { GptRechargeShopResolver } from './plugin';
import {
    allowedRechargeOrigin,
    openRechargeSecret,
    readRechargeResponse,
    rechargeCredentialMatches,
    sealRechargeSecret,
    validateRechargeSession,
} from './security';
import { GptRechargeService } from './service';
const nativeFetch = globalThis.fetch;
const source = 'https://executor.example.test';
describe('bounded recharge response bytes', () => {
    it('preserves Fetch UTF-8 decoding when a JSON response starts with a byte order mark', async () => {
        const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"status":"queued"}')]);
        const expected = await new Response(bytes).text();
        expect(await readRechargeResponse(new Response(bytes))).toBe(expected);
        expect(JSON.parse(expected)).toEqual({ status: 'queued' });
    });
    it('accepts normal UTF-8 content and the exact byte boundary', async () => {
        const text = JSON.stringify({ text: '界'.repeat(12_000) });
        expect(await readRechargeResponse(new Response(text))).toBe(text);
        const boundary = ' '.repeat(65_536);
        expect(await readRechargeResponse(new Response(boundary))).toBe(boundary);
    });
    it('rejects oversized UTF-8 bytes even when the character count is below the limit', async () => {
        const text = JSON.stringify({ text: '界'.repeat(30_000) });
        expect(text.length).toBeLessThan(65_536);
        await expect(readRechargeResponse(new Response(text))).rejects.toThrow('size limit');
    });
    it('cancels an oversized declared body without consuming it', async () => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({ cancel });
        await expect(
            readRechargeResponse(new Response(body, { headers: { 'content-length': '65537' } })),
        ).rejects.toThrow('size limit');
        expect(cancel).toHaveBeenCalledOnce();
    });
});
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
    ({
        channelId,
        channel: { code: channelId === 1 ? 'moyao-ai' : 'another-store' },
        req: { ip: '203.0.113.10', res: { setHeader: vi.fn() } },
    }) as unknown as RequestContext;
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
    let remote: (typeof upstream & { stage?: string; message?: string }) | null;
    let plan: string;
    let mode: string;
    let canFence: boolean;
    let submissionIds: string[];
    let submits: number;
    let retryFor: string | undefined;
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
        canFence = false;
        submissionIds = [];
        submits = 0;
        retryFor = undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string, init: RequestInit) => {
                const action = url.split('/').at(-1);
                if (action === 'config')
                    return Promise.resolve(Response.json({ maintenance: false, supplier: source }));
                if (action === 'query' || action === 'verify') {
                    const retry = remote?.id === retryFor && retryFor !== undefined;
                    return Promise.resolve(
                        Response.json({
                            plan,
                            status: !remote || retry ? 'available' : 'reserved',
                            ...(retry && { reason: 'verified_retry_available' }),
                            task: remote,
                        }),
                    );
                }
                if (action === 'task') {
                    const taskInput = JSON.parse(init.body as string);
                    if (taskInput.action === 'reconcile') {
                        expect(taskInput.submissionId).toBe(submissionIds.at(-1));
                        return Promise.resolve(Response.json({ fenced: canFence }));
                    }
                    expect(Object.keys(taskInput).sort()).toEqual(['id', 'taskToken']);
                    return Promise.resolve(Response.json(remote ?? upstream));
                }
                submits++;
                const input = JSON.parse(init.body as string);
                expect(input.submissionId).toMatch(/^[a-f0-9-]{36}$/);
                submissionIds.push(input.submissionId);
                if (retryFor && remote?.id === retryFor) {
                    expect(input.afterFailedTask).toBe(retryFor);
                    expect(Object.keys(input).sort()).toEqual([
                        'afterFailedTask',
                        'code',
                        'session',
                        'submissionId',
                    ]);
                } else expect(Object.keys(input).sort()).toEqual(['code', 'session', 'submissionId']);
                if (mode === 'unknown') return Promise.reject(new Error(`transport ${source} ${key}`));
                if (mode === 'rejected') return Promise.resolve(Response.json({ rejected: true }));
                if (mode === 'replay-old') return Promise.resolve(Response.json(remote));
                remote = input.afterFailedTask
                    ? {
                          ...upstream,
                          plan,
                          id: '21111111-1111-4111-8111-111111111111',
                          updatedAt: '2026-10-16T10:00:02.000Z',
                      }
                    : { ...upstream, plan };
                return Promise.resolve(Response.json(remote));
            }),
        );
    });
    afterEach(async () => {
        await db?.destroy();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });
    it('uses the resolved store channel and separates invalid and held codes without creating receipts', async () => {
        vi.mocked(fetch).mockImplementation((_url, options) => {
            expect(new Headers(options?.headers).get('x-vendure-recharge-channel')).toBe('moyao-ai');
            if (typeof options?.body !== 'string') throw new Error('Expected JSON body');
            const { code } = JSON.parse(options.body);
            if (code === 'outside') {
                return Promise.resolve(
                    Response.json({ reason: 'storefront_code_not_admitted' }, { status: 400 }),
                );
            }
            if (code === 'unavailable') return Promise.resolve(new Response(null, { status: 503 }));
            return Promise.resolve(
                Response.json({ plan: 'plus', status: 'reserved', reason: 'manual_review_required' }),
            );
        });
        await expect(service.verify(ctx(), 'outside')).rejects.toThrow('兑换码无效或已停用，请核对后重试');
        await expect(service.query(ctx(), 'unavailable')).rejects.toThrow('充值服务暂时无法确认请求');
        const held = { plan: 'plus', status: 'reserved', reason: 'manual_review_required', task: null };
        expect(await service.verify(ctx(), 'held')).toEqual(held);
        expect(await service.query(ctx(), 'held')).toEqual(held);
        await expect(service.submit(ctx(), 'held', session)).rejects.toThrow('上次开通结果待核对');
        expect(
            vi.mocked(fetch).mock.calls.some(([url]) => typeof url === 'string' && url.endsWith('/submit')),
        ).toBe(false);
        expect(await db.getRepository(GptRechargeReceipt).count()).toBe(0);
    });
    it('recovers the same store receipt for two spellings of a native code', async () => {
        const code = 'KC-' + 'A'.repeat(15);
        const first = await service.submit(ctx(), code, session);
        expect(await service.submit(ctx(), code.toLowerCase(), session)).toEqual(first);
        expect(submits).toBe(1);
        expect(await db.getRepository(GptRechargeReceipt).count()).toBe(1);
    });
    it('cancels an oversized streamed upstream response before reading the rest', async () => {
        let pulls = 0;
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls++;
                if (pulls > 8) controller.close();
                else controller.enqueue(new Uint8Array(32_768).fill(32));
            },
            cancel() {
                cancelled = true;
            },
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
        await expect(service.verify(ctx(), 'oversized-response')).rejects.toThrow('充值服务暂时无法确认请求');
        expect(cancelled).toBe(true);
        expect(pulls).toBeLessThanOrEqual(4);
    });
    it.each(['plus', 'pro_5x', 'pro_20x', 'pro500'])(
        'uses code-bound %s and stores no plaintext credentials',
        async value => {
            plan = value;
            const result = await service.submit(ctx(), 'fixture-code', session);
            expect(result.plan).toBe(plan);
            expect(result.id).not.toBe(upstream.id);
            expect(Object.keys(result).sort()).toEqual([
                'credential',
                'id',
                'plan',
                'stage',
                'status',
                'updatedAt',
            ]);
            expect(JSON.stringify(result)).not.toContain(source);
            expect(JSON.stringify(result)).not.toContain(upstream.taskToken);
            const stored = JSON.stringify(await db.getRepository(GptRechargeReceipt).find());
            for (const secretValue of ['fixture-code', session, upstream.taskToken, upstream.id])
                expect(stored).not.toContain(secretValue);
        },
    );
    it('streams only the authorized task, persists detailed progress and rejects old business revisions', async () => {
        const accepted = await service.submit(ctx(), 'stream-code', session);
        const progress = {
            attempt: upstream.id,
            execution: 1,
            version: 3,
            retryAt: null,
            changedAt: '2026-10-16T10:00:03.000Z',
            milestones: [{ key: 'card', state: 'complete', at: '2026-10-16T10:00:03.000Z' }],
        };
        const snapshot = {
            ...upstream,
            status: 'running',
            stage: 'processing',
            progress,
            accountEmail: 'customer@example.test',
            updatedAt: progress.changedAt,
        };
        const received: any[] = [];
        const ready = vi.fn();
        vi.mocked(fetch).mockImplementation((_url, options) => {
            expect(new Headers(options?.headers).get('accept')).toBe('text/event-stream');
            expect(JSON.parse(typeof options?.body === 'string' ? options.body : '')).toEqual({
                id: upstream.id,
                taskToken: upstream.taskToken,
            });
            return Promise.resolve(
                new Response(
                    'event: ready\ndata: {}\n\nevent: task\ndata: ' + JSON.stringify(snapshot) + '\n\n',
                    { headers: { 'content-type': 'text/event-stream' } },
                ),
            );
        });
        await expect(
            service.watchTask(
                ctx(2),
                accepted.id,
                accepted.credential,
                new AbortController().signal,
                ready,
                value => received.push(value),
            ),
        ).rejects.toThrow();
        await expect(
            service.watchTask(ctx(), accepted.id, 'wrong', new AbortController().signal, ready, value =>
                received.push(value),
            ),
        ).rejects.toThrow();
        await service.watchTask(
            ctx(),
            accepted.id,
            accepted.credential,
            new AbortController().signal,
            ready,
            value => received.push(value),
        );
        expect(ready).toHaveBeenCalledOnce();
        expect(received[0].accountEmail).toBe('customer@example.test');
        expect(received[0].progress.milestones).toEqual(progress.milestones);
        expect(received[0].progress.attempt).not.toBe(upstream.id);
        expect(JSON.stringify(received[0])).not.toContain(upstream.taskToken);
        const stored = JSON.stringify(await db.getRepository(GptRechargeReceipt).find());
        expect(stored).not.toContain('customer@example.test');
        vi.mocked(fetch).mockResolvedValue(
            Response.json({
                ...snapshot,
                progress: { ...progress, version: 2, milestones: [] },
                updatedAt: '2026-10-16T10:00:09.000Z',
            }),
        );
        const retained = await service.task(ctx(), accepted.id, accepted.credential);
        expect(retained.progress?.version).toBe(3);
        expect(retained.progress?.milestones).toEqual(progress.milestones);
    });
    it.runIf(Boolean(process.env.GPT_RECHARGE_ID_PROJECT))(
        'redeems a code-bound Pro500 through the actual ID task bridge, receipts and task stream',
        async () => {
            const { pathToFileURL } = await import('node:url');
            const { createServer } = await import('node:http');
            const peer = process.env.GPT_RECHARGE_ID_PROJECT;
            if (!peer) throw new Error('Missing local integration source');
            const moduleUrl = pathToFileURL(peer + '/modules/recharge/vendure/loopback-bridge.mjs').href;
            const { createLoopbackVendureRechargeBridge, signRechargeWorkerRequest, rechargeWorkerPrefix } =
                await import(/* @vite-ignore */ moduleUrl);
            const clientUrl = pathToFileURL(peer + '/server/order-recharge-client.mjs').href;
            const { createOrderRechargeClient } = await import(/* @vite-ignore */ clientUrl);
            const code = 'KC-AAAAAAAAAAAAAAA';
            const native = createOrderRechargeClient(
                { upstreamUrl: 'http://127.0.0.1:1', secret: 'synthetic-cross-project-native-key-only' },
                (url: URL, init: RequestInit) => {
                    expect(url.pathname).toBe('/api/verify-cdk');
                    if (typeof init.body !== 'string') throw new Error('Expected a JSON body');
                    expect(JSON.parse(init.body)).toEqual({ cdk: code });
                    return Response.json({ success: true, data: { type: '自助', plan_type: 'pro500' } });
                },
            );
            const workerSecret = 'synthetic-cross-project-worker-key-only';
            const bridge = createLoopbackVendureRechargeBridge({
                vendureKey: key,
                workerSecret,
                codes: [],
                lookupAdmission: native.verifyStorefrontCode,
            });
            const server = createServer((req, res) => void bridge.handle(req, res));
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
            const abort = new AbortController();
            let watching: Promise<void> | undefined;
            try {
                let delayedSubmit: (() => Promise<Response>) | undefined;
                vi.mocked(fetch).mockImplementation((url, options) => {
                    const destination = (
                        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
                    ).replace(source, origin);
                    if (destination.endsWith('/submit') && !delayedSubmit) {
                        delayedSubmit = () => nativeFetch(destination, options);
                        return Promise.reject(
                            new Error('Synthetic connection lost before ID received submit'),
                        );
                    }
                    return nativeFetch(destination, options);
                });
                expect(await service.verify(ctx(), code)).toMatchObject({
                    plan: 'pro500',
                    status: 'available',
                });
                await expect(service.submit(ctx(), code, session)).rejects.toThrow('提交结果待核对');
                const review = await service.submissionReview(ctx(), code);
                expect(review.pending).toBe(true);
                expect(await service.recoverSubmission(ctx(), code, review.revision)).toMatchObject({
                    pending: false,
                });
                if (!delayedSubmit) throw new Error('Missing delayed request fixture');
                const late = await delayedSubmit();
                expect(await late.json()).toMatchObject({ rejected: true });
                expect(await service.query(ctx(), code)).toMatchObject({ status: 'available', task: null });
                const accepted = await service.submit(ctx(), code, session);
                expect(accepted.plan).toBe('pro500');
                expect(accepted.accountEmail).toBe('demo@example.test');
                const values: any[] = [];
                let first!: () => void;
                const initial = new Promise<void>(resolve => {
                    first = resolve;
                });
                watching = service.watchTask(
                    ctx(),
                    accepted.id,
                    accepted.credential,
                    abort.signal,
                    () => undefined,
                    value => {
                        values.push(value);
                        first();
                    },
                );
                await initial;
                const worker = async (action: string, value: object = {}) => {
                    const path = rechargeWorkerPrefix + '/' + action;
                    const body = JSON.stringify(value);
                    const reply = await nativeFetch(origin + path, {
                        method: 'POST',
                        body,
                        headers: {
                            'content-type': 'application/json',
                            ...signRechargeWorkerRequest(workerSecret, path, body),
                        },
                    });
                    expect(reply.status).toBe(200);
                    return reply.json();
                };
                const lease = (await worker('claim')).task;
                expect(lease.plan).toBe('pro500');
                await worker('progress', {
                    id: lease.id,
                    leaseToken: lease.leaseToken,
                    upstreamJobId: 'joint-job',
                    stage: 'processing',
                    facts: [
                        { key: 'card', state: 'complete', at: Date.now(), attempt: 1 },
                        { key: 'billing', state: 'complete', at: Date.now(), attempt: 1 },
                    ],
                });
                await worker('result', {
                    id: lease.id,
                    leaseToken: lease.leaseToken,
                    upstreamJobId: 'joint-job',
                    outcome: 'confirmed_success',
                    evidenceId: 'synthetic-completion',
                });
                await watching;
                expect(values.at(-1)).toMatchObject({ plan: 'pro500', status: 'succeeded' });
                expect(values.at(-1).progress.milestones).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ key: 'card', state: 'complete' }),
                        expect.objectContaining({ key: 'billing', state: 'complete' }),
                    ]),
                );
                expect(JSON.stringify(values)).not.toContain(lease.leaseToken);
                expect(JSON.stringify(values)).not.toContain(lease.id);
                expect((await service.query(ctx(), code)).task?.progress).toEqual(values.at(-1).progress);
            } finally {
                abort.abort();
                await watching?.catch(() => undefined);
                bridge.close();
                server.closeAllConnections();
                await new Promise<void>(resolve => server.close(() => resolve()));
            }
        },
        10000,
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
    it('keeps uncertain submissions locked until an explicit fenced recovery and never resends', async () => {
        const code = 'lost-before-enqueue';
        mode = 'unknown';
        await expect(service.submit(ctx(), code, session)).rejects.toThrow('提交结果待核对');
        const review = await service.submissionReview(ctx(), code);
        expect(review.pending).toBe(true);
        await expect(service.verify(ctx(), code)).resolves.toMatchObject({
            status: 'reserved',
            reason: 'manual_review_required',
        });
        await expect(service.recoverSubmission(ctx(), code, review.revision - 1)).rejects.toThrow('已变化');
        await expect(service.recoverSubmission(ctx(), code, review.revision)).rejects.toThrow('已保留锁定');
        expect(await service.submissionReview(ctx(), code)).toEqual(review);
        canFence = true;
        await expect(service.recoverSubmission(ctx(), code, review.revision)).resolves.toEqual({
            pending: false,
            revision: review.revision + 1,
        });
        expect(submits).toBe(1);
        await expect(service.verify(ctx(), code)).resolves.toMatchObject({ status: 'available' });
        mode = 'ok';
        await expect(service.submit(ctx(), code, session)).resolves.toMatchObject({ status: 'queued' });
        expect(submits).toBe(2);
        expect(new Set(submissionIds).size).toBe(2);
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
    async function prepareFailedRetry(code: string) {
        await service.submit(ctx(), code, session);
        remote = { ...upstream, status: 'failed', updatedAt: '2026-10-16T10:00:01.000Z' };
        retryFor = remote.id;
    }

    it('keeps the first failure visible and sends at most one explicit retry for that receipt', async () => {
        const code = 'reviewed-retry';
        await prepareFailedRetry(code);
        expect(await service.verify(ctx(), code)).toMatchObject({
            status: 'available',
            reason: 'verified_retry_available',
            task: null,
        });
        const previous = await service.query(ctx(), code);
        expect(previous).toMatchObject({
            status: 'available',
            reason: 'verified_retry_available',
            task: { status: 'failed' },
        });
        const results = await Promise.all([
            service.submit(ctx(), code, session),
            service.submit(ctx(), code, session),
            service.submit(ctx(), code, session),
        ]);
        expect(results.some(task => task.status === 'queued')).toBe(true);
        expect(submits).toBe(2);
        expect(await service.query(ctx(), code)).toMatchObject({
            status: 'reserved',
            task: { id: previous.task?.id, status: 'queued' },
        });
    });

    it.each(['unknown', 'replay-old'])(
        'does not release an ambiguous retry on the previous failure (%s)',
        async outcome => {
            const code = 'pending-retry';
            await prepareFailedRetry(code);
            mode = outcome;
            await expect(service.submit(ctx(), code, session)).rejects.toThrow('提交结果待核对');
            expect(await service.verify(ctx(), code)).toMatchObject({
                status: 'reserved',
                reason: 'manual_review_required',
            });
            expect(await service.query(ctx(), code)).toMatchObject({
                status: 'reserved',
                reason: 'manual_review_required',
                task: { status: 'awaiting_review' },
            });
            expect((await service.submit(ctx(), code, session)).status).toBe('awaiting_review');
            expect(submits).toBe(2);
            remote = {
                ...upstream,
                id: '21111111-1111-4111-8111-111111111111',
                updatedAt: '2026-10-16T10:00:02.000Z',
            };
            expect((await service.query(ctx(), code)).task?.status).toBe('queued');
            expect(submits).toBe(2);
        },
    );

    it('allows another explicit submit after the executor proves a retry was not accepted', async () => {
        const code = 'retry-rejected';
        await prepareFailedRetry(code);
        mode = 'rejected';
        await expect(service.submit(ctx(), code, session)).rejects.toMatchObject({
            code: 'GPT_RECHARGE_NOT_ACCEPTED',
        });
        expect((await service.query(ctx(), code)).task?.status).toBe('failed');
        mode = 'ok';
        expect((await service.submit(ctx(), code, session)).status).toBe('queued');
        expect(submits).toBe(3);
    });
    it('rejects other channels and forged credentials', async () => {
        const task = await service.submit(ctx(), 'isolation', session);
        await expect(service.task(ctx(2), task.id, task.credential)).rejects.toThrow();
        await expect(service.task(ctx(), task.id, 'f'.repeat(64))).rejects.toThrow();
        await expect(service.task(ctx(), task.id, '中'.repeat(64))).rejects.toThrow();
    });
    it('accepts the existing task query through the real Vendure ID interceptor', async () => {
        const accepted = await service.submit(ctx(), 'opaque-reference', session);
        const resolver = new GptRechargeShopResolver(service);
        const schema = buildSchema(
            `scalar DateTime\ntype Query { test: Boolean }\ntype Mutation { test: Boolean }\n${print(shopSchema)}`,
        );
        const interceptor = new IdInterceptor(
            new IdCodecService({
                entityOptions: { entityIdStrategy: new AutoIncrementIdStrategy() },
            } as ConfigService),
        );
        const query = (credential: string, fields: string) =>
            graphql({
                schema,
                source: `query GptRechargeTask($id: ID!, $credential: String!) {
                    gptRechargeTask(id: $id, credential: $credential) { ${fields} }
                }`,
                variableValues: { id: accepted.id, credential },
                rootValue: {
                    gptRechargeTask: (
                        args: { id: string; credential: string },
                        _context: unknown,
                        info: GraphQLResolveInfo,
                    ) => {
                        const execution = new ExecutionContextHost([null, args, { req: {} }, info]);
                        execution.setType('graphql');
                        interceptor.intercept(execution, { handle: () => of(null) });
                        expect(args.id).toBe(-1);
                        return resolver.gptRechargeTask(ctx(), info, args.credential);
                    },
                },
            });
        const legacyFields = 'id credential plan status updatedAt';
        await expect(query(accepted.credential, legacyFields)).resolves.toMatchObject({
            data: { gptRechargeTask: { id: accepted.id, status: 'queued' } },
        });
        await expect(query(accepted.credential, `${legacyFields} stage`)).resolves.toMatchObject({
            data: { gptRechargeTask: { id: accepted.id, status: 'queued', stage: 'queued' } },
        });
        await expect(query('f'.repeat(64), legacyFields)).resolves.toMatchObject({
            errors: [expect.objectContaining({ extensions: expect.objectContaining({ code: 'FORBIDDEN' }) })],
        });
    });
    it('retains only fixed real stages across identical and late polls, without leaking messages', async () => {
        const accepted = await service.submit(ctx(), 'stage-proof', session);
        remote = {
            ...upstream,
            status: 'running',
            stage: 'payment_details',
            message: 'synthetic-private-detail',
            updatedAt: '2026-10-16T10:01:00.850Z',
        };
        const current = await service.task(ctx(), accepted.id, accepted.credential);
        expect(current.stage).toBe('payment_details');
        expect(current.updatedAt.toISOString()).toBe(remote.updatedAt);
        expect(JSON.stringify(current)).not.toContain('synthetic-private-detail');
        // Simulate the precision of the production datetime column.
        await db
            .getRepository(GptRechargeReceipt)
            .update({ publicId: accepted.id }, { upstreamUpdatedAt: new Date('2026-10-16T10:01:00.000Z') });
        const prior = await db.getRepository(GptRechargeReceipt).findOneByOrFail({ publicId: accepted.id });
        expect((await service.task(ctx(), accepted.id, accepted.credential)).stage).toBe('payment_details');
        remote = { ...remote, stage: 'started', updatedAt: '2026-10-16T10:01:00.500Z' };
        expect((await service.task(ctx(), accepted.id, accepted.credential)).stage).toBe('payment_details');
        const persisted = await db
            .getRepository(GptRechargeReceipt)
            .findOneByOrFail({ publicId: accepted.id });
        expect(persisted.revision).toBe(prior.revision);
        remote = { ...remote, stage: 'unknown-private-message', updatedAt: '2026-10-16T10:02:00.000Z' };
        remote = { ...upstream, status: 'running', stage: 'payment_details' };
        expect((await service.task(ctx(), accepted.id, accepted.credential)).stage).toBe('payment_details');
        remote = { ...remote, status: 'succeeded', stage: 'paying', updatedAt: '2026-10-16T10:03:00.000Z' };
        expect((await service.task(ctx(), accepted.id, accepted.credential)).stage).toBe('succeeded');
    });
    it('reads legacy running snapshots without inventing completed steps', async () => {
        const accepted = await service.submit(ctx(), 'legacy-stage', session);
        await db.getRepository(GptRechargeReceipt).update(
            { publicId: accepted.id },
            {
                status: 'running',
                encryptedUpstreamTask: sealRechargeSecret(
                    JSON.stringify({ id: upstream.id, taskToken: upstream.taskToken }),
                    `gpt:1:${accepted.id}`,
                ),
            },
        );
        expect((await service.task(ctx(), accepted.id, accepted.credential)).stage).toBe('processing');
    });
    it('verifies through the source while isolating task receipts and concurrent claims', async () => {
        await service.saveConfig(ctx(2), {
            enabled: true,
            upstreamOrigin: source,
            serviceKey: key,
            expectedRevision: -1,
        });
        await service.submit(ctx(), 'owned', session);
        expect(await service.verify(ctx(2), 'owned')).toEqual({
            plan: 'plus',
            status: 'reserved',
            task: null,
        });
        for (const operation of [
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
            partnerConfigured: false,
            legacyConfigured: true,
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
    it('checks only partner connectivity for the independent portal', async () => {
        expect(await service.publicConfig(ctx(), true)).toEqual({ enabled: false, maintenance: false });
        expect(fetch).not.toHaveBeenCalled();
        expect(await service.publicConfig(ctx())).toEqual({ enabled: true, maintenance: false });
        await service.saveConfig(ctx(), {
            enabled: true,
            upstreamOrigin: source,
            partnerApiKey: 'rp_' + 'a'.repeat(24) + '.' + 'b'.repeat(43),
            expectedRevision: 0,
        });
        const legacy = vi.mocked(fetch).getMockImplementation();
        if (!legacy) throw new Error('Missing legacy test transport');
        vi.mocked(fetch).mockImplementation((url, init) =>
            typeof url === 'string' && url.endsWith('/api/recharge/v1/config')
                ? Promise.resolve(Response.json({ maintenance: true }))
                : legacy(url, init),
        );
        expect(await service.publicConfig(ctx(), true)).toEqual({ enabled: true, maintenance: true });
        expect(await service.publicConfig(ctx())).toEqual({ enabled: true, maintenance: false });
    });
    it.each(['plus', 'pro500'])(
        'uses ID-hosted partner authorization for code-bound %s while retaining the legacy connection',
        async partnerPlan => {
            const apiKey = 'rp_' + 'a'.repeat(24) + '.' + 'b'.repeat(43);
            const code = 'RA-' + 'A'.repeat(32);
            const ticket = 'c'.repeat(43);
            const exchange: string[] = [];
            const authUrl = source + '/recharge/authorize#' + upstream.id + '.' + ticket;
            let status = 'awaiting_authorization';
            let updatedAt = '2026-10-16T10:00:00.000Z';
            const legacy = vi.mocked(fetch).getMockImplementation();
            if (!legacy) throw new Error('Missing legacy test transport');
            vi.mocked(fetch).mockImplementation((url, init) => {
                if (typeof url !== 'string' || !url.includes('/api/recharge/v1/')) return legacy(url, init);
                const path = url.split('/api/recharge/v1')[1];
                expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ' + apiKey);
                expect(new Headers(init?.headers).get('x-vendure-recharge-key')).toBeNull();
                exchange.push(path);
                if (path === '/codes/query' || path === '/codes/verify')
                    return Promise.resolve(Response.json({ plan: partnerPlan, status: 'available' }));
                if (path === '/redemptions') {
                    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('shop-request');
                    expect(init?.body).toBe(JSON.stringify({ code }));
                }
                return Promise.resolve(
                    Response.json({
                        id: upstream.id,
                        plan: partnerPlan,
                        status,
                        updatedAt,
                        accountEmail: 'customer@example.test',
                        ...(path === '/redemptions' && { authorizationUrl: authUrl }),
                    }),
                );
            });
            const config = await service.saveConfig(ctx(), {
                enabled: true,
                upstreamOrigin: source + '/api/recharge/v1',
                partnerApiKey: apiKey,
                expectedRevision: 0,
            });
            expect(config).toMatchObject({ partnerConfigured: true, legacyConfigured: true });
            expect(config.upstreamOrigin).toBe(source);
            expect(JSON.stringify(config)).not.toContain(apiKey);
            const saved = await db.getRepository(GptRechargeConfig).findOneByOrFail({ channelId: 1 });
            expect(openRechargeSecret(saved.encryptedServiceKey, 'gpt:1')).toBe(key);
            expect((await service.verify(ctx(), 'legacy-code')).status).toBe('available');
            await expect(service.submit(ctx(), code, session)).rejects.toThrow('本次提交未受理');
            expect(await service.verify(ctx(), code)).toMatchObject({
                status: 'available',
                plan: partnerPlan,
            });
            const result = await service.startAuthorization(ctx(), code.toLowerCase(), 'shop-request');
            expect(result.authorizationUrl).toBe(authUrl);
            expect(result.task).toMatchObject({
                status: 'awaiting_authorization',
                plan: partnerPlan,
                accountEmail: 'c***@example.test',
            });
            expect(result.task.id).not.toBe(upstream.id);
            status = 'queued';
            updatedAt = '2026-10-16T10:00:01.000Z';
            expect(await service.task(ctx(), result.task.id, result.task.credential)).toMatchObject({
                status: 'queued',
                plan: partnerPlan,
            });
            await expect(service.task(ctx(2), result.task.id, result.task.credential)).rejects.toThrow();
            const row = await db
                .getRepository(GptRechargeReceipt)
                .findOneByOrFail({ publicId: result.task.id });
            expect(JSON.stringify(row)).not.toContain(ticket);
            expect(JSON.stringify(row)).not.toContain(apiKey);
            expect(exchange).toEqual([
                '/codes/verify',
                '/codes/query',
                '/redemptions',
                '/redemptions/' + upstream.id,
            ]);

            vi.mocked(fetch).mockResolvedValue(Response.json({ plan: 'unknown', status: 'available' }));
            await expect(service.startAuthorization(ctx(), code, 'another-request')).rejects.toThrow(
                '兑换码状态暂不可用',
            );
            expect(vi.mocked(fetch).mock.lastCall?.[0]).toBe(source + '/api/recharge/v1/codes/query');
        },
    );
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
