// Real built storefront with loopback-only synthetic reads; no production connections or writes.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { TRAFFIC_OPT_OUT_KEY } from '../../src/storefront-traffic.ts';
import { startSeoFixtureServer } from '../seo-public/preview-server.mjs';
import { fixtureData } from '../visual-presets/fixtures.mjs';

const output = fileURLToPath(
    new URL('../../../../.runtime/window-home-auth-release-20261029/coupon-browser/', import.meta.url),
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const offer = fixtureData('classic', false, 'product-coupon-quantity').activeStorefrontCoupons[0];
assert.ok(offer?.claimable, 'Expected an active synthetic coupon');
const results = [];
try {
    // Exercise the actual anonymous HTML -> identity -> personalized-read handoff.
    // NEW/RETURNING eligibility is synthetic server output, never production data.
    for (const [width, language, skin] of [
        [390, 'zh', 'classic'],
        [390, 'en', 'neo-minimalist'],
        [1440, 'zh', 'neo-minimalist'],
        [1440, 'en', 'classic'],
    ]) {
        for (const audience of ['guest', 'new', 'returning']) {
            let releaseIdentity = () => undefined;
            let releaseCoupons = () => undefined;
            let identityGate = Promise.resolve();
            let couponGate = Promise.resolve();

            const fixture = await startSeoFixtureServer(0, {
                listenHost: '127.0.0.1',
                readOnly: true,
                transformPage(snapshot) {
                    snapshot.visualPreset.presetId = skin;
                    snapshot.content.blocks.push({
                        ...snapshot.content.blocks[0],
                        id: 'synthetic-coupons',
                        type: 'COUPONS',
                        title: 'Synthetic offers',
                        enabled: true,
                        items: [],
                    });
                    snapshot.content.settings.configuredBlockTypes.push('COUPONS');
                    snapshot.couponAudience = 'unknown';
                    snapshot.couponCampaigns = [offer];
                },
                async transformGraphQlData(data, { operation }) {
                    if (operation.query.includes('StorefrontCustomerIdentity')) await identityGate;
                    if (operation.query.includes('activeStorefrontCoupons')) await couponGate;
                    data.activeCustomer =
                        audience === 'guest'
                            ? null
                            : {
                                  ...fixtureData('classic', true).activeCustomer,
                                  orders: { totalItems: audience === 'returning' ? 1 : 0, items: [] },
                              };
                    data.activeStorefrontCoupons =
                        audience === 'guest'
                            ? []
                            : [
                                  {
                                      ...offer,
                                      customerEligibility: 'NEW',
                                      claimed: false,
                                      claimable: audience === 'new',
                                  },
                              ];
                    data.myStorefrontCoupons = [];
                },
            });
            const fixtureOrigin = `http://127.0.0.1:${fixture.port}`;
            const context = await browser.newContext({
                viewport: { width, height: 900 },
                serviceWorkers: 'block',
            });
            await context.addInitScript(key => {
                localStorage.setItem(key, '1');
                window.__couponFrames = [];
                const sample = () => {
                    window.__couponFrames.push({
                        heading: !!document.querySelector('.coupon-hub-title-lockup'),
                        claim: !!document.querySelector('.coupon-claim-btn'),
                        pending: !!document.querySelector('.coupon-hub-placeholder'),
                    });
                    if (window.__couponFrames.length < 1200) requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
            }, TRAFFIC_OPT_OUT_KEY);
            await context.route('**/*', route =>
                new URL(route.request().url()).origin === fixtureOrigin
                    ? route.continue()
                    : route.abort('blockedbyclient'),
            );
            const page = await context.newPage();
            try {
                for (const first of ['identity', 'coupons']) {
                    identityGate = new Promise(resolve => {
                        releaseIdentity = resolve;
                    });
                    couponGate = new Promise(resolve => {
                        releaseCoupons = resolve;
                    });
                    if (first === 'identity') await page.goto(`${fixtureOrigin}/${language}/`);
                    else await page.reload();
                    await expect(page.locator('html')).toHaveAttribute('data-storefront-app-owned', '');
                    await expect(page.locator('.coupon-hub-section')).toHaveCount(0);
                    await expect(page.locator('.coupon-hub-title-lockup')).toHaveCount(0);
                    // The current route starts coupons only after identity settles.
                    // Exercise each slow dependency without waiting for an impossible order.
                    const identityResponse = page.waitForResponse(
                        response =>
                            response.url().includes('/shop-api') &&
                            response.request().postData()?.includes('StorefrontCustomerIdentity'),
                    );
                    const couponResponse = page.waitForResponse(
                        response =>
                            response.url().includes('/shop-api') &&
                            response.request().postData()?.includes('activeStorefrontCoupons'),
                    );
                    if (first === 'identity') {
                        releaseIdentity();
                        await identityResponse;
                        await expect(page.locator('.coupon-hub-section')).toHaveCount(0);
                        releaseCoupons();
                    } else {
                        releaseCoupons();
                        await expect(page.locator('.coupon-hub-section')).toHaveCount(0);
                        releaseIdentity();
                        await identityResponse;
                    }
                    await couponResponse;
                    await expect(page.locator('.coupon-hub-placeholder')).toHaveCount(0);
                    await expect(page.locator('.coupon-claim-btn')).toHaveCount(audience === 'new' ? 1 : 0);
                    if (audience === 'new') {
                        await expect(page.locator('.coupon-hub-title-lockup')).toBeVisible();
                    } else {
                        await expect(page.locator('.coupon-hub-section')).toHaveCount(0);
                        const frames = await page.evaluate(() => window.__couponFrames);
                        assert.ok(
                            frames.every(frame => !frame.heading && !frame.claim),
                            'Ineligible visitors must never flash an offer heading or claim button',
                        );
                    }
                    await page.screenshot({
                        path: `${output}/${width}-${language}-${skin}-${audience}-${first}.png`,
                        fullPage: true,
                    });
                    results.push({ width, language, skin, audience, first, status: 'PASS' });
                }
                const categoryLink = page.locator('a[href*="/category"]').filter({ visible: true }).first();
                await categoryLink.click();
                await expect(page).toHaveURL(/\/category/u);
                await page.goBack();
                await expect(page.locator('.home-page')).toBeVisible();
                await expect(page.locator('.coupon-claim-btn')).toHaveCount(audience === 'new' ? 1 : 0);
                results.push({
                    width,
                    language,
                    skin,
                    audience,
                    phase: 'home-category-home',
                    status: 'PASS',
                });
            } catch (error) {
                await page
                    .screenshot({ path: `${output}/handoff-failure.png`, fullPage: true })
                    .catch(() => undefined);
                await writeFile(
                    `${output}/handoff-failure.json`,
                    JSON.stringify({ width, language, skin, audience, error: String(error) }, null, 2),
                );
                throw error;
            } finally {
                releaseIdentity();
                releaseCoupons();
                await context.close();
                await fixture.close();
            }
        }
    }
    await writeFile(
        `${output}/summary.json`,
        JSON.stringify({ status: 'PASS', syntheticData: true, results }, null, 2),
    );
    process.stdout.write(`Coupon visibility browser checks passed: ${results.length} scenarios\n`);
} finally {
    await browser.close();
}
