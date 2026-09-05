import {
    ConfigService,
    Customer,
    DefaultLogger,
    LogLevel,
    mergeConfig,
    NativeAuthenticationMethod,
    PasswordCipher,
    TransactionalConnection,
    User,
} from '@vendure/core';
import {
    createTestEnvironment,
    MysqlInitializer,
    registerInitializer,
    SqljsInitializer,
    testConfig,
} from '@vendure/testing';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initialData } from '../../../../e2e-common/e2e-initial-data';
import { TwoFactorDashboardPlugin } from '../two-factor-dashboard.plugin';

import { hashValue, totpAtStep } from './admin-two-factor.crypto';
import {
    AdminTwoFactorChallenge,
    AdminTwoFactorCredential,
    AdminTwoFactorRateLimit,
} from './admin-two-factor.entity';
import { AdminTwoFactorService } from './admin-two-factor.service';

const begin =
    'mutation($u:String!,$p:String!){adminBeginLogin(username:$u,password:$p,rememberMe:false){status challengeToken expiresAt message}}';
const complete =
    'mutation($t:String!,$c:String!){adminCompleteTwoFactorLogin(challengeToken:$t,code:$c){status message}}';
const status = '{adminTwoFactorStatus{enabled available recoveryCodesRemaining}}';
const setup =
    'mutation($p:String!,$c:String){adminBeginTwoFactorSetup(password:$p,code:$c){secret otpauthUri}}';
const confirm =
    'mutation($p:String!,$c:String!){adminConfirmTwoFactorSetup(password:$p,code:$c){success recoveryCodes}}';
const disable = 'mutation($p:String!,$c:String!){adminDisableTwoFactor(password:$p,code:$c){success}}';

