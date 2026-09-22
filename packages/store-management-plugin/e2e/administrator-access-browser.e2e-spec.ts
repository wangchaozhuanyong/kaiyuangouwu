import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    AdministratorService,
    ChannelService,
    ConfigService,
    CurrencyCode,
    DefaultSearchPlugin,
    LanguageCode,
    mergeConfig,
    Permission,
    RequestContextService,
    RoleService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { NextAdminPlugin } from '@vendure/next-admin-plugin';
import { StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { StorefrontContentPlugin } from '@vendure/storefront-content-plugin';
import { StorefrontReviewPlugin } from '@vendure/storefront-review-plugin';
import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import { TwoFactorDashboardPlugin } from '@vendure/two-factor-dashboard-plugin';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { CommerceFulfillmentPlugin } from '../../commerce-fulfillment-plugin/src/commerce-fulfillment.plugin';
import { AdministratorAccessService } from '../src/administrator-access.service';
import { manageStoreTeamPermission } from '../src/constants';
import { MerchantInitialPasswordService } from '../src/merchant-initial-password.service';
import { StoreManagementPlugin } from '../src/store-management.plugin';

const initialPassword = 'LocalFixturePass123!';
const credentials = {
    owner: { username: 'superadmin', password: 'superadmin' },
    platformAdmin: { username: 'platform-admin@example.test', password: initialPassword },
    companyStaff: { username: 'company-staff@example.test', password: initialPassword },
    storePrimary: { username: 'store-primary@example.test', password: initialPassword },
    storeManager: { username: 'store-manager@example.test', password: initialPassword },
    storeStaff: { username: 'store-staff@example.test', password: initialPassword },
} as const;

const config = mergeConfig(testConfig(), {
    authOptions: { requireVerification: false, tokenMethod: ['cookie', 'bearer'] },
    customFields: {
        Channel: [
            {
                name: 'storefrontNameZh',
                type: 'string',
                length: 32,
                nullable: false,
                defaultValue: '测试店铺',
                public: true,
            },
            {
                name: 'storefrontNameEn',
                type: 'string',
                length: 32,
                nullable: false,
                defaultValue: 'Test Store',
                public: true,
            },
        ],
    },
    plugins: [
        ContentTranslationPlugin.init({
            provider: {
                name: 'administrator-access-browser-test',
                isConfigured: () => false,
                translate: () => Promise.reject(new Error('Browser acceptance must not translate content')),
            },
        }),
        StorefrontCartPlugin,
        CatalogManagementPlugin,
        StoreManagementPlugin.init({
            enabled: false,
            signingSecret: 'administrator-browser-e2e-secret-at-least-32-characters',
        }),
        CommerceFulfillmentPlugin.init({ testPaymentsEnabled: false }),
        StoreDomainPlugin.init({ cnameTarget: 'stores.example.test' }),
        StorefrontContentPlugin,
        StorefrontReviewPlugin,
        DefaultSearchPlugin.init({ bufferUpdates: false }),
        TwoFactorDashboardPlugin,
        NextAdminPlugin.init({
            route: 'dashboard',
            appDir: join(__dirname, '../../next-admin/dist'),
            serveStatic: true,
        }),
    ],
});

const { server } = createTestEnvironment(config);
const origin = `http://127.0.0.1:${config.apiOptions.port}`;
let browser: Browser;

describe.sequential('administrator access browser acceptance', () => {
    beforeAll(async () => {
        registerInitializer(
            'sqljs',
            new SqljsInitializer(mkdtempSync(join(tmpdir(), 'vendure-administrator-browser-'))),
        );
        await server.init({
            initialData: { ...initialData, collections: [], paymentMethods: [] },
            customerCount: 0,
        });
        await seedAccessMatrix();
        browser = await chromium.launch({ headless: true });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await browser?.close();
        await server.destroy();
    });

    it('lets the sole platform owner manage every lower level and exposes owner-only policy', async () => {
        await withAuthenticatedPage(credentials.owner, async page => {
            await openTeamPage(page, true);
            await expectPageText(page, '平台所有者专属权限（不可下放）');
            await expectPageText(page, '公司跨店权限（只可授予平台岗位，不可授予店铺岗位）');
            expect(await manageableEmails(page)).toEqual([
                'company-staff@example.test',
                'platform-admin@example.test',
                'store-manager@example.test',
                'store-primary@example.test',
                'store-staff@example.test',
            ]);
        });
    });

    it('lets a platform administrator manage lower platform and store accounts but not the owner', async () => {
        await withAuthenticatedPage(credentials.platformAdmin, async page => {
            await openTeamPage(page, true);
            await expectPageText(page, '公司跨店权限（只可授予平台岗位，不可授予店铺岗位）');
            expect(await page.getByText('平台所有者专属权限（不可下放）').count()).toBe(0);
            expect(await manageableEmails(page)).toEqual([
                'company-staff@example.test',
                'store-manager@example.test',
                'store-primary@example.test',
                'store-staff@example.test',
            ]);
        });
    });

    it('keeps company staff on assigned cross-store work without team-management access', async () => {
        await withAuthenticatedPage(credentials.companyStaff, async page => {
            await openTeamPage(page, false);
            expect(await manageableEmails(page)).toEqual([]);
            await page.getByLabel('切换当前店铺').selectOption('browser-store-token');
            await page.waitForFunction(
                () => sessionStorage.getItem('vendure-active-channel-token') === 'browser-store-token',
            );
            await expectProductOnlyDashboard(page);
            await openCatalogPage(page);
        });
    });

    it('lets the store primary manage only lower accounts in its own store and blocks native list bypass', async () => {
        await withAuthenticatedPage(credentials.storePrimary, async page => {
            await expectProductOnlyDashboard(page);
            await openTeamPage(page, true);
            expect(await manageableEmails(page)).toEqual([
                'store-manager@example.test',
                'store-staff@example.test',
            ]);
            const bypass = await graphql(
                page,
                `
                    query {
                        administrators {
                            totalItems
                        }
                    }
                `,
            );
            expect(bypass.errors?.[0]?.message).toContain('店铺账号请使用本店团队与岗位列表');
        });
    });

    it('lets a store manager run store operations without account or role administration', async () => {
        await withAuthenticatedPage(credentials.storeManager, async page => {
            await openTeamPage(page, false);
            expect(await manageableEmails(page)).toEqual([]);
            await openCatalogPage(page);
        });
    });

    it('keeps a store employee within the assigned store job permissions', async () => {
        await withAuthenticatedPage(credentials.storeStaff, async page => {
            await expectProductOnlyDashboard(page);
            await openTeamPage(page, false);
            expect(await manageableEmails(page)).toEqual([]);
            await openCatalogPage(page);
        });
    });
});

async function seedAccessMatrix() {
    const app = server.app;
    const connection = app.get(TransactionalConnection);
    const configService = app.get(ConfigService);
    let superAdmin = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { identifier: configService.authOptions.superadminCredentials.identifier },
        relations: { roles: { channels: true } },
    });
    let ctx = await app.get(RequestContextService).create({ apiType: 'admin', user: superAdmin });
    const access = app.get(AdministratorAccessService);
    const roleService = app.get(RoleService);
    const administratorService = app.get(AdministratorService);
    const initialPasswords = app.get(MerchantInitialPasswordService);
    const channelService = app.get(ChannelService);

    await access.current(ctx);
    await access.createManagedAdministrator(ctx, {
        firstName: 'Platform',
        lastName: 'Admin',
        emailAddress: credentials.platformAdmin.username,
        password: initialPassword,
        roleIds: [],
        scope: 'PLATFORM',
        authority: 'ADMIN',
    });
    const companyRole = await access.createManagedRole(ctx, {
        code: 'browser-company-staff',
        description: '公司商品运营',
        permissions: [Permission.ReadProduct],
        scope: 'PLATFORM',
    });
    await access.createManagedAdministrator(ctx, {
        firstName: 'Company',
        lastName: 'Staff',
        emailAddress: credentials.companyStaff.username,
        password: initialPassword,
        roleIds: [companyRole.id],
        scope: 'PLATFORM',
        authority: 'STAFF',
    });

    const template = await channelService.getDefaultChannel();
    const createdChannel = await channelService.create(ctx, {
        code: 'browser-store',
        token: 'browser-store-token',
        defaultLanguageCode: LanguageCode.en,
        currencyCode: CurrencyCode.USD,
        pricesIncludeTax: template.pricesIncludeTax,
    });
    if ('errorCode' in createdChannel) throw new Error(createdChannel.message);
    const [superAdminRole, customerRole] = await Promise.all([
        roleService.getSuperAdminRole(ctx),
        roleService.getCustomerRole(ctx),
    ]);
    await roleService.assignRoleToChannel(ctx, superAdminRole.id, createdChannel.id);
    await roleService.assignRoleToChannel(ctx, customerRole.id, createdChannel.id);
    await access.extendPlatformRolesToChannel(ctx, createdChannel);
    superAdmin = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { id: superAdmin.id },
        relations: { roles: { channels: true } },
    });
    ctx = await app
        .get(RequestContextService)
        .create({ apiType: 'admin', user: superAdmin, channelOrToken: createdChannel });

    const storePrimaryRole = await roleService.create(ctx, {
        code: 'browser-store-admin',
        description: '店铺主管理员',
        channelIds: [createdChannel.id],
        permissions: [
            Permission.CreateAdministrator,
            Permission.ReadAdministrator,
            Permission.UpdateAdministrator,
            Permission.DeleteAdministrator,
            Permission.ReadChannel,
            Permission.CreateProduct,
            Permission.ReadProduct,
            Permission.UpdateProduct,
            Permission.DeleteProduct,
            manageStoreTeamPermission.Permission,
        ],
    });
    const storePrimary = await administratorService.create(ctx, {
        firstName: 'Store',
        lastName: 'Primary',
        emailAddress: credentials.storePrimary.username,
        password: initialPassword,
        roleIds: [storePrimaryRole.id],
    });
    await initialPasswords.requirePasswordChange(ctx, storePrimary);
    await access.registerStorePrimary(ctx, storePrimary, createdChannel);

    const storeManagerRole = await access.createManagedRole(ctx, {
        code: 'browser-store-manager',
        description: '店铺普通管理员',
        templateCode: 'STORE_MANAGER',
        scope: 'STORE',
        channelId: createdChannel.id,
    });
    const storeStaffRole = await access.createManagedRole(ctx, {
        code: 'browser-store-product-staff',
        description: '店铺商品员工',
        templateCode: 'PRODUCT_OPERATIONS',
        scope: 'STORE',
        channelId: createdChannel.id,
    });
    await access.createManagedAdministrator(ctx, {
        firstName: 'Store',
        lastName: 'Manager',
        emailAddress: credentials.storeManager.username,
        password: initialPassword,
        roleIds: [storeManagerRole.id],
        scope: 'STORE',
        authority: 'MANAGER',
        channelId: createdChannel.id,
    });
    await access.createManagedAdministrator(ctx, {
        firstName: 'Store',
        lastName: 'Staff',
        emailAddress: credentials.storeStaff.username,
        password: initialPassword,
        roleIds: [storeStaffRole.id],
        scope: 'STORE',
        authority: 'STAFF',
        channelId: createdChannel.id,
    });
}

