/* eslint-disable no-console -- CLI script output */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// IndexNow submits changed URLs to Bing, Yandex, Naver and Seznam within minutes.
// Google ignores IndexNow and still reads /sitemap.xml, so this never replaces the sitemap.
const ENDPOINT = 'https://api.indexnow.org/indexnow';
export const MAX_BATCH = 10_000;
const DEFAULT_HOST = 'https://moyaoai.com';
const NON_PUBLIC_PATHS = [
    '/shop-api',
    '/admin-api',
    '/_storefront/',
    '/promo/enter',
    '/promo/access',
    '/promo/account-entry',
];
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** A sitemap index lists child sitemaps; a urlset lists pages. Both use <loc>. */
export function parseSitemapIndex(xml) {
    return [...String(xml).matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/gu)].map(match => match[1].trim());
}

export function parseUrlSet(xml) {
    return [...String(xml).matchAll(/<url>\s*<loc>([^<]+)<\/loc>/gu)].map(match => match[1].trim());
}

/** Keep only same-origin public URLs, in sitemap order, without duplicates. */
export function selectSubmissionUrls({ urls, host, limit = MAX_BATCH, include = null }) {
    const origin = new URL(host).origin;
    const pattern = include ? new RegExp(include, 'u') : null;
    const seen = new Set();
    const selected = [];
    for (const value of urls) {
        let url;
        try {
            url = new URL(value);
        } catch {
            continue;
        }
        if (url.origin !== origin || url.protocol !== 'https:') continue;
        if (NON_PUBLIC_PATHS.some(prefix => url.pathname.startsWith(prefix))) continue;
        if (pattern && !pattern.test(url.href)) continue;
        if (seen.has(url.href)) continue;
        seen.add(url.href);
        selected.push(url.href);
        if (selected.length >= limit) break;
    }
    return selected;
}

export function chunk(values, size = MAX_BATCH) {
    assert.ok(Number.isSafeInteger(size) && size > 0, 'Invalid batch size');
    const batches = [];
    for (let index = 0; index < values.length; index += size) batches.push(values.slice(index, index + size));
    return batches;
}

export function buildIndexNowBody({ host, key, keyLocation, urlList }) {
    const origin = new URL(host).origin;
    return {
        host: new URL(origin).host,
        key,
        keyLocation: keyLocation ?? `${origin}/${key}.txt`,
        urlList,
    };
}

function parseArguments(argv) {
    const options = {
        host: DEFAULT_HOST,
        apply: false,
        limit: MAX_BATCH,
        include: null,
        out: null,
        key: null,
        timeoutMs: 60_000,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = () => {
            const next = argv[index + 1];
            assert.ok(next && !next.startsWith('--'), `Missing value for ${argument}`);
            index += 1;
            return next;
        };
        if (argument === '--host') options.host = value();
        else if (argument === '--key') options.key = value();
        else if (argument === '--limit') options.limit = Number(value());
        else if (argument === '--timeout') options.timeoutMs = Number(value()) * 1_000;
        else if (argument === '--include') options.include = value();
        else if (argument === '--out') options.out = value();
        else if (argument === '--apply') options.apply = true;
        else if (argument === '--help' || argument === '-h') options.help = true;
        else throw new Error(`Unknown argument: ${argument}`);
    }
    return options;
}

async function readText(url, timeoutMs, attempts = 2) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: { accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' },
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!response.ok) throw new Error(`${url} returned ${response.status}`);
            return await response.text();
        } catch (error) {
            lastError = error;
            if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 1_500));
        }
    }
    throw lastError;
}

async function collectSitemapUrls(host, { limit, timeoutMs }) {
    const indexXml = await readText(`${host}/sitemap.xml`, timeoutMs);
    const children = parseSitemapIndex(indexXml);
    const urls = [];
    if (!children.length) return parseUrlSet(indexXml);
    assert.ok(children.length <= 50, 'Sitemap index exceeds the supported child count');
    for (const child of children) {
        urls.push(...parseUrlSet(await readText(child, timeoutMs)));
        if (urls.length >= limit * 2) break;
    }
    return urls;
}

export async function main(argv = process.argv.slice(2)) {
    const options = parseArguments(argv);
    if (options.help) {
        console.log(
            [
                'Usage: node scripts/seo-index-now.mjs [--host URL] [--limit N] [--include REGEX]',
                '                                      [--key KEY] [--timeout SECONDS] [--apply] [--out FILE]',
                '',
                'Dry run by default: it only reads /sitemap.xml and prints the plan.',
                '--apply sends the URLs to IndexNow; the key must be served at /{key}.txt.',
                'The key may also come from INDEXNOW_KEY.',
            ].join('\n'),
        );
        return { dryRun: true, urls: [] };
    }
    const host = new URL(options.host).origin;
    assert.ok(host.startsWith('https://'), 'IndexNow requires an https host');
    assert.ok(Number.isSafeInteger(options.limit) && options.limit > 0, 'Invalid --limit');

    const urls = await collectSitemapUrls(host, options);
    const selected = selectSubmissionUrls({
        urls,
        host,
        limit: options.limit,
        include: options.include,
    });
    const runId = randomBytes(6).toString('hex');
    const receiptFile =
        options.out ??
        path.join(
            project,
            'tmp/seo-index-now',
            `${new Date().toISOString().replace(/[:.]/gu, '-')}-${runId}.json`,
        );
    const receipt = {
        host,
        generatedAt: new Date().toISOString(),
        discovered: urls.length,
        selected: selected.length,
        dryRun: !options.apply,
        batches: [],
        urls: selected,
    };

    if (!selected.length) throw new Error('No public URL found in the sitemap');

    if (!options.apply) {
        await mkdir(path.dirname(receiptFile), { recursive: true });
        await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
        console.log(`Dry run: ${selected.length} of ${urls.length} URLs would be submitted to ${ENDPOINT}`);
        console.log(`Receipt: ${receiptFile}`);
        return receipt;
    }

    const key = options.key ?? process.env.INDEXNOW_KEY;
    assert.ok(key, 'Missing index key: pass --key or set INDEXNOW_KEY');
    assert.match(key, /^[A-Za-z0-9-]{8,128}$/u, 'Invalid index key');

    for (const batch of chunk(selected)) {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify(buildIndexNowBody({ host, key, urlList: batch })),
            signal: AbortSignal.timeout(30_000),
        });
        receipt.batches.push({ size: batch.length, status: response.status });
        if (!response.ok) throw new Error(`IndexNow rejected ${batch.length} URLs with ${response.status}`);
    }
    await mkdir(path.dirname(receiptFile), { recursive: true });
    await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    console.log(`Submitted ${selected.length} URLs in ${receipt.batches.length} batch(es)`);
    console.log(`Receipt: ${receiptFile}`);
    return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main().catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
