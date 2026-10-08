import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixtureData } from '../../../packages/storefront/e2e/visual-presets/fixtures.mjs';

// Adapted from e2e/classic-palette/preview-server.mjs. This serves the candidate's
// real compiled components with explicitly synthetic fixtures and never forwards writes.
const candidateRoot = fileURLToPath(new URL('../../../', import.meta.url));
const distRoot = path.join(candidateRoot, 'packages/storefront/dist');
const publicRoot = path.join(candidateRoot, 'packages/storefront/public');
export const DEFAULT_PORT = 5398;
export const LONG_LOCAL_HOST = 'responsive-qa.localhost';
const signedOut = new Set(['/login', '/register', '/forgot-password']);
const states = ['PaymentSettled', 'Shipped', 'Delivered', 'Cancelled'];
const localImages = [
    '/storefront/default-hero.jpg',
    '/storefront/hero-01-gateway.jpg',
    '/storefront/hero-02-vip.jpg',
];
const orderCache = new Map();
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
};

function replaceFixtureArtwork(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string' && item.startsWith('data:image/svg+xml'))
            value[key] = '/storefront/categories/category-desk-setup.jpg';
        else if (item && typeof item === 'object') replaceFixtureArtwork(item);
    }
}

function posterTemplate() {
    const fields = [
        'title',
        'headline',
        'siteIntro',
        'featureOneTitle',
        'featureOneText',
        'featureTwoTitle',
        'featureTwoText',
        'featureThreeTitle',
        'featureThreeText',
        'qrEyebrow',
        'qrTitle',
        'qrDescription',
        'rewardText',
        'sceneOne',
        'sceneTwo',
        'sceneThree',
        'sceneFour',
        'ctaText',
        'footerTitle',
        'footerText',
        'serviceText',
    ];
    return {
        ...Object.fromEntries(
            fields.flatMap(field => [
                [`${field}Zh`, '本地合成验收'],
                [`${field}En`, 'Local synthetic QA'],
            ]),
        ),
        id: 'QA_LOCAL_POSTER',
        name: '本地合成验收海报 / Synthetic QA poster',
        enabled: true,
        position: 0,
        layoutVariant: 'STANDARD_CENTER',
        updatedAt: '2026-10-08T00:00:00.000Z',
        posterBackgroundAsset: null,
        shareBackgroundAsset: null,
        foregroundColor: '#152c49',
        accentColor: '#2565ae',
        overlayOpacity: 0,
        headlineZh: '邀请好友',
        headlineEn: 'Invite friends',
        rewardTextZh: '合成样本：{rewardRate}% 奖励',
        rewardTextEn: 'Synthetic sample: {rewardRate}% reward',
        qrDescriptionZh: '仅用于本地验收',
        qrDescriptionEn: 'For local QA only',
        serviceTextZh: '',
        serviceTextEn: '',
    };
}

export function logisticsOrders(language = 'zh', count = 12_345) {
    const key = `${language}:${count}`;
    if (orderCache.has(key)) return orderCache.get(key);
    const base = fixtureData('classic', true, 'aftercare').order;
    const name =
        language === 'zh'
            ? '本地合成订单 · 排版验收商品'
            : 'Synthetic layout sample product with a deliberately long English name';
    const productVariant = {
        ...base.lines[0].productVariant,
        name,
        featuredAsset: {
            id: 'qa-local-product-artwork',
            preview: '/storefront/categories/category-desk-setup.jpg',
        },
        product: {
            id: 'qa-local-product',
            name,
            featuredAsset: { preview: '/storefront/categories/category-desk-setup.jpg' },
        },
        customFields: { fulfillmentType: 'physical' },
    };
    const items = Array.from({ length: count }, (_, index) => {
        const state = states[index % states.length];
        const id = `qa-synthetic-order-${index + 1}`;
        const show = index < 5;
        return {
            ...base,
            id,
            code: `${show ? 'QA-SHOW' : 'QA-SYNTHETIC'}-${String(index + 1).padStart(5, '0')}`,
            state,
            createdAt: '2026-10-08T08:00:00.000Z',
            updatedAt: '2026-10-08T08:00:00.000Z',
            orderPlacedAt: '2026-10-08T08:00:00.000Z',
            lines: [
                {
                    ...base.lines[0],
                    id: `${id}-line`,
                    productVariant,
                    customFields: { fulfillmentTypeSnapshot: 'physical' },
                },
            ],
            customFields: { customerNote: 'Synthetic fixture only; no real customer or order.' },
            fulfillments:
                state === 'PaymentSettled'
                    ? []
                    : [
                          {
                              id: `${id}-fulfillment`,
                              createdAt: '2026-10-08T08:00:00.000Z',
                              updatedAt: '2026-10-08T08:00:00.000Z',
                              state,
                              method: 'local-synthetic-courier',
                              trackingCode: `QA-TRACKING-${index + 1}`,
                              deliveryEvidence: null,
                          },
                      ],
        };
    });
    orderCache.set(key, items);
    return items;
}

