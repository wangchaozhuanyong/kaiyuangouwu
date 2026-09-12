// Regression coverage for prelaunch findings A02 and A03.
import {
    ConfigService,
    mergeConfig,
    RequestContextService,
    SessionService,
    TransactionalConnection,
    UserService,
} from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

const config = mergeConfig(testConfig(), {
    authOptions: { requireVerification: false, tokenMethod: ['bearer', 'api-key'] },
});
const { server, adminClient, shopClient } = createTestEnvironment(config);
const me = gql`
    query {
        me {
            id
        }
    }
`;
beforeAll(async () => {
    await server.init({ initialData: { ...initialData, collections: [] }, customerCount: 0 });
    await adminClient.asSuperAdmin();
}, TEST_SETUP_TIMEOUT_MS);
afterAll(async () => {
    await server.destroy();
});

it('revokes another existing customer session after changing the password', async () => {
    const password = randomUUID();
    const nextPassword = randomUUID();
    const email = `audit-${randomUUID()}@example.invalid`;
    const created = await adminClient.query(
        gql`
            mutation ($input: CreateCustomerInput!, $password: String) {
                createCustomer(input: $input, password: $password) {
                    __typename
                    ... on Customer {
                        id
                    }
                }
            }
        `,
        {
            input: { firstName: 'Audit', lastName: 'Fixture', emailAddress: email },
            password,
        },
    );
    expect(created.createCustomer.__typename).toBe('Customer');
    const observer = new SimpleGraphQLClient(
        config,
        `http://127.0.0.1:${config.apiOptions.port}/${config.apiOptions.shopApiPath}`,
    );
    await shopClient.asUserWithCredentials(email, password);
    await observer.asUserWithCredentials(email, password);
    expect((await observer.query(me)).me.id).toBeTruthy();
    const observerSession = await server.app.get(SessionService).getSessionFromToken(observer.getAuthToken());
    if (!observerSession) throw new Error('Expected a cached observer session');

    const changed = await shopClient.query(
        gql`
            mutation ($old: String!, $next: String!) {
                updateCustomerPassword(currentPassword: $old, newPassword: $next) {
                    __typename
                    ... on Success {
                        success
                    }
                }
            }
        `,
        { old: password, next: nextPassword },
    );
    expect(changed.updateCustomerPassword.success).toBe(true);
    await server.app.get(ConfigService).authOptions.sessionCacheStrategy.set(observerSession);

    expect(
        (
            await observer.query(me).catch(error => {
                expect(error.message).toContain('not currently authorized');
                return { me: null };
            })
        ).me,
        'The old independent session must be revoked',
    ).toBeNull();
});

it('removes cached administrator access immediately after an API key role downgrade', async () => {
    const role = await adminClient.query(
        gql`
            mutation ($input: CreateRoleInput!) {
                createRole(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                code: `audit-read-${randomUUID()}`,
                description: 'Audit fixture',
                permissions: ['ReadProduct'],
                channelIds: ['1'],
            },
        },
    );
    const created = await adminClient.query(
        gql`
            mutation ($input: CreateApiKeyInput!) {
                createApiKey(input: $input) {
                    apiKey
                    entityId
                }
            }
        `,
        {
            input: { roleIds: ['1'], translations: [{ languageCode: 'en', name: 'Audit fixture key' }] },
        },
    );
    const actual = config;
    const call = async () => {
        const response = await fetch(
            `http://127.0.0.1:${config.apiOptions.port}/${config.apiOptions.adminApiPath}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    [String(actual.authOptions.apiKeyHeaderKey)]: created.createApiKey.apiKey,
                },
                body: JSON.stringify({ query: 'query { administrators { totalItems } }' }),
            },
        );
        return response.json() as Promise<{
            data?: { administrators?: { totalItems: number } };
            errors?: unknown[];
        }>;
    };
    expect((await call()).data?.administrators?.totalItems).toBeGreaterThan(0);
    const keyRow = await server.app
        .get(TransactionalConnection)
        .rawConnection.getRepository('ApiKey')
        .findOneOrFail({ where: { translations: { name: 'Audit fixture key' } } });
    const staleSession = await server.app.get(SessionService).getSessionFromToken(keyRow.apiKeyHash);
    if (!staleSession) throw new Error('Expected the fixture key to have a cached session');
    await adminClient.query(
        gql`
            mutation ($input: UpdateApiKeyInput!) {
                updateApiKey(input: $input) {
                    id
                }
            }
        `,
        {
            input: { id: created.createApiKey.entityId, roleIds: [role.createRole.id] },
        },
    );
    expect(
        (await call()).data?.administrators,
        'The downgraded key must lose administrator access',
    ).toBeFalsy();
    // Simulate a separate API instance retaining its pre-downgrade cache entry.
    await server.app.get(ConfigService).authOptions.sessionCacheStrategy.set(staleSession);
    expect(
        (await call()).data?.administrators,
        'A stale cache on another instance must not restore revoked permissions',
    ).toBeFalsy();
    // A later upgrade must also take effect without rotating the key.
    await adminClient.query(
        gql`
            mutation ($input: UpdateApiKeyInput!) {
                updateApiKey(input: $input) {
                    id
                }
            }
        `,
        {
            input: { id: created.createApiKey.entityId, roleIds: ['1'] },
        },
    );
    expect((await call()).data?.administrators?.totalItems).toBeGreaterThan(0);
});

it('revokes the previously authenticated session after password recovery', async () => {
    const password = randomUUID();
    const email = `audit-recovery-${randomUUID()}@example.invalid`;
    await adminClient.query(
        gql`
            mutation ($input: CreateCustomerInput!, $password: String) {
                createCustomer(input: $input, password: $password) {
                    __typename
                }
            }
        `,
        {
            input: { firstName: 'Audit', lastName: 'Recovery', emailAddress: email },
            password,
        },
    );
    const observer = new SimpleGraphQLClient(
        config,
        `http://127.0.0.1:${config.apiOptions.port}/${config.apiOptions.shopApiPath}`,
    );
    await observer.asUserWithCredentials(email, password);
    expect((await observer.query(me)).me.id).toBeTruthy();
    const observerSession = await server.app.get(SessionService).getSessionFromToken(observer.getAuthToken());
    if (!observerSession) throw new Error('Expected a cached observer session');

    const ctx = await server.app.get(RequestContextService).create({ apiType: 'shop' });
    const user = await server.app.get(UserService).setPasswordResetToken(ctx, email);
    if (!user) throw new Error('Expected the recovery fixture user');
    const token = user.getNativeAuthenticationMethod().passwordResetToken;
    const recovery = new SimpleGraphQLClient(
        config,
        `http://127.0.0.1:${config.apiOptions.port}/${config.apiOptions.shopApiPath}`,
    );
    const result = await recovery.query(
        gql`
            mutation ($token: String!, $password: String!) {
                resetPassword(token: $token, password: $password) {
                    __typename
                    ... on CurrentUser {
                        id
                    }
                }
            }
        `,
        { token, password: randomUUID() },
    );
    expect(result.resetPassword.__typename).toBe('CurrentUser');
    await server.app.get(ConfigService).authOptions.sessionCacheStrategy.set(observerSession);

    expect(
        (
            await observer.query(me).catch(error => {
                expect(error.message).toContain('not currently authorized');
                return { me: null };
            })
        ).me,
        'Recovery must revoke the previously authenticated session',
    ).toBeNull();
});
