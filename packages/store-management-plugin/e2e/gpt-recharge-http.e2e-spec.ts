import { buildSchema, graphql, print } from 'graphql';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddGptRecharge1792152000000 } from '../../dev-server/migrations/1792152000000-add-gpt-recharge';
import { GptRechargeApi } from '../../storefront/src/api/gpt-recharge';
import { parseShopApiResponse } from '../../storefront/src/api/helpers';
import { shopSchema } from '../src/gpt-recharge/api-extensions';
import { GptRechargeConfig, GptRechargeReceipt } from '../src/gpt-recharge/entities';
import { GptRechargeShopResolver } from '../src/gpt-recharge/plugin';
import { GptRechargeService } from '../src/gpt-recharge/service';

// Explicit, test-only peer path: no production dependency between the two repositories.
const peer = process.env.GPT_RECHARGE_ID_PROJECT;
if (!peer || !path.isAbsolute(peer))
    throw new Error('Set GPT_RECHARGE_ID_PROJECT to the ID project before this isolated integration check.');
const peerRequire = createRequire(path.join(peer, 'package.json'));
const compiled = (name: string) => peerRequire(path.join(peer, 'apps/api/dist', name));
const { Test } = peerRequire('@nestjs/testing');
const { OnlineRechargeVendureController } = compiled(
    'id-business-v2/online-recharge/vendure-integration.controller.js',
);
const { OnlineRechargeVendureIntegration } = compiled(
    'id-business-v2/online-recharge/vendure-integration.service.js',
);
const { OnlineRechargePublicLimiter } = compiled('id-business-v2/online-recharge/public.controller.js');
const { OnlineRechargeTasksService } = compiled('id-business-v2/online-recharge/tasks.service.js');
const { OnlineRechargeTasksRepository } = compiled(
    'id-business-v2/online-recharge/persistence/tasks.repository.js',
);
const { FieldEncryptionService } = compiled('common/crypto/field-encryption.service.js');
const { createOnlineRechargeBodyParser } = compiled('id-business-v2/online-recharge/worker-body-parser.js');
const { HttpExceptionFilter } = compiled('common/filters/http-exception.filter.js');
const { ApiResponseInterceptor } = compiled('common/interceptors/api-response.interceptor.js');
const source = 'https://executor.integration.example.test';
const serviceKey = 'synthetic-integration-service-credential-only';
const session = (identity: string) =>
    JSON.stringify({
        user: { id: identity, email: `${identity}@example.test` },
        accessToken: 'synthetic-session-access-token-only',
        expires: '2099-01-01T00:00:00Z',
    });
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