async function withAuthenticatedPage(
    credential: { username: string; password: string },
    assertion: (page: Page) => Promise<void>,
) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const adminApiResponses: string[] = [];
    const adminApiResponseTasks: Array<Promise<void>> = [];
    const clientErrors: string[] = [];
    let pendingAdminApiRequests = 0;
    page.on('pageerror', error => clientErrors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') clientErrors.push(message.text());
    });
    page.on('request', request => {
        if (request.url().includes('/admin-api')) pendingAdminApiRequests += 1;
    });
    const finishAdminApiRequest = (request: { url(): string }) => {
        if (request.url().includes('/admin-api')) pendingAdminApiRequests -= 1;
    };
    page.on('requestfinished', finishAdminApiRequest);
    page.on('requestfailed', finishAdminApiRequest);
    page.on('response', response => {
        if (!response.url().includes('/admin-api')) return;
        adminApiResponseTasks.push(
            response
                .text()
                .then(body => {
                    adminApiResponses.push(`${response.status()} ${body.slice(0, 1_200)}`);
                })
                .catch(() => undefined),
        );
    });
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(5_000);
    try {
        await page.goto(`${origin}/dashboard/login`);
        await page.locator('#admin-username').fill(credential.username);
        await page.locator('#admin-password').fill(credential.password);
        await page.getByRole('button', { name: '进入管理后台' }).click();
        if (credential.username !== credentials.owner.username) {
            try {
                await page.getByRole('heading', { name: '设置新的登录密码' }).waitFor();
            } catch (error) {
                const body = (await page.locator('body').innerText()).replace(/\s+/gu, ' ').slice(0, 800);
                const permissionSnapshot = await graphql(
                    page,
                    `
                        query {
                            me {
                                channels {
                                    code
                                    token
                                    permissions
                                }
                            }
                        }
                    `,
                );
                const permissions = JSON.stringify(permissionSnapshot);
                throw new Error(
                    `Initial-password gate did not open (${page.url()}): ${body}; ` +
                        `PERMISSIONS: ${permissions}; ${formatBrowserDiagnostics(adminApiResponses, clientErrors)}`,
                    { cause: error },
                );
            }
            const replacement = `Accepted-${credential.username.split('@')[0]}-123!`;
            await page.locator('#initial-new-password').fill(replacement);
            await page.locator('#initial-confirm-password').fill(replacement);
            await page.getByRole('button', { name: '确认并重新登录' }).click();
            await page.locator('#admin-username').waitFor();
            expect(await page.locator('body').innerText()).toContain('密码已更新');
            await page.locator('#admin-username').fill(credential.username);
            await page.locator('#admin-password').fill(replacement);
            await page.getByRole('button', { name: '进入管理后台' }).click();
        }
        try {
            await page.waitForURL(/\/dashboard\/dashboard$/u);
        } catch (error) {
            const body = (await page.locator('body').innerText()).replace(/\s+/gu, ' ').slice(0, 600);
            throw new Error(
                `Administrator login did not reach the dashboard (${page.url()}): ${body}; API: ${adminApiResponses.at(-1) ?? 'no response'}`,
                { cause: error },
            );
        }
        // The dashboard keeps long-lived/background requests open, so networkidle is not a stable
        // readiness signal. Two frames let React commit queries; tracked response bodies are then drained.
        await page.evaluate(
            () =>
                new Promise<void>(resolve => {
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                }),
        );
        await expect.poll(() => pendingAdminApiRequests, { timeout: 5_000, interval: 50 }).toBe(0);
        await Promise.all([...adminApiResponseTasks]);
        const dashboardAuthorizationErrors = adminApiResponses.filter(
            response =>
                response.includes('"errors"') &&
                /Forbidden|FORBIDDEN|not currently authorized|无权/iu.test(response),
        );
        expect(
            dashboardAuthorizationErrors,
            `Dashboard requested fields outside this account's permissions: ${dashboardAuthorizationErrors.join(' | ')}`,
        ).toEqual([]);
        try {
            await page
                .locator('h1')
                .filter({ hasText: /^(?:平台管理中心|经营概览)/u })
                .waitFor({ timeout: 10_000 });
        } catch (error) {
            const body = (await page.locator('body').innerText()).replace(/\s+/gu, ' ').slice(0, 800);
            throw new Error(
                `Administrator dashboard did not stabilize (${page.url()}): ${body}; ` +
                    formatBrowserDiagnostics(adminApiResponses, clientErrors),
                { cause: error },
            );
        }
        try {
            await assertion(page);
        } catch (error) {
            throw new Error(
                `${error instanceof Error ? error.message : String(error)}; ` +
                    formatBrowserDiagnostics(adminApiResponses, clientErrors),
                { cause: error },
            );
        }
    } finally {
        await context.close();
    }
}

