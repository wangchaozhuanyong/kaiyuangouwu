/** Local synthetic fixtures only. No upstream, database, credentials or business writes. */
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    canonicalPublicPageRequest,
    isReusablePublicPageData,
    publicPageRequestFromUrl,
    publicPageRequestKey,
    publicPageRouteHref,
    serializeStorefrontPageData,
    STOREFRONT_PAGE_DATA_ELEMENT_ID,
    storefrontNavigationCollections,
} from '../../../storefront-content-plugin/src/shared/public-page-data.ts';
import {
    mediaDescriptor,
    STOREFRONT_IMAGE_SIZES,
} from '../../../storefront-content-plugin/src/shared/responsive-image.ts';
import { fixtureData } from '../visual-presets/fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../../asset-server-plugin/package.json'));
const { parse, getOperationAST } = require('graphql');
const sharp = require('sharp');
const defaultDist = resolve(here, '../../dist');
const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json',
};
const json = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
};
const attribute = value =>
    String(value).replace(
        /[&"<>]/gu,
        char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char],
    );

function optionsFor(req, url, defaults) {
    let reference;
    try {
        reference = new URL(req.headers.referer ?? url.href);
    } catch {
        reference = url;
    }
    const value = key => url.searchParams.get(key) ?? reference.searchParams.get(key) ?? defaults[key];
    return {
        delay: Math.min(10_000, Math.max(0, Number(value('qaDelay')) || 0)),
        imageDelay: Math.min(30_000, Math.max(0, Number(value('qaImageDelay')) || 0)),
        empty: value('qaEmpty') === '1',
        ssi: value('qaSsi') === 'hot' ? 'hot' : 'cold',
        legacy: value('qaLegacy') === '1',
        preset: value('qaPreset') === 'classic' ? 'classic' : 'neo-minimalist',
        accessMode: ['PREVIEW', 'CLOSED'].includes(value('qaAccessMode')) ? value('qaAccessMode') : 'LIVE',
    };
}

function fixtureCatalog(products, input = {}, empty = false) {
    let items = empty
        ? []
        : products.filter(product => {
              const price = product.variants[0].priceWithTax;
              return (
                  (!input.term || product.name.toLowerCase().includes(input.term.toLowerCase())) &&
                  (!input.collectionId || product.collections.some(item => item.id === input.collectionId)) &&
                  (!input.fulfillmentType || input.fulfillmentType === 'PHYSICAL') &&
                  (input.minPriceWithTax == null || price >= input.minPriceWithTax) &&
                  (input.maxPriceWithTax == null || price <= input.maxPriceWithTax)
              );
          });
    if (input.sort === 'PRICE_DESC') items = items.toReversed();
    const totalItems = items.length;
    const skip = input.skip ?? 0;
    return { items: items.slice(skip, skip + (input.take ?? 12)), totalItems };
}

function fixtures(preset) {
    const source = fixtureData(preset, false);
    const asset = id => ({ id, preview: `/assets/preview/${id}.svg` });
    const products = Array.from({ length: 24 }, (_, index) => {
        const id = `product-${index + 1}`;
        const featuredAsset = asset(id);
        return {
            ...source.product,
            id,
            name: `日常随行杯 ${index + 1}`,
            slug: `qa-cup-${index + 1}`,
            featuredAsset,
            assets: [featuredAsset, asset(`${id}-detail`)],
            collections: [
                { id: index < 12 ? 'collection-cups' : 'collection-other' },
                { id: 'collection-daily' },
            ],
            variants: [
                {
                    ...source.product.variants[0],
                    id: `variant-${index + 1}`,
                    featuredAsset,
                    priceWithTax: 2990 + index * 100,
                    product: { id, name: `日常随行杯 ${index + 1}`, featuredAsset },
                },
            ],
        };
    });
    const collections = [
        {
            ...source.collections.items[0],
            featuredAsset: asset('category-daily'),
            children: [
                { ...source.collections.items[0].children[0], featuredAsset: asset('category-cups') },
                {
                    ...source.collections.items[0].children[0],
                    id: 'collection-other',
                    name: '其他用品',
                    featuredAsset: asset('category-other'),
                },
                {
                    ...source.collections.items[0].children[0],
                    id: 'collection-empty',
                    name: '暂无商品',
                    featuredAsset: asset('category-empty'),
                },
            ],
        },
    ];
    return {
        ...source,
        activeCustomer: null,
        order: null,
        storefrontCart: {
            ...source.storefrontCart,
            lines: [],
            totalQuantity: 0,
            subTotalWithTax: 0,
            totalWithTax: 0,
        },
        products: { items: products, totalItems: products.length },
        product: products[0],
        collections: { items: collections, totalItems: collections.length },
        storefrontContent: source.storefrontContent.map(block => ({
            ...block,
            imageUrl: `/assets/preview/qa-${block.type.toLowerCase()}.svg`,
        })),
    };
}