export function dataFor(page, language = page.searchParams.get('lang') === 'en' ? 'en' : 'zh') {
    const preset = page.searchParams.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
    const signedIn = !signedOut.has(page.pathname);
    const data = fixtureData(preset, signedIn, 'normal');
    const referrals = fixtureData(preset, signedIn, 'aftercare');
    replaceFixtureArtwork(data);
    replaceFixtureArtwork(referrals);
    data.activeChannel.customFields.storefrontNameZh = '本地合成验收';
    data.activeChannel.customFields.storefrontNameEn = 'Synthetic QA';
    data.storefrontVisualPreset.desktopLayout = 'classic';
    data.storefrontBranding.accessMode = 'OPEN';
    data.storefrontBranding.description =
        language === 'zh'
            ? '本地合成数据，仅用于排版验收。'
            : 'Local synthetic data for layout acceptance only.';
    data.storefrontBranding.tagline = '';
    data.myCustomerProductActivity = { favoriteProductIds: [], recentProductVisits: [] };
    data.storefrontDailyRecommendations = {
        businessDate: '2026-10-08',
        expiresAt: '2099-01-01T00:00:00Z',
        items: [],
    };
    data.myCustomerAvatar = null;
    data.referralProgram = {
        ...referrals.referralProgram,
        defaultPosterTemplate: 'QA_LOCAL_POSTER',
        posterTemplates: ['QA_LOCAL_POSTER'],
        systemPosterTemplateConfigs: [posterTemplate()],
        posterTemplateConfigs: [],
    };
    data.myReferralOverview = referrals.myReferralOverview;
    if (data.myReferralOverview) data.myReferralOverview.inviteCode = 'LOCALQA12345';
    if (data.activeCustomer) {
        data.activeCustomer = {
            ...data.activeCustomer,
            id: 'qa-local-synthetic-customer',
            firstName: '本地合成',
            lastName: '验收顾客',
            emailAddress: 'layout-qa@example.invalid',
            orders: { items: logisticsOrders(language, 5), totalItems: 5 },
        };
    }
    const heroBase = data.storefrontContent.find(block => block.type === 'HERO');
    const single = ['1', 'single'].includes(page.searchParams.get('hero'));
    const heroes = localImages.slice(0, single ? 1 : 3).map((imageUrl, index) => ({
        ...heroBase,
        id: `qa-local-hero-${index + 1}`,
        code: `qa-local-hero-${index + 1}`,
        position: index,
        imageUrl,
        imageAsset: { width: 1376, height: 768 },
        title:
            language === 'zh' ? `本地合成首页验收 ${index + 1}` : `Local synthetic home preview ${index + 1}`,
        subtitle: language === 'zh' ? '候选组件排版' : 'Candidate component layout',
        body: '',
        ctaLabel: language === 'zh' ? '浏览商品' : 'Browse products',
        settings: { ...heroBase.settings, visualStyle: 'classic' },
    }));
    const trust = {
        ...heroBase,
        id: 'qa-local-trust',
        code: 'qa-local-trust',
        type: 'TRUST_BAR',
        position: 3,
        imageUrl: null,
        imageAsset: null,
        title: '',
        subtitle: '',
        body: '',
        ctaLabel: '',
        targetType: 'NONE',
        targetValue: null,
        settings: {},
        items: (language === 'zh'
            ? ['合成验收样本', '本地组件展示', '不执行真实交易', '测试数据']
            : ['Synthetic preview only', 'Local component sample', 'No real transactions', 'QA fixtures']
        ).map((label, index) => ({
            id: `qa-trust-${index}`,
            enabled: true,
            position: index,
            label,
            description: '',
            imageUrl: null,
            targetType: 'NONE',
            targetValue: null,
            settings: {},
        })),
    };
    data.storefrontContent = [
        ...heroes,
        trust,
        ...data.storefrontContent.filter(block => block.type !== 'HERO' && block.type !== 'TRUST_BAR'),
    ];
    data.storefrontContentSettings.heroAutoplayIntervalSeconds = 30;
    data.storefrontContentSettings.configuredBlockTypes = [
        'HERO',
        'TRUST_BAR',
        'AUTH_LOGIN',
        'AUTH_REGISTER',
    ];
    return data;
}

function json(res, data, status = 200) {
    res.writeHead(status, { 'content-type': types['.json'] });
    res.end(JSON.stringify(data));
}