function formatBrowserDiagnostics(adminApiResponses: string[], clientErrors: string[]) {
    const api = adminApiResponses.slice(-6).join(' | ') || 'no response';
    const client = clientErrors.join(' | ') || 'none';
    return `API: ${api}; CLIENT: ${client}`;
}

async function openTeamPage(page: Page, allowed: boolean) {
    await page.goto(`${origin}/dashboard/settings/team`);
    if (allowed) {
        try {
            await page
                .locator('h1')
                .filter({ hasText: /^员工与权限/u })
                .waitFor();
        } catch (error) {
            const body = (await page.locator('body').innerText()).replace(/\s+/gu, ' ').slice(0, 800);
            throw new Error(`Team page did not load (${page.url()}): ${body}`, { cause: error });
        }
        expect(await page.getByRole('heading', { name: '当前账号无权访问' }).count()).toBe(0);
    } else {
        await page.getByRole('heading', { name: '当前账号无权访问' }).waitFor();
    }
}

async function openCatalogPage(page: Page) {
    await page.goto(`${origin}/dashboard/catalog/list`);
    expect(await page.getByRole('heading', { name: '当前账号无权访问' }).count()).toBe(0);
    await page
        .locator('h1')
        .filter({ hasText: /^商品管理/u })
        .waitFor();
}