export function buildPublicPage(request, host, options = {}, scope = {}) {
    request = canonicalPublicPageRequest(request);
    const data = fixtures(options.preset);
    const channel = data.activeChannel;
    const config = {
        ...channel,
        availableCountries: data.availableCountries,
        availableProvinces: [],
        ...data.storefrontBranding,
        logoUrl: '/assets/preview/qa-logo.svg',
        currencyConfiguration: data.storefrontCurrencyConfiguration,
        accessMode: options.accessMode ?? 'LIVE',
    };
    const content = {
        blocks: data.storefrontContent,
        settings: {
            ...data.storefrontContentSettings,
            auth: {
                emailPasswordEnabled: true,
                emailAutoRegistrationEnabled: false,
                emailQuickRegistrationEnabled: false,
                googleEnabled: false,
            },
        },
        flashSales: [],
        flashSalesDeferred: true,
        systemAnnouncements: [],
    };
    const route =
        request.kind === 'catalog'
            ? { catalog: fixtureCatalog(data.products.items, request.input, options.empty) }
            : request.kind === 'product'
              ? { product: data.products.items.find(item => item.id === request.id) ?? null }
              : { products: options.empty ? [] : data.products.items.slice(0, 12) };
    const media = [mediaDescriptor(config.logoUrl, 'icon')];
    for (const product of route.catalog?.items ?? route.products ?? (route.product ? [route.product] : []))
        media.push(
            mediaDescriptor(product.featuredAsset.preview, request.kind === 'product' ? 'detail' : 'card'),
        );
    if (request.kind === 'home')
        media.push(mediaDescriptor(content.blocks.find(block => block.type === 'HERO').imageUrl, 'hero'));
    return {
        schemaVersion: 1,
        version: 'synthetic-local-fixture-v1',
        generatedAt: Date.now(),
        scope: {
            host,
            channelCode: channel.code,
            languageCode: scope.languageCode === 'en' ? 'en' : 'zh_Hans',
            currencyCode: 'MYR',
            priceContext: 'public',
        },
        request,
        requestKey: publicPageRequestKey(request),
        route: publicPageRouteHref(request),
        config,
        content,
        collections: data.collections.items,
        visualPreset: data.storefrontVisualPreset,
        flashSales: [],
        media,
        failures: [],
        ...route,
    };
}

function hotSsi(page, url) {
    if (!isReusablePublicPageData(page)) return '';
    const request = page.request;
    const candidate =
        request.kind === 'home'
            ? page.content.blocks.find(block => block.type === 'HERO')?.imageUrl
            : request.kind === 'catalog'
              ? page.catalog.items[0]?.featuredAsset?.preview
              : page.product?.featuredAsset?.preview;
    const link = (kind, sizes, condition) => {
        const media = mediaDescriptor(candidate, kind, sizes ? { sizes } : undefined);
        return [
            `<link rel="preload" as="image" href="${attribute(media.src)}" type="image/webp"`,
            ` imagesrcset="${attribute(media.srcSet)}" imagesizes="${attribute(media.sizes)}"`,
            ` fetchpriority="high"${condition ? ` media="${condition}"` : ''}>`,
        ].join('');
    };
    const primaryId = url.searchParams.get('collectionId') ?? url.searchParams.get('collection');
    const hasSidebar =
        request.kind === 'catalog' &&
        request.path === '/category' &&
        storefrontNavigationCollections(page.collections ?? []).some(
            item => item.id === primaryId && item.children?.length,
        );
    const preload = !candidate
        ? ''
        : request.kind === 'catalog'
          ? link(
                'card',
                hasSidebar ? STOREFRONT_IMAGE_SIZES.categorySidebarRow : STOREFRONT_IMAGE_SIZES.productRow,
                '(max-width: 1023px)',
            ) + link('card', STOREFRONT_IMAGE_SIZES.desktopCatalogCard, '(min-width: 1024px)')
          : link(request.kind === 'home' ? 'hero' : 'detail');
    return `${preload}<script type="application/json" id="${STOREFRONT_PAGE_DATA_ELEMENT_ID}">${serializeStorefrontPageData(page)}</script>`;
}

