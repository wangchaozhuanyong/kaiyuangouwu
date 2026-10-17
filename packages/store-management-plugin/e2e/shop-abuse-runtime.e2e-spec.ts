import { type INestApplication } from '@nestjs/common';
import { bootstrap, mergeConfig, TransactionalConnection } from '@vendure/core';
import {
    AdminNotificationConfigService,
    AdminNotificationService,
    OperationsDashboardPlugin,
} from '@vendure/operations-dashboard-plugin';
import { testConfig } from '@vendure/testing';
import { createRequire } from 'node:module';
import { type AddressInfo } from 'node:net';
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Use the actual compiled plugin and metadata loaded by production, not a manually
// constructed interceptor or a test GraphQL schema. Build the package before running.
const compiled = createRequire(import.meta.url);
const { ShopAbuseProtectionPlugin } = compiled(
    '../dist/abuse-protection/plugin.js',
) as typeof import('../dist/abuse-protection/plugin');
const { ShopAbuseProtectionService } = compiled(
    '../dist/abuse-protection/service.js',
) as typeof import('../dist/abuse-protection/service');
const { ShopAbuseStore } = compiled(
    '../dist/abuse-protection/store.js',
) as typeof import('../dist/abuse-protection/store');

interface GraphResponse {
    data?: Record<string, any> | null;
    errors?: Array<{ message: string; path?: string[]; extensions?: Record<string, any> }>;
}
const adminName = 'synthetic-abuse-runtime-admin';
const adminPassword = 'SyntheticRuntimeAdmin123!';
const customerEmail = 'synthetic-abuse-runtime@example.invalid';
const customerPassword = 'SyntheticRuntimeCustomer123!';
const loginQuery = `mutation RuntimeLogin($username: String!, $password: String!) {
    login(username: $username, password: $password) {
        ... on CurrentUser { id identifier }
        ... on ErrorResult { errorCode message }
    }
}`;

