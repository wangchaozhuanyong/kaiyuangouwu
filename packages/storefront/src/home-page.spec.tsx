import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { buildHomeNoticeItems, HomePage, NoticeDetailSheet } from './pages/home-page';
import { StorefrontContext } from './StorefrontContext';
import { MarketConfig, Product, StorefrontContentBlock } from './types';

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useNavigate: () => vi.fn(),
}));

const market: MarketConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

const product: Product = {
    id: 'product-1',
    createdAt: '2026-08-25T00:00:00.000Z',
    name: '不应自动进入轮播的商品',
    slug: 'catalog-product',
    description: '普通商品描述',
    featuredAsset: null,
    assets: [],
    collections: [],
    variants: [],
};

const heroBlock: StorefrontContentBlock = {
    id: 'hero-1',
    code: 'homepage-hero',
    type: 'HERO',
    enabled: true,
    position: 0,
    startsAt: null,
    endsAt: null,
    imageUrl: '/assets/hero.jpg',
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    title: '后台配置的首页轮播',
    subtitle: '首页精选',
    body: '只显示后台配置的内容',
    ctaLabel: '查看活动',
    items: [],
};

const coreCategoriesBlock: StorefrontContentBlock = {
    id: 'core-categories-1',
    code: 'homepage-core-categories',
    type: 'CORE_CATEGORIES',
    enabled: true,
    position: 3,
    startsAt: null,
    endsAt: null,
    imageUrl: null,
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    settings: { dualCardTemplate: 'forest-amber' },
    title: '核心品类精选',
    subtitle: '',
    body: '',
    ctaLabel: '',
    items: [
        {
            id: 'core-item-1',
            enabled: true,
            position: 0,
            imageUrl: null,
            targetType: 'PAGE',
            targetValue: 'category',
            settings: { badgeLabelZh: '桌面数码', ctaLabelZh: '探索硬件' },
            label: '后台设置的办公卡片',
            description: '后台设置的办公说明',
        },
        {
            id: 'core-item-2',
            enabled: true,
            position: 1,
            imageUrl: null,
            targetType: 'PAGE',
            targetValue: 'category',
            settings: { badgeLabelZh: '数字生产力', ctaLabelZh: '即刻获取' },
            label: '后台设置的数字卡片',
            description: '后台设置的数字说明',
        },
    ],
};

const categoryAdBlock: StorefrontContentBlock = {
    ...heroBlock,
    id: 'category-ad-1',
    code: 'homepage-category-ad',
    type: 'CATEGORY_AD',
    imageUrl: '/assets/category-ad.jpg',
    targetType: 'COLLECTION',
    targetValue: 'collection-1',
    title: '分类广告',
    subtitle: '右侧副标题',
    body: '',
    ctaLabel: '不应显示的按钮文案',
    settings: { displayCount: 4, selectedProductIds: [] },
    items: [],
};

const trustBarBlock: StorefrontContentBlock = {
    ...heroBlock,
    id: 'trust-1',
    code: 'homepage-trust',
    type: 'TRUST_BAR',
    imageUrl: null,
    items: [],
};

const baseProps = {
    products: [product],
    collections: [],
    contentBlocks: [],
    managedContentProducts: [],
    heroAutoplayIntervalSeconds: 5,
    configuredBlockTypes: [
        'HERO',
        'NOTICE',
        'QUICK_LINKS',
        'COUPONS',
        'TRUST_BAR',
        'CORE_CATEGORIES',
        'FLASH_SALE',
        'BEST_SELLERS',
        'RECOMMENDATIONS',
        'LEGAL',
    ],
    coupons: [],
    flashSales: [],
    systemAnnouncements: [],
    bestSellerProducts: [],
    recommendationProducts: [],
    contentError: '',
    loading: false,
    error: null,
    market,
    locale: market.locale,
    language: 'zh' as const,
    storefrontName: '测试店铺',
    storefrontDescription: '',
    logoUrl: null,
    addingVariantId: null,
    claimedCampaignIds: [],
    couponLoading: false,
    onCategorySelect: vi.fn(),
    onAdd: vi.fn(),
    onToggleLanguage: vi.fn(),
    onNotifications: vi.fn(),
    onClaimCoupon: vi.fn().mockResolvedValue(null),
    onContentTarget: vi.fn(),
    onContentRetry: vi.fn(),
    onRetry: vi.fn(),
};

