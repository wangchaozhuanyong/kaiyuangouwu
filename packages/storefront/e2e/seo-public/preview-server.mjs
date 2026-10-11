import { load } from 'cheerio';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixtureData } from '../visual-presets/fixtures.mjs';

import { syntheticPage } from './fixtures.mjs';

// Uses the actual completed production artifacts; this script never builds or contacts a backend.
const dist = path.resolve(fileURLToPath(new URL('../../dist/', import.meta.url)));
const require = createRequire(import.meta.url);
const { renderPublicPage } = require(path.join(dist, '.server/public-page-renderer.cjs'));
const template = await readFile(path.join(dist, 'index.html'), 'utf8');
const mime = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
};
const picture =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#d5dee4"/><text x="24" y="72">Synthetic local QA</text></svg>';
const json = (response, value, status = 200) => {
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    response.end(JSON.stringify(value));
};
const requests = [];

function dataFor(url, host) {
    const store = host.startsWith('localhost:') ? 'synthetic-b' : 'synthetic-a';
    const languageCode =
        url.pathname.startsWith('/zh/') || url.searchParams.get('languageCode') === 'zh_Hans'
            ? 'zh_Hans'
            : 'en';
    const kind =
        url.searchParams.get('kind') ??
        (url.pathname.includes('/product')
            ? 'product'
            : url.pathname.includes('/category')
              ? 'catalog'
              : url.pathname.includes('/guides/')
                ? 'article'
                : 'home');
    const page = syntheticPage(store, languageCode, kind, { host, origin: `http://${host}` });
    if (kind === 'catalog' && url.searchParams.get('input')) {
        const input = JSON.parse(url.searchParams.get('input'));
        // Page 2 is the explicit acceptance scope; other pages remain synthetic and scoped.
        if ((input.skip ?? 0) !== 12) {
            const base = syntheticPage(store, languageCode, 'home', { host, origin: `http://${host}` });
            page.catalog.items = (input.skip ?? 0) === 0 ? base.products : [];
            page.request.input.skip = input.skip ?? 0;
            page.requestKey = JSON.stringify(page.request);
            const query = new URLSearchParams({ collectionId: page.request.input.collectionId });
            if (input.skip) query.set('page', String(input.skip / 12 + 1));
            page.route = `/${languageCode === 'zh_Hans' ? 'zh' : 'en'}/category?${query}`;
            page.seo.requestKey = page.requestKey;
            page.seo.canonical = `http://${host}${page.route}`;
        }
    }
    return page;
}

function graphQlData(page) {
    const data = fixtureData('classic', false, 'normal');
    Object.assign(data, {
        activeChannel: { id: page.scope.channelCode, ...page.config },
        availableCountries: page.config.availableCountries,
        storefrontBranding: { ...page.config, accessMode: 'LIVE' },
        storefrontContent: page.content.blocks,
        storefrontContentSettings: page.content.settings,
        storefrontVisualPreset: {
            channelId: page.scope.channelCode,
            presetId: page.visualPreset?.presetId ?? 'classic',
            desktopLayout: 'legacy',
            revision: 'SYNTHETIC-QA-1',
        },
        products: { items: page.products, totalItems: 36 },
        product: page.product ?? page.products[0],
        collections: { items: page.collections },
        storefrontCatalog: page.catalog ?? { items: page.products, totalItems: 36 },
        activeCustomer: null,
        activeOrder: null,
        storefrontReviewSettings: { enabled: false },
        activeStoreCommerceMode: 'HYBRID',
        activeStorefrontFlashSales: [],
        activeSystemAnnouncements: [],
        activeStorefrontCouponCampaigns: [],
        myStorefrontCoupons: [],
        myCustomerProductActivity: { favoriteProductIds: [], recentProductVisits: [] },
        storefrontDailyRecommendations: {
            items: [],
            businessDate: '2026-01-01',
            expiresAt: '2099-01-01T00:00:00Z',
        },
        recordStorefrontHeartbeat: { recorded: true },
        recordMyProductVisit: { favoriteProductIds: [], recentProductVisits: [] },
        currentCustomerServiceReview: null,
    });
    data.storefrontCart = {
        ...data.storefrontCart,
        lines: [],
        totalQuantity: 0,
        selectedQuantity: 0,
        selectedLineCount: 0,
        selectionState: 'NONE',
        checkoutOrder: null,
        subTotalWithTax: 0,
        selectedSubTotalWithTax: 0,
        currencyCode: 'MYR',
    };
    return data;
}

