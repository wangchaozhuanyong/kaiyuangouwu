import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const storefront = fileURLToPath(new URL('../..', import.meta.url));
const output = path.resolve(storefront, '../../reports/ai-image-studio-audit-20260913');
const origin = 'http://127.0.0.1:5187';
const bucket = {
    limit: 20,
    unlimited: false,
    remaining: 20,
    reserved: 0,
    consumed: 0,
    windowEndsAt: '2099-01-01',
};
const quota = {
    paidEnabled: true,
    paidPrice: 50,
    currencyCode: 'CNY',
    daily: { ...bucket, remaining: 0 },
    minute: bucket,
};
const customer = {
    id: 'shell-customer',
    firstName: '本地',
    lastName: '验收',
    emailAddress: 'shell@example.test',
    phoneNumber: '',
    addresses: [],
    orders: { totalItems: 0, items: [] },
};
const state = { signedIn: false, customerError: false, balance: 1000 };
const observed = {
    operations: [],
    unexpectedOperations: [],
    externalRequests: [],
    pageErrors: [],
    checks: [],
};
const model = {
    id: 'shell-model',
    code: 'shell-model',
    displayNameZh: '本地验收模型',
    displayNameEn: 'Local test model',
    descriptionZh: '本地模拟接口',
    officialModelId: 'shell-model',
    resolutionOptions: [{ resolution: '1K', unitPrice: 100, supportedAspectRatios: ['1:1'] }],
    unitPrice: 100,
    currencyCode: 'CNY',
    freeImageEnabled: false,
    dailyFreeImageLimit: 0,
    paidAfterFreeEnabled: true,
    healthStatus: 'HEALTHY',
};
const pluginBlock = {
    id: 'shell-plugins',
    code: 'storefront-client-plugins',
    type: 'CLIENT_PLUGINS',
    enabled: true,
    position: 1,
    title: '本地验收服务',
    subtitle: '',
    body: '',
    settings: null,
    items: [
        {
            id: 'shell-entry',
            enabled: true,
            position: 0,
            label: 'AI 图片工坊',
            description: '',
            targetType: 'NONE',
            targetValue: null,
            settings: { pluginCode: 'ai-image-studio-entry', placement: 'BUSINESS_SERVICES_MAIN' },
        },
    ],
};
function responseFor(name, variables) {
    switch (name) {
        case 'StorefrontConfig':
            return {
                activeChannel: {
                    code: 'shell-local',
                    defaultLanguageCode: 'zh_Hans',
                    defaultCurrencyCode: 'CNY',
                    customFields: {
                        storefrontNameZh: '本地主站验收',
                        storefrontNameEn: 'Local shell acceptance',
                    },
                },
                availableCountries: [{ code: 'CN', name: '中国' }],
                availableStorefrontProvinces: [],
                storefrontBranding: null,
                storefrontCurrencyConfiguration: {
                    defaultCurrencyCode: 'CNY',
                    availableCurrencyCodes: ['CNY'],
                    selectorEnabled: false,
                },
            };
        case 'StorefrontVisualPreset':
            return {
                activeChannel: { id: 'shell-local' },
                storefrontVisualPreset: {
                    channelId: 'shell-local',
                    presetId: 'classic',
                    desktopLayout: 'classic',
                    revision: 'local',
                },
            };
        case 'StorefrontCatalog':
            return { storefrontCatalog: { items: [], totalItems: 0 } };
        case 'StorefrontProducts':
            return { products: { items: [], totalItems: 0 } };
        case 'StorefrontCollections':
            return { collections: { items: [], totalItems: 0 } };
        case 'StorefrontContent':
            return {
                storefrontContentSettings: {
                    heroAutoplayIntervalSeconds: 5,
                    configuredBlockTypes: ['CLIENT_PLUGINS'],
                },
                activeStorefrontFlashSales: [],
                activeSystemAnnouncements: [],
                storefrontContent: [pluginBlock],
            };
        case 'ActiveStoreCommerceMode':
            return { activeStoreCommerceMode: 'HYBRID' };
        case 'StorefrontCart':
            return {
                storefrontCart: {
                    id: 'shell-cart',
                    revision: 0,
                    state: 'OPEN',
                    projectedRevision: null,
                    totalQuantity: 0,
                    selectedLineCount: 0,
                    selectedQuantity: 0,
                    selectionState: 'NONE',
                    lines: [],
                    checkoutOrder: null,
                },
            };
        case 'StorefrontCustomer':
            return { activeCustomer: state.signedIn ? customer : null, myCustomerAvatar: null };
        case 'ActiveStorefrontCoupons':
            return { activeStorefrontCoupons: [] };
        case 'MyStorefrontCoupons':
            return { myStorefrontCoupons: [] };
        case 'MyStorefrontCouponUsageRecords':
            return { myStorefrontCouponUsageRecords: [] };
        case 'RecordStorefrontPageView':
            return { recordStorefrontPageView: { recorded: true } };
        case 'RecordStorefrontVisit':
            return { recordStorefrontVisit: { recorded: true } };
        case 'ImageStudioConfig':
            return {
                imageStudioConfig: {
                    enabled: true,
                    promptOptimizationEnabled: true,
                    promptOptimizerModelIds: ['本地模拟'],
                    defaultModelCode: model.code,
                    termsVersion: 'shell-test',
                    termsZh: '本页接口均为本地模拟，仅用于主站页面验收。',
                    outputRetentionDays: 90,
                    referenceRetentionHours: 24,
                    maxQuantity: 4,
                    models: [model],
                },
            };
        case 'ImageStudioWallet':
            return { imageStudioWallet: { availableBalance: state.balance, currencyCode: 'CNY' } };
        case 'ImagePromptQuotaStatus':
            return { imagePromptQuotaStatus: quota };
        case 'ImageModelQuotaStatus':
            return {
                imageModelQuotaStatus: [
                    {
                        modelCode: model.code,
                        freeImageEnabled: false,
                        paidAfterFreeEnabled: true,
                        free: { ...bucket, remaining: 0 },
                        safety: bucket,
                    },
                ],
            };
        case 'MyImageGenerationJobs':
            return { myImageGenerationJobs: { items: [], totalItems: 0 } };
        case 'PreviewImageGenerationPrompt':
            return {
                previewImageGenerationPrompt: {
                    length: (variables.input.optimizedPrompt || variables.input.prompt).length + 100,
                    limit: 8000,
                    valid: true,
                },
            };
        case 'OptimizeImagePrompt': {
            expect(variables.input.expectedPrice).toBe(50);
            expect(variables.input.currencyCode).toBe('CNY');
            state.balance -= 50;
            return {
                optimizeImagePrompt: {
                    originalPrompt: variables.input.prompt,
                    optimizedPrompt: '保留袋装咖啡包装，去除人物与背景，制作白底商品图。',
                    source: 'MODEL',
                    billingMode: 'PAID',
                    chargedAmount: 50,
                    currencyCode: 'CNY',
                    promptQuota: quota,
                    recommendedModelCode: model.code,
                    optimizerModelId: '本地模拟',
                    recommendationReason: '商品图',
                },
            };
        }
        default:
            observed.unexpectedOperations.push(name);
            return null;
    }
}
await mkdir(output, { recursive: true });
const vite = await createServer({
    root: storefront,
    configFile: path.join(storefront, 'vite.config.ts'),
    define: {
        'import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING': JSON.stringify('false'),
        'import.meta.env.VITE_SHOP_API_URL': JSON.stringify('/shop-api'),
    },
    server: { host: '127.0.0.1', port: 5187, strictPort: true },
});
let browser;
let page;
try {
    await vite.listen();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1365, height: 1000 }, locale: 'zh-CN' });
    page.on('pageerror', error => observed.pageErrors.push(error.message));
    await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) {
            observed.externalRequests.push(url.origin + url.pathname);
            return route.abort();
        }
        if (url.pathname === '/storefront-realtime/events')
            return route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: ': local fixture\n\n',
            });
        if (url.pathname !== '/shop-api') return route.continue();
        const body =
            request.method() === 'GET'
                ? {
                      query: url.searchParams.get('query'),
                      variables: JSON.parse(url.searchParams.get('variables') || '{}'),
                  }
                : request.postDataJSON();
        const name = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? 'anonymous';
        observed.operations.push(name);
        if (name === 'StorefrontCustomer' && state.customerError)
            return route.fulfill({ json: { errors: [{ message: '本地注入：账户读取暂时失败' }] } });
        const data = responseFor(name, body.variables || {});
        return route.fulfill({
            json: data ? { data } : { errors: [{ message: 'Unhandled local operation: ' + name }] },
        });
    });
    await page.goto(origin + '/services');
    await page.getByRole('button', { name: /AI 图片工坊/ }).click();
    await expect(page).toHaveURL(/\/image-studio$/);
    await expect(page.getByText('登录后开始生图', { exact: true })).toBeVisible();
    expect(
        observed.operations.some(name =>
            ['ImageStudioWallet', 'MyImageGenerationJobs', 'OptimizeImagePrompt'].includes(name),
        ),
    ).toBe(false);
    await page.getByRole('button', { name: '去登录', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    observed.checks.push(
        'real services entry routes to studio, signed-out gate avoids private image requests, sign-in button opens full login form',
    );

    state.signedIn = true;
    await page.goto(origin + '/image-studio');
    await expect(page.getByRole('button', { name: /付费优化/ })).toBeVisible();
    await page.locator('textarea').first().fill('提取女人手里的袋装咖啡做商品图');
    await page.getByRole('button', { name: /付费优化/ }).click();
    await expect(page.locator('.toast')).toContainText('本次费用');
    await expect(page.locator('textarea').first()).toHaveValue(/保留袋装咖啡包装/);
    await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeEnabled();
    expect(observed.operations.filter(name => name === 'OptimizeImagePrompt')).toHaveLength(1);
    await page.screenshot({ path: path.join(output, 'shell-desktop.png'), animations: 'disabled' });
    observed.checks.push(
        'authenticated full shell passes customer, model, price, locale and toast to studio; one explicit optimization request',
    );

    const beforeFailure = observed.operations.filter(name => name === 'ImageStudioConfig').length;
    state.customerError = true;
    await page.goto(origin + '/image-studio');
    await expect(page.getByText('本地注入：账户读取暂时失败', { exact: true })).toBeVisible({
        timeout: 20000,
    });
    await expect(page.getByRole('button', { name: /付费优化/ })).toHaveCount(0);
    expect(observed.operations.filter(name => name === 'ImageStudioConfig')).toHaveLength(beforeFailure);
    state.customerError = false;
    state.signedIn = false;
    await page
        .getByRole('button', { name: /重试|Retry/ })
        .first()
        .click();
    await expect(page.getByText('登录后开始生图', { exact: true })).toBeVisible();
    observed.checks.push(
        'failed account read blocks studio mount and private queries; retry resolves to signed-out state without stale paid actions',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + '/services');
    await page.getByRole('button', { name: /AI 图片工坊/ }).click();
    await expect(page.getByText('登录后开始生图', { exact: true })).toBeVisible();
    state.signedIn = true;
    await page.reload();
    await expect(page.getByRole('button', { name: /付费优化/ })).toBeVisible();
    await page.locator('textarea').first().fill('袋装咖啡商品图');
    await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeEnabled();
    await page.screenshot({ path: path.join(output, 'shell-mobile.png'), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    observed.checks.push(
        '390px service navigation, anonymous gate and authenticated editor render without horizontal overflow',
    );
    expect(observed.unexpectedOperations).toEqual([]);
    expect(observed.externalRequests).toEqual([]);
    expect(observed.pageErrors).toEqual([]);
    await writeFile(
        path.join(output, 'shell-result.json'),
        JSON.stringify(
            {
                observedAt: new Date().toISOString(),
                mode: 'real main.tsx + router + App + shell + ShopApi; all GraphQL data and authentication states simulated locally; no backend or supplier calls',
                ...observed,
            },
            null,
            2,
        ) + '\n',
    );
    process.stdout.write(JSON.stringify(observed.checks, null, 2) + '\n');
} catch (error) {
    await writeFile(
        path.join(output, 'shell-failure.json'),
        JSON.stringify(
            {
                error: error.message,
                ...observed,
                body: await page
                    ?.locator('body')
                    .innerText()
                    .catch(() => ''),
            },
            null,
            2,
        ) + '\n',
    );
    await page?.screenshot({ path: path.join(output, 'shell-failure.png') }).catch(() => undefined);
    throw error;
} finally {
    await browser?.close();
    await vite.close();
}
