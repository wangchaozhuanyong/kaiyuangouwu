// Actual client entry with the same public test data used by the Admin harness.
// This file is served only by the local parity Vite configuration.
import { fixtureData } from '../../../storefront/e2e/visual-presets/fixtures.mjs';
import { newContentBlock } from '../../src/pages/Storefront/storefront-content-utils';
import { decorationDraft } from '../../src/pages/Storefront/storefront-decoration-model';

const params = new URLSearchParams(location.search);
const hero = newContentBlock('HERO', 1, '生活好物');
hero.id = 'hero-a';
hero.code = 'hero-a';
hero.enabled = true;
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
const notice = newContentBlock('NOTICE', 0, '服务公告');
notice.enabled = true;
const products = newContentBlock('BEST_SELLERS', 4, '热门商品');
products.enabled = true;
const blocks = [notice, hero, products].map(block => decorationDraft(block, 'zh_Hans').block);
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.pathname.endsWith('/shop-api')) {
        const data = fixtureData(params.get('preset') ?? 'modern-oriental', false);
        data.activeChannel.id = 'fixture';
        data.activeChannel.code = '轮播测试店铺';
        data.storefrontVisualPreset.channelId = 'fixture';
        data.storefrontContent = blocks;
        return new Response(JSON.stringify({ data }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }
    if (url.pathname.includes('/storefront-realtime')) return new Response(null, { status: 204 });
    return nativeFetch(input, init);
};
void import('../../../storefront/src/main');