describe('storefront API → Shop GraphQL → Vendure SQL receipts → ID Nest HTTP → task service/repository', () => {
    let db: DataSource;
    let app: any;
    let shop: Server;
    let api: GptRechargeApi;
    let foreignApi: GptRechargeApi;
    let encryption: any;
    let idUrl: string;
    let shopUrl: string;
    let mode: string;
    let maintenance: boolean;
    let submissions: number;
    const tasks = new Map<string, any>();
    const codes = new Map<string, any>();
    const nativeFetch = globalThis.fetch;
    function context(channelId = 1, response?: any) {
        return { channelId, req: { ip: '198.51.100.20', res: response } } as any;
    }
    function client(channelId = 1) {
        return new GptRechargeApi({
            request: async (query: string, variables: object, signal?: AbortSignal) => {
                const response = await nativeFetch(shopUrl, {
                    method: 'POST',
                    signal,
                    headers: { 'content-type': 'application/json', 'x-test-channel': String(channelId) },
                    body: JSON.stringify({ query, variables }),
                });
                return parseShopApiResponse(await response.text(), response.status, response.ok);
            },
        } as any);
    }
    beforeEach(async () => {
        vi.stubEnv('GPT_RECHARGE_ENCRYPTION_KEY', 'ac'.repeat(32));
        vi.stubEnv('GPT_RECHARGE_ALLOWED_ORIGINS', source);
        vi.stubEnv('ONLINE_RECHARGE_VENDURE_KEY', serviceKey);
        vi.stubEnv('ONLINE_RECHARGE_VENDURE_SOURCE_IPS', '127.0.0.1');
        tasks.clear();
        codes.clear();
        mode = 'ok';
        maintenance = false;
        submissions = 0;
        encryption = new FieldEncryptionService({
            get: (key: string) => `synthetic-${key}-for-integration-only`,
        });
        for (const [code, plan] of [
            ['PLUS-CODE', 'plus'],
            ['PRO100-CODE', 'pro_5x'],
            ['PRO200-CODE', 'pro_20x'],
        ]) {
            codes.set(encryption.hash(code), {
                id: randomUUID(),
                plan,
                status: 'available',
                taskId: null,
                deletedAt: null,
            });
        }
        const store = {
            onlineRechargeConfig: {
                findUnique: () =>
                    Promise.resolve({
                        settings: { maintenance, maxConcurrent: 10, proxyCountryCode: 'PH' },
                    }),
            },
            onlineRechargeCode: {
                findUnique: ({ where }: any) => Promise.resolve(codes.get(where.codeHash) ?? null),
                update: ({ where, data }: any) => {
                    const row = [...codes.values()].find(item => item.id === where.id);
                    return Promise.resolve(Object.assign(row, data));
                },
            },
            idBusinessV2RechargeProxy: { count: () => Promise.resolve(1) },
            onlineRechargeTask: {
                findUnique: ({ where }: any) => Promise.resolve(tasks.get(where.id) ?? null),
                count: ({ where }: any) =>
                    Promise.resolve(
                        [...tasks.values()].filter(
                            row =>
                                row.operation === where.operation &&
                                (!where.sessionIdentityHash ||
                                    row.sessionIdentityHash === where.sessionIdentityHash) &&
                                where.status.in.includes(row.status),
                        ).length,
                    ),
                create: ({ data }: any) => {
                    submissions++;
                    const row = {
                        id: randomUUID(),
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        status: 'queued',
                        progress: 0,
                        stage: 'queued',
                        result: { privateUrl: source },
                        ...data,
                    };
                    tasks.set(row.id, row);
                    return Promise.resolve(row);
                },
                updateMany: () => Promise.resolve({ count: 0 }),
            },
        };
        let serial: Promise<unknown> = Promise.resolve();
        const repository = {
            read: (work: any) => work(store),
            log: () => Promise.resolve(undefined),
            transaction: (_name: string, work: any) => {
                const result = serial.then(() => work(store));
                serial = result.catch(() => undefined);
                return result;
            },
        };
        const taskRepository = new OnlineRechargeTasksRepository(
            repository,
            { internal: () => Promise.resolve({ settings: { maintenance } }) },
            encryption,
            {},
            { summary: () => Promise.resolve(null) },
        );
        const taskService = new OnlineRechargeTasksService(taskRepository);
        const integration = new OnlineRechargeVendureIntegration(
            taskService,
            new OnlineRechargePublicLimiter(),
            repository,
        );
        const module = await Test.createTestingModule({
            controllers: [OnlineRechargeVendureController],
            providers: [{ provide: OnlineRechargeVendureIntegration, useValue: integration }],
        }).compile();
        app = module.createNestApplication({ logger: false, bodyParser: false });
        app.use('/api/id-business-v2/online-recharge', createOnlineRechargeBodyParser());
        app.setGlobalPrefix('api');
        app.useGlobalFilters(new HttpExceptionFilter());
        app.useGlobalInterceptors(new ApiResponseInterceptor());
        await app.listen(0, '127.0.0.1');
        idUrl = await app.getUrl();
        vi.stubGlobal('fetch', async (input: any, init: RequestInit) => {
            const url = String(input);
            if (!url.startsWith(source + '/')) return nativeFetch(input, init);
            if (url.endsWith('/submit') && mode === 'pre-dispatch-loss')
                throw new Error('Synthetic transport loss');
            const result = await nativeFetch(url.replace(source, idUrl), init);
            if (url.endsWith('/submit') && mode === 'drop-response')
                throw new Error('Synthetic response loss after ID acceptance');
            return result;
        });
        db = await new DataSource({ type: 'sqljs', entities: schemas, synchronize: false }).initialize();
        await new AddGptRecharge1792152000000().up(db.createQueryRunner());
        const service = new GptRechargeService(
            { getRepository: (_ctx: any, entity: any) => db.getRepository(entity) } as any,
            {
                assertEnabled: () => Promise.resolve(undefined),
                isEnabled: () => Promise.resolve(true),
            } as any,
        );
        for (const channelId of [1, 2])
            await service.saveConfig(context(channelId), {
                enabled: true,
                upstreamOrigin: source,
                serviceKey,
                expectedRevision: -1,
            });
        const resolver = new GptRechargeShopResolver(service);
        const schema = buildSchema(
            'scalar DateTime\ntype Query { _empty: Boolean }\ntype Mutation { _empty: Boolean }\n' +
                print(shopSchema),
        );
        const root = {
            gptRechargeConfig: (_args: any, ctx: any) => resolver.gptRechargeConfig(ctx),
            verifyGptRechargeCode: ({ code }: any, ctx: any) => resolver.verifyGptRechargeCode(ctx, code),
            queryGptRechargeCode: ({ code }: any, ctx: any) => resolver.queryGptRechargeCode(ctx, code),
            submitGptRecharge: ({ code, session: accountSession }: any, ctx: any) =>
                resolver.submitGptRecharge(ctx, code, accountSession),
            gptRechargeTask: ({ id, credential }: any, ctx: any) =>
                resolver.gptRechargeTask(ctx, id, credential),
        };
        const serveShop = async (request: IncomingMessage, response: ServerResponse) => {
            let raw = '';
            for await (const bytes of request) raw += bytes;
            const body = JSON.parse(raw);
            const result = await graphql({
                schema,
                source: body.query,
                variableValues: body.variables,
                rootValue: root,
                contextValue: context(Number(request.headers['x-test-channel'] ?? 1), response),
            });
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(result));
        };
        shop = createServer((request, response) => {
            void serveShop(request, response).catch(() => {
                response.statusCode = 500;
                response.end();
            });
        });
        await new Promise<void>(resolve => shop.listen(0, '127.0.0.1', resolve));
        shopUrl = `http://127.0.0.1:${(shop.address() as any).port}/shop-api`;
        api = client();
        foreignApi = client(2);
    });
    afterEach(async () => {
        shop?.closeAllConnections();
        if (shop) await new Promise<void>(resolve => shop.close(() => resolve()));
        await app?.close();
        await db?.destroy();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });
    it.each([
        ['PLUS-CODE', 'plus'],
        ['PRO100-CODE', 'pro_5x'],
        ['PRO200-CODE', 'pro_20x'],
    ])('redeems %s, recovers progress and returns only website credentials', async (code, plan) => {
        expect(await api.config()).toEqual({ enabled: true, maintenance: false });
        expect((await api.verify(code)).plan).toBe(plan);
        const receipt = await api.submit(code, session(code));
        expect(receipt.plan).toBe(plan);
        expect(receipt.status).toBe('queued');
        expect(submissions).toBe(1);
        const internal = [...tasks.values()][0];
        expect(internal.payload.integrationSource).toBe('vendure-storefront');
        expect(receipt.id).not.toBe(internal.id);
        expect(JSON.stringify(receipt)).not.toContain(source);
        expect(Object.keys(receipt).sort()).toEqual(['credential', 'id', 'plan', 'status', 'updatedAt']);
        const stored = JSON.stringify(await db.getRepository(GptRechargeReceipt).find());
        for (const secret of [
            code,
            session(code),
            internal.id,
            encryption.decrypt(internal.publicTokenEncrypted),
        ])
            expect(stored).not.toContain(secret);
        internal.status = 'succeeded';
        internal.updatedAt = new Date(Date.now() + 60000);
        expect((await api.task(receipt.id, receipt.credential)).status).toBe('succeeded');
        expect((await client().query(code)).task?.id).toBe(receipt.id);
    });
    it('concurrent and lost-response submissions create only one ID task', async () => {
        mode = 'drop-response';
        await expect(api.submit('PLUS-CODE', session('same-user'))).rejects.toThrow('待核对');
        expect(submissions).toBe(1);
        mode = 'ok';
        const [a, b] = await Promise.all([
            api.submit('PLUS-CODE', session('same-user')),
            api.query('PLUS-CODE'),
        ]);
        expect(a.id).toBe(b.task?.id);
        expect(submissions).toBe(1);
    });
    it('keeps an ambiguous code in review even when the executor has no visible task yet', async () => {
        mode = 'pre-dispatch-loss';
        await expect(api.submit('PLUS-CODE', session('uncertain'))).rejects.toThrow('待核对');
        expect(submissions).toBe(0);
        const result = await api.query('PLUS-CODE');
        expect(result.status).toBe('reserved');
        expect(result.task?.status).toBe('awaiting_review');
        mode = 'ok';
        expect((await api.submit('PLUS-CODE', session('uncertain'))).status).toBe('awaiting_review');
        expect(submissions).toBe(0);
    });
    it('a rolled-back capacity rejection can be corrected; invalid JSON never dispatches', async () => {
        await expect(api.submit('PLUS-CODE', '{}')).rejects.toMatchObject({
            errorCode: 'GPT_RECHARGE_NOT_ACCEPTED',
        });
        expect(submissions).toBe(0);
        maintenance = true;
        await expect(api.submit('PLUS-CODE', session('retry'))).rejects.toMatchObject({
            errorCode: 'GPT_RECHARGE_NOT_ACCEPTED',
        });
        expect(submissions).toBe(0);
        maintenance = false;
        expect((await api.submit('PLUS-CODE', session('retry'))).status).toBe('queued');
        expect(submissions).toBe(1);
    });
    it('rejects foreign storefronts, forged task credentials and unauthenticated execution requests', async () => {
        const result = await api.submit('PLUS-CODE', session('owner'));
        for (const action of [
            () => foreignApi.verify('PLUS-CODE'),
            () => foreignApi.query('PLUS-CODE'),
            () => foreignApi.submit('PLUS-CODE', session('owner')),
            () => foreignApi.task(result.id, result.credential),
            () => api.task(result.id, 'forged'),
        ])
            await expect(action()).rejects.toThrow();
        const response = await nativeFetch(
            idUrl + '/api/id-business-v2/online-recharge/integrations/vendure/submit',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-vendure-client-ip': '198.51.100.20' },
                body: JSON.stringify({ code: 'PRO200-CODE', session: session('attacker') }),
            },
        );
        expect(response.status).toBe(403);
        expect(submissions).toBe(1);
    });
    it('rejects caller-selected Pro500 at the GraphQL and integration boundary', async () => {
        const response = await nativeFetch(shopUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                query: 'mutation { submitGptRecharge(code:"PLUS-CODE", session:"{}", plan:"pro500") { id } }',
            }),
        });
        expect((await response.json()).errors).toBeTruthy();
        const direct = await nativeFetch(
            idUrl + '/api/id-business-v2/online-recharge/integrations/vendure/submit',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-vendure-recharge-key': serviceKey,
                    'x-vendure-client-ip': '198.51.100.20',
                },
                body: JSON.stringify({ code: 'PLUS-CODE', session: session('tamper'), plan: 'pro500' }),
            },
        );
        expect(direct.status).toBe(400);
        expect(submissions).toBe(0);
    });
});
