import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Synthetic module density based on the reviewed order; no merchant data or live calls. */
export const scenarioNames = [
    'home',
    'slow',
    'cold',
    'images',
    'product-images',
    'image-error',
    'coupons',
    'old',
    'targeted',
    'prepared',
    'late',
    'dark',
];
export const reportRoot = 'docs/local-validation/moyao-loading-20261029';
export const scenarioKeys = [
    'qaLabel',
    'qaCase',
    'qaMode',
    'qaDuration',
    'qaPreset',
    'qaCoupons',
    'qaCodeDelay',
    'qaImageDelay',
    'qaDataDelay',
    'qaImageCache',
];
export function scenarioParameters(name, label, mode = 'performance') {
    if (!scenarioNames.includes(name)) throw new Error('Unknown local scenario');
    const params = new URLSearchParams({
        qaLabel: label,
        qaCase: name,
        qaMode: mode === 'geometry' ? 'geometry' : 'performance',
        qaPreset: name === 'dark' ? 'neo-minimalist' : 'classic',
    });
    if (name === 'slow') params.set('qaCodeDelay', '1600');
    if (name === 'cold' || name === 'late') params.set('qaDataDelay', '1200');
    if (name === 'images' || name === 'product-images') params.set('qaImageDelay', '2000');
    if (['coupons', 'old', 'targeted', 'prepared', 'late'].includes(name)) params.set('qaCoupons', 'enabled');
    return params;
}
export function inheritScenario(url, referer) {
    let reference;
    try {
        reference = new URL(referer ?? url.href);
    } catch {
        reference = url;
    }
    if (reference.origin !== url.origin) return url;
    for (const key of scenarioKeys)
        if (!url.searchParams.has(key) && reference.searchParams.has(key))
            url.searchParams.set(key, reference.searchParams.get(key));
    return url;
}
const delay = value => Math.min(5000, Math.max(0, Number(value) || 0));
export function requestScenario(url) {
    const productImage = /^\/assets\/preview\/product-[a-z0-9_-]+\.svg$/iu.test(url.pathname);
    const syntheticImage =
        url.pathname.startsWith('/qa/hero-') || /^\/assets\/preview\/[a-z0-9_-]+\.svg$/iu.test(url.pathname);
    return {
        syntheticImage,
        productImage,
        delay:
            url.pathname === '/_storefront/page-data' || url.pathname === '/shop-api'
                ? delay(url.searchParams.get('qaDataDelay'))
                : url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')
                  ? delay(url.searchParams.get('qaCodeDelay'))
                  : syntheticImage && (url.searchParams.get('qaCase') !== 'product-images' || productImage)
                    ? delay(url.searchParams.get('qaImageDelay'))
                    : 0,
        failImage: url.searchParams.get('qaCase') === 'image-error' && productImage,
        cache: url.searchParams.get('qaImageCache') === 'warm' ? 'public, max-age=300' : 'no-store',
    };
}
export function applyReviewedHomeStructure(page) {
    const hero = page.content.blocks.find(block => block.type === 'HERO');
    if (!hero) return;
    hero.title = '合成工具商城：桌面精选';
    hero.subtitle = '本地加载验收';
    hero.body = '只模拟审查首页的模块顺序和内容密度，不代表真实商品、品牌或承诺。';
    hero.position = 1;
    hero.imageUrl = '/qa/hero-desktop.svg';
    hero.imageAsset = { width: 1600, height: 640 };
    hero.settings = {
        ...hero.settings,
        heroArtworkLayout: 'campaign',
        mobileImageUrl: '/qa/hero-mobile.svg',
        mobileImageWidth: 600,
        mobileImageHeight: 600,
        mobileHeroTextColor: '#ffffff',
        mobileHeroHideStats: true,
        mobileHeroTranslations: [
            {
                languageCode: 'zh_Hans',
                title: '手机合成工具商城',
                subtitle: '本地加载验收',
                body: '仅模拟模块密度，全部数据来自本机',
                ctaLabel: '查看合成商品',
            },
        ],
    };
    const extraHeroes = [
        ['轻巧工具', '手机轻巧工具', '短文案'],
        [
            '合成工具系列：多场景协作和日常灵感工作台',
            '合成工具系列：多场景协作和日常灵感工作台',
            '较长合成文案用于检查轮播高度、文案换行与相邻模块的位置连续性，所有内容仅供本地验收。',
        ],
    ].map(([title, mobileTitle, body], index) => ({
        ...hero,
        id: `qa-hero-${index + 2}`,
        code: `qa-hero-${index + 2}`,
        title,
        body,
        position: 1 + (index + 1) / 10,
        imageUrl: `/qa/hero-desktop-${index + 2}.svg`,
        settings: {
            ...hero.settings,
            mobileImageUrl: `/qa/hero-mobile-${index + 2}.svg`,
            mobileHeroTranslations: [
                { ...hero.settings.mobileHeroTranslations[0], title: mobileTitle, body },
            ],
        },
    }));
    const quick = page.content.blocks.find(block => block.type === 'QUICK_LINKS');
    if (quick) {
        quick.position = 2;
        quick.items = quick.items
            .slice(0, 5)
            .map((item, index) => ({ ...item, imageUrl: `/assets/preview/quick-${index}.svg` }));
    }
    const coupon = page.content.blocks.find(block => block.type === 'COUPONS');
    if (coupon) coupon.position = 3;
    const ids = (page.products ?? []).map(product => product.id);
    const make = (type, code, title, position, settings = {}) => ({
        ...hero,
        id: code,
        code,
        type,
        title,
        subtitle: '本地匿名合成数据',
        body: '仅用于加载连续性验收',
        imageUrl: null,
        imageAsset: null,
        targetType: 'NONE',
        targetValue: null,
        items: [],
        position,
        settings,
    });
    const modules = [
        make('NOTICE', 'qa-notice', '本地验收公告：所有商品和图片均为合成数据', 0),
        make('BEST_SELLERS', 'qa-sales', '合成热销商品', 4, { displayCount: 12 }),
        make('RECOMMENDATIONS', 'qa-recommended', '合成推荐商品', 5, { displayCount: 12 }),
        // One lead + six supporting cards exercises the actual two-row desktop mosaic alignment.
        make('FEATURED_COLLECTION', 'qa-featured', '合成每日精选', 6, {
            selectedProductIds: ids.slice(0, 7),
            displayCount: 7,
        }),
        make('FEATURED_COLLECTION', 'qa-codex', 'Codex 工具合成专区', 7, {
            selectedProductIds: ids,
            displayCount: 12,
        }),
        make('STORY', 'qa-story', '合成品牌说明', 8),
    ];
    const replace = new Set(modules.map(block => block.type));
    page.content.blocks = [
        ...page.content.blocks.filter(
            block => !replace.has(block.type) && (block.type !== 'HERO' || block === hero),
        ),
        ...extraHeroes,
        ...modules,
    ];
    page.content.settings.configuredBlockTypes = [
        ...new Set([...page.content.settings.configuredBlockTypes, ...modules.map(block => block.type)]),
    ];
    page.bestSellers = {
        catalog: { items: page.products ?? [], totalItems: ids.length },
        salesByProductId: {},
        pinnedProducts: [],
        candidateCount: 12,
    };
    // Public recommendation reads remain owned by the actual Query path, just like the site.
    page.content.settings.heroAutoplayIntervalSeconds = 5;
    page.content.systemAnnouncements = syntheticAnnouncements();
}

