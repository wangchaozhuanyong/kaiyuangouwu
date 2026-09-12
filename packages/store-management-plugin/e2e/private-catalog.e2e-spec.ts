import { APP_INTERCEPTOR } from '@nestjs/core';
import { LanguageCode, mergeConfig, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StorefrontPromotionAccessService } from '../src/promotion/storefront-promotion-access.service';
import { StorefrontPromotionController } from '../src/promotion/storefront-promotion.controller';
import { StorefrontPromotionService } from '../src/promotion/storefront-promotion.service';
import { StorefrontCatalogAccessInterceptor } from '../src/storefront-catalog-access.interceptor';

@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [StorefrontPromotionController],
    providers: [
        { provide: APP_INTERCEPTOR, useClass: StorefrontCatalogAccessInterceptor },
        {
            provide: StorefrontPromotionAccessService,
            useValue: {
                resolveRequest: () => Promise.resolve({ channelId: 'fixture-store' }),
            },
        },
        { provide: StorefrontPromotionService, useValue: {} },
    ],
})
class PrivateCatalogTestPlugin {}

const config = mergeConfig(testConfig(), {
    authOptions: { requireVerification: false, tokenMethod: ['cookie', 'bearer'] },
    plugins: [PrivateCatalogTestPlugin],
});
const { server, adminClient, shopClient } = createTestEnvironment(config);
let productId: string;
const catalog = gql`
    query {
        products {
            totalItems
            items {
                id
                name
            }
        }
    }
`;

describe('Shop API catalog authentication', () => {
    beforeAll(async () => {
        await server.init({ initialData: { ...initialData, collections: [] }, customerCount: 0 });
        await adminClient.asSuperAdmin();
        const result = await adminClient.query(
            gql`
                mutation CreatePrivateProduct($input: CreateProductInput!) {
                    createProduct(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    enabled: true,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Private catalog fixture',
                            slug: 'private-catalog-fixture',
                            description: 'Visible only after authentication',
                        },
                    ],
                },
            },
        );
        productId = result.createProduct.id;
    }, TEST_SETUP_TIMEOUT_MS);
    afterAll(() => server.destroy());

    it('blocks direct anonymous catalog access through real Nest authorization', async () => {
        await expect(shopClient.query(catalog)).rejects.toThrow();
        await expect(
            shopClient.query(gql`
            query PretendLogin {
                login: product(id: "${productId}") { ...Details }
            }
            fragment Details on Product { id name }
        `),
        ).rejects.toThrow();
        const account = await shopClient.query(gql`
            query {
                activeCustomer {
                    id
                }
            }
        `);
        expect(account.activeCustomer).toBeNull();
    });
    it('allows account creation and login, then rejects the same query after logout', async () => {
        await shopClient.query(gql`
            mutation {
                registerCustomerAccount(
                    input: {
                        emailAddress: "private-catalog@example.test"
                        password: "LocalFixturePass123!"
                        firstName: "Catalog"
                        lastName: "Fixture"
                    }
                ) {
                    __typename
                }
            }
        `);
        await shopClient.asUserWithCredentials('private-catalog@example.test', 'LocalFixturePass123!');
        const result = await shopClient.query(catalog);
        expect(result.products.items).toContainEqual({ id: productId, name: 'Private catalog fixture' });
        await shopClient.query(gql`
            mutation {
                logout {
                    success
                }
            }
        `);
        await expect(shopClient.query(catalog)).rejects.toThrow();
        const adminResult = await adminClient.query(catalog);
        expect(adminResult.products.totalItems).toBeGreaterThan(0);
    });
    it('uses a real signed account cookie, not the promotion cookie, for the media auth endpoint', async () => {
        const origin = `http://127.0.0.1:${config.apiOptions.port}`;
        const denied = await fetch(`${origin}/promo/access`, {
            headers: { cookie: 'storefront-entry=fixture-entry-cookie' },
        });
        expect(denied.status).toBe(401);
        const login = await fetch(`${origin}/shop-api`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                query: `mutation {
                    login(username: "private-catalog@example.test", password: "LocalFixturePass123!") {
                        __typename
                    }
                }`,
            }),
        });
        const cookies = login.headers
            .getSetCookie()
            .map(value => value.split(';')[0])
            .join('; ');
        expect(cookies.length).toBeGreaterThan(0);
        const allowed = await fetch(`${origin}/promo/access`, { headers: { cookie: cookies } });
        expect(allowed.status).toBe(204);
        await fetch(`${origin}/shop-api`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: cookies },
            body: JSON.stringify({ query: 'mutation { logout { success } }' }),
        });
        const expired = await fetch(`${origin}/promo/access`, { headers: { cookie: cookies } });
        expect(expired.status).toBe(401);
    });
});
