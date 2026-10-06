import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixtureData } from '../visual-presets/fixtures.mjs';

// Local manual acceptance only: serves the already verified build and read-only sample data.
const root = path.resolve(fileURLToPath(new URL('../../dist/', import.meta.url)));
const port = Number(process.env.STOREFRONT_TEST_PORT ?? 5326);
const data = fixtureData('classic', true, 'normal');
data.myCustomerProductActivity = { favoriteProductIds: [], recentProductVisits: [] };
data.storefrontDailyRecommendations = {
    businessDate: '2026-10-03',
    expiresAt: '2026-10-04T00:00:00Z',
    items: [],
};
const state = { mode: 'normal', contentReads: 0, aggregateReads: 0, graphqlReads: {}, snapshotWarm: false };
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
};
const placeholder =
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e2e8f0"/></svg>';
function json(res, payload, status = 200) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}
async function requestBody(req) {
    let text = '';
    for await (const chunk of req) {
        text += chunk.toString();
        if (text.length > 128_000) throw new Error('Request too large');
    }
    return text ? JSON.parse(text) : {};
}

const panel = `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>客户端加载与刷新测试</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#e8edf3;color:#172033;font:14px system-ui,sans-serif}
header{background:#fff;padding:12px 18px;border-bottom:1px solid #d8dee8;position:sticky;top:0;z-index:1}
.intro,.controls{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.intro{margin-bottom:10px}
strong{font-size:16px}.note{color:#59687a;font-size:12px}.controls label{display:flex;align-items:center;gap:8px}
button,select{font:inherit;min-height:44px;border:1px solid #c4cedc;border-radius:8px;background:#fff;color:inherit;padding:8px 12px;cursor:pointer}
button:hover{background:#f1f5f9}button:focus-visible,select:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
.primary{background:#1d4ed8;color:#fff;border-color:#1d4ed8}.primary:hover{background:#1e40af}
#counter{font-size:12px;color:#59687a;margin-left:auto}.stage{padding:16px;display:flex;justify-content:center}
iframe{width:1440px;max-width:100%;height:calc(100dvh - 140px);min-height:660px;background:#fff;border:1px solid #c4cedc;border-radius:12px}
@media(max-width:650px){header{padding:10px}.stage{padding:8px}#counter{margin-left:0}iframe{height:calc(100dvh - 200px)}}
</style></head><body>
<header><div class="intro"><strong>客户端加载与刷新测试</strong><span class="note">当前重构版本 · 本地只读模拟数据 · 未发布</span></div>
<div class="controls">
<label>数据场景 <select id="mode"><option value="normal">正常</option><option value="slow">慢速（3 秒）</option><option value="error">读取失败</option></select></label>
<button id="refresh" class="primary" type="button">触发后台更新</button>
<button id="first" type="button">首次加载</button>
<button id="reload" type="button">重载当前页</button>
<label>宽度 <select id="width"><option value="1440">桌面 1440</option><option value="390">手机 390</option></select></label>
<span id="counter" role="status">内容读取：0 次</span>
</div><div class="note" style="margin-top:8px">切换场景后点“触发后台更新”；失败后改回正常，再点页面里的“重试”。首次加载会清空本测试页的公共缓存。</div></header>
<div class="stage"><iframe id="app" title="客户端实际页面" src="/services"></iframe></div>
<script>
const app=document.getElementById('app'),mode=document.getElementById('mode');
const ready=fetch('/__interaction-state').then(response=>response.json()).then(state=>{mode.value=state.mode});
let setting=ready;
mode.addEventListener('change',()=>{
 const selected=mode.value;
 setting=setting.then(()=>fetch('/__interaction-state',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:selected})
 }));
});
document.getElementById('refresh').addEventListener('click',async()=>{await setting;app.contentWindow?.dispatchEvent(new Event('visibilitychange'));});
document.getElementById('first').addEventListener('click',async()=>{
 await setting;const next=new URL(app.contentWindow.location.href);
 next.searchParams.set('__interactionReset','1');app.src=next.href;
});
document.getElementById('reload').addEventListener('click',()=>app.contentWindow.location.reload());
document.getElementById('width').addEventListener('change',event=>{app.style.width=event.target.value+'px';});
async function updateCounter(){
 try{
  const state=await fetch('/__interaction-state').then(response=>response.json());
  document.getElementById('counter').textContent='内容读取：'+state.contentReads+' 次';
 }finally{setTimeout(updateCounter,1000);}
}
void updateCounter();
</script></body></html>`;