function assembleFixtureHtml(page, body) {
    const document = load(template);
    document('html').attr('lang', page.scope.languageCode === 'zh_Hans' ? 'zh-CN' : 'en');
    document('html').attr('data-storefront-preset', page.visualPreset?.presetId ?? 'classic');
    document('title').text(page.seo.title);
    document('meta[name=description]').attr('content', page.seo.description);
    document('meta[name=robots]').attr('content', page.seo.robots);
    document('link[rel=canonical],link[rel=alternate],script[type="application/ld+json"]').remove();
    document('head').append('<link rel="canonical">');
    document('link[rel=canonical]').attr('href', page.seo.canonical);
    for (const alternate of page.seo.alternates) {
        document('head').append('<link rel="alternate">');
        document('link[rel=alternate]')
            .last()
            .attr('hreflang', alternate.language)
            .attr('href', alternate.href);
    }
    for (const schema of page.seo.structuredData) {
        const schemaPayload = JSON.stringify(schema).replace(/</gu, '\\u003c');
        document('head').append(
            `<script type="application/ld+json" data-storefront-seo>${schemaPayload}</script>`,
        );
    }
    document('#root').attr('data-public-rendered', '1').html(body);
    const payload = JSON.stringify(page).replace(
        /[<>&\u2028\u2029]/gu,
        value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    document('body').append(
        `<script id="storefront-public-page-data" type="application/json">${payload}</script>`,
    );
    return document.html();
}

export async function startSeoFixtureServer(port = 0, { transformPage } = {}) {
    const pageFor = (...args) => {
        const page = dataFor(...args);
        transformPage?.(page);
        return page;
    };
    const server = http.createServer(async (request, response) => {
        try {
            const host = request.headers.host;
            if (!/^(?:127\.0\.0\.1|localhost):\d+$/u.test(host ?? ''))
                return json(response, { error: 'Synthetic host only' }, 400);
            const url = new URL(request.url, `http://${host}`);
            requests.push({ host, path: url.pathname + url.search, method: request.method });
            if (url.pathname === '/__qa/requests') return json(response, requests);
            if (url.pathname === '/_storefront/page-data') return json(response, pageFor(url, host));
            if (url.pathname === '/shop-api') {
                let requestBody = '';
                for await (const chunk of request) requestBody += chunk.toString();
                const operation = JSON.parse(requestBody || '{}');
                const referrer = new URL(request.headers.referer ?? `http://${host}/en/`);
                if (url.searchParams.has('languageCode'))
                    referrer.searchParams.set('languageCode', url.searchParams.get('languageCode'));
                const graphQlPage = pageFor(referrer, host);
                requests.at(-1).operation =
                    /(?:query|mutation)\s+(\w+)/u.exec(operation.query ?? '')?.[1] ?? 'unknown';
                return json(response, { data: graphQlData(graphQlPage) });
            }
            if (url.pathname.includes('storefront-realtime')) {
                response.writeHead(204);
                response.end();
                return;
            }
            if (url.pathname === '/qa/synthetic-image.svg' || url.pathname.includes('neutral-')) {
                response.writeHead(200, { 'content-type': 'image/svg+xml' });
                response.end(picture);
                return;
            }
            const asset = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
            if (
                asset.startsWith(dist + path.sep) &&
                (await stat(asset)
                    .then(file => file.isFile())
                    .catch(() => false))
            ) {
                response.writeHead(200, {
                    'content-type': mime[path.extname(asset)] ?? 'application/octet-stream',
                });
                response.end(await readFile(asset));
                return;
            }
            if (url.pathname.startsWith('/assets/')) {
                response.writeHead(404);
                response.end('Missing fixture asset');
                return;
            }
            const page = pageFor(url, host);
            const body = await renderPublicPage(page);
            response.writeHead(200, {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-store',
            });
            response.end(assembleFixtureHtml(page, body));
        } catch (error) {
            json(response, { error: error.message }, 500);
        }
    });
    await new Promise(resolve => server.listen(port, '::', resolve));
    return {
        port: server.address().port,
        requests,
        close: () => new Promise(resolve => server.close(resolve)),
    };
}