async function expectProductOnlyDashboard(page: Page) {
    await page.getByText('卡密发货预警', { exact: true }).waitFor();
    expect(await page.getByText('核心经营指标', { exact: true }).count()).toBe(0);
    expect(await page.getByText('经营指标加载失败', { exact: true }).count()).toBe(0);
}

async function expectPageText(page: Page, text: string) {
    await page.getByText(text, { exact: true }).waitFor();
}

async function manageableEmails(page: Page): Promise<string[]> {
    const result = await graphql(
        page,
        `
            query {
                manageableAdministrators {
                    administrator {
                        emailAddress
                    }
                }
            }
        `,
    );
    if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '));
    const records = result.data?.manageableAdministrators as
        Array<{ administrator: { emailAddress: string } }> | undefined;
    return (records ?? []).map(record => record.administrator.emailAddress).sort();
}

async function graphql(page: Page, query: string) {
    return page.evaluate(
        async ({ endpoint, document }) => {
            const activeChannelToken = sessionStorage.getItem('vendure-active-channel-token');
            const headers: Record<string, string> = { 'content-type': 'application/json' };
            if (activeChannelToken) headers['vendure-token'] = activeChannelToken;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify({ query: document }),
            });
            return (await response.json()) as {
                data?: Record<string, unknown>;
                errors?: Array<{ message: string }>;
            };
        },
        { endpoint: `${origin}/admin-api?displayLanguageCode=zh_Hans`, document: query },
    );
}
