import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixtureData } from '../visual-presets/fixtures.mjs';

// Actual production build with synthetic data; this server cannot forward business writes.
const root = fileURLToPath(new URL('../../dist/', import.meta.url));
const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
const port = Number(process.argv[2] ?? 57206);
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
};
const signedOut = new Set(['/login', '/register', '/forgot-password']);

function dataFor(page) {
    const preset = page.searchParams.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
    const signedIn = !signedOut.has(page.pathname);
    const data = fixtureData(preset, signedIn, 'coupons');
    const referrals = fixtureData(preset, signedIn, 'aftercare');
    data.referralProgram = referrals.referralProgram;
    data.myReferralOverview = referrals.myReferralOverview;
    data.myCustomerProductActivity = { favoriteProductIds: [], recentProductVisits: [] };
    data.storefrontDailyRecommendations = {
        businessDate: '2026-10-06',
        expiresAt: '2099-01-01T00:00:00Z',
        items: [],
    };
    data.activeChannel.customFields.storefrontNameZh = '配色验收样本';
    data.activeChannel.customFields.storefrontNameEn = 'Local color QA';
    data.activeStorefrontCoupons.push({
        ...data.activeStorefrontCoupons[0],
        id: 'local-claimable',
        name: '可领取样本券',
        claimed: false,
        claimable: true,
    });
    const history = ['USED', 'REFUNDED'].map((status, index) => ({
        ...data.myStorefrontCoupons[1],
        id: `local-history-${index}`,
        customerCouponId: 'qa-coupon-1',
        status,
        savedAmount: 500,
        usedAt: '2026-10-01T00:00:00Z',
        refundedAt: status === 'REFUNDED' ? '2026-10-02T00:00:00Z' : null,
        orderId: 'order-1',
        orderCode: 'LOCAL-SAMPLE',
    }));
    data.myStorefrontCouponUsageRecords = history;
    data.myStorefrontCouponUsageRecordsPage = { items: history, totalItems: history.length };
    // Use existing local product artwork instead of invented merchant imagery.
    const image = '/storefront/categories/category-desk-setup.jpg';
    function media(value) {
        if (!value || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) {
            if (typeof item === 'string' && item.startsWith('data:image/svg+xml')) value[key] = image;
            else if (item && typeof item === 'object') media(item);
        }
    }
    media(data);
    return data;
}

function json(res, data, status = 200) {
    res.writeHead(status, { 'content-type': types['.json'] });
    res.end(JSON.stringify(data));
}

http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
        if (url.pathname === '/shop-api') {
            let body = '';
            for await (const part of req) {
                body += part;
                if (body.length > 128_000) return json(res, { error: 'Request too large' }, 413);
            }
            const { query = '' } = JSON.parse(body || '{}');
            if (/\bmutation\b/u.test(query))
                return json(
                    res,
                    { errors: [{ message: '本地颜色验收不执行保存、领券、下单或支付。' }] },
                    403,
                );
            const page = new URL(req.headers.referer ?? '/', url.origin);
            if (
                page.searchParams.get('state') === 'error' &&
                /myReferralOverview|activeStorefrontCoupons|myStorefrontCoupons/u.test(query)
            ) {
                return json(res, { errors: [{ message: 'Controlled local visual error state' }] });
            }
            return json(res, { data: dataFor(page) });
        }
        if (url.pathname.includes('storefront-realtime') || url.pathname.includes('analytics')) {
            res.writeHead(204).end();
            return;
        }
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, { error: 'Read-only preview' }, 403);
        for (const base of [root, publicRoot]) {
            const file = path.resolve(base, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(path.resolve(base) + path.sep)) continue;
            try {
                if (!(await stat(file)).isFile()) continue;
                res.writeHead(200, {
                    'content-type': types[path.extname(file)] ?? 'application/octet-stream',
                });
                res.end(await readFile(file));
                return;
            } catch {
                /* SPA routes use the entry below. */
            }
        }
        if (path.extname(url.pathname)) return json(res, { error: 'Not found' }, 404);
        const skin = url.searchParams.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
        const html = (await readFile(path.join(root, 'index.html'), 'utf8')).replace(
            '<head>',
            `<head><script>
// Only synthetic preview-origin public data is reset between test scenarios.
for(const key of Object.keys(sessionStorage))if(key.startsWith('vendure-storefront-public-query-cache:'))sessionStorage.removeItem(key);
localStorage.setItem('storefront-analytics-opt-out:v1','1');
sessionStorage.setItem('__storefront_preset__',${JSON.stringify(skin)});
</script>`,
        );
        res.writeHead(200, { 'content-type': types['.html'] });
        res.end(html);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        if (!res.headersSent) json(res, { error: 'Local preview unavailable' }, 500);
        else res.end();
    }
}).listen(port, '127.0.0.1', () =>
    process.stdout.write(`Local color acceptance: http://127.0.0.1:${port}/account\n`),
);
