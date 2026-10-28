import assert from 'node:assert/strict';
import test from 'node:test';

import { startSeoFixtureServer } from '../seo-public/preview-server.mjs';

import { applyCouponScenario } from './coupon-fixture.mjs';

test('coupon fixtures represent prepared, unknown, empty and late public inputs without identity', () => {
    const page = {};
    applyCouponScenario(page, 'coupons');
    assert.deepEqual(page, { couponAudience: 'anonymous', couponCampaigns: [] });
    applyCouponScenario(page, 'old');
    assert.deepEqual(page, {});
    applyCouponScenario(page, 'targeted');
    assert.equal(page.couponAudience, 'unknown');
    assert.equal(page.couponCampaigns.length, 1);
    applyCouponScenario(page, 'prepared');
    assert.equal(page.couponAudience, 'anonymous');
    assert.equal(page.couponCampaigns[0].claimed, false);
    assert.equal(page.couponCampaigns[0].claimable, true);
    assert.equal('customerId' in page.couponCampaigns[0], false);
    applyCouponScenario(page, 'late');
    assert.deepEqual(page, {});
    applyCouponScenario(page, 'late', true);
    assert.equal(page.couponAudience, 'anonymous');
    assert.equal(page.couponCampaigns.length, 1);
});

test('loading fixture serves synthetic SSR and refuses every GraphQL write operation', async t => {
    const server = await startSeoFixtureServer(0, {
        listenHost: '127.0.0.1',
        readOnly: true,
        renderPage: async () => '<main>synthetic body</main>',
        transformHtml: async (_route, page) =>
            `<html><head><title>QA</title></head><body><div id="root"></div>
            <script type="module" src="/assets/mock.js"></script><i>${page.scope.channelCode}</i></body></html>`,
        beforeRequest: async (_request, response, url) => {
            if (url.pathname !== '/__qa/health') return false;
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ synthetic: true }));
            return true;
        },
    });
    t.after(() => server.close());
    const origin = `http://127.0.0.1:${server.port}`;
    const document = await fetch(origin + '/zh/').then(response => response.text());
    assert.match(document, /data-public-rendered="1"/u);
    assert.match(document, /synthetic body/u);
    assert.match(document, /storefront-public-page-data/u);
    assert.deepEqual(await fetch(origin + '/__qa/health').then(response => response.json()), {
        synthetic: true,
    });
    for (const input of [
        { query: 'mutation Purchase { purchase }' },
        { query: 'subscription Updates { updates }' },
        { query: 'query Read { activeCustomer } mutation Purchase { purchase }', operationName: 'Read' },
        { query: 'mutation { claimStorefrontCoupon(campaignId: "qa-prepared-coupon") { id } }' },
    ]) {
        const response = await fetch(origin + '/shop-api', { method: 'POST', body: JSON.stringify(input) });
        assert.equal(response.status, 405);
        assert.match(JSON.stringify(await response.json()), /Read-only local fixture/u);
    }
    const read = await fetch(origin + '/shop-api', {
        method: 'POST',
        body: JSON.stringify({ query: 'query Read { activeCustomer }' }),
    });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).data.activeCustomer, null);
});
