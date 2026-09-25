import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { AssetType } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    AdministratorService,
    Asset,
    AssetTranslation,
    Channel,
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
import gql from 'graphql-tag';
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
import { StoreProfile } from '../src/entities/store-profile.entity';
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

const { server, adminClient, shopClient } = createTestEnvironment(config);
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

    it('opens the customer service feedback inbox in NextAdmin', async () => {
        await withAuthenticatedPage(credentials.owner, async page => {
            await page.getByLabel('切换当前店铺').selectOption('browser-store-token');
            await page.waitForFunction(
                () => sessionStorage.getItem('vendure-active-channel-token') === 'browser-store-token',
            );
            await page.goto(`${origin}/dashboard/sales/customer-service-feedback`);
            try {
                await page.getByRole('heading', { name: '客服服务评价' }).waitFor();
            } catch (error) {
                throw new Error(
                    `Feedback route ${page.url()}: ${(await page.locator('body').innerText()).slice(0, 900)}`,
                    { cause: error },
                );
            }
            await expectPageText(page, '暂无客服评价');
            await page.getByRole('button', { name: '刷新' }).click();
            await expectPageText(page, '暂无客服评价');
            shopClient.setChannelToken('browser-store-token');
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken('browser-store-token');
            const registration = await adminClient.query(gql`
                mutation {
                    createCustomer(
                        input: {
                            emailAddress: "browser-feedback@example.test"
                            firstName: "Feedback"
                            lastName: "Browser"
                        }
                        password: "BrowserFeedbackPass123!"
                    ) {
                        ... on Customer {
                            id
                        }
                    }
                }
            `);
            expect(registration.createCustomer.id).toBeTruthy();
            await shopClient.asUserWithCredentials(
                'browser-feedback@example.test',
                'BrowserFeedbackPass123!',
            );
            const submitted = await shopClient.query(gql`
                mutation {
                    submitMyCustomerServiceFeedback(
                        input: { rating: 4, tags: ["FRIENDLY"], comment: "客服评价后台闭环测试" }
                    ) {
                        id
                        rating
                    }
                }
            `);
            expect(submitted.submitMyCustomerServiceFeedback.rating).toBe(4);
            await page.getByRole('button', { name: '刷新' }).click();
            await page.getByText('客服评价后台闭环测试').waitFor();
            await expectPageText(page, '态度热情');
            await shopClient.query(gql`
                mutation {
                    logout {
                        success
                    }
                }
            `);
        });
    });

    it('saves selected desktop category artwork through the actual NextAdmin login and publishes it to Shop API', async () => {
        const connection = server.app.get(TransactionalConnection);
        const channel = await connection.rawConnection.getRepository(Channel).findOneByOrFail({
            token: 'browser-store-token',
        });
        const asset = await connection.rawConnection.getRepository(Asset).save(
            new Asset({
                name: 'authenticated-category-banner.svg',
                type: AssetType.IMAGE,
                fileSize: 400,
                mimeType: 'image/svg+xml',
                width: 1600,
                height: 480,
                source: 'authenticated-category-banner.svg',
                preview: 'authenticated-category-banner.svg',
                channels: [{ id: channel.id }],
            }),
        );
        await connection.rawConnection.getRepository(AssetTranslation).save(
            [LanguageCode.en, LanguageCode.zh_Hans].map(
                languageCode =>
                    new AssetTranslation({
                        base: asset,
                        languageCode,
                        name: asset.name,
                    }),
            ),
        );
        await withAuthenticatedPage(credentials.owner, async page => {
            await page.getByLabel('切换当前店铺').selectOption('browser-store-token');
            await page.waitForFunction(
                () => sessionStorage.getItem('vendure-active-channel-token') === 'browser-store-token',
            );
            await page.goto(`${origin}/dashboard/storefront/decoration?panel=desktop-category-banners`);
            const settings = page.getByRole('dialog', { name: '商城装修设置' });
            const banner = settings.getByRole('region', { name: '电脑端分类横幅' });
            const mode = banner.getByRole('combobox', { name: '横幅展示方式' });
            try {
                await mode.waitFor({ timeout: 10_000 });
            } catch (error) {
                throw new Error(
                    `Category editor did not load (${page.url()}): ${(await page.locator('body').innerText()).slice(0, 1_000)}`,
                    { cause: error },
                );
            }
            await mode.selectOption('image');
            await banner.getByRole('button', { name: '从素材库选择' }).click();
            await page
                .getByRole('dialog', { name: '选择图片素材' })
                .getByRole('button')
                .filter({ hasText: asset.name })
                .click();
            await banner.getByRole('button', { name: '保存分类横幅' }).click();
            await banner.getByRole('status').filter({ hasText: '分类横幅已保存到当前店铺' }).waitFor();

            shopClient.setChannelToken('browser-store-token');
            const published = await shopClient.query(gql`
                query PublishedCategoryBanner {
                    storefrontContent {
                        code
                        enabled
                        settings
                        imageAsset {
                            name
                        }
                    }
                }
            `);
            expect(published.storefrontContent).toContainEqual(
                expect.objectContaining({
                    code: 'desktop-category-banner-default',
                    enabled: true,
                    settings: expect.objectContaining({ mode: 'image' }),
                    imageAsset: expect.objectContaining({ name: asset.name }),
                }),
            );

            await page.reload();
            await page
                .getByRole('dialog', { name: '商城装修设置' })
                .getByRole('combobox', { name: '横幅展示方式' })
                .waitFor();
            expect(
                await page
                    .getByRole('dialog', { name: '商城装修设置' })
                    .getByRole('combobox', { name: '横幅展示方式' })
                    .inputValue(),
            ).toBe('image');
            await page
                .getByRole('dialog', { name: '商城装修设置' })
                .getByRole('region', { name: '电脑端分类横幅' })
                .getByText(asset.name)
                .waitFor();
        });
    });

    it('saves commercial service artwork through NextAdmin and publishes it to Shop API', async () => {
        const connection = server.app.get(TransactionalConnection);
        const channel = await connection.rawConnection.getRepository(Channel).findOneByOrFail({
            token: 'browser-store-token',
        });
        const asset = await connection.rawConnection.getRepository(Asset).save(
            new Asset({
                name: 'authenticated-business-services.svg',
                type: AssetType.IMAGE,
                fileSize: 400,
                mimeType: 'image/svg+xml',
                width: 1600,
                height: 480,
                source: 'authenticated-business-services.svg',
                preview: 'authenticated-business-services.svg',
                channels: [{ id: channel.id }],
            }),
        );
        await connection.rawConnection.getRepository(AssetTranslation).save(
            [LanguageCode.en, LanguageCode.zh_Hans].map(
                languageCode =>
                    new AssetTranslation({
                        base: asset,
                        languageCode,
                        name: asset.name,
                    }),
            ),
        );

        await withAuthenticatedPage(credentials.owner, async page => {
            await page.getByLabel('切换当前店铺').selectOption('browser-store-token');
            await page.waitForFunction(
                () => sessionStorage.getItem('vendure-active-channel-token') === 'browser-store-token',
            );
            await page.goto(`${origin}/dashboard/storefront/business-services-copy`);
            await page.getByRole('heading', { name: '商业服务页文案' }).waitFor();
            await page.getByRole('button', { name: '从素材库选择' }).click();
            await page
                .getByRole('dialog', { name: '选择图片素材' })
                .getByRole('button')
                .filter({ hasText: asset.name })
                .click();
            await page.getByRole('button', { name: '保存并发布' }).click();
            await page.getByText('已保存到当前店铺；修改的中文文案将按翻译设置同步。').waitFor();

            const admin = await graphql(
                page,
                `
                    query SavedBusinessServicesArtwork {
                        storefrontContentBlocks {
                            code
                            enabled
                            imageAsset {
                                name
                            }
                            translations {
                                languageCode
                                title
                                body
                            }
                        }
                    }
                `,
            );
            expect(admin.errors).toBeUndefined();
            const saved = (
                admin.data?.storefrontContentBlocks as Array<{
                    code: string;
                    enabled: boolean;
                    imageAsset: { name: string } | null;
                    translations: Array<{ languageCode: string; title: string; body: string }>;
                }>
            ).find(block => block.code === 'storefront-client-plugins');
            expect(saved?.imageAsset?.name).toBe(asset.name);

            shopClient.setChannelToken('browser-store-token');
            const published = await shopClient.query(gql`
                query PublishedBusinessServicesArtwork {
                    storefrontContent {
                        code
                        enabled
                        imageAsset {
                            name
                        }
                    }
                }
            `);
            expect(published.storefrontContent, JSON.stringify(saved)).toContainEqual(
                expect.objectContaining({
                    code: 'storefront-client-plugins',
                    enabled: true,
                    imageAsset: expect.objectContaining({ name: asset.name }),
                }),
            );

            await page.reload();
            await page.getByText(asset.name).waitFor();
        });
    });

    it('creates support content with selected artwork in NextAdmin and publishes it to Shop API', async () => {
        const connection = server.app.get(TransactionalConnection);
        const channel = await connection.rawConnection.getRepository(Channel).findOneByOrFail({
            token: 'browser-store-token',
        });
        const asset = await connection.rawConnection.getRepository(Asset).save(
            new Asset({
                name: 'authenticated-support-hero.svg',
                type: AssetType.IMAGE,
                fileSize: 400,
                mimeType: 'image/svg+xml',
                width: 1600,
                height: 480,
                source: 'authenticated-support-hero.svg',
                preview: 'authenticated-support-hero.svg',
                channels: [{ id: channel.id }],
            }),
        );
        await connection.rawConnection.getRepository(AssetTranslation).save(
            [LanguageCode.en, LanguageCode.zh_Hans].map(
                languageCode =>
                    new AssetTranslation({
                        base: asset,
                        languageCode,
                        name: asset.name,
                    }),
            ),
        );

        await withAuthenticatedPage(credentials.owner, async page => {
            await page.getByLabel('切换当前店铺').selectOption('browser-store-token');
            await page.waitForFunction(
                () => sessionStorage.getItem('vendure-active-channel-token') === 'browser-store-token',
            );
            await page.goto(`${origin}/dashboard/storefront/content?tab=pages`);
            await page.getByRole('heading', { name: '店铺内容与页面' }).waitFor();
            const card = page
                .getByRole('article')
                .filter({ has: page.getByRole('heading', { name: '客服与帮助' }) });
            await card.getByRole('button', { name: '开始配置' }).click();
            const editor = page.getByRole('dialog', { name: '新建店铺楼层区块' });
            await editor
                .getByText('电脑端客服页首配图')
                .locator('..')
                .getByRole('button', { name: '从素材库选择' })
                .click();
            await page
                .getByRole('dialog', { name: '选择图片素材' })
                .getByRole('button')
                .filter({ hasText: asset.name })
                .click();
            await editor.getByRole('checkbox', { name: '客服渠道 2' }).check();
            await editor.getByRole('textbox', { name: 'QQ 号 *' }).fill('123456789');
            await editor.getByRole('button', { name: '添加问题' }).click();
            await editor.getByRole('textbox', { name: '中文问题 1' }).fill('如何确认运费？');
            await editor.getByRole('textbox', { name: '中文答案 1' }).fill('结算时按地址计算。');
            await editor.getByRole('button', { name: 'English' }).click();
            await editor
                .getByRole('textbox', { name: 'English question 1' })
                .fill('How is shipping calculated?');
            await editor
                .getByRole('textbox', { name: 'English answer 1' })
                .fill('It is calculated at checkout.');
            await editor.getByRole('checkbox', { name: '启用问题 1' }).check();
            await editor.getByRole('button', { name: '保存并生效' }).click();
            await editor.waitFor({ state: 'hidden' });

            shopClient.setChannelToken('browser-store-token');
            const published = await shopClient.query(gql`
                query PublishedSupportArtwork {
                    storefrontContent {
                        type
                        enabled
                        imageAsset {
                            name
                        }
                        settings
                        items {
                            enabled
                            targetType
                            targetValue
                            settings
                        }
                    }
                }
            `);
            expect(published.storefrontContent).toContainEqual(
                expect.objectContaining({
                    type: 'SUPPORT',
                    enabled: true,
                    imageAsset: expect.objectContaining({ name: asset.name }),
                    settings: expect.objectContaining({
                        supportFaqs: [
                            expect.objectContaining({
                                enabled: true,
                                questionZh: '如何确认运费？',
                                answerEn: 'It is calculated at checkout.',
                            }),
                        ],
                    }),
                    items: expect.arrayContaining([
                        expect.objectContaining({
                            enabled: true,
                            targetType: 'URL',
                            targetValue: 'https://wpa.qq.com/msgrd?v=3&uin=123456789&site=qq&menu=yes',
                            settings: expect.objectContaining({ supportChannel: 'QQ' }),
                        }),
                    ]),
                }),
            );

            await page.reload();
            await page
                .getByRole('article')
                .filter({ hasText: '客服与帮助' })
                .getByRole('button', { name: '编辑内容' })
                .click();
            const reopened = page.getByRole('dialog', { name: '编辑店铺楼层区块' });
            await reopened.getByText(asset.name).waitFor();
            expect(await reopened.getByRole('textbox', { name: '中文问题 1' }).inputValue()).toBe(
                '如何确认运费？',
            );
        });
    });

    it('edits both legal documents in NextAdmin and publishes their content to Shop API', async () => {
        await withAuthenticatedPage(credentials.owner, async page => {
            await page.getByLabel('切换当前店铺').selectOption('browser-store-token');
            await page.waitForFunction(
                () => sessionStorage.getItem('vendure-active-channel-token') === 'browser-store-token',
            );
            await page.goto(`${origin}/dashboard/storefront/content?tab=pages`);
            const card = page
                .getByRole('article')
                .filter({ has: page.getByRole('heading', { name: '法律条款' }) });
            await card.getByRole('button', { name: '开始配置' }).click();
            const editor = page.getByRole('dialog', { name: '新建店铺楼层区块' });
            const privacy = editor
                .getByRole('checkbox', { name: '子项 1' })
                .locator('xpath=ancestor::article');
            const terms = editor.getByRole('checkbox', { name: '子项 2' }).locator('xpath=ancestor::article');
            await privacy.getByLabel('法律正文').fill('本地隐私政策验收正文。\n第二段。');
            await terms.getByLabel('法律正文').fill('本地使用条款验收正文。');
            await editor.getByRole('button', { name: 'English' }).click();
            await privacy.getByLabel('法律正文').fill('Local privacy policy acceptance.\nSecond paragraph.');
            await terms.getByLabel('法律正文').fill('Local terms of use acceptance.');
            await editor.getByRole('checkbox', { name: '前台启用' }).check();
            await editor.getByRole('button', { name: '保存并生效' }).click();
            await editor.waitFor({ state: 'hidden' });

            shopClient.setChannelToken('browser-store-token');
            const published = await shopClient.query(gql`
                query PublishedLegalDocuments {
                    storefrontContent {
                        type
                        items {
                            label
                            description
                            targetType
                            targetValue
                        }
                    }
                }
            `);
            expect(published.storefrontContent).toContainEqual(
                expect.objectContaining({
                    type: 'LEGAL',
                    items: expect.arrayContaining([
                        expect.objectContaining({
                            label: 'Privacy policy',
                            description: 'Local privacy policy acceptance.\nSecond paragraph.',
                            targetType: 'PAGE',
                            targetValue: '/legal?id=privacy',
                        }),
                        expect.objectContaining({
                            label: 'Terms of use',
                            description: 'Local terms of use acceptance.',
                            targetType: 'PAGE',
                            targetValue: '/legal?id=terms',
                        }),
                    ]),
                }),
            );

            await page.reload();
            await card.getByRole('button', { name: '编辑内容' }).click();
            const reopened = page.getByRole('dialog', { name: '编辑店铺楼层区块' });
            expect(
                await reopened
                    .getByRole('checkbox', { name: '子项 1' })
                    .locator('xpath=ancestor::article')
                    .getByLabel('法律正文')
                    .inputValue(),
            ).toBe('本地隐私政策验收正文。\n第二段。');
        });
    });

    it('creates a homepage announcement in NextAdmin and publishes it to Shop API', async () => {
        await withAuthenticatedPage(credentials.owner, async page => {
            await page.getByLabel('切换当前店铺').selectOption('browser-store-token');
            await page.waitForFunction(
                () => sessionStorage.getItem('vendure-active-channel-token') === 'browser-store-token',
            );
            await page.goto(`${origin}/dashboard/storefront/content?tab=announcements`);
            await page.getByRole('button', { name: '新建公告' }).first().click();
            const editor = page.getByRole('dialog', { name: '新建首页公告' });
            await editor.getByLabel('中文标题 *').fill('本地后台公告验收');
            await editor.getByLabel('中文正文 *').fill('仅用于本地登录态发布验证。');
            await editor.getByRole('checkbox', { name: '人工锁定' }).nth(0).check();
            await editor.getByRole('checkbox', { name: '人工锁定' }).nth(1).check();
            await editor.getByLabel('英文标题').fill('Local announcement acceptance');
            await editor.getByLabel('英文正文').fill('Local authenticated publication check only.');
            await editor.getByRole('button', { name: '创建公告' }).click();
            await editor.waitFor({ state: 'hidden' });

            shopClient.setChannelToken('browser-store-token');
            const published = await shopClient.query(gql`
                query PublishedHomepageAnnouncement {
                    activeSystemAnnouncements {
                        title
                        content
                    }
                }
            `);
            expect(published.activeSystemAnnouncements).toContainEqual(
                expect.objectContaining({
                    title: 'Local announcement acceptance',
                    content: 'Local authenticated publication check only.',
                }),
            );

            await page.reload();
            await page.getByRole('heading', { name: '本地后台公告验收' }).waitFor();
        });
    });

    it('creates a fixed-color coupon in NextAdmin and publishes its appearance to Shop API', async () => {
        await withAuthenticatedPage(credentials.owner, async page => {
            await page.getByLabel('切换当前店铺').selectOption('browser-store-token');
            await page.waitForFunction(
                () => sessionStorage.getItem('vendure-active-channel-token') === 'browser-store-token',
            );
            await page.goto(`${origin}/dashboard/marketing/promotions`);
            await page.getByRole('heading', { name: '优惠与促销' }).waitFor();
            await page.getByRole('button', { name: '新建优惠券' }).first().click();
            const editor = page.getByRole('dialog', { name: '新建优惠券活动' });
            await editor.getByLabel('活动名称 *').fill('登录态固定配色测试券');
            await editor.getByLabel('券面配色（仅影响展示）').selectOption('gold');
            await editor.getByRole('button', { name: '创建优惠券' }).click();
            await page.getByText('优惠券活动已创建并开始按排期生效').waitFor();

            const admin = await graphql(
                page,
                `
                    query {
                        storeCouponCampaigns {
                            id
                            name
                            appearanceTheme
                        }
                    }
                `,
            );
            expect(admin.errors).toBeUndefined();
            const campaign = (
                admin.data?.storeCouponCampaigns as Array<{
                    id: string;
                    name: string;
                    appearanceTheme: string;
                }>
            ).find(item => item.name === '登录态固定配色测试券');
            expect(campaign?.appearanceTheme).toBe('gold');

            shopClient.setChannelToken('browser-store-token');
            const shop = await shopClient.query(gql`
                query PublishedCouponAppearance {
                    activeStorefrontCoupons {
                        id
                        appearanceTheme
                    }
                }
            `);
            expect(shop.activeStorefrontCoupons).toContainEqual(
                expect.objectContaining({ id: campaign?.id, appearanceTheme: 'gold' }),
            );

            await page.reload();
            await page.getByText('登录态固定配色测试券').waitFor();
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
        // This fixture has no zones; empty IDs keep the ChannelService's original unassigned behavior.
        defaultShippingZoneId: '',
        defaultTaxZoneId: '',
    });
    if ('errorCode' in createdChannel) throw new Error(createdChannel.message);
    const profileRepository = connection.rawConnection.getRepository(StoreProfile);
    const profile =
        (await profileRepository.findOneBy({ channelId: createdChannel.id })) ??
        new StoreProfile({
            channelId: createdChannel.id,
            descriptionZh: '',
            descriptionEn: '',
        });
    profile.status = 'ACTIVE';
    profile.isPublished = true;
    await profileRepository.save(profile);
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
