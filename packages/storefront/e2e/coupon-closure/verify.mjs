import { chromium, expect, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fixtureData } from '../cart-commands/fixtures.mjs';

const output = fileURLToPath(new URL('../../../../artifacts/coupon-closure/', import.meta.url));
await mkdir(output, { recursive: true });
const results = [];
for (const [engine, browserType] of [
    ['chromium', chromium],
    ['webkit', webkit],
]) {
    const browser = await browserType.launch({ headless: true });
    try {
        for (const width of [1440, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'zh-CN' });
            const fixture = structuredClone(fixtureData('classic'));
            const coupons = Array.from({ length: 45 }, (_, index) => ({
                id: `coupon-${index}`,
                campaignId: `campaign-${index}`,
                campaignName: `测试优惠券 ${index + 1}`,
                campaignKind: 'ORDER_FIXED',
                status: 'AVAILABLE',
                minimumSpend: 0,
                currencyCode: 'MYR',
                discountAmount: (index + 1) * 100,
                discountRate: null,
                collectionIds: [],
                productVariantIds: [],
                claimedAt: '2026-09-09T12:00:00Z',
                validFrom: '2026-09-09T12:00:00Z',
                validUntil: '2099-09-16T12:00:00Z',
                lockedAt: null,
                usedAt: null,
                returnedAt: null,
                expiredAt: null,
                lockedOrderId: null,
                usedOrderId: null,
                returnCount: 0,
                usable: true,
            }));
            const history = coupons.slice(0, 23).map((coupon, index) => ({
                ...coupon,
                id: `allocation-${index}`,
                customerCouponId: coupon.id,
                campaignName: `用券记录 ${index + 1}`,
                status: index === 0 ? 'REFUNDED' : 'USED',
                savedAmount: 100,
                usedAt: '2026-09-10T12:00:00Z',
                refundedAt: index === 0 ? '2026-09-10T13:00:00Z' : null,
                orderId: `order-${index}`,
                orderCode: `QA${index}`,
            }));
            let failHistory = false;
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.pathname.includes('shop-api')) {
                    const { query, variables } = route.request().postDataJSON() ?? {};
                    const usage = query?.includes('MyStorefrontCouponUsageRecordsPage');
                    if (usage && failHistory)
                        return route.fulfill({
                            json: { errors: [{ message: 'Injected private database failure' }] },
                        });
                    const source = usage ? history : coupons;
                    const options = variables?.options ?? {};
                    const paged = {
                        items: source.slice(options.skip ?? 0, (options.skip ?? 0) + (options.take ?? 20)),
                        totalItems: source.length,
                    };
                    return route.fulfill({
                        json: {
                            data: {
                                ...fixture,
                                myStorefrontCoupons: coupons,
                                myStorefrontCouponUsageRecords: history,
                                myStorefrontCouponsPage: paged,
                                myStorefrontCouponUsageRecordsPage: paged,
                            },
                        },
                    });
                }
                if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
                if (url.pathname.includes('storefront-realtime'))
                    return route.fulfill({ status: 204, body: '' });
                return route.continue();
            });
            await page.goto('http://127.0.0.1:5198/coupons');
            const tabs = page.locator('.coupon-center-tabs');
            await tabs.getByRole('button', { name: /未使用|Unused/ }).click();
            const tickets = page.locator('.coupon-center-ticket-list > article');
            await expect(tickets).toHaveCount(20);
            await expect(page.locator('.coupon-center-pagination')).toContainText('45');
            await page.getByRole('button', { name: /下一页|Next/, exact: true }).click();
            await expect(page.locator('.coupon-center-pagination')).toContainText('2 / 3');
            await expect(tickets.first().locator('strong').first()).toHaveText('21');
            await page.getByRole('button', { name: /下一页|Next/, exact: true }).click();
            await expect(tickets).toHaveCount(5);
            await expect(page.getByRole('button', { name: /下一页|Next/, exact: true })).toBeDisabled();
            await page.screenshot({ path: `${output}/${engine}-${width}-owned.png`, fullPage: true });
            await tabs.getByRole('button', { name: /记录|History/ }).click();
            await expect(tickets).toHaveCount(20);
            await expect(page.locator('.coupon-center-pagination')).toContainText('1 / 2');
            failHistory = true;
            await page.getByRole('button', { name: /下一页|Next/, exact: true }).click();
            const retry = page.getByRole('button', { name: /重试|Retry/, exact: true });
            await expect(retry).toBeVisible({ timeout: 15000 });
            await expect(page.locator('body')).not.toContainText('Injected private database failure');
            failHistory = false;
            await retry.click();
            await expect(tickets).toHaveCount(3);
            await expect(tickets.first()).toContainText('QA20');
            await page.screenshot({ path: `${output}/${engine}-${width}-history.png`, fullPage: true });
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
            expect(overflow).toBe(false);
            expect(errors).toEqual([]);
            results.push({
                engine,
                width,
                passed: true,
                checks: [
                    '45 coupons in 3 pages',
                    '23 history records in 2 pages',
                    'independent tab cursor',
                    'failure redaction and retry',
                    'end-page disabled',
                    'no horizontal overflow',
                    'no runtime errors',
                ],
            });
            await page.close();
        }
    } finally {
        await browser.close();
    }
}
await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2));
process.stdout.write(JSON.stringify(results) + '\n');
