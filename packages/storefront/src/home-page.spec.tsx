import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { HomePage, NoticeDetailSheet } from './pages/home-page';
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

describe('HomePage notices', () => {
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