describe('real Vendure Shop abuse plugin bootstrap and HTTP boundary', () => {
    let app: INestApplication | undefined;
    let origin: string;
    let tokenHeader: string;
    let adminToken: string;
    const outbound: string[] = [];
    let beforeSpy: ReturnType<typeof vi.spyOn>;
    let failureSpy: ReturnType<typeof vi.spyOn>;
    const nativeFetch = globalThis.fetch;
    function application(): INestApplication {
        if (!app) throw new Error('Synthetic Vendure application did not bootstrap');
        return app;
    }

    async function request(api: 'shop-api' | 'admin-api', query: string, variables = {}, token?: string) {
        const response = await fetch(`${origin}/${api}`, {
            method: 'POST',
            signal: AbortSignal.timeout(10_000),
            headers: {
                'content-type': 'application/json',
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ query, variables }),
        });
        return { response, result: (await response.json()) as GraphResponse };
    }

    beforeAll(async () => {
        // No dev-config/dotenv imports; never consume private runtime notification settings.
        for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_OPS_CHAT_ID', 'VENDURE_DASHBOARD_URL'])
            vi.stubEnv(name, '');
        vi.stubEnv('TELEGRAM_EMERGENCY_ENABLED', 'false');
        vi.stubEnv('VENDURE_DISABLE_TELEMETRY', 'true');
        vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            const url = new URL(input instanceof Request ? input.url : input.toString());
            if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
                outbound.push(url.hostname);
                return Promise.reject(new Error('Runtime acceptance forbids non-loopback network access'));
            }
            return nativeFetch(input, init);
        });
        const config = mergeConfig(testConfig, {
            apiOptions: { hostname: '127.0.0.1', port: 0, trustProxy: false },
            dbConnectionOptions: {
                type: 'sqljs',
                database: new Uint8Array(),
                location: '',
                autoSave: false,
                synchronize: true,
            },
            authOptions: {
                requireVerification: false,
                tokenMethod: 'bearer',
                cookieOptions: { secret: 'synthetic-runtime-cookie-signing-secret' },
                superadminCredentials: { identifier: adminName, password: adminPassword },
            },
            plugins: [OperationsDashboardPlugin, ShopAbuseProtectionPlugin],
        });
        tokenHeader = config.authOptions.authTokenHeaderKey;
        app = await bootstrap(config, {
            nestApplicationOptions: { abortOnError: false },
            onBeforeAppListen: candidate => {
                app = candidate;
                return Promise.resolve();
            },
        });
        const address = app.getHttpServer().address() as AddressInfo;
        expect(address.address).toBe('127.0.0.1');
        origin = `http://127.0.0.1:${address.port}`;
        const security = app.get(ShopAbuseProtectionService);
        beforeSpy = vi.spyOn(security, 'before');
        failureSpy = vi.spyOn(security, 'observeFailure');

        const admin = await request('admin-api', loginQuery, {
            username: adminName,
            password: adminPassword,
        });
        expect(admin.result.errors).toBeUndefined();
        expect(admin.result.data?.login.identifier).toBe(adminName);
        const token = admin.response.headers.get(tokenHeader);
        if (!token) throw new Error('Synthetic admin login did not issue a session');
        adminToken = token;
        const created = await request(
            'admin-api',
            `mutation RuntimeCustomer($email: String!, $password: String!) {
            createCustomer(input: { firstName: "Synthetic", lastName: "Runtime", emailAddress: $email }, password: $password) {
                ... on Customer { id }
                ... on ErrorResult { errorCode message }
            }
        }`,
            { email: customerEmail, password: customerPassword },
            adminToken,
        );
        expect(created.result.errors).toBeUndefined();
        expect(created.result.data?.createCustomer.id).toBeTruthy();
    }, 60_000);

    afterAll(async () => {
        await app?.close();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        expect(outbound).toEqual([]);
    });

    it('resolves real Nest dependencies, entity metadata and the extended Shop schema', async () => {
        expect(application().get(ShopAbuseStore)).toBeInstanceOf(ShopAbuseStore);
        expect(application().get(ShopAbuseProtectionService)).toBeInstanceOf(ShopAbuseProtectionService);
        expect(application().get(AdminNotificationService)).toBeInstanceOf(AdminNotificationService);
        const notification = await application().get(AdminNotificationConfigService).get();
        expect(notification.enabled).toBe(false);
        expect(notification.notifySecurityEvents).toBe(false);
        expect(notification.tokenConfigured).toBe(false);
        const connection = application().get(TransactionalConnection).rawConnection;
        expect(connection.options.type).toBe('sqljs');
        expect(connection.entityMetadatas.some(entity => entity.tableName === 'shop_abuse_bucket')).toBe(
            true,
        );
        expect(connection.entityMetadatas.some(entity => entity.tableName === 'shop_abuse_challenge')).toBe(
            true,
        );
        const { result } = await request('shop-api', '{ __type(name: "Mutation") { fields { name } } }');
        expect(result.errors).toBeUndefined();
        expect(result.data?.__type.fields.map((field: { name: string }) => field.name)).toContain(
            'createShopAbuseChallenge',
        );
        const authenticated = await request(
            'shop-api',
            `mutation HarmlessAuthentication($username: String!, $password: String!) {
            account: authenticate(input: { native: { username: $username, password: $password } }) {
                ... on CurrentUser { identifier }
                ... on ErrorResult { errorCode }
            }
        }`,
            { username: customerEmail, password: customerPassword },
        );
        expect(authenticated.result.errors).toBeUndefined();
        expect(authenticated.result.data?.account.identifier).toBe(customerEmail);
        expect(authenticated.response.headers.get('cache-control')).toContain('no-store');
        expect(authenticated.response.headers.get(tokenHeader)).toBeTruthy();
    });

    it('charges actual password failures and enforces a typed challenge behind an alias', async () => {
        beforeSpy.mockClear();
        failureSpy.mockClear();
        for (let attempt = 0; attempt < 3; attempt++) {
            const { response: attemptResponse, result: attemptResult } = await request(
                'shop-api',
                loginQuery,
                {
                    username: customerEmail,
                    password: 'SyntheticWrongPassword123!',
                },
            );
            expect(attemptResult.errors).toBeUndefined();
            expect(attemptResult.data?.login.errorCode).toBe('INVALID_CREDENTIALS_ERROR');
            expect(attemptResponse.headers.get('cache-control')).toContain('no-store');
            expect(attemptResponse.headers.get(tokenHeader)).toBeNull();
        }
        const { response, result } = await request(
            'shop-api',
            `mutation HarmlessCatalogName($username: String!, $password: String!) {
            harmless: login(username: $username, password: $password) { ... on CurrentUser { id } ... on ErrorResult { errorCode } }
        }`,
            { username: customerEmail, password: customerPassword },
        );
        const rows = await application()
            .get(TransactionalConnection)
            .rawConnection.query('SELECT attempts FROM shop_abuse_bucket');
        expect(rows.filter((row: { attempts: number }) => row.attempts === 3).length).toBeGreaterThanOrEqual(
            3,
        );
        expect(beforeSpy).toHaveBeenCalledTimes(4);
        expect(failureSpy).toHaveBeenCalledTimes(3);
        expect(result.errors?.[0]).toMatchObject({
            path: ['harmless'],
            extensions: { code: 'SHOP_ABUSE_CHALLENGE_REQUIRED', action: 'LOGIN' },
        });
        expect(result.data).toBeNull();
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(response.headers.get(tokenHeader)).toBeNull();
    });

    it('issues anonymous raster challenges and leaves Admin authentication outside Shop admission', async () => {
        const { response, result } = await request(
            'shop-api',
            `mutation RuntimeProof($target: String!) {
            createShopAbuseChallenge(action: "LOGIN", target: $target) { id imageDataUrl expiresAt }
        }`,
            { target: customerEmail },
        );
        expect(result.errors).toBeUndefined();
        const proof = result.data?.createShopAbuseChallenge;
        expect(proof.id).toMatch(/^[a-f0-9]{48}$/);
        expect(proof.imageDataUrl).toMatch(/^data:image\/png;base64,/);
        expect(Buffer.from(proof.imageDataUrl.split(',')[1], 'base64').subarray(0, 8)).toEqual(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
        expect(Object.keys(proof).sort()).toEqual(['expiresAt', 'id', 'imageDataUrl']);
        expect(response.headers.get('cache-control')).toContain('no-store');
        const admin = await request('admin-api', loginQuery, {
            username: adminName,
            password: adminPassword,
        });
        expect(admin.result.errors).toBeUndefined();
        expect(admin.result.data?.login.identifier).toBe(adminName);
        expect(admin.response.headers.get(tokenHeader)).toBeTruthy();
    });
});
