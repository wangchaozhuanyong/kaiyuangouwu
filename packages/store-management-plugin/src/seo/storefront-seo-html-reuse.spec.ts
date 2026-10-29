// @vitest-environment node
import { load } from 'cheerio';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { syntheticPage } from '../../../storefront/e2e/seo-public/fixtures.mjs';
import { StorefrontPublicCacheService } from '../performance/storefront-public-cache.service';

import { StorefrontSeoHtmlService } from './storefront-seo-html.service';

async function harness() {
    const output = path.resolve(__dirname, '../../../../tmp/public-html-reuse');
    await mkdir(output, { recursive: true });
    const root = await mkdtemp(path.join(output, 'artifact-'));
    const shell =
        '<html><head><script type="module" src="/assets/index.js"></script></head><body><div id="root"></div></body></html>';
    const artifact = async (folder: string) => {
        await mkdir(path.join(folder, '.server'), { recursive: true });
        await writeFile(path.join(folder, 'index.html'), shell);
        await writeFile(
            path.join(folder, '.server/public-page-renderer.cjs'),
            'let calls=0; exports.renderPublicPage=async()=>`<main>Render ${++calls}</main>`;',
        );
    };
    await artifact(root);
    const records = new Map<string, unknown>();
    const cache = new StorefrontPublicCacheService(
        {
            get: (key: string) => Promise.resolve(records.get(key)),
            set: (key: string, value: unknown) => {
                records.set(key, value);
                return Promise.resolve();
            },
        } as never,
        { systemOptions: { cacheStrategy: {} } } as never,
    );
    const service = new StorefrontSeoHtmlService(cache);
    const rootSpy = vi
        .spyOn(service as unknown as { artifactRoot(): string }, 'artifactRoot')
        .mockReturnValue(root);
    const immutableSpy = vi
        .spyOn(service as unknown as { immutableRoot(root: string): boolean }, 'immutableRoot')
        .mockReturnValue(true);
    const page = syntheticPage('synthetic-a', 'en', 'home');
    const ctx = {
        apiType: 'shop',
        channelId: 'a',
        channel: { code: page.scope.channelCode },
        languageCode: page.scope.languageCode,
        currencyCode: page.scope.currencyCode,
    };
    const render = (value = page, context = ctx) => service.render(value, context as never);
    return { service, render, page, ctx, cache, records, rootSpy, immutableSpy, artifact, root };
}
afterEach(() => vi.restoreAllMocks());

it('reuses identical public HTML and joins simultaneous renders without rebuilding its body', async () => {
    const h = await harness();
    const results = await Promise.all(Array.from({ length: 8 }, () => h.render()));
    expect(new Set(results).size).toBe(1);
    expect(load(results[0])('#root').text()).toBe('Render 1');
    expect(await h.render()).toBe(results[0]);
    expect(await h.render(Object.fromEntries(Object.entries(h.page).reverse()))).toBe(results[0]);
});

it('separates audience, SEO, media, host and public data versions', async () => {
    const h = await harness();
    const first = await h.render();
    for (const changed of [
        { ...h.page, couponAudience: 'unknown' },
        { ...h.page, seo: { ...h.page.seo, title: 'Updated title' } },
        { ...h.page, media: [{ assetUrl: '/changed.svg' }] },
        { ...h.page, scope: { ...h.page.scope, host: 'other.test' } },
        { ...h.page, version: 'updated-version' },
    ])
        expect(await h.render(changed)).not.toBe(first);
    expect(await h.render()).toBe(first);
});

it('discards old generations and uses the current immutable frontend artifact', async () => {
    const h = await harness();
    const first = await h.render();
    await h.cache.invalidate('a');
    expect(load(await h.render())('#root').text()).toBe('Render 2');
    const next = path.join(h.root, 'next-release');
    await h.artifact(next);
    h.rootSpy.mockReturnValue(next);
    expect(load(await h.render())('#root').text()).toBe('Render 1');
    expect(first).toContain('Render 1');
});