function renderHome(overrides: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
        <StorefrontContext.Provider value={{ ...baseProps, ...overrides }}>
            <HomePage />
        </StorefrontContext.Provider>,
    );
}

describe('HomePage hero carousel', () => {
    it('does not render a carousel from catalog products when no managed hero exists', () => {
        const markup = renderHome();

        expect(markup).not.toContain('class="hero');
        expect(markup).not.toContain('aria-roledescription="轮播"');
    });

    it('renders the carousel when the backend returns managed hero content', () => {
        const markup = renderHome({ contentBlocks: [heroBlock] });

        expect(markup).toContain('class="hero');
        expect(markup).toContain('aria-roledescription="轮播"');
        expect(markup).toContain('class="hero-rich-image-link"');
        expect(markup).toContain('aria-label="查看推荐内容：后台配置的首页轮播"');
        expect(markup).toContain(heroBlock.title);
    });

    it('does not substitute a built-in image for a managed hero that has no backend image', () => {
        const markup = renderHome({ contentBlocks: [{ ...heroBlock, imageUrl: null }] });

        expect(markup).not.toContain('class="hero');
        expect(markup).not.toContain('aria-roledescription="轮播"');
    });

    it('applies the backend-managed hero copy colors and accent colors', () => {
        const markup = renderHome({
            contentBlocks: [
                {
                    ...heroBlock,
                    backgroundColor: '#312E81',
                    textColor: '#FFFFFF',
                    settings: {
                        secondaryTextColor: '#E0F2FE',
                        accentColor: '#22D3EE',
                        accentSecondaryColor: '#7C3AED',
                        buttonTextColor: '#FFFFFF',
                    },
                },
            ],
        });

        expect(markup).toContain('--hero-overlay-color:#312E81');
        expect(markup).toContain('--hero-title-color:#FFFFFF');
        expect(markup).toContain('--hero-body-color:#E0F2FE');
        expect(markup).toContain('--hero-accent-color:#22D3EE');
        expect(markup).toContain('--hero-accent-secondary-color:#7C3AED');
    });
});

