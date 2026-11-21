import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    AutoIncrementIdStrategy,
    CurrencyCode,
    LanguageCode,
    mergeConfig,
    TransactionalConnection,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment } from '@vendure/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { createOperatingStoreFixture } from '../../../e2e-common/operating-store-fixture';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { ShopAbuseProtectionPlugin } from '../src/abuse-protection/plugin';
import { GptRechargeReceipt } from '../src/gpt-recharge/entities';
import { GptRechargePlugin } from '../src/gpt-recharge/plugin';
import { rechargeFingerprint, sealRechargeSecret } from '../src/gpt-recharge/security';
import { StoreManagementPlugin } from '../src/store-management.plugin';

const config = mergeConfig(testConfig(), {
    // Match deployed Vendure. The testing strategy prefixes even opaque task IDs with T_.
    entityOptions: { entityIdStrategy: new AutoIncrementIdStrategy() },
    authOptions: { cookieOptions: { secret: randomUUID() } },
    plugins: [
        OperationsDashboardPlugin,
        StorefrontCartPlugin,
        StoreDomainPlugin.init({ cnameTarget: 'edge.example.invalid', routingMode: 'require-domain' }),
        ContentTranslationPlugin.init({
            provider: {
                name: 'standalone-recharge-test',
                isConfigured: () => false,
                translate: () => Promise.reject(new Error('Unexpected translation')),
            },
        }),
        GptRechargePlugin,
        ShopAbuseProtectionPlugin,
        StoreManagementPlugin.init({ enabled: true, signingSecret: randomUUID() }),
    ],
});
const { server } = createTestEnvironment(config);

describe('standalone recharge → Vendure domain routing, Shop API and task stream', () => {
    const id = randomUUID();
    let credential: string;
    let host: string;
    let otherHost: string;
    let otherToken: string;
    function post(path: string, targetHost: string, input: object) {
        return new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
            const req = request(
                {
                    hostname: '127.0.0.1',
                    port: config.apiOptions.port,
                    path,
                    method: 'POST',
                    headers: {
                        Host: targetHost,
                        'content-type': 'application/json',
                        'vendure-token': otherToken,
                    },
                },
                res => {
                    res.setEncoding('utf8');
                    let body = '';
                    res.on('data', chunk => {
                        body += chunk;
                    });
                    res.on('end', () => {
                        const status = res.statusCode;
                        if (status === undefined) return reject(new Error('Missing HTTP response status'));
                        resolve({ status, type: res.headers['content-type'] ?? '', body });
                    });
                },
            );
            req.once('error', reject);
            req.end(JSON.stringify(input));
        });
    }
    beforeAll(async () => {
        vi.stubEnv('GPT_RECHARGE_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
        await server.init({
            initialData: { ...initialData, collections: [], paymentMethods: [] },
            customerCount: 0,
        });
        const connection = server.app.get(TransactionalConnection).rawConnection;
        await connection.synchronize();
        const createStore = (code: string) =>
            createOperatingStoreFixture(server.app, {
                code,
                currencyCode: CurrencyCode.USD,
                defaultLanguageCode: LanguageCode.en,
                commerceMode: 'DIGITAL_ONLY',
            });
        const owner = await createStore('recharge-owner');
        const foreign = await createStore('recharge-foreign');
        host = owner.code + '.example.invalid';
        otherHost = foreign.code + '.example.invalid';
        otherToken = foreign.token;
        credential = rechargeFingerprint(id, 'gpt:' + owner.id + ':task');
        await connection.getRepository(GptRechargeReceipt).save(
            new GptRechargeReceipt({
                channelId: owner.id,
                publicId: id,
                plan: 'pro500',
                status: 'succeeded',
                encryptedUpstreamTask: sealRechargeSecret(
                    JSON.stringify({
                        id: randomUUID(),
                        taskToken: '',
                        accountEmail: 'customer@example.test',
                    }),
                    'gpt:' + owner.id + ':' + id,
                ),
                codeFingerprint: randomBytes(32).toString('hex'),
            }),
        );
    }, TEST_SETUP_TIMEOUT_MS);
    afterAll(async () => {
        try {
            await server.destroy();
        } finally {
            vi.unstubAllEnvs();
        }
    });
    it('resolves the stored receipt by its verified Host and rejects other stores', async () => {
        const task = await post('/api/recharge/task', host, { id, credential });
        expect(JSON.parse(task.body)).toMatchObject({
            data: {
                gptRechargeTask: {
                    id,
                    plan: 'pro500',
                    status: 'succeeded',
                    accountEmail: 'c***@example.test',
                },
            },
        });
        const denied = await post('/api/recharge/task', otherHost, { id, credential });
        expect(JSON.parse(denied.body).errors).toBeTruthy();
        const unknown = await post('/api/recharge/task', 'unknown.example.invalid', { id, credential });
        expect([403, 404]).toContain(unknown.status);
        const challenge = await post('/api/recharge/challenge', host, {
            action: 'RECHARGE_CODE',
            target: 'example',
        });
        expect(JSON.parse(challenge.body).data?.createShopAbuseChallenge.id).toMatch(/^[a-f0-9]{48}$/);
    });
    it('uses the real private stream for the same host and receipt', async () => {
        const stream = await post('/api/recharge/events', host, { id, credential });
        expect(stream.type).toContain('text/event-stream');
        expect(stream.body).toContain('event: ready');
        expect(stream.body).toContain('event: task');
        expect(stream.body).toContain(id);
        expect(stream.body).toContain('c***@example.test');
        expect(stream.body).not.toContain('customer@example.test');
        expect((await post('/api/recharge/events', otherHost, { id, credential })).status).toBe(403);
    });
});