it('does not persist preview, private, incomplete or expired snapshots', async () => {
    const h = await harness();
    for (const [page, ctx] of [
        [{ ...h.page, config: { ...h.page.config, accessMode: 'PREVIEW' } }, h.ctx],
        [h.page, { ...h.ctx, activeUserId: 'private-owner' }],
        [h.page, { ...h.ctx, session: {} }],
        [{ ...h.page, failures: ['content'] }, h.ctx],
        [{ ...h.page, generatedAt: Date.now() - 31_000 }, h.ctx],
    ] as const) {
        const first = await h.render(page as never, ctx as never);
        expect(await h.render(page as never, ctx as never)).not.toBe(first);
    }
    expect(h.records.size).toBe(0);
});

it('expires HTML no later than its source snapshot', async () => {
    const h = await harness();
    const first = await h.render();
    vi.spyOn(Date, 'now').mockReturnValue(h.page.generatedAt + 31_000);
    expect(await h.render()).not.toBe(first);
});

it('bounds entry count and retained bytes while still returning uncached documents', async () => {
    const h = await harness();
    const large = { ...h.page, config: { ...h.page.config, description: '中'.repeat(600_000) } };
    for (let i = 0; i < 21; i++) await h.render({ ...large, version: `large-${i}` });
    const bytes = [...h.records.values()].reduce(
        (sum: number, entry) => sum + Buffer.byteLength((entry as { value: string }).value),
        0,
    );
    expect(bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(h.records.size).toBeGreaterThan(0);
    const overflow = { ...large, version: 'after-budget' };
    const first = (await h.render(overflow)).match(/<main>(.*?)<\/main>/u)?.[1];
    expect((await h.render(overflow)).match(/<main>(.*?)<\/main>/u)?.[1]).not.toBe(first);
});

it('bounds the number of retained HTML entries', async () => {
    const small = await harness();
    for (let i = 0; i < 65; i++) await small.render({ ...small.page, version: `small-${i}` });
    expect(small.records.size).toBe(64);
});

it('counts retained generations independently when public data is repeatedly invalidated', async () => {
    const h = await harness();
    for (let i = 0; i < 65; i++) {
        await h.cache.invalidate('a');
        await h.render();
    }
    expect(h.records.size).toBe(64);
});

it('isolates merchants, languages and settlement currencies, including changed prices in the same snapshot version', async () => {
    const h = await harness();
    const first = await h.render();
    for (const value of [
        syntheticPage('synthetic-b', 'en', 'home'),
        syntheticPage('synthetic-a', 'zh_Hans', 'home'),
    ]) {
        const ctx = {
            ...h.ctx,
            channelId: value.scope.channelCode,
            channel: { code: value.scope.channelCode },
            languageCode: value.scope.languageCode,
            currencyCode: value.scope.currencyCode,
        };
        expect(await h.render(value, ctx)).not.toBe(first);
    }
    const changedPrice = {
        ...h.page,
        products: h.page.products.map(
            (product: { variants: Array<Record<string, unknown>> }, index: number) =>
                index
                    ? product
                    : { ...product, variants: [{ ...product.variants[0], priceWithTax: 123456 }] },
        ),
    };
    expect(await h.render(changedPrice)).not.toBe(first);
    const usd = { ...h.page, scope: { ...h.page.scope, currencyCode: 'USD' } };
    expect(await h.render(usd, { ...h.ctx, currencyCode: 'USD' })).not.toBe(first);
    expect(await h.render()).toBe(first);
});

it('does not retain a document larger than the per-document limit', async () => {
    const h = await harness();
    await h.render({ ...h.page, config: { ...h.page.config, description: '中'.repeat(710_000) } });
    expect(h.records.size).toBe(0);
});

it('does not retain render failures', async () => {
    const h = await harness();
    await writeFile(
        path.join(h.root, '.server/public-page-renderer.cjs'),
        'let calls=0; exports.renderPublicPage=async()=>{if(++calls===1)throw new Error("render failure");return "<main>Recovered</main>"};',
    );
    await expect(h.render()).rejects.toMatchObject({ renderStage: 'body-render' });
    expect(h.records.size).toBe(0);
    expect(load(await h.render())('#root').text()).toBe('Recovered');
});

it('reuses immutable asset inputs across different pages and discards them on a release switch', async () => {
    const h = await harness();
    const provider = [
        'exports.publicRouteScriptPreloadScope="home-static-v1";',
        'exports.renderPublicPage=async()=>"<main>Public</main>";',
        'exports.getPublicRouteScriptPreloads=async(_page,_assets,read)=>[(await read("hint.js")).trim()];',
    ].join('\n');
    const configure = async (root: string, name: string) => {
        await mkdir(path.join(root, 'assets'), { recursive: true });
        await writeFile(path.join(root, '.server/public-page-renderer.cjs'), provider);
        await writeFile(path.join(root, 'assets', name), '');
        await writeFile(path.join(root, 'assets/hint.js'), name);
    };
    await configure(h.root, 'one.js');
    expect(await h.render()).toContain('href="/assets/one.js"');
    // Simulate a changed read result to prove a new page does not reread this immutable input.
    await writeFile(path.join(h.root, 'assets/hint.js'), 'two.js');
    expect(await h.render({ ...h.page, version: 'next-page' })).toContain('href="/assets/one.js"');
    const next = path.join(h.root, 'next-release');
    await h.artifact(next);
    await configure(next, 'two.js');
    h.rootSpy.mockReturnValue(next);
    const switched = await h.render();
    expect(switched).toContain('href="/assets/two.js"');
    expect(switched).not.toContain('href="/assets/one.js"');
});

it('does not reuse data-dependent hints from an older renderer without an explicit contract', async () => {
    const h = await harness();
    await mkdir(path.join(h.root, 'assets'));
    await writeFile(path.join(h.root, 'assets/one.js'), '');
    await writeFile(path.join(h.root, 'assets/two.js'), '');
    await writeFile(path.join(h.root, 'assets/hint.js'), 'one.js');
    await writeFile(
        path.join(h.root, '.server/public-page-renderer.cjs'),
        [
            'exports.renderPublicPage=async()=>"<main>Public</main>";',
            'exports.getPublicRouteScriptPreloads=async(_page,_assets,read)=>[(await read("hint.js")).trim()];',
        ].join('\n'),
    );
    expect(await h.render()).toContain('href="/assets/one.js"');
    await writeFile(path.join(h.root, 'assets/hint.js'), 'two.js');
    const next = await h.render({ ...h.page, version: 'next-page' });
    expect(next).toContain('href="/assets/two.js"');
    expect(next).not.toContain('href="/assets/one.js"');
});

it('retries failed optional script reads instead of retaining a rejected promise', async () => {
    const h = await harness();
    await mkdir(path.join(h.root, 'assets'));
    await writeFile(path.join(h.root, 'assets/one.js'), '');
    await writeFile(path.join(h.root, 'assets/hint.js'), 'one.js');
    await writeFile(
        path.join(h.root, '.server/public-page-renderer.cjs'),
        [
            'exports.publicRouteScriptPreloadScope="home-static-v1";',
            'let calls=0;exports.renderPublicPage=async()=>"<main>Public</main>";',
            'exports.getPublicRouteScriptPreloads=async(_page,_assets,read)=>{',
            'if(++calls===1)require("node:fs").unlinkSync(require("node:path").resolve(__dirname,"../assets/hint.js"));',
            'return [(await read("hint.js")).trim()]};',
        ].join('\n'),
    );
    expect(await h.render()).not.toContain('href="/assets/one.js"');
    await writeFile(path.join(h.root, 'assets/hint.js'), 'one.js');
    expect(await h.render({ ...h.page, version: 'next-page' })).toContain('href="/assets/one.js"');
});

it('rereads mutable local dist inputs when a local build changes in place', async () => {
    const h = await harness();
    h.immutableSpy.mockReturnValue(false);
    await mkdir(path.join(h.root, 'assets'));
    await writeFile(path.join(h.root, 'assets/one.js'), '');
    await writeFile(path.join(h.root, 'assets/two.js'), '');
    await writeFile(path.join(h.root, 'assets/hint.js'), 'one.js');
    await writeFile(
        path.join(h.root, '.server/public-page-renderer.cjs'),
        [
            'exports.publicRouteScriptPreloadScope="home-static-v1";',
            'exports.renderPublicPage=async()=>"<main>Public</main>";',
            'exports.getPublicRouteScriptPreloads=async(_page,_assets,read)=>[(await read("hint.js")).trim()];',
        ].join('\n'),
    );
    expect(await h.render()).toContain('href="/assets/one.js"');
    await writeFile(path.join(h.root, 'assets/hint.js'), 'two.js');
    expect(await h.render({ ...h.page, version: 'next-page' })).toContain('href="/assets/two.js"');
});