function publicPage(url, host) {
    const languageCode = url.searchParams.get('languageCode') ?? 'en';
    const currencyCode = url.searchParams.get('currencyCode') ?? data.activeChannel.defaultCurrencyCode;
    const branding = data.storefrontBranding ?? {};
    const page = {
        schemaVersion: 1,
        version: 'local-fixture-v1',
        generatedAt: Date.now(),
        route: '/',
        scope: {
            host,
            channelCode: data.activeChannel.code,
            languageCode,
            currencyCode,
            priceContext: 'public',
        },
        config: {
            ...data.activeChannel,
            ...branding,
            brandBackgroundColor: branding.backgroundColor,
            brandPrimaryColor: branding.primaryColor,
            brandAccentColor: branding.accentColor,
            brandHighlightColor: branding.highlightColor,
            availableCountries: data.availableCountries,
            availableProvinces: data.availableStorefrontProvinces ?? [],
            currencyConfiguration: data.storefrontCurrencyConfiguration,
        },
        content: {
            blocks: data.storefrontContent,
            flashSales: [],
            flashSalesDeferred: true,
            systemAnnouncements: data.activeSystemAnnouncements ?? [],
            settings: data.storefrontContentSettings,
        },
        flashSales: data.activeStorefrontFlashSales ?? [],
        products: data.products.items,
        collections: data.collections.items,
        visualPreset: data.storefrontVisualPreset,
        media: [],
        failures: [],
    };
    if (url.searchParams.get('kind') === 'catalog') page.catalog = data.storefrontCatalog ?? data.products;
    if (url.searchParams.get('kind') === 'product')
        page.product = data.product ?? data.products.items[0] ?? null;
    return page;
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        if (url.pathname === '/__interaction-test') {
            res.writeHead(200, { 'content-type': types['.html'] });
            res.end(panel);
            return;
        }
        if (url.pathname === '/__interaction-state') {
            if (req.method === 'POST') {
                const body = await requestBody(req);
                if (!['normal', 'slow', 'error'].includes(body.mode))
                    return json(res, { error: 'Invalid mode' }, 400);
                state.mode = body.mode;
                state.contentReads = 0;
            }
            return json(res, state);
        }
        if (url.pathname === '/_storefront/page-data') {
            state.aggregateReads++;
            const page = publicPage(url, req.headers.host);
            if (state.mode === 'slow') await new Promise(resolve => setTimeout(resolve, 3000));
            if (state.mode === 'error') {
                delete page.content;
                page.failures.push('content');
            }
            state.snapshotWarm = state.mode === 'normal';
            return json(res, page);
        }
        if (url.pathname === '/shop-api') {
            const body = await requestBody(req);
            const query = String(body.query ?? '');
            const operation = query.match(/query\s+(\w+)/u)?.[1] ?? 'unnamed';
            state.graphqlReads[operation] = (state.graphqlReads[operation] ?? 0) + 1;
            if (/^\s*mutation\b/u.test(query))
                return json(res, {
                    errors: [
                        {
                            message: '本地测试只提供读取样本，不执行保存、下单或支付。',
                            extensions: { code: 'FORBIDDEN' },
                        },
                    ],
                });
            const content = /\bstorefrontContent\s*\{/u.test(query);
            const mode = state.mode;
            if (content) {
                state.contentReads++;
                await new Promise(resolve => setTimeout(resolve, mode === 'slow' ? 3000 : 150));
                if (mode === 'error')
                    return json(res, {
                        errors: [
                            {
                                message: 'Controlled local read failure',
                                extensions: { code: 'INTERNAL_SERVER_ERROR' },
                            },
                        ],
                    });
            }
            return json(res, { data });
        }
        if (url.pathname.includes('/storefront-realtime')) {
            res.writeHead(204);
            res.end();
            return;
        }
        const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (file !== root && !file.startsWith(root + path.sep)) return json(res, { error: 'Not found' }, 404);
        try {
            if ((await stat(file)).isFile()) {
                res.writeHead(200, {
                    'content-type': types[path.extname(file)] ?? 'application/octet-stream',
                });
                res.end(await readFile(file));
                return;
            }
        } catch {
            /* Unknown SPA routes use the application entry below. */
        }
        if (/\.(?:png|jpe?g|webp|svg|ico)$/u.test(url.pathname)) {
            res.writeHead(200, { 'content-type': types['.svg'] });
            res.end(placeholder);
            return;
        }
        if (path.extname(url.pathname)) return json(res, { error: 'Not found' }, 404);
        let html = await readFile(path.join(root, 'index.html'), 'utf8');
        if (state.snapshotWarm && state.mode === 'normal') {
            const page = publicPage(
                new URL(
                    '/?languageCode=' +
                        (/^zh/iu.test(req.headers['accept-language'] ?? '') ? 'zh_Hans' : 'en'),
                    url,
                ),
                req.headers.host,
            );
            const serialized = JSON.stringify(page).replace(/</gu, '\\u003c');
            html = html.replace(
                '<!--# include virtual="/_storefront/lcp-preload" -->',
                `<script id="storefront-public-page-data" type="application/json">${serialized}</script>`,
            );
        }
        if (url.searchParams.get('__interactionReset') === '1')
            html = html.replace(
                '<head>',
                `<head><script>
for(const key of Object.keys(sessionStorage)){
 if(key.startsWith('vendure-storefront-public-query-cache:'))sessionStorage.removeItem(key);
}
const url=new URL(location.href);url.searchParams.delete('__interactionReset');
history.replaceState(history.state,'',url.pathname+url.search);
</script>`,
            );
        res.writeHead(200, { 'content-type': types['.html'] });
        res.end(html);
    } catch {
        if (!res.headersSent) json(res, { error: 'Local preview request failed' }, 500);
        else res.end();
    }
});
server.listen(port, '127.0.0.1', () =>
    process.stdout.write(`Local interaction preview: http://127.0.0.1:${port}/__interaction-test\n`),
);