describe('HomePage localized trust bar layout', () => {
    it('uses the compact single-row layout for short Chinese labels', () => {
        const markup = renderHome({ contentBlocks: [trustBarBlock] });

        expect(markup).toContain('class="home-trust-bar"');
        expect(markup).not.toContain('home-trust-bar has-long-copy');
    });

    it('uses professional compact English labels without forcing a wrapping layout', () => {
        const markup = renderHome({
            contentBlocks: [trustBarBlock],
            language: 'en',
            locale: 'en-MY',
        });

        expect(markup).toContain('class="home-trust-bar"');
        expect(markup).not.toContain('home-trust-bar has-long-copy');
        expect(markup).toContain('class="home-trust-label">Tracking</span>');
        expect(markup).toContain('class="home-trust-label">Pricing</span>');
        expect(markup).toContain('class="home-trust-label">Security</span>');
        expect(markup).toContain('class="home-trust-label">Support</span>');
    });

    it('uses a wrapping layout for long merchant-managed labels in any language', () => {
        const managedTrustBlock: StorefrontContentBlock = {
            ...trustBarBlock,
            items: [
                {
                    id: 'trust-item-1',
                    enabled: true,
                    position: 0,
                    imageUrl: null,
                    targetType: 'NONE',
                    targetValue: null,
                    label: '数字商品订单交付进度可查',
                    description: '',
                },
            ],
        };
        const markup = renderHome({ contentBlocks: [managedTrustBlock] });
        const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

        expect(markup).toContain('class="home-trust-bar has-long-copy"');
        expect(stylesheet).toMatch(
            /\.home-trust-bar\.has-long-copy\s*\{[^}]*grid-template-columns:\s*repeat\(2,/,
        );
        expect(stylesheet).toMatch(
            /\.home-trust-bar\.has-long-copy \.home-trust-item\s*\{[^}]*white-space:\s*normal;/,
        );
    });
});

describe('HomePage desktop intro layout', () => {
    const positionedHeroBlock = { ...heroBlock, position: 1 };
    const positionedTrustBlock = { ...trustBarBlock, position: 2 };
    const quickLinksBlock: StorefrontContentBlock = {
        ...heroBlock,
        id: 'quick-links-1',
        code: 'homepage-quick-links',
        type: 'QUICK_LINKS',
        position: 3,
        imageUrl: null,
        items: [],
    };

    it('uses the desktop composition only for adjacent modules in canonical order', () => {
        const markup = renderHome({
            contentBlocks: [positionedHeroBlock, positionedTrustBlock, quickLinksBlock],
        });
        const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

        expect(markup).toContain('class="home-intro-grid is-desktop-grouped"');
        expect(stylesheet).toMatch(
            /\.homepage-modules > \.home-intro-grid\.is-desktop-grouped\s*\{[^}]*display:\s*grid;/,
        );
    });

    it('keeps merchant-reordered intro modules out of the desktop composition', () => {
        const markup = renderHome({
            contentBlocks: [
                positionedHeroBlock,
                { ...quickLinksBlock, position: 2 },
                { ...positionedTrustBlock, position: 3 },
            ],
        });

        expect(markup).toContain('class="home-intro-grid"');
        expect(markup).not.toContain('class="home-intro-grid is-desktop-grouped"');
    });
});

describe('HomePage notices', () => {
    it('does not rotate a single system announcement into the legacy notice placeholder', () => {
        const noticeBlock: StorefrontContentBlock = {
            ...heroBlock,
            id: 'notice-block',
            code: 'homepage-notice',
            type: 'NOTICE',
            imageUrl: null,
            title: '公告',
            subtitle: '',
            body: '',
            ctaLabel: '',
            items: [],
        };

        const items = buildHomeNoticeItems(
            [
                {
                    id: 'notice-1',
                    title: '配送公告',
                    content: '周末订单将在周一发货。',
                    linkUrl: null,
                    startsAt: null,
                    endsAt: null,
                },
            ],
            noticeBlock,
            'zh',
        );

        expect(items).toHaveLength(1);
        expect(items[0]?.id).toBe('system-notice-1');
        expect(items[0]?.summary).toContain('配送公告');
        expect(items[0]?.summary).not.toBe('公告');
    });

    it('preserves the backend order when multiple system announcements rotate', () => {
        const items = buildHomeNoticeItems(
            [
                {
                    id: 'newer',
                    title: '最新公告',
                    content: '最新内容',
                    linkUrl: null,
                    startsAt: null,
                    endsAt: null,
                },
                {
                    id: 'older',
                    title: '较早公告',
                    content: '较早内容',
                    linkUrl: null,
                    startsAt: null,
                    endsAt: null,
                },
            ],
            undefined,
            'zh',
        );

        expect(items.map(item => item.id)).toEqual(['system-newer', 'system-older']);
    });

    it('keeps a notice without a link clickable so the full content can be opened', () => {
        const markup = renderHome({
            configuredBlockTypes: baseProps.configuredBlockTypes.filter(type => type !== 'NOTICE'),
            systemAnnouncements: [
                {
                    id: 'notice-1',
                    title: '配送公告',
                    content: '这是一段需要在详情中完整阅读的公告正文。',
                    linkUrl: null,
                    startsAt: null,
                    endsAt: null,
                },
            ],
        });

        expect(markup).toContain('aria-haspopup="dialog"');
        expect(markup).toContain('aria-label="查看公告全文：配送公告"');
        expect(markup).not.toContain('class="notice-strip" type="button" disabled');
    });

    it('shows the full content and jump button in the notice detail sheet', () => {
        const content = '第一段完整内容。\n\n第二段完整内容，不能在公告条中被截断后丢失。';
        const markup = renderToStaticMarkup(
            <NoticeDetailSheet
                item={{
                    id: 'notice-2',
                    summary: '活动公告',
                    title: '活动公告',
                    content,
                    ctaLabel: '',
                    targetType: 'NONE',
                    targetValue: null,
                    linkUrl: 'https://example.com/activity',
                }}
                language="zh"
                onClose={vi.fn()}
                onFollowTarget={vi.fn()}
            />,
        );

        expect(markup).toContain('role="dialog"');
        expect(markup).toContain('第一段完整内容');
        expect(markup).toContain('第二段完整内容');
        expect(markup).toContain('class="notice-detail-action"');
        expect(markup).toContain('前往链接');
    });
});

describe('HomePage core category cards', () => {
    it('does not render hard-coded cards when no managed block exists', () => {
        const markup = renderHome();

        expect(markup).not.toContain('home-dual-showcase');
        expect(markup).not.toContain('极简办公工作站');
    });

    it('renders managed copy and the selected color template', () => {
        const markup = renderHome({ contentBlocks: [coreCategoriesBlock] });

        expect(markup).toContain('data-card-template="forest-amber"');
        expect(markup).toContain('后台设置的办公卡片');
        expect(markup).toContain('桌面数码');
        expect(markup).toContain('探索硬件');
        expect(markup).not.toContain('极简办公工作站');
    });

    it('uses the screenshot color template when a managed block has no template setting', () => {
        const markup = renderHome({
            contentBlocks: [{ ...coreCategoriesBlock, settings: null }],
        });

        expect(markup).toContain('data-card-template="tech-duo"');
    });
});

describe('HomePage category promotion', () => {
    it('places the subtitle at the end of the heading and omits the CTA copy', () => {
        const markup = renderHome({
            configuredBlockTypes: [...baseProps.configuredBlockTypes, 'CATEGORY_AD'],
            contentBlocks: [categoryAdBlock],
        });

        expect(markup).toContain('class="section-header-end-subtitle">右侧副标题</p>');
        expect(markup).not.toContain('不应显示的按钮文案');
    });
});

describe('HomePage featured collection', () => {
    const featuredProduct: Product = {
        ...product,
        name: 'Codex-Plus成品号',
        description: '这是一段会在移动端限制为两行的商品描述。',
        collections: [{ id: 'collection-1', name: 'GPT-Plus', slug: 'gpt-plus', parentId: '' }],
        variants: [
            {
                id: 'variant-1',
                name: 'Codex-Plus成品号',
                sku: 'CODEX-PLUS',
                priceWithTax: 14000,
                currencyCode: 'CNY',
                stockLevel: 'IN_STOCK',
                featuredAsset: null,
                product: { id: product.id, name: product.name, featuredAsset: null },
                customFields: { fulfillmentType: 'digital' },
            },
        ],
    };
    const featuredCollectionBlock: StorefrontContentBlock = {
        ...heroBlock,
        id: 'featured-collection-1',
        code: 'homepage-featured-collection',
        type: 'FEATURED_COLLECTION',
        position: 4,
        imageUrl: null,
        title: '推荐集合',
        subtitle: '',
        body: '',
        ctaLabel: '',
        settings: { displayCount: 4, selectedProductIds: [featuredProduct.id] },
        items: [],
    };

    it('labels the horizontal product track and keeps the compact mobile layout rules', () => {
        const markup = renderHome({
            configuredBlockTypes: [...baseProps.configuredBlockTypes, 'FEATURED_COLLECTION'],
            contentBlocks: [featuredCollectionBlock],
            managedContentProducts: [featuredProduct],
        });
        const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

        expect(markup).toContain('aria-label="推荐集合，左右滑动查看更多商品"');
        expect(markup).toContain('Codex-Plus成品号');
        expect(stylesheet).toMatch(
            /\.featured-collection-intro\s*\{[^}]*min-height:\s*156px;[^}]*padding:\s*20px;/,
        );
        expect(stylesheet).toMatch(
            /\.featured-collection-track\s*\{[^}]*grid-auto-columns:\s*clamp\(248px, calc\(100vw - 64px\), 360px\);[^}]*scroll-snap-type:\s*inline mandatory;/,
        );
        expect(stylesheet).toMatch(
            /\.featured-collection-product-copy small\s*\{[^}]*-webkit-line-clamp:\s*2;/,
        );
    });
});
