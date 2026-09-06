import { expect as browserExpect, chromium } from '@playwright/test';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StorefrontPageView } from '../src/entities/storefront-page-view.entity';
import { StoreManagementPlugin } from '../src/store-management.plugin';

const config = mergeConfig(testConfig(), {
    apiOptions: { trustProxy: 'loopback' },
    authOptions: { requireVerification: false },
    plugins: [
        ContentTranslationPlugin.init({
            provider: {
                name: 'traffic-test',
                isConfigured: () => true,
                translate: request => ({
                    provider: 'traffic-test',
                    translations: request.segments.map(segment => ({ key: segment.key, text: segment.text })),
                }),
            },
        }),
        StoreManagementPlugin.init({
            enabled: false,
            signingSecret: 'traffic-e2e-isolated-test-secret-at-least-32-characters',
        }),
    ],
});
const { server, adminClient, shopClient } = createTestEnvironment(config);
const RECORD = gql`
    mutation RecordTraffic($input: StorefrontPageViewInput!) {
        recordStorefrontPageView(input: $input) {
            recorded
        }
    }
`;
const REPORT = gql`
    query TrafficReport($days: Int!) {
        storefrontTraffic(days: $days) {
            businessDate
            timezone
            firstRecordedAt
            lastRecordedAt
            days {
                businessDate
                visitorCount
                pageViewCount
                ipCount
            }
        }
        referralTodayMetrics {
            visitorCount
        }
    }
`;
const input = (visitorId = 'traffic-e2e-browser-0001') => ({
    eventId: randomUUID(),
    visitorId,
    pageView: true,
});