describe.sequential('administrator login 2FA through real GraphQL and SQL', () => {
    let environment: ReturnType<typeof createTestEnvironment>;
    let directory: string;
    let url: string;
    let connection: TransactionalConnection;
    let password: string;
    let firstToken: string;
    let token: string;
    let secret: string;
    let codes: string[];
    const username = 'two-factor-test-admin';

    async function request(
        query: string,
        variables: Record<string, unknown> = {},
        authToken?: string,
        shop = false,
        apiKey?: string,
    ) {
        const response = await fetch(shop ? url.replace('/admin-api', '/shop-api') : url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                ...(apiKey
                    ? { [environment.server.app.get(ConfigService).authOptions.apiKeyHeaderKey]: apiKey }
                    : {}),
            },
            body: JSON.stringify({ query, variables }),
        });
        const result = await response.json();
        return {
            ...result,
            token: response.headers.get('vendure-auth-token'),
            cacheControl: response.headers.get('cache-control'),
        };
    }

    beforeAll(async () => {
        directory = await mkdtemp(path.join(tmpdir(), 'vendure-admin-2fa-test-'));
        process.env.ADMIN_TWO_FACTOR_ENCRYPTION_KEY = randomBytes(32).toString('hex');
        password = randomBytes(20).toString('hex');
        const listener = createServer();
        await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
        const port = (listener.address() as { port: number }).port;
        await new Promise<void>(resolve => listener.close(() => resolve()));
        url = `http://127.0.0.1:${port}/admin-api`;
        registerInitializer('sqljs', new SqljsInitializer(directory));
        // Use only an explicitly selected disposable MySQL fixture, as in the core E2E suite.
        const mysql = process.env.DB === 'mysql';
        if (mysql && !process.env.E2E_MYSQL_PORT) throw new Error('E2E_MYSQL_PORT is required');
        if (mysql) registerInitializer('mysql', new MysqlInitializer());
        environment = createTestEnvironment(
            mergeConfig(testConfig, {
                ...(mysql
                    ? {
                          dbConnectionOptions: {
                              type: 'mysql' as const,
                              host: '127.0.0.1',
                              port: Number(process.env.E2E_MYSQL_PORT),
                              username: 'root',
                              password: 'password',
                              synchronize: true,
                          },
                      }
                    : {}),
                apiOptions: { port },
                logger: new DefaultLogger({ level: LogLevel.Error }),
                authOptions: {
                    superadminCredentials: { identifier: username, password },
                    tokenMethod: ['bearer', 'api-key'],
                },
                plugins: [TwoFactorDashboardPlugin],
            }),
        );
        await environment.server.init({ initialData, customerCount: 0 });
        connection = environment.server.app.get(TransactionalConnection);
    });

    beforeEach(async () => {
        await connection.rawConnection.getRepository(AdminTwoFactorRateLimit).clear();
    });

    afterAll(async () => {
        await environment?.server.destroy();
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    it('keeps unenrolled login working and requires password plus a valid setup code to enable', async () => {
        const login = await request(begin, { u: username, p: password });
        expect(login.errors).toBeUndefined();
        expect(login.data.adminBeginLogin.status).toBe('SUCCESS');
        firstToken = login.token;
        // MySQL INSERT IGNORE returns no generated ID for an existing rate-limit bucket.
        const repeated = await request(begin, { u: username, p: password });
        expect(repeated.errors).toBeUndefined();
        expect(repeated.data.adminBeginLogin.status).toBe('SUCCESS');
        expect((await request(status, {}, firstToken)).data.adminTwoFactorStatus).toMatchObject({
            enabled: false,
            available: true,
        });
        expect((await request(setup, { p: 'incorrect' }, firstToken)).errors).toBeDefined();
        const pending = await request(setup, { p: password }, firstToken);
        expect(pending.errors).toBeUndefined();
        expect(pending.cacheControl).toBe('no-store');
        secret = pending.data.adminBeginTwoFactorSetup.secret;
        const row = await connection.rawConnection
            .getRepository(AdminTwoFactorCredential)
            .findOneByOrFail({});
        expect(row.pendingSecret).not.toContain(secret);
        expect((await request(status, {}, firstToken)).data.adminTwoFactorStatus.enabled).toBe(false);
        expect((await request(confirm, { p: password, c: 'invalid' }, firstToken)).errors).toBeDefined();
        const enabled = await request(
            confirm,
            { p: password, c: totpAtStep(secret, Math.floor(Date.now() / 30000)) },
            firstToken,
        );
        expect(enabled.errors).toBeUndefined();
        codes = enabled.data.adminConfirmTwoFactorSetup.recoveryCodes;
        expect(codes).toHaveLength(10);
        expect((await request('{me{id}}', {}, firstToken)).errors).toBeDefined();
        const stored = await connection.rawConnection
            .getRepository(AdminTwoFactorCredential)
            .findOneByOrFail({});
        expect(stored.recoveryHashes).not.toContain(codes[0]);
        expect(stored.pendingSecret).toBeNull();
    });

    it('keeps duplicate bucket inserts atomic and preserves the limit and expiry reset', async () => {
        const service = environment.server.app.get(AdminTwoFactorService);
        const scope = 'duplicate-bucket-regression';
        const outcomes = await Promise.allSettled(
            Array.from({ length: 6 }, () => service.rateLimit(scope, 3)),
        );
        expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(3);
        for (const outcome of outcomes) {
            if (outcome.status === 'rejected') expect(outcome.reason.message).toContain('尝试次数过多');
        }
        const repository = connection.rawConnection.getRepository(AdminTwoFactorRateLimit);
        expect((await repository.findOneByOrFail({ bucket: hashValue(scope) })).attempts).toBe(3);
        await repository.update({ bucket: hashValue(scope) }, { expiresAt: new Date(Date.now() - 1000) });
        await service.rateLimit(scope, 3);
        expect((await repository.findOneByOrFail({ bucket: hashValue(scope) })).attempts).toBe(1);
    });

    it('rejects legacy login, authenticate(native), setup-code replay and Shop API session reuse', async () => {
        for (const query of [
            'mutation($u:String!,$p:String!){login(username:$u,password:$p){__typename}}',
            'mutation($u:String!,$p:String!){authenticate(input:{native:{username:$u,password:$p}}){__typename}}',
        ]) {
            const result = await request(query, { u: username, p: password });
            expect(Object.values(result.data)[0]).toEqual({ __typename: 'InvalidCredentialsError' });
            expect(result.token).toBeFalsy();
        }
        const login = await request(begin, { u: username, p: password });
        expect(login.token).toBeFalsy();
        expect(login.data.adminBeginLogin.status).toBe('REQUIRES_2FA');
        const enrolled = await connection.rawConnection
            .getRepository(AdminTwoFactorCredential)
            .findOneByOrFail({});
        const replay = await request(complete, {
            t: login.data.adminBeginLogin.challengeToken,
            c: totpAtStep(secret, enrolled.lastUsedStep),
        });
        expect(replay.data.adminCompleteTwoFactorLogin.status).toBe('ERROR');
        expect(replay.token).toBeFalsy();
        // A shared administrator/customer User is a possible alternate-session route.
        const user = await connection.rawConnection
            .getRepository(User)
            .findOneByOrFail({ identifier: username });
        await connection.rawConnection.getRepository(Customer).save(
            new Customer({
                firstName: 'Security',
                lastName: 'Fixture',
                emailAddress: 'security-fixture@example.invalid',
                user,
            }),
        );
        const shop = await request(
            'mutation($u:String!,$p:String!){login(username:$u,password:$p){__typename}}',
            { u: username, p: password },
            undefined,
            true,
        );
        expect(shop.token).toBeTruthy();
        expect((await request('{me{id}}', {}, shop.token)).errors).toBeDefined();
    });

    it('consumes a recovery code and challenge only once under concurrent requests', async () => {
        const login = await request(begin, { u: username, p: password });
        const challengeToken = login.data.adminBeginLogin.challengeToken;
        const results = await Promise.all([
            request(complete, { t: challengeToken, c: codes[0] }),
            request(complete, { t: challengeToken, c: codes[0] }),
        ]);
        const successful = results.filter(
            result => result.data?.adminCompleteTwoFactorLogin.status === 'SUCCESS',
        );
        expect(successful).toHaveLength(1);
        token = successful[0].token;
        expect((await request(status, {}, token)).data.adminTwoFactorStatus.recoveryCodesRemaining).toBe(9);
        const replay = await request(complete, { t: challengeToken, c: codes[1] });
        expect(replay.data.adminCompleteTwoFactorLogin.status).toBe('ERROR');
        const next = await request(begin, { u: username, p: password });
        expect(
            (await request(complete, { t: next.data.adminBeginLogin.challengeToken, c: codes[0] })).data
                .adminCompleteTwoFactorLogin.status,
        ).toBe('ERROR');
    });

    it('accepts a fresh TOTP code within clock skew and rejects reuse on another challenge', async () => {
        const code = totpAtStep(secret, Math.floor(Date.now() / 30000) + 1);
        const login = await request(begin, { u: username, p: password });
        const result = await request(complete, { t: login.data.adminBeginLogin.challengeToken, c: code });
        expect(result.data.adminCompleteTwoFactorLogin.status).toBe('SUCCESS');
        expect((await request(status, {}, result.token)).data.adminTwoFactorStatus.enabled).toBe(true);
        const next = await request(begin, { u: username, p: password });
        expect(
            (await request(complete, { t: next.data.adminBeginLogin.challengeToken, c: code })).data
                .adminCompleteTwoFactorLogin.status,
        ).toBe('ERROR');
    });

    it('expires challenges and persists failed attempts instead of allowing unlimited retries', async () => {
        const login = await request(begin, { u: username, p: password });
        const challengeToken = login.data.adminBeginLogin.challengeToken;
        for (let i = 0; i < 5; i++) await request(complete, { t: challengeToken, c: 'invalid' });
        const blocked = await request(complete, { t: challengeToken, c: codes[1] });
        expect(blocked.data.adminCompleteTwoFactorLogin.status).toBe('ERROR');
        const row = await connection.rawConnection
            .getRepository(AdminTwoFactorChallenge)
            .findOneByOrFail({ tokenHash: hashValue(challengeToken) });
        expect(row.attempts).toBe(5);
        const next = await request(begin, { u: username, p: password });
        await connection.rawConnection
            .getRepository(AdminTwoFactorChallenge)
            .update(
                { tokenHash: hashValue(next.data.adminBeginLogin.challengeToken) },
                { expiresAt: new Date(Date.now() - 1000) },
            );
        expect(
            (await request(complete, { t: next.data.adminBeginLogin.challengeToken, c: codes[1] })).data
                .adminCompleteTwoFactorLogin.status,
        ).toBe('ERROR');
    });

    it('allows scoped API-key business calls but rejects personal 2FA operations', async () => {
        const profile = await request('{activeAdministrator{user{roles{id}}}}', {}, token);
        const roleIds = profile.data.activeAdministrator.user.roles.map((role: { id: string }) => role.id);
        const created = await request(
            'mutation($roles:[ID!]!){createApiKey(input:{roleIds:$roles,translations:[{languageCode:en,name:"2FA test integration"}]}){apiKey}}',
            { roles: roleIds },
            token,
        );
        expect(created.errors).toBeUndefined();
        const apiKey = created.data.createApiKey.apiKey;
        expect((await request('{channels{items{id}}}', {}, undefined, false, apiKey)).errors).toBeUndefined();
        expect((await request(status, {}, undefined, false, apiKey)).errors).toBeDefined();
        expect(
            (await request(setup, { p: password, c: codes[1] }, undefined, false, apiKey)).errors,
        ).toBeDefined();
        expect(
            (await request(disable, { p: password, c: codes[1] }, undefined, false, apiKey)).errors,
        ).toBeDefined();
    });

    it('invalidates pending challenges and authenticated sessions when a password changes', async () => {
        const login = await request(begin, { u: username, p: password });
        const user = await connection.rawConnection
            .getRepository(User)
            .findOneByOrFail({ identifier: username });
        const repository = connection.rawConnection.getRepository(NativeAuthenticationMethod);
        const method = await repository.findOneOrFail({
            where: { user: { id: user.id } },
            select: ['id', 'passwordHash'],
        });
        const newHash = await environment.server.app
            .get(PasswordCipher)
            .hash(randomBytes(24).toString('hex'));
        try {
            await repository.update(method.id, { passwordHash: newHash });
            expect((await request('{me{id}}', {}, token)).errors).toBeDefined();
            expect(
                (await request(complete, { t: login.data.adminBeginLogin.challengeToken, c: codes[1] })).data
                    .adminCompleteTwoFactorLogin.status,
            ).toBe('ERROR');
        } finally {
            await repository.update(method.id, { passwordHash: method.passwordHash });
        }
    });

    it('replaces an authenticator only after confirmation and regenerates recovery codes with revocation', async () => {
        const previous = await connection.rawConnection
            .getRepository(AdminTwoFactorCredential)
            .findOneByOrFail({});
        const pending = await request(setup, { p: password, c: codes[2] }, token);
        expect(pending.errors).toBeUndefined();
        const beforeConfirmation = await connection.rawConnection
            .getRepository(AdminTwoFactorCredential)
            .findOneByOrFail({});
        expect(beforeConfirmation.encryptedSecret).toBe(previous.encryptedSecret);
        expect(beforeConfirmation.enabledAt).toBeTruthy();
        secret = pending.data.adminBeginTwoFactorSetup.secret;
        const confirmed = await request(
            confirm,
            { p: password, c: totpAtStep(secret, Math.floor(Date.now() / 30000)) },
            token,
        );
        expect(confirmed.errors).toBeUndefined();
        codes = confirmed.data.adminConfirmTwoFactorSetup.recoveryCodes;
        expect((await request(status, {}, token)).errors).toBeDefined();
        const login = await request(begin, { u: username, p: password });
        token = (await request(complete, { t: login.data.adminBeginLogin.challengeToken, c: codes[0] }))
            .token;
        const waiting = await request(begin, { u: username, p: password });
        const regenerated = await request(
            'mutation($p:String!,$c:String!){adminRegenerateTwoFactorRecoveryCodes(password:$p,code:$c){recoveryCodes}}',
            { p: password, c: codes[1] },
            token,
        );
        expect(regenerated.errors).toBeUndefined();
        expect((await request(status, {}, token)).errors).toBeDefined();
        const oldUnusedCode = codes[3];
        codes = regenerated.data.adminRegenerateTwoFactorRecoveryCodes.recoveryCodes;
        expect(
            (await request(complete, { t: waiting.data.adminBeginLogin.challengeToken, c: codes[0] })).data
                .adminCompleteTwoFactorLogin.status,
        ).toBe('ERROR');
        const fresh = await request(begin, { u: username, p: password });
        expect(
            (await request(complete, { t: fresh.data.adminBeginLogin.challengeToken, c: oldUnusedCode })).data
                .adminCompleteTwoFactorLogin.status,
        ).toBe('ERROR');
        token = (await request(complete, { t: fresh.data.adminBeginLogin.challengeToken, c: codes[0] }))
            .token;
        expect(token).toBeTruthy();
    });

    it('requires a second factor to disable, revokes sessions and permits a fresh password login', async () => {
        expect((await request(disable, { p: password, c: 'invalid' }, token)).errors).toBeDefined();
        expect((await request(status, {}, token)).data.adminTwoFactorStatus.enabled).toBe(true);
        const disabled = await request(disable, { p: password, c: codes[1] }, token);
        expect(disabled.errors).toBeUndefined();
        expect(disabled.data.adminDisableTwoFactor.success).toBe(true);
        expect((await request('{me{id}}', {}, token)).errors).toBeDefined();
        const login = await request(begin, { u: username, p: password });
        expect(login.data.adminBeginLogin.status).toBe('SUCCESS');
        token = login.token;
        expect((await request(status, {}, token)).data.adminTwoFactorStatus.enabled).toBe(false);
        const pending = await request(setup, { p: password }, token);
        expect(pending.data.adminBeginTwoFactorSetup.secret).not.toBe(secret);
    });

    it.runIf(process.env.ADMIN_2FA_BROWSER_QA === '1')(
        'completes enrollment, recovery login and disabling in a real browser',
        async () => {
            const { runAdminTwoFactorBrowserQa } = await import('./admin-two-factor.browser-qa.js');
            await runAdminTwoFactorBrowserQa(url, username, password);
        },
        90000,
    );
});
