// Actual client entry with the same public test data used by the Admin harness.
// This file is served only by the local parity Vite configuration.
import { fixtureData } from '../../../storefront/e2e/visual-presets/fixtures.mjs';
import {
    newAccountHeroBlock,
    newContentBlock,
    newContentItem,
} from '../../src/pages/Storefront/storefront-content-utils';
import { decorationDraft } from '../../src/pages/Storefront/storefront-decoration-model';

const params = new URLSearchParams(location.search);
const hero = newContentBlock('HERO', 1, '生活好物');
hero.id = 'hero-a';
hero.code = 'hero-a';
hero.enabled = true;
if (params.has('original')) hero.settings = { ...hero.settings, themePreset: 'bright' };
hero.translations[0].title = '装修即时预览验证';
hero.imageAsset = {
    id: 'replacement-asset',
    name: '替换轮播横幅',
    mimeType: 'image/svg+xml',
    preview: '/assets/replacement-carousel.svg',
    source: '/assets/replacement-carousel.svg',
    width: 1600,
    height: 520,
};
if (params.has('managedImages')) {
    Object.assign(hero.translations[0], {
        title: '为马来西亚的家，甄选舒适好物',
        subtitle: 'FLASH CAST · HOME & LIVING',
        body: '从卧室、客厅到餐厅与书房，为日常空间挑选耐看、实用的家具与家居。',
        ctaLabel: '浏览家具',
    });
    hero.targetType = 'PAGE';
    hero.targetValue = 'category';
}
const notice = newContentBlock('NOTICE', 0, '服务公告');
notice.enabled = true;
const products = newContentBlock('BEST_SELLERS', 4, '热门商品');
products.enabled = true;
const gallery = newContentBlock('QUICK_LINKS', 3, '精选分类');
gallery.id = 'gallery';
gallery.code = 'gallery';
gallery.enabled = true;
gallery.items = Array.from({ length: 5 }, (_, index) => {
    const item = newContentItem(index);
    item.id = `gallery-${index}`;
    item.imageUrl = '/assets/fixture-carousel.svg';
    item.targetType = 'PAGE';
    item.targetValue = 'category';
    item.translations[0].label = ['签证留学', '第二家园', '正品烟草', '精品白酒', '正厂槟榔'][index];
    return item;
});
const trust = newContentBlock('TRUST_BAR', 2, '服务保障');
trust.enabled = true;
trust.items = ['马币标价', '订单可查', '在马客服', '按需询价'].map((label, position) => {
    const item = newContentItem(position);
    item.translations[0].label = label;
    return item;
});
const account = newAccountHeroBlock(0);
account.imageAsset = {
    ...hero.imageAsset,
    id: 'fixture-asset',
    preview: '/assets/fixture-carousel.svg',
    source: '/assets/fixture-carousel.svg',
};
const blocks = [
    notice,
    hero,
    ...(params.has('gallery') ? [gallery] : []),
    products,
    ...(params.has('managedImages') ? [trust, account] : []),
].map(block => decorationDraft(block, 'zh_Hans').block);
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.pathname.endsWith('/shop-api')) {
        const data = fixtureData(
            params.get('preset') ?? 'neo-minimalist',
            params.has('accountArtwork'),
            params.has('managedImages') ? 'auth-referral' : 'normal',
        );
        data.activeChannel.id = 'fixture';
        data.activeChannel.code = '轮播测试店铺';
        data.storefrontVisualPreset.channelId = 'fixture';
        data.storefrontContent = blocks;
        if (params.has('managedImages'))
            data.storefrontDailyRecommendations = {
                businessDate: '2026-10-03',
                expiresAt: '2099-01-01T00:00:00Z',
                items: data.products.items,
            };
        return new Response(JSON.stringify({ data }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }
    if (url.pathname.includes('/storefront-realtime')) return new Response(null, { status: 204 });
    return nativeFetch(input, init);
};
void import('../../../storefront/src/main');
