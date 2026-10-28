/** Synthetic same-origin acceptance UI. Start the browser with CUA; this does not automate it. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mediaDescriptor } from '../../../storefront-content-plugin/src/shared/responsive-image.ts';
import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette.ts';
import { buildPublicPage } from '../client-loading/preview-server.mjs';
import { startSeoFixtureServer } from '../seo-public/preview-server.mjs';

import { applyCouponScenario, preparedCampaigns } from './coupon-fixture.mjs';

const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const args = new URLSearchParams(
    process.argv
        .slice(2)
        .map(value => value.replace(/^--/u, ''))
        .join('&'),
);
const label = args.get('label') ?? 'candidate';
if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(label)) throw new Error('Invalid evidence label');
const dist = path.join(project, 'packages/storefront/dist');
const output = path.join(project, 'docs/local-validation/soft-loading-release-20261028', label);
await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
const caseKey = Symbol('local-fixture-case');
const observer = await readFile(fileURLToPath(new URL('./observe.js', import.meta.url)), 'utf8');
const template = await readFile(path.join(dist, 'index.html'), 'utf8');
const files = [
    'index.html',
    '.server/public-page-renderer.cjs',
    ...[...template.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/gu)].map(match => match[1].slice(1)),
];
const artifact = {
    label,
    capturedAt: new Date().toISOString(),
    note: 'Exact existing dist inputs; not proof of the current source tree or production.',
    files: await Promise.all(
        [...new Set(files)].map(async file => ({
            file,
            sha256: createHash('sha256')
                .update(await readFile(path.join(dist, file)))
                .digest('hex'),
        })),
    ),
};
await writeFile(path.join(output, 'artifact-inputs.json'), JSON.stringify(artifact, null, 2));

const dashboard = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>商城加载本地验收</title>
<style>
body{font:15px system-ui;
margin:20px;
color:#242b31;
background:#edf0f4}
button,select{font:inherit;
padding:9px 13px;
margin:3px}
iframe{display:block;
background:white;
border:0;
transform-origin:top left}
#frame-shell{overflow:auto;
height:880px}
pre{white-space:pre-wrap;
background:white;
padding:12px}
nav{margin-bottom:12px}</style>
<h1>商城加载本地验收</h1>
<p>合成数据 · 真实 SSR 与客户端构建 · 不连接生产 · 每次文档采样 12 秒</p>
<nav>
<label>视口 <select id="width">
<option>390</option>
<option>1440</option>
</select>
</label>
<label>场景 <select id="scenario">
<option value="home">正常首页</option>
<option value="slow">慢交互入口</option>
<option value="cold">无SSR慢数据首进</option>
<option value="images">慢图片</option>
<option value="coupons">无券</option>
<option value="old">旧快照缺优惠字段</option>
<option value="targeted">已准备公开券，身份未知</option>
<option value="prepared">已准备匿名优惠券</option>
<option value="late">公开优惠迟到</option>
<option value="dark">深色皮肤</option>
</select>
</label>
<button id="open">打开场景</button>
<button id="reload">刷新当前页</button>
<button id="scroll">滚动到正文</button>
<button id="top">回到顶部</button>
<button id="sample">开始导航采样</button>
<button id="back">后退</button>
<button id="forward">前进</button>
</nav>
<pre id="status">等待选择场景</pre>
<div id="frame-shell">
<iframe id="site" title="合成商城" width="390" height="844">
</iframe>
</div>
<script>
const site=document.getElementById('site');
function openCase(){
const width=Number(document.getElementById('width').value);
site.width=width;
site.style.transform=width>innerWidth-50?'scale('+((innerWidth-50)/width)+')':'';
const scenario=document.getElementById('scenario').value;
const params=new URLSearchParams({
qaLabel:${JSON.stringify(label)},qaCase:scenario,qaPreset:scenario==='dark'?'neo-minimalist':'classic'
});
if(scenario==='slow')params.set('qaCodeDelay','1600');
if(scenario==='cold'||scenario==='late')params.set('qaDataDelay','1200');
if(scenario==='images')params.set('qaImageDelay','2000');
if(['coupons','old','targeted','prepared','late'].includes(scenario))params.set('qaCoupons','enabled');
site.src='/zh/?'+params;
document.getElementById('status').textContent='采样中：'+width+'px / '+scenario;
}
document.getElementById('open').onclick=openCase;
document.getElementById('reload').onclick=()=>{document.getElementById('status').textContent='刷新采样中';
site.contentWindow.location.reload()};
document.getElementById('scroll').onclick=()=>site.contentWindow.scrollTo({top:500,behavior:'instant'});
document.getElementById('top').onclick=()=>site.contentWindow.scrollTo({top:0,behavior:'instant'});
document.getElementById('sample').onclick=()=>{site.contentWindow.postMessage({type:'start-loading-sample'},location.origin);
document.getElementById('status').textContent='导航采样中，请操作商城导航'};
document.getElementById('back').onclick=()=>site.contentWindow.history.back();
document.getElementById('forward').onclick=()=>site.contentWindow.history.forward();
addEventListener('message',event=>{
if(event.origin===location.origin&&event.source===site.contentWindow&&event.data.type==='loading-experience-report')
document.getElementById('status').textContent=JSON.stringify(event.data.summary,null,2)});
</script>
</html>`;

const json = (res, value, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = await startSeoFixtureServer(Number(args.get('port') ?? 5198), {
    listenHost: '127.0.0.1',
    readOnly: true,
    async beforeRequest(req, res, url) {
        res.setHeader(
            'Content-Security-Policy',
            [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data:",
                "font-src 'self' data:",
                "connect-src 'self'",
                "frame-src 'self'",
            ].join('; '),
        );
        if (url.pathname === '/__qa') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            res.end(dashboard);
            return true;
        }
        if (url.pathname === '/__qa/health') {
            json(res, { label, output, artifact });
            return true;
        }
        if (url.pathname === '/__qa/observe.js') {
            res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
            res.end(observer);
            return true;
        }
        if (url.pathname === '/__qa/record') {
            if (req.method !== 'POST') {
                json(res, { error: 'POST required' }, 405);
                return true;
            }
            let body = '';
            for await (const part of req) {
                body += part;
                if (body.length > 2_000_000) {
                    json(res, { error: 'Report too large' }, 413);
                    return true;
                }
            }
            const report = JSON.parse(body);
            if (report.fixture !== 'loading-experience-synthetic-v1' || !Array.isArray(report.samples)) {
                json(res, { error: 'Invalid synthetic report' }, 400);
                return true;
            }
            const name =
                String(report.case ?? 'home')
                    .replace(/[^a-zA-Z0-9_-]/gu, '')
                    .slice(0, 40) || 'home';
            const width = Number(report.viewport?.width) || 0;
            const filename = `${Date.now()}-${name}-${width}.json`;
            await writeFile(path.join(output, filename), JSON.stringify(report, null, 2));
            json(res, { saved: filename });
            return true;
        }
        const reference = new URL(req.headers.referer ?? url.href);
        for (const key of ['qaCase', 'qaPreset', 'qaCoupons', 'qaCodeDelay', 'qaImageDelay', 'qaDataDelay']) {
            if (!url.searchParams.has(key) && reference.searchParams.has(key))
                url.searchParams.set(key, reference.searchParams.get(key));
        }
        if (url.pathname === '/_storefront/page-data' || url.pathname === '/shop-api')
            await pause(Math.min(5000, Math.max(0, Number(url.searchParams.get('qaDataDelay')) || 0)));
        if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js'))
            await pause(Math.min(5000, Math.max(0, Number(reference.searchParams.get('qaCodeDelay')) || 0)));
        if (
            url.pathname.startsWith('/qa/hero-') ||
            /^\/assets\/preview\/[a-z0-9_-]+\.svg$/iu.test(url.pathname)
        ) {
            await pause(Math.min(5000, Math.max(0, Number(reference.searchParams.get('qaImageDelay')) || 0)));
            const phone = url.pathname.includes('mobile');
            res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
            res.end(
                `<svg xmlns="http://www.w3.org/2000/svg" width="${phone ? 600 : 1600}" height="${phone ? 600 : 640}">
<rect width="100%" height="100%" fill="${phone ? '#173e56' : '#274a3d'}"/>
<circle cx="70%" cy="55%" r="160" fill="#d9b985"/>
<text x="10%" y="85%" fill="white" font-size="30">Synthetic local artwork</text></svg>`,
            );
            return true;
        }
        return false;
    },
    transformPage(page, { url, host }) {
        const seo = page.seo;
        const requestedProductId = url.searchParams.get('id');
        const requestedCatalogInput = url.searchParams.get('input');
        const request =
            page.request.kind === 'product' && requestedProductId
                ? { ...page.request, id: requestedProductId }
                : page.request.kind === 'catalog' && requestedCatalogInput
                  ? { ...page.request, input: JSON.parse(requestedCatalogInput) }
                  : page.request;
        const initialRoute =
            request.kind === 'product'
                ? `${page.route.split('?')[0]}?id=${encodeURIComponent(request.id)}`
                : page.route;
        const preset = url.searchParams.get('qaPreset') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
        const snapshot = buildPublicPage(
            request,
            host,
            { preset, coupons: url.searchParams.get('qaCoupons') },
            { languageCode: page.scope.languageCode },
        );
        Object.assign(page, snapshot, { seo, route: initialRoute });
        page[caseKey] = url.searchParams.get('qaCase');
        page.seo.channelCode = page.scope.channelCode;
        page.seo.requestKey = page.requestKey;
        const hero = page.content.blocks.find(block => block.type === 'HERO');
        if (hero) {
            hero.title = '桌面首页：轻柔呈现';
            hero.subtitle = '桌面独立文案';
            hero.imageUrl = '/qa/hero-desktop.svg';
            hero.imageAsset = { width: 1600, height: 640 };
            hero.items = [
                {
                    id: 'qa-stat',
                    enabled: true,
                    position: 0,
                    label: '12',
                    description: '合成商品',
                    targetType: 'NONE',
                    targetValue: null,
                    imageUrl: null,
                    settings: {},
                },
            ];
            hero.settings = {
                ...hero.settings,
                mobileImageUrl: '/qa/hero-mobile.svg',
                mobileImageWidth: 600,
                mobileImageHeight: 600,
                mobileHeroTextColor: '#ffffff',
                mobileHeroHideStats: true,
                mobileHeroTranslations: [
                    {
                        languageCode: 'zh_Hans',
                        title: '手机首页：轻柔呈现',
                        subtitle: '手机独立文案',
                        body: '此页面仅使用本地合成数据',
                        ctaLabel: '查看合成商品',
                    },
                ],
            };
            page.media.push(
                mediaDescriptor(hero.imageUrl, 'hero'),
                mediaDescriptor('/qa/hero-mobile.svg', 'hero'),
            );
            page.content.blocks.push({
                ...hero,
                id: 'qa-featured',
                code: 'qa-featured',
                type: 'FEATURED_COLLECTION',
                title: '本地精选商品',
                subtitle: '用于连续性与滚动恢复验收',
                body: '',
                imageUrl: null,
                imageAsset: null,
                position: 20,
                items: [],
                settings: {
                    selectedProductIds: (page.products ?? []).map(product => product.id),
                    displayCount: 12,
                },
            });
            page.content.settings.configuredBlockTypes.push('FEATURED_COLLECTION');
        }
        applyCouponScenario(page, url.searchParams.get('qaCase'), url.pathname === '/_storefront/page-data');
    },
    async transformGraphQlData(data, { operation, referrer }) {
        if (/activeStorefrontCouponCampaigns/u.test(operation.query ?? ''))
            data.activeStorefrontCouponCampaigns = ['prepared', 'targeted', 'late'].includes(
                referrer.searchParams.get('qaCase'),
            )
                ? preparedCampaigns()
                : [];
        if (/StorefrontProductsByIds/u.test(operation.query ?? '')) {
            const ids = operation.variables?.options?.filter?.id?.in ?? [];
            const items = (data.products?.items ?? []).filter(product => ids.includes(product.id));
            data.products = { items, totalItems: items.length };
        }
    },
    renderPage: page =>
        page[caseKey] === 'cold'
            ? ''
            : require(path.join(dist, '.server/public-page-renderer.cjs')).renderPublicPage(page),
    transformDocument: (html, { page }) =>
        page[caseKey] === 'cold'
            ? html
                  .replace(/\sdata-public-rendered="1"/gu, '')
                  .replace(/<script[^>]+id="storefront-public-page-data"[^>]*>[\s\S]*?<\/script>/gu, '')
            : html,
    async transformHtml(route, page) {
        const currentTemplate = await readFile(path.join(dist, 'index.html'), 'utf8');
        const emitted = await readdir(path.join(dist, 'assets'));
        const prefixes = route.includes('/product')
            ? ['product-detail-page-']
            : /\/(category|search)/u.test(route)
              ? ['account-catalog-surfaces-']
              : [];
        const styles = prefixes.flatMap(prefix =>
            emitted.filter(file => file.startsWith(prefix) && file.endsWith('.css')),
        );
        const preset = page.visualPreset.presetId;
        const palette = resolveStorefrontSemanticPalette(preset, {
            backgroundColor: page.config.brandBackgroundColor,
            primaryColor: page.config.brandPrimaryColor,
            accentColor: page.config.brandAccentColor,
            highlightColor: page.config.brandHighlightColor,
        });
        const variables = {
            ...semanticPaletteCssVariables(palette),
            ...storefrontSkinCssVariables(preset, palette),
            'color-scheme': preset === 'neo-minimalist' ? 'dark' : 'light',
        };
        const style = Object.entries(variables)
            .map(([key, value]) => `${key}:${value}`)
            .join(';');
        return currentTemplate
            .replace('data-storefront-theme-pending', `style="${style}"`)
            .replace('<head>', '<head><script src="/__qa/observe.js"></script>')
            .replace(
                '</head>',
                styles.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('') + '</head>',
            );
    },
});
process.stdout.write(`Synthetic loading acceptance: http://127.0.0.1:${server.port}/__qa (${label})\n`);
process.stdout.write(`Evidence: ${output}\n`);