export async function handlePreview(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Local-Synthetic-Preview', 'responsive-three-surfaces-20261008');
    // A candidate compiled with a remote API URL must fail locally, never contact that API.
    res.setHeader('Content-Security-Policy', "connect-src 'self'; form-action 'self'; object-src 'none'");
    const url = new URL(req.url, `http://${req.headers.host ?? `127.0.0.1:${DEFAULT_PORT}`}`);
    try {
        if (url.pathname === '/shop-api') {
            if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json'))
                return json(
                    res,
                    { errors: [{ message: 'Only read-only JSON GraphQL queries are supported.' }] },
                    403,
                );
            let body = '';
            for await (const part of req) {
                body += part;
                if (body.length > 128_000) return json(res, { error: 'Request too large' }, 413);
            }
            let parsed;
            try {
                parsed = JSON.parse(body || '{}');
            } catch {
                return json(res, { error: 'Invalid JSON' }, 400);
            }
            const query = typeof parsed.query === 'string' ? parsed.query : '';
            if (/\b(?:mutation|subscription)\b/u.test(query) || !/^\s*(?:query\b|\{)/u.test(query))
                return json(
                    res,
                    { errors: [{ message: '本地合成验收禁止保存、注册、下单、支付及其他写入。' }] },
                    403,
                );
            const page = new URL(req.headers.referer ?? '/', url.origin);
            const language =
                (req.headers['language-code'] ?? url.searchParams.get('languageCode')) === 'en' ? 'en' : 'zh';
            if (/\bquery\s+StorefrontOrders\b/u.test(query) && page.pathname === '/logistics') {
                const items = logisticsOrders(language);
                // Intentional fixture-only stress case: a single loaded page contains
                // 12,345 records so the real UI derives the large counts itself.
                return json(res, {
                    data: { activeCustomer: { orders: { items, totalItems: items.length } } },
                });
            }
            const data = dataFor(page, language);
            if (/\bquery\s+StorefrontOrder\b/u.test(query) && parsed.variables?.id)
                data.order =
                    logisticsOrders(language, 5).find(order => order.id === parsed.variables.id) ??
                    data.order;
            return json(res, { data });
        }
        if (!['GET', 'HEAD'].includes(req.method))
            return json(res, { error: 'Read-only synthetic preview' }, 403);
        if (url.pathname.includes('storefront-realtime')) {
            res.writeHead(204).end();
            return;
        }
        // Keep the real count at 12,345 while only drawing the five explicitly marked
        // QA-SHOW rows. All five filters retain this normal search term.
        if (url.pathname === '/logistics' && !url.searchParams.has('term')) {
            url.searchParams.set('term', 'QA-SHOW');
            res.writeHead(302, { location: `${url.pathname}${url.search}` }).end();
            return;
        }
        for (const base of [distRoot, publicRoot]) {
            const file = path.resolve(base, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(path.resolve(base) + path.sep)) continue;
            try {
                if (!(await stat(file)).isFile()) continue;
                res.writeHead(200, {
                    'content-type': types[path.extname(file)] ?? 'application/octet-stream',
                });
                res.end(req.method === 'HEAD' ? undefined : await readFile(file));
                return;
            } catch {
                /* SPA routes use the candidate entry below. */
            }
        }
        if (path.extname(url.pathname)) return json(res, { error: 'Not found' }, 404);
        const pageLanguage = url.searchParams.get('lang') === 'en' ? 'en' : 'zh';
        const preset = url.searchParams.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
        const html = (await readFile(path.join(distRoot, 'index.html'), 'utf8')).replace(
            '<head>',
            `<head><script>
// Only public cache data on this synthetic local preview origin is reset.
for(const key of Object.keys(sessionStorage))if(key.startsWith('vendure-storefront-public-query-cache:'))sessionStorage.removeItem(key);
localStorage.setItem('storefront-analytics-opt-out:v1','1');
localStorage.setItem('storefront-language-preference-v2:qa-channel',JSON.stringify({version:2,source:'manual',language:${JSON.stringify(pageLanguage)}}));
sessionStorage.setItem('__storefront_preset__',${JSON.stringify(preset)});
</script>`,
        );
        res.writeHead(200, { 'content-type': types['.html'] });
        res.end(req.method === 'HEAD' ? undefined : html);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        if (!res.headersSent) json(res, { error: 'Local synthetic preview unavailable' }, 500);
        else res.end();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.argv[2] ?? DEFAULT_PORT);
    http.createServer(handlePreview).listen(port, '127.0.0.1', () => {
        process.stdout.write(`Synthetic candidate acceptance: http://127.0.0.1:${port}/\n`);
        process.stdout.write(`Logistics: http://127.0.0.1:${port}/logistics?lang=zh&term=QA-SHOW\n`);
        process.stdout.write(
            `Referral long local origin: http://${LONG_LOCAL_HOST}:${port}/referral?lang=zh\n`,
        );
    });
}
