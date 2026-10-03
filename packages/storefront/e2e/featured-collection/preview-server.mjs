import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixtureData } from '../visual-presets/fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const primary = path.dirname(
    execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
        encoding: 'utf8',
    }).trim(),
);
const assets = path.join(primary, 'design-proposals/moyao-classic-decoration-20261001/assets');
const clientRoot = path.join(root, 'packages/storefront/dist');
const adminRoot = path.join(root, 'packages/next-admin/dist');
const port = Number(process.env.COLLECTION_PREVIEW_PORT ?? 5327);
const samples = [
    ['Codex-Plus成品号', 'product-codex-plus.webp', 14000],
    ['Codex-Pro X5成品号', 'product-codex-x5.webp', 70000],
    ['10美元Token额度', 'product-token-10.webp', 1000],
    ['1美元Token额度', 'product-token-1.webp', 100],
    ['Codex-Pro X20成品号', 'product-codex-x20.webp', 200000],
    ['Gemini Pro成品号', 'product-gemini-pro.webp', 50000],
];

function dataFor(page, variables = {}) {
    const preset = page.searchParams.get('preset') ?? 'classic';
    const language = page.searchParams.get('language') ?? 'zh';
    const count = Math.min(50, Math.max(0, Number(page.searchParams.get('count') ?? 6)));
    const data = fixtureData(preset, false);
    const products = Array.from({ length: count }, (_, index) => {
        const [label, file, price] = samples[index % samples.length];
        const id = `local-collection-product-${index + 1}`;
        const name =
            language === 'zh'
                ? `${label}${index < 6 ? '' : ` ${index + 1}`}`
                : `Collection item ${index + 1}`;
        const asset = {
            id: `local-artwork-${index + 1}`,
            preview: `/fixtures/${file}`,
            width: 1024,
            height: 1024,
        };
        return {
            id,
            name,
            slug: id,
            description: '本地模拟商品；图片来自项目原素材，价格和库存只用于验收。',
            createdAt: '2026-10-03T00:00:00Z',
            featuredAsset: asset,
            assets: [asset],
            collections: [],
            customFields: { fulfillmentType: 'digital' },
            variants: [
                {
                    id: `local-variant-${index + 1}`,
                    name,
                    sku: `LOCAL-${index + 1}`,
                    priceWithTax: price,
                    currencyCode: 'CNY',
                    stockLevel: index < 2 ? 'OUT_OF_STOCK' : 'IN_STOCK',
                    saleableStockLevel: index < 2 ? 0 : 100,
                    featuredAsset: asset,
                    customFields: { fulfillmentType: 'digital' },
                    product: { id, name, featuredAsset: asset },
                },
            ],
        };
    });
    data.activeChannel.customFields = {
        storefrontNameZh: '集合模板 · 本地原素材预览',
        storefrontNameEn: 'Collection template · Local preview',
    };
    data.activeChannel.defaultCurrencyCode = 'CNY';
    data.activeChannel.currencyCode = 'CNY';
    data.activeStoreCommerceMode = 'DIGITAL_ONLY';
    data.storefrontContent = [
        {
            id: 'local-collection',
            code: 'local-collection-template',
            type: 'FEATURED_COLLECTION',
            enabled: true,
            position: 0,
            startsAt: null,
            endsAt: null,
            imageUrl: null,
            backgroundColor: null,
            textColor: null,
            title: language === 'zh' ? '推荐集合' : 'Featured collection',
            subtitle: '',
            body: '',
            ctaLabel: language === 'zh' ? '浏览全部' : 'View collection',
            targetType: 'PAGE',
            targetValue: '/category',
            settings: {
                displayCount: Math.max(1, count),
                selectedProductIds: products.map(product => product.id),
            },
            items: [],
        },
    ];
    data.storefrontContentSettings.configuredBlockTypes = [
        'FEATURED_COLLECTION',
        'HERO',
        'QUICK_LINKS',
        'CORE_CATEGORIES',
        'TRUST_BAR',
        'FEATURED_PRODUCTS',
        'RECOMMENDATIONS',
        'FLASH_SALE',
        'COUPONS',
        'NOTICE',
        'CATEGORY_AD',
        'STORY',
        'CUSTOM',
        'SUPPORT',
        'LEGAL',
    ];
    data.products = { items: products, totalItems: products.length };
    data.storefrontCatalog = data.products;
    data.product = products.find(product => product.id === variables.id) ?? products[0] ?? null;
    return data;
}

const types = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
};
http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/admin-preview') {
        const session = 'local-collection-template';
        const preset = url.searchParams.get('preset') ?? 'classic';
        const language = url.searchParams.get('language') ?? 'zh';
        const html = (await readFile(path.join(adminRoot, 'storefront-preview.html'), 'utf8')).replace(
            '<html',
            `<html data-decoration-session="${session}"`,
        );
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <body style="margin:0"><p style="font:12px system-ui;margin:8px">本地后台同源预览 · 原素材与模拟数据 · 未发布</p>
        <iframe title="后台客户端预览" style="display:block;border:0;width:100%;height:1800px"></iframe><script>
            const iframe=document.querySelector('iframe');
            window.addEventListener('message',async event=>{
                if(event.origin!==location.origin||event.source!==iframe.contentWindow||event.data.session!==${JSON.stringify(session)})return;
                const send=data=>iframe.contentWindow.postMessage({...data,session:${JSON.stringify(session)}},location.origin);
                if(event.data.type==='decoration-ready')send({type:'decoration-draft',channelCode:'qa-channel',
                    draft:{block:null,visible:false,route:'/',language:${JSON.stringify(language)},presetId:${JSON.stringify(preset)}}});
                if(event.data.type==='decoration-query'){
                    const response=await fetch(${JSON.stringify(`/shop-api${url.search}`)},
                        {method:'POST',headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({query:event.data.query,variables:event.data.variables})});
                    send({type:'decoration-response',id:event.data.id,status:response.status,payload:await response.json()});
                }
            });
            iframe.srcdoc=${JSON.stringify(html).replaceAll('<', String.raw`\u003c`)};
        </script></body></html>`);
        return;
    }
    if (url.pathname === '/shop-api') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw || '{}');
        if (/\bmutation\b/.test(body.query ?? '')) {
            res.writeHead(403).end();
            return;
        }
        const page = url.searchParams.has('count') ? url : new URL(req.headers.referer ?? '/', url.origin);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: dataFor(page, body.variables) }));
        return;
    }
    if (url.pathname.includes('storefront-realtime') || req.method !== 'GET') {
        res.writeHead(204).end();
        return;
    }
    try {
        if (url.pathname.startsWith('/fixtures/')) {
            const artworkFile = path.basename(url.pathname);
            if (!samples.some(sample => sample[1] === artworkFile)) throw new Error('Unknown fixture image');
            res.setHeader('Content-Type', 'image/webp');
            res.end(await readFile(path.join(assets, artworkFile)));
            return;
        }
        const base = url.pathname.startsWith('/dashboard/') ? adminRoot : clientRoot;
        const relative = path.extname(url.pathname)
            ? url.pathname.replace(/^\/dashboard\//, '').replace(/^\//, '')
            : 'index.html';
        const file = path.resolve(base, relative);
        if (!file.startsWith(`${base}${path.sep}`)) throw new Error('Path outside preview build');
        res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
        res.end(await readFile(file));
    } catch {
        res.writeHead(404).end();
    }
}).listen(port, '127.0.0.1', () =>
    process.stdout.write(`Collection template preview: http://127.0.0.1:${port}/?preset=classic&count=6\n`),
);