/** Start explicitly on 127.0.0.1; caller owns listen/close. Dist is never generated here. */
export function createPreviewServer({ dist = defaultDist, defaults = {} } = {}) {
    const requests = [];
    const images = new Map();
    const record = value => {
        requests.push({ at: Date.now(), ...value });
        if (requests.length > 1000) requests.shift();
    };
    const server = createServer(async (req, res) => {
        try {
            const host = req.headers.host ?? '127.0.0.1';
            if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host))
                return json(res, 403, { error: 'Loopback fixture only' });
            const url = new URL(req.url, `http://${host}`);
            const options = optionsFor(req, url, defaults);
            if (
                req.method !== 'GET' &&
                req.method !== 'HEAD' &&
                !(req.method === 'POST' && url.pathname === '/shop-api')
            )
                return json(res, 405, { error: 'Business writes disabled in local fixture' });
            if (url.pathname === '/__qa/requests') return json(res, 200, { fixture: true, requests });
            if (url.pathname === '/__qa/health')
                return json(res, 200, { fixture: true, dist, defaultSsi: defaults.qaSsi ?? 'cold' });
            if (url.pathname === '/_storefront/page-data') {
                if (options.accessMode === 'CLOSED')
                    return json(res, 403, { errorCode: 'STOREFRONT_CLOSED', message: '店铺暂未开放' });
                if (options.legacy) return json(res, 404, { fixture: true, legacy: true });
                const kind = url.searchParams.get('kind') ?? 'home';
                const aggregateRequest = canonicalPublicPageRequest(
                    kind === 'catalog'
                        ? {
                              kind,
                              path: url.searchParams.get('path') ?? '/category',
                              input: JSON.parse(url.searchParams.get('input') ?? '{}'),
                          }
                        : kind === 'product'
                          ? { kind, id: url.searchParams.get('id') ?? '' }
                          : { kind },
                );
                record({
                    type: 'aggregate',
                    key: publicPageRequestKey(aggregateRequest),
                    delay: options.delay,
                });
                if (options.delay) await new Promise(done => setTimeout(done, options.delay));
                return json(
                    res,
                    200,
                    buildPublicPage(aggregateRequest, host, options, {
                        languageCode: url.searchParams.get('languageCode'),
                    }),
                );
            }
            if (url.pathname === '/shop-api') {
                let body = '';
                if (req.method === 'POST')
                    for await (const chunk of req) {
                        body += chunk;
                        if (body.length > 64_000)
                            return json(res, 413, { error: 'Fixture request too large' });
                    }
                const input = req.method === 'POST' ? JSON.parse(body) : Object.fromEntries(url.searchParams);
                const document = parse(input.query ?? '');
                // Reject the entire document if it contains any write, including an unselected operation.
                if (
                    document.definitions.some(
                        item => item.kind === 'OperationDefinition' && item.operation !== 'query',
                    )
                )
                    return json(res, 405, {
                        errors: [
                            { message: 'All mutations and subscriptions are disabled in local fixture' },
                        ],
                    });
                const operation = getOperationAST(document, input.operationName);
                if (!operation) return json(res, 400, { error: 'One read operation is required' });
                const data = fixtures(options.preset);
                if (options.accessMode === 'CLOSED')
                    return json(res, 403, {
                        errors: [{ message: '店铺暂未开放', extensions: { code: 'STOREFRONT_CLOSED' } }],
                    });
                data.storefrontBranding = { ...data.storefrontBranding, accessMode: options.accessMode };
                const variables =
                    typeof input.variables === 'string'
                        ? JSON.parse(input.variables)
                        : (input.variables ?? {});
                data.storefrontCatalog = fixtureCatalog(data.products.items, variables.input, options.empty);
                data.product = data.products.items.find(item => item.id === variables.id) ?? data.product;
                if (options.empty) data.products = { items: [], totalItems: 0 };
                const fields = operation.selectionSet.selections.filter(item => item.kind === 'Field');
                record({
                    type: 'graphql',
                    operation: operation.name?.value ?? 'anonymous',
                    fields: fields.map(item => item.name.value),
                    delay: options.delay,
                });
                if (options.delay) await new Promise(done => setTimeout(done, options.delay));
                return json(res, 200, {
                    data: Object.fromEntries(
                        fields.map(field => [
                            field.alias?.value ?? field.name.value,
                            data[field.name.value] ?? null,
                        ]),
                    ),
                });
            }
            if (url.pathname === '/storefront-realtime/events') {
                record({ type: 'realtime' });
                res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
                res.write('event: ready\ndata: {"version":1,"heartbeatIntervalMs":15000}\n\n');
                const timer = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
                res.on('close', () => clearInterval(timer));
                return;
            }
            if (/^\/assets\/(preview|source)\/[a-z0-9_-]+\.svg$/iu.test(url.pathname)) {
                record({
                    type: 'image',
                    path: url.pathname,
                    preset: url.searchParams.get('preset'),
                    delay: options.imageDelay,
                });
                if (options.imageDelay) await new Promise(done => setTimeout(done, options.imageDelay));
                const width = Math.min(
                    1600,
                    Math.max(32, Number(url.searchParams.get('preset')?.match(/(\d+)$/u)?.[1]) || 640),
                );
                const key = `${url.pathname}:${width}`;
                let buffer = images.get(key);
                if (!buffer) {
                    const source = fixtureData().product.featuredAsset.preview;
                    buffer = sharp(Buffer.from(decodeURIComponent(source.slice(source.indexOf(',') + 1))))
                        .resize({ width })
                        .webp({ quality: 90 })
                        .toBuffer();
                    images.set(key, buffer);
                }
                const bytes = await buffer;
                res.writeHead(200, {
                    'content-type': 'image/webp',
                    'cache-control': 'public, max-age=300',
                    'content-length': bytes.length,
                });
                return res.end(req.method === 'HEAD' ? undefined : bytes);
            }
            const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            const path = resolve(dist, relative);
            if (!path.startsWith(resolve(dist) + sep) && path !== resolve(dist))
                return json(res, 403, { error: 'Invalid fixture path' });
            let file;
            try {
                if ((await stat(path)).isFile()) file = path;
            } catch {
                /* Public SPA route below. */
            }
            if (file) {
                const bytes = await readFile(file);
                res.writeHead(200, {
                    'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
                    'cache-control': 'no-store',
                });
                return res.end(req.method === 'HEAD' ? undefined : bytes);
            }
            if (extname(url.pathname)) return json(res, 404, { error: 'Missing local static asset' });
            const request = publicPageRequestFromUrl(url.pathname + url.search);
            const page =
                request && options.ssi === 'hot' ? buildPublicPage(request, host, options) : undefined;
            const html = (await readFile(resolve(dist, 'index.html'), 'utf8')).replace(
                /<!--#\s*include\s+virtual="\/_storefront\/lcp-preload"\s*-->/gu,
                page ? hotSsi(page, url) : '',
            );
            record({ type: 'document', route: url.pathname, ssi: options.ssi });
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            res.end(req.method === 'HEAD' ? undefined : html);
        } catch (error) {
            if (!res.headersSent) json(res, 400, { fixture: true, error: error.message });
            else res.end();
        }
    });
    return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = new URLSearchParams(
        process.argv
            .slice(2)
            .map(value => value.replace(/^--/u, ''))
            .join('&'),
    );
    const port = Number(args.get('port') ?? 5197);
    const server = createPreviewServer({ defaults: Object.fromEntries(args) });
    server.listen(port, '127.0.0.1', () =>
        process.stdout.write(
            `Synthetic storefront preview: http://127.0.0.1:${port} (no production connections)\n`,
        ),
    );
}
