import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

import { syntheticPage } from '../seo-public/fixtures.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = fileURLToPath(new URL('../../../../reports/realtime-rollback-20261026/', import.meta.url));
await mkdir(output, { recursive: true });
const baseline = process.argv.includes('--baseline');
const baselineCode = baseline
    ? execFileSync('git', ['show', 'b5a831f:packages/storefront/src/realtime-updates.ts'], {
          cwd: root,
          encoding: 'utf8',
      })
    : undefined;
let state;
const vite = await createServer({
    configFile: false,
    root,
    define: { 'import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING': JSON.stringify('false') },
    server: {
        host: '127.0.0.1',
        port: 0,
        fs: { allow: [fileURLToPath(new URL('../../../../', import.meta.url))] },
    },
    plugins: [
        {
            name: 'synthetic-realtime-acceptance',
            enforce: 'pre',
            transform(code, id) {
                if (baseline && id.endsWith('/src/realtime-updates.ts'))
                    return { code: baselineCode, map: null };
            },
            configureServer(server) {
                server.middlewares.use((req, res, next) => {
                    if (req.url.startsWith('/_storefront/page-data')) {
                        const snapshot = syntheticPage('synthetic-a', 'en', 'home', {
                            host: req.headers.host,
                        });
                        snapshot.version = String(state.revision);
                        state.started++;
                        let complete = false;
                        const timer = setTimeout(() => {
                            complete = true;
                            res.writeHead(200, { 'content-type': 'application/json' });
                            res.end(JSON.stringify(snapshot));
                        }, state.delay);
                        res.on('close', () => {
                            if (!complete) {
                                state.canceled++;
                                clearTimeout(timer);
                            }
                        });
                        return;
                    }
                    if (req.url === '/__burst/events') {
                        res.writeHead(200, {
                            'content-type': 'text/event-stream',
                            'cache-control': 'no-store',
                        });
                        res.write('event: ready\ndata: {"version":1,"heartbeatIntervalMs":15000}\n\n');
                        const frame = index =>
                            `event: invalidate\ndata: ${JSON.stringify({ version: 1, id: String(index), occurredAt: '', topics: ['content'] })}\n\n`;
                        if (state.mode === 'one-block') {
                            state.revision = 100;
                            res.end(Array.from({ length: 100 }, (_, index) => frame(index + 1)).join(''));
                        } else {
                            const timer = setInterval(
                                () => {
                                    state.revision++;
                                    res.write(frame(state.revision));
                                    if (state.revision === 100) {
                                        clearInterval(timer);
                                        res.end();
                                    }
                                },
                                state.mode === 'slow-split' ? 10 : 1,
                            );
                            res.on('close', () => clearInterval(timer));
                        }
                        return;
                    }
                    next();
                });
            },
        },
    ],
});
await vite.listen();
const origin = vite.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const mode of baseline
        ? ['one-block', 'split-blocks', 'slow-split']
        : ['one-block', 'split-blocks', 'slow-split', 'cancel']) {
        state = { mode, revision: 0, started: 0, canceled: 0, delay: mode === 'slow-split' ? 2000 : 200 };
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            serviceWorkers: 'block',
        });
        const page = await context.newPage();
        await page.goto(origin + 'e2e/realtime-burst/index.html');
        await page.waitForFunction(() => Boolean(window.burstQA));
        const result = await page.evaluate(cancel => window.burstQA.run(cancel), mode === 'cancel');
        if (mode === 'cancel') {
            await new Promise(resolve => setTimeout(resolve, 250));
            assert.equal(state.started, 1, 'Canceled notification must not launch a queued refresh');
        } else {
            assert.equal(result.events, 100);
            assert.equal(result.final, '100');
            assert(result.visible.every(version => version === '0' || version === '100'));
            if (baseline && mode !== 'one-block') {
                assert(state.started > 3, 'Expected baseline request amplification');
                assert(state.canceled > 1, 'Expected baseline repeated cancellations');
            } else {
                assert(state.started <= (mode === 'slow-split' ? 3 : 2));
                assert.equal(state.canceled, 0);
            }
            await expect(page.locator('#result')).toHaveText('100');
        }
        results.push({
            mode,
            ...state,
            ...result,
            status: baseline && mode !== 'one-block' ? 'REPRODUCED_AMPLIFICATION' : 'PASS',
        });
        await context.close();
    }
    await writeFile(
        output + (baseline ? '/realtime-browser-before.json' : '/realtime-browser.json'),
        JSON.stringify(
            {
                environment:
                    'Local Vite + actual SSE, fetchPublicPage, QueryClient, Chromium; synthetic public data',
                results,
            },
            null,
            2,
        ),
    );
    process.stdout.write(JSON.stringify(results) + '\n');
} finally {
    await browser.close();
    await vite.close();
}
