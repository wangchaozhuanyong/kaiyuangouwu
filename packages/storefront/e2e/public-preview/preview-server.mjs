import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixtureData } from '../visual-presets/fixtures.mjs';

// Synthetic browser acceptance only. No real store, payment or database is contacted.
const root = path.resolve(fileURLToPath(new URL('../../dist/', import.meta.url)));
const port = Number(process.env.PUBLIC_PREVIEW_TEST_PORT ?? 5356);
const data = fixtureData('classic', false, 'normal');
data.activeChannel.customFields = {
    storefrontNameZh: '公开预览本地验收',
    storefrontNameEn: 'Local preview acceptance',
};
const state = { mode: 'PREVIEW', aggregateReads: 0, graphqlReads: 0 };
const panel = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>公开预览闭环本地验收</title><style>
body{font:14px system-ui;margin:0}header{padding:12px;background:#eee}
button,select{font:inherit;min-height:44px;margin:4px;padding:8px}
iframe{width:100%;height:calc(100vh - 110px);border:0}
</style><header><strong>合成数据，未连接生产</strong>
<label>店铺状态 <select id="mode"><option>PREVIEW</option><option>CLOSED</option><option>LIVE</option><option>NETWORK_ERROR</option></select></label>
<button id="focus">重新聚焦页面</button><button id="reload">首次访问 / 重载</button></header>
<iframe id="app" title="实际商城构建" src="/"></iframe>
<script>
const app=document.querySelector('#app');
document.querySelector('#mode').onchange=async event=>{
await fetch('/__preview-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:event.target.value})});
};
document.querySelector('#focus').onclick=()=>app.contentWindow.dispatchEvent(new Event('visibilitychange'));
document.querySelector('#reload').onclick=()=>app.contentWindow.location.reload();
</script></html>`;
const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
};
function json(res, body, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}
function page(url, host) {
    const branding = data.storefrontBranding;
    return {
        schemaVersion: 1,
        version: 'local-' + state.mode,
        generatedAt: Date.now(),
        route: '/',
        scope: {
            host,
            channelCode: data.activeChannel.code,
            languageCode: url.searchParams.get('languageCode') ?? 'zh_Hans',
            currencyCode: url.searchParams.get('currencyCode') ?? 'MYR',
            priceContext: 'public',
        },
        config: {
            ...data.activeChannel,
            ...branding,
            accessMode: state.mode,
            brandBackgroundColor: branding.backgroundColor,
            brandPrimaryColor: branding.primaryColor,
            brandAccentColor: branding.accentColor,
            brandHighlightColor: branding.highlightColor,
            availableCountries: data.availableCountries,
            availableProvinces: [],
            currencyConfiguration: data.storefrontCurrencyConfiguration,
        },
        content: {
            blocks: data.storefrontContent,
            flashSales: [],
            systemAnnouncements: [],
            settings: data.storefrontContentSettings,
        },
        products: data.products.items,
        collections: data.collections.items,
        flashSales: [],
        visualPreset: data.storefrontVisualPreset,
        media: [],
        failures: [],
    };
}
const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        if (url.pathname === '/__preview-check') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(panel);
        }
        if (url.pathname === '/__preview-state') {
            if (req.method === 'POST') {
                let body = '';
                for await (const chunk of req) body += chunk;
                const requested = JSON.parse(body).mode;
                if (!['PREVIEW', 'CLOSED', 'LIVE', 'NETWORK_ERROR'].includes(requested))
                    return json(res, {}, 400);
                state.mode = requested;
            }
            return json(res, state);
        }
        if (url.pathname === '/_storefront/page-data') {
            state.aggregateReads++;
            if (state.mode === 'CLOSED') return json(res, { errorCode: 'STOREFRONT_CLOSED' }, 403);
            if (state.mode === 'NETWORK_ERROR') return json(res, { error: 'Synthetic network failure' }, 503);
            return json(res, page(url, req.headers.host));
        }
        if (url.pathname === '/shop-api') {
            state.graphqlReads++;
            if (state.mode === 'CLOSED')
                return json(res, {
                    errors: [{ message: 'Store not open yet', extensions: { code: 'STOREFRONT_CLOSED' } }],
                });
            if (state.mode === 'NETWORK_ERROR') return json(res, {}, 503);
            return json(res, {
                data: { ...data, storefrontBranding: { ...data.storefrontBranding, accessMode: state.mode } },
            });
        }
        if (url.pathname.includes('storefront-realtime')) {
            res.writeHead(204);
            return res.end();
        }
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep) && file !== root) return json(res, {}, 404);
        try {
            if ((await stat(file)).isFile()) {
                res.writeHead(200, {
                    'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
                });
                return res.end(await readFile(file));
            }
        } catch {
            /* SPA route or synthetic media */
        }
        if (/\.(png|jpe?g|webp|svg)$/u.test(url.pathname)) {
            res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
            return res.end(
                '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#eee"/></svg>',
            );
        }
        if (path.extname(url.pathname)) return json(res, {}, 404);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(await readFile(path.join(root, 'index.html')));
    } catch {
        json(res, { error: 'Synthetic fixture failure' }, 500);
    }
});
server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Local preview acceptance: http://127.0.0.1:${port}/__preview-check\n`);
});