describe('storefront traffic Shop/Admin API integration', () => {
    beforeAll(async () => {
        registerInitializer(
            'sqljs',
            new SqljsInitializer(mkdtempSync(join(tmpdir(), 'vendure-traffic-api-'))),
        );
        await server.init({
            initialData: { ...initialData, collections: [], paymentMethods: [] },
            customerCount: 0,
        });
        // TestServer bypasses bootstrap's Express trust-proxy setup; mirror that setup for this isolated server.
        server.app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);
    beforeEach(async () => {
        // This server uses only the temporary fixture database created above.
        await server.app.get(TransactionalConnection).rawConnection.getRepository(StorefrontPageView).clear();
        await shopClient.asAnonymousUser();
        shopClient.setRequestHeader('user-agent', 'Mozilla/5.0 Traffic E2E Browser');
        shopClient.setRequestHeader('x-forwarded-for', '203.0.113.10');
        shopClient.setRequestHeader('cookie', null);
        server.app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
    });
    afterAll(async () => {
        await server.destroy();
    });

    it('returns missing data and requires administrator permission to read statistics', async () => {
        const report = await adminClient.query(REPORT, { days: 7 });
        expect(report.storefrontTraffic.days).toHaveLength(7);
        expect(report.storefrontTraffic.firstRecordedAt).toBeNull();
        expect(report.referralTodayMetrics.visitorCount).toBeNull();
        const response = await fetch(`http://127.0.0.1:${config.apiOptions.port}/admin-api`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: '{ storefrontTraffic { businessDate } }' }),
        });
        expect((await response.json()).errors?.length).toBeGreaterThan(0);
        await expect(adminClient.query(REPORT, { days: 1000 })).rejects.toThrow();
    });

    it('deduplicates retries and reports page views, unique browsers and trusted IPs consistently across both widgets', async () => {
        const first = input();
        expect(await shopClient.query(RECORD, { input: first })).toMatchObject({
            recordStorefrontPageView: { recorded: true },
        });
        await shopClient.query(RECORD, { input: first });
        await shopClient.query(RECORD, { input: input('traffic-e2e-browser-0002') });
        shopClient.setRequestHeader('x-forwarded-for', '198.51.100.20');
        await shopClient.query(RECORD, { input: input() });
        const report = await adminClient.query(REPORT, { days: 7 });
        expect(report.storefrontTraffic.days.at(-1)).toMatchObject({
            visitorCount: 2,
            pageViewCount: 3,
            ipCount: 2,
        });
        expect(report.referralTodayMetrics.visitorCount).toBe(2);
    });

    it('filters bot and opted-out requests at the server', async () => {
        shopClient.setRequestHeader('user-agent', 'Googlebot/2.1');
        expect(await shopClient.query(RECORD, { input: input() })).toMatchObject({
            recordStorefrontPageView: { recorded: false },
        });
        shopClient.setRequestHeader('user-agent', 'Mozilla/5.0 Traffic E2E Browser');
        shopClient.setRequestHeader('cookie', 'storefront_analytics_opt_out=1');
        expect(await shopClient.query(RECORD, { input: input() })).toMatchObject({
            recordStorefrontPageView: { recorded: false },
        });
        expect((await adminClient.query(REPORT, { days: 1 })).referralTodayMetrics.visitorCount).toBeNull();
    });

    it('does not trust forwarded IPs when the application has not configured a trusted proxy', async () => {
        server.app.getHttpAdapter().getInstance().set('trust proxy', false);
        await shopClient.query(RECORD, { input: input() });
        expect((await adminClient.query(REPORT, { days: 1 })).storefrontTraffic.days[0].ipCount).toBeNull();
    });

    it('merges login into the anonymous browser without adding a page view', async () => {
        const first = input();
        await shopClient.query(RECORD, { input: first });
        await shopClient.query(gql`
            mutation {
                registerCustomerAccount(
                    input: {
                        emailAddress: "traffic-fixture@example.test"
                        password: "TrafficFixturePass123!"
                        firstName: "Traffic"
                        lastName: "Fixture"
                    }
                ) {
                    ... on Success {
                        success
                    }
                }
            }
        `);
        await shopClient.asUserWithCredentials('traffic-fixture@example.test', 'TrafficFixturePass123!');
        await shopClient.query(RECORD, { input: { ...first, pageView: false } });
        await shopClient.query(RECORD, { input: input('traffic-e2e-browser-0002') });
        const report = await adminClient.query(REPORT, { days: 1 });
        expect(report.storefrontTraffic.days[0]).toMatchObject({
            visitorCount: 1,
            pageViewCount: 2,
            ipCount: 1,
        });
    });

    it('collects browser navigation into the real API and shows responsive reports and browser exclusion', async () => {
        const root = join(process.cwd(), '../next-admin');
        const target = `http://127.0.0.1:${config.apiOptions.port}`;
        const vite = await createServer({
            root,
            configFile: join(root, 'vite.config.ts'),
            logLevel: 'error',
            envDir: false,
            define: {
                'import.meta.env.VITE_SHOP_API_URL': JSON.stringify('/shop-api'),
                'import.meta.env.VITE_VENDURE_ADMIN_API_URL': JSON.stringify('/admin-api'),
            },
            resolve: { dedupe: ['react', 'react-dom'] },
            server: {
                host: '127.0.0.1',
                port: 5199,
                strictPort: true,
                proxy: {
                    '/shop-api': {
                        target,
                        headers: {
                            'vendure-token': config.defaultChannelToken,
                            'x-forwarded-for': '203.0.113.10',
                        },
                    },
                    '/admin-api': {
                        target,
                        headers: { authorization: `Bearer ${adminClient.getAuthToken()}` },
                    },
                },
            },
        });
        await vite.listen();
        const address = vite.httpServer?.address();
        if (!address || typeof address === 'string') throw new Error('Traffic fixture server did not start');
        const port = address.port;
        const url = `http://traffic.localhost:${port}/e2e/traffic/index.html`;
        const artifacts = mkdtempSync(join(tmpdir(), 'vendure-traffic-browser-'));
        const browser = await chromium.launch({ headless: true });
        try {
            const automated = await browser.newPage();
            await automated.route('**/*', route =>
                ['traffic.localhost', 'admin.traffic.localhost'].includes(
                    new URL(route.request().url()).hostname,
                )
                    ? route.continue()
                    : route.abort(),
            );
            const automatedErrors: string[] = [];
            automated.on('pageerror', error => automatedErrors.push(error.message));
            await automated.goto(`${url}?mode=shop`);
            try {
                await browserExpect(automated.getByRole('heading', { name: '采集联调测试页' })).toBeVisible();
            } catch (error) {
                process.stdout.write(
                    JSON.stringify({
                        fixtureErrors: automatedErrors,
                        body: await automated.locator('body').innerText(),
                    }) + '\n',
                );
                throw error;
            }
            expect(automatedErrors).toEqual([]);
            expect(
                (await adminClient.query(REPORT, { days: 1 })).storefrontTraffic.days[0].pageViewCount,
            ).toBeNull();
            await automated.close();

            const context = await browser.newContext({
                viewport: { width: 1440, height: 1000 },
                locale: 'zh-CN',
                userAgent:
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            });
            // Deliberate fixture-only human-browser simulation; production code still excludes automation.
            await context.addInitScript(() =>
                Object.defineProperty(navigator, 'webdriver', { get: () => false }),
            );
            await context.route('**/*', route =>
                ['traffic.localhost', 'admin.traffic.localhost'].includes(
                    new URL(route.request().url()).hostname,
                )
                    ? route.continue()
                    : route.abort(),
            );
            const shop = await context.newPage();
            const errors: string[] = [];
            const responses: unknown[] = [];
            shop.on('pageerror', error => errors.push(error.message));
            shop.on('response', async response => {
                if (new URL(response.url()).pathname === '/shop-api') {
                    const body = await response.json().catch(() => ({}));
                    responses.push({
                        status: response.status(),
                        recorded: body.data?.recordStorefrontPageView?.recorded,
                        errors: body.errors?.map((error: { message: string }) => error.message),
                    });
                }
            });
            await shop.goto(`${url}?mode=shop`);
            const total = async () =>
                (await adminClient.query(REPORT, { days: 1 })).storefrontTraffic.days[0];
            try {
                await browserExpect.poll(async () => (await total()).pageViewCount).toBe(1);
            } catch (error) {
                process.stdout.write(
                    JSON.stringify({
                        fixtureErrors: errors,
                        responses,
                        browser: await shop.evaluate(() => ({
                            visible: document.visibilityState,
                            automated: navigator.webdriver,
                            uuidAvailable: typeof crypto.randomUUID,
                        })),
                    }) + '\n',
                );
                throw error;
            }
            await shop.getByRole('button', { name: '打开商品页', exact: true }).click();
            await browserExpect.poll(async () => (await total()).pageViewCount).toBe(2);
            await shop.getByRole('button', { name: '仅重渲染', exact: true }).click();
            expect((await total()).pageViewCount).toBe(2);
            await shop.reload();
            await browserExpect.poll(async () => (await total()).pageViewCount).toBe(3);
            expect(await total()).toMatchObject({ visitorCount: 1, ipCount: 1 });

            const admin = await context.newPage();
            admin.on('pageerror', error => errors.push(error.message));
            await admin.goto(url.replace('://traffic.localhost', '://admin.traffic.localhost'));
            await browserExpect(admin.getByText('今日浏览量', { exact: true })).toBeVisible();
            await admin.getByText('查看每日数据', { exact: true }).click();
            await browserExpect(admin.locator('tbody tr')).toHaveCount(7);
            await admin.getByRole('button', { name: '最近 30 天', exact: true }).click();
            await browserExpect(admin.locator('tbody tr')).toHaveCount(30);
            await admin.screenshot({ path: join(artifacts, 'desktop.png'), fullPage: true });
            await admin.setViewportSize({ width: 390, height: 844 });
            await browserExpect
                .poll(() => admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
                .toBe(true);
            await admin.screenshot({ path: join(artifacts, 'mobile.png'), fullPage: true });
            await browserExpect(admin.getByText('要排除自己检查店铺的访问', { exact: false })).toBeVisible();
            await shop.bringToFront();
            await shop.getByRole('button', { name: '不统计本浏览器访问', exact: true }).click();
            await browserExpect(
                shop.getByRole('button', { name: '已排除本浏览器访问 · 恢复统计', exact: true }),
            ).toBeVisible();
            await shop.bringToFront();
            await shop.getByRole('button', { name: '返回首页', exact: true }).click();
            await shop.reload();
            await browserExpect(shop.getByRole('heading', { name: '采集联调测试页' })).toBeVisible();
            expect((await total()).pageViewCount).toBe(3);

            await shop.getByRole('button', { name: '已排除本浏览器访问 · 恢复统计', exact: true }).click();
            await shop.bringToFront();
            await browserExpect.poll(async () => (await total()).pageViewCount).toBe(4);
            expect(errors).toEqual([]);
            process.stdout.write(`Traffic browser evidence (isolated test data): ${artifacts}\n`);
            await context.close();
        } finally {
            await browser.close();
            await vite.close();
        }
    }, 60000);
});