export function syntheticAnnouncements() {
    return [
        {
            id: 'qa-announcement',
            title: '本地合成加载验收',
            content: '所有商品、价格、品牌名称与图片均为合成测试数据。',
            linkUrl: null,
            startsAt: null,
            endsAt: null,
            createdAt: null,
        },
    ];
}

/** Read-only artifacts can come from this repository or one of its internal worktrees. */
export function resolveDistRoot(project, requested, canonical = realpathSync) {
    const repository =
        path.basename(path.dirname(project)) === '.codex-worktrees'
            ? path.dirname(path.dirname(project))
            : project;
    const requestedPath = requested ?? path.join(project, 'packages/storefront/dist');
    if (!path.isAbsolute(requestedPath)) throw new Error('dist-root must be absolute');
    const resolved = canonical(requestedPath);
    const owningRoot = resolved.endsWith(path.sep + 'packages/storefront/dist')
        ? resolved.slice(0, -'/packages/storefront/dist'.length)
        : '';
    const canonicalRepository = canonical(repository);
    if (
        owningRoot !== canonicalRepository &&
        !(path.dirname(owningRoot) === path.join(canonicalRepository, '.codex-worktrees'))
    )
        throw new Error('dist-root must belong to this repository or its .codex-worktrees');
    return resolved;
}
