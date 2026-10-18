import { readFile, readdir } from 'node:fs/promises';

import { startSeoFixtureServer } from '../seo-public/preview-server.mjs';
import { fixtureData } from '../visual-presets/fixtures.mjs';

// Real SSR and client bundles, synthetic data only. No production API or write operations.
export function startLoadingExperienceServer(port = 0, defaultState = 'ready') {
    return startSeoFixtureServer(port, {
        listenHost: '127.0.0.1',
        async transformHtml(pathname) {
            const html = await readFile(
                process.env.STOREFRONT_QA_DIST
                    ? `${process.env.STOREFRONT_QA_DIST}/index.html`
                    : new URL('../../dist/index.html', import.meta.url),
                'utf8',
            );
            const observer = await readFile(new URL('./observer.js', import.meta.url), 'utf8');
            const dist = process.env.STOREFRONT_QA_DIST ?? new URL('../../dist/', import.meta.url);
            const assets = await readdir(
                typeof dist === 'string' ? `${dist}/assets` : new URL('assets/', dist),
            );
            const prefixes = pathname.includes('/product')
                ? ['product-detail-page-']
                : pathname.includes('/category')
                  ? ['account-catalog-surfaces-']
                  : [];
            const styles = assets
                .filter(file => file.endsWith('.css') && prefixes.some(prefix => file.startsWith(prefix)))
                .map(file => `<link rel="stylesheet" href="/assets/${file}">`)
                .join('');
            return html
                .replace('<head>', `<head><script>${observer}</script>`)
                .replace('</head>', `${styles}</head>`);
        },
        transformPage(page, { url }) {
            page.visualPreset = {
                ...page.visualPreset,
                presetId: url.searchParams.get('preset') ?? 'classic',
            };
            page.content.blocks.push({
                ...page.content.blocks[0],
                id: 'qa-coupons',
                code: 'qa-coupons',
                type: 'COUPONS',
                enabled: !url.searchParams.has('noCoupons'),
                position: 0.5,
                imageUrl: null,
                title: page.scope.languageCode === 'en' ? 'Local sample offers' : '本地测试优惠',
                subtitle: '',
                body: '',
                items: [],
                settings: null,
            });
            page.content.settings.configuredBlockTypes.push('COUPONS');
            page.content.blocks.push(
                ...[1, 2].map(index => ({
                    ...page.content.blocks[0],
                    id: `qa-hero-${index}`,
                    code: `qa-hero-${index}`,
                    type: 'HERO',
                    position: -2 + index / 10,
                    items: [],
                    settings: null,
                    title: `Local image ${index}`,
                    subtitle: '',
                    body: '',
                    ctaLabel: '',
                    imageUrl: `/qa/loading-image-${index}.svg`,
                    targetType: 'NONE',
                    targetValue: null,
                })),
            );
            page.content.settings.configuredBlockTypes.push('HERO');
            for (const product of page.products) {
                product.assets = [
                    product.featuredAsset,
                    { id: `${product.id}-alternate`, preview: '/qa/loading-image-2.svg' },
                    ...(url.searchParams.has('galleryFailure')
                        ? [{ id: `${product.id}-failed`, preview: '/qa/loading-image-3.svg' }]
                        : []),
                ];
            }
        },
        async serveAssets(request, response) {
            const match = /^\/qa\/loading-image-(\d).svg/u.exec(request.url);
            if (!match) return false;
            await new Promise(resolve => setTimeout(resolve, 800));
            response.writeHead(200, {
                'content-type': 'image/svg+xml',
                'cache-control': 'public, max-age=3600',
            });
            response.end(
                `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">` +
                    `<rect width="1200" height="600" fill="${match[1] === '1' ? '#dde4ef' : '#23334a'}"/>` +
                    '<circle cx="900" cy="300" r="210" fill="#758da9"/>' +
                    `<text x="80" y="310" font-size="56" fill="${match[1] === '1' ? '#23334a' : '#dde4ef'}">` +
                    `Local sample ${match[1]}</text></svg>`,
            );
            return true;
        },
        async transformGraphQlData(data, { operation, referrer }) {
            const query = String(operation.query ?? '');
            const state = referrer.searchParams.get('state') ?? defaultState;
            data.activeCustomer = state === 'guest' ? null : fixtureData('classic', true).activeCustomer;
            data.activeStorefrontCoupons =
                state === 'empty'
                    ? []
                    : [
                          {
                              id: 'qa-offer',
                              code: 'LOCAL-QA',
                              name: '本地测试优惠 / Sample offer',
                              description: '',
                              kind: 'ORDER_FIXED',
                              appearanceTheme: 'gold',
                              currencyCode: 'MYR',
                              discountAmount: 500,
                              discountRate: null,
                              minimumSpend: 10000,
                              startsAt: null,
                              endsAt: null,
                              claimStartsAt: null,
                              claimEndsAt: null,
                              validityDays: 30,
                              claimable: true,
                              claimed: false,
                              remainingIssueCount: 20,
                              scope: 'ORDER',
                              collectionIds: [],
                              productVariantIds: [],
                          },
                      ];
            if (/activeCustomer\s*\{/u.test(query)) await new Promise(resolve => setTimeout(resolve, 1400));
            if (/activeStorefrontCoupons\s*\{/u.test(query)) {
                await new Promise(resolve => setTimeout(resolve, 1800));
                if (state === 'error') throw new Error('Synthetic coupon read failure');
            }
        },
    });
}

if (process.argv.includes('--serve')) {
    const server = await startLoadingExperienceServer(Number(process.env.LOADING_QA_PORT ?? 5347));
    process.stdout.write(`Local loading experience fixture: http://127.0.0.1:${server.port}/zh/\n`);
}
