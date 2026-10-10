import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { STOREFRONT_IMAGE_SIZES } from '../../../storefront-content-plugin/src/shared/responsive-image.ts';

import { buildPublicPage, createPreviewServer } from './preview-server.mjs';

let server;
let base;
before(async () => {
    // SSI contract tests run before a production build on a clean CI checkout.
    // Use the real source HTML marker rather than depending on an old dist directory.
    server = createPreviewServer({ dist: fileURLToPath(new URL('../../', import.meta.url)) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
});
const catalogUrl = (input = {}, extra = '') =>
    `${base}/_storefront/page-data?kind=catalog&path=/category&input=${encodeURIComponent(JSON.stringify(input))}${extra}`;

test('a missing detail can remain in a cached home summary without changing the catalog', async () => {
    const home = await (await fetch(`${base}/_storefront/page-data?kind=home&qaMissingProduct=1`)).json();
    assert.ok(home.products.some(product => product.id === 'product-1'));
    const detail = await (
        await fetch(`${base}/_storefront/page-data?kind=product&id=product-1&qaMissingProduct=1`)
    ).json();
    assert.equal(detail.product, null);
    assert.deepEqual(detail.failures, []);
    const legacy = await (
        await fetch(`${base}/shop-api`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                referer: `${base}/product?id=product-1&qaMissingProduct=1`,
            },
            body: JSON.stringify({
                query: 'query Detail($id: ID!) { product(id: $id) { id } }',
                variables: { id: 'product-1' },
            }),
        })
    ).json();
    assert.equal(legacy.data.product, null);
});

test('fixture uses the shared canonical contract and paginates independent category filters', async () => {
    const page = await (
        await fetch(catalogUrl({ collectionId: 'collection-cups', take: 6, skip: 6 }))
    ).json();
    assert.equal(page.scope.host, new URL(base).host);
    assert.equal(page.scope.priceContext, 'public');
    assert.equal(page.catalog.totalItems, 12);
    assert.equal(page.catalog.items[0].id, 'product-7');
    assert.equal(page.catalog.items.length, 6);
    assert.equal(page.requestKey, JSON.stringify(page.request));
    assert.equal(page.products, undefined);
    assert.equal(page.activeCustomer, undefined);
    assert.equal(page.storefrontCart, undefined);
    assert.ok(page.media.some(item => item.kind === 'card'));
    assert.ok(page.media.every(item => item.kind !== 'hero'));
    const empty = await (await fetch(catalogUrl({ collectionId: 'collection-empty' }))).json();
    assert.deepEqual(empty.catalog, { items: [], totalItems: 0 });
});

test('hot SSI contains only matching route snapshot/preload; cold SSI contains neither', async () => {
    const hot = await (await fetch(`${base}/category?collectionId=collection-cups&qaSsi=hot`)).text();
    const cold = await (await fetch(`${base}/category?qaSsi=cold`)).text();
    assert.match(hot, /id="storefront-public-page-data"/u);
    assert.match(hot, /product-1\.svg/u);
    assert.match(hot, /imagesizes="[^"]*104px/u);
    assert.doesNotMatch(hot, /as="image"[^>]+qa-hero/u);
    assert.doesNotMatch(cold, /id="storefront-public-page-data"/u);
    assert.doesNotMatch(cold, /<!--#\s*include/u);
});

test('preview reads are ephemeral and a closed fixture never exposes an old LIVE snapshot', async () => {
    const preview = await fetch(catalogUrl({}, '&qaAccessMode=PREVIEW'));
    assert.equal(preview.headers.get('cache-control'), 'no-store');
    assert.equal((await preview.json()).config.accessMode, 'PREVIEW');
    for (const mode of ['PREVIEW', 'CLOSED']) {
        const html = await (await fetch(`${base}/category?qaSsi=hot&qaAccessMode=${mode}`)).text();
        assert.doesNotMatch(html, /id="storefront-public-page-data"/u);
        assert.doesNotMatch(html, /rel="preload" as="image"/u);
    }
    const closed = await fetch(catalogUrl({}, '&qaAccessMode=CLOSED'));
    assert.equal(closed.status, 403);
    assert.equal((await closed.json()).errorCode, 'STOREFRONT_CLOSED');
});

test('qaDelay/qaEmpty/qaLegacy inherit the document query via Referer without cookies', async () => {
    const start = Date.now();
    const response = await fetch(catalogUrl(), {
        headers: { referer: `${base}/category?qaDelay=80&qaEmpty=1` },
    });
    assert.ok(Date.now() - start >= 60);
    assert.deepEqual((await response.json()).catalog, { items: [], totalItems: 0 });
    assert.equal((await fetch(catalogUrl({}, '&qaLegacy=1'))).status, 404);
    assert.equal((await fetch(catalogUrl({ take: 1000 }))).status, 400);
});

test('hot fixture uses the same sidebar and desktop sizes as the deployed SSI renderer', async () => {
    const html = await (
        await fetch(`${base}/category?collectionId=collection-daily&childId=collection-cups&qaSsi=hot`)
    ).text();
    assert.ok(html.includes(`imagesizes="${STOREFRONT_IMAGE_SIZES.categorySidebarRow}"`));
    assert.ok(html.includes(`imagesizes="${STOREFRONT_IMAGE_SIZES.desktopCatalogCard}"`));
});

test('read-only GraphQL fallback returns synthetic queries and rejects all write documents', async () => {
    const query = await fetch(`${base}/shop-api`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            query: 'query Catalog($input: StorefrontCatalogInput!) { storefrontCatalog(input: $input) { totalItems } activeCustomer { id } }',
            variables: { input: { collectionId: 'collection-empty' } },
        }),
    });
    assert.deepEqual(await query.json(), {
        data: { storefrontCatalog: { items: [], totalItems: 0 }, activeCustomer: null },
    });
    for (const document of [
        'mutation { addItemToOrder { id } }',
        'query Read { activeCustomer { id } } mutation Write { logout { success } }',
    ]) {
        const response = await fetch(`${base}/shop-api`, {
            method: 'POST',
            body: JSON.stringify({ query: document, operationName: 'Read' }),
        });
        assert.equal(response.status, 405);
    }
    assert.equal((await fetch(`${base}/checkout`, { method: 'POST', body: '{}' })).status, 405);
    assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 403);
});

test('fixture pictures are genuine bounded WebP and requests remain observable', async () => {
    const response = await fetch(
        `${base}/assets/preview/product-1.svg?preset=storefront-card-320&format=webp`,
    );
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    const observed = await (await fetch(`${base}/__qa/requests`)).json();
    assert.ok(observed.requests.some(item => item.type === 'aggregate'));
    assert.ok(observed.requests.some(item => item.type === 'graphql'));
    assert.ok(observed.requests.some(item => item.type === 'image'));
});

test('home/detail and a successful empty aggregate have distinct route contracts', () => {
    const home = buildPublicPage({ kind: 'home' }, 'localhost');
    const product = buildPublicPage({ kind: 'product', id: 'product-2' }, 'localhost');
    assert.equal(home.products.length, 12);
    assert.ok(home.media.some(item => item.kind === 'hero'));
    assert.equal(product.route, '/product?id=product-2');
    assert.equal(product.product.id, 'product-2');
    assert.ok(product.media.some(item => item.kind === 'detail'));
    assert.deepEqual(buildPublicPage({ kind: 'home' }, 'localhost', { empty: true }).products, []);
});
