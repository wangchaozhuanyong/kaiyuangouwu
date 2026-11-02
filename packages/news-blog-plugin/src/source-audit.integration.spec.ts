import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';

import { SafeProviderUrlService } from '../../image-generation-plugin/src/security/safe-provider-url.service';

import { dayStart, previousMonth } from './history';
import { BlogSourceHttp } from './source-http';
import { parseSource, sourceCatalog } from './sources';

// Isolate unused provider/module wiring, never the HTTP adapter, DNS checks, parsing or source data.
vi.mock('@vendure/image-generation-plugin', () => ({ EditorialProviderService: class {} }));
vi.mock(
    '@vendure/storefront-content-plugin',
    async () => import('../../storefront-content-plugin/src/shared/news-blog.js'),
);
const directory = process.env.BLOG_SOURCE_AUDIT_DIR;
it.skipIf(!directory)(
    'audits real public feeds with the deployed collector and no model calls',
    async () => {
        const out = resolve(directory ?? '');
        const window = {
            start: process.env.BLOG_HISTORY_START ?? previousMonth().start,
            end: process.env.BLOG_HISTORY_END ?? previousMonth().end,
        };
        const from = dayStart(window.start);
        const to = new Date(dayStart(window.end).getTime() + 86400000);
        await mkdir(out, { recursive: true });
        const http = new BlogSourceHttp({ safeUrls: new SafeProviderUrlService() } as never);
        const results = await Promise.allSettled(
            sourceCatalog.map(async source => {
                const response = await http.read(source.code, source.url);
                await writeFile(resolve(out, `${source.code}.source`), response.body);
                const entries = parseSource(source.code, response.body);
                const selected = entries.filter(x => x.publishedAt >= from && x.publishedAt < to);
                await writeFile(
                    resolve(out, `${source.code}.entries.json`),
                    JSON.stringify(selected, null, 2),
                );
                return {
                    source: source.code,
                    url: source.url,
                    status: response.status,
                    totalParsed: entries.length,
                    inWindow: selected.length,
                    firstDate: entries.map(x => x.publishedAt.toISOString()).sort()[0],
                    lastDate: entries
                        .map(x => x.publishedAt.toISOString())
                        .sort()
                        .at(-1),
                };
            }),
        );
        const receipt = {
            observedAt: new Date().toISOString(),
            ...window,
            paidCalls: 0,
            sources: results.map((r, index) =>
                r.status === 'fulfilled'
                    ? r.value
                    : {
                          source: sourceCatalog[index].code,
                          error: String(r.reason?.message ?? 'read failed'),
                      },
            ),
        };
        await writeFile(resolve(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
        expect(results.filter(x => x.status === 'rejected')).toHaveLength(0);
        for (const row of results)
            if (row.status === 'fulfilled') expect(row.value.totalParsed).toBeGreaterThan(0);
    },
    90000,
);
it.skipIf(!directory)(
    'reads the official Gemini archive using the same transport',
    async () => {
        const http = new BlogSourceHttp({ safeUrls: new SafeProviderUrlService() } as never);
        const r = await http.read(
            'gemini-blog',
            'https://blog.google/products-and-platforms/products/gemini/',
        );
        await writeFile(resolve(directory ?? '', 'gemini-archive.source'), r.body);
        expect(r.status).toBe(200);
        expect(r.body).toContain('Gemini');
        expect(parseSource('gemini-blog', r.body).length).toBeGreaterThan(0);
    },
    60000,
);
