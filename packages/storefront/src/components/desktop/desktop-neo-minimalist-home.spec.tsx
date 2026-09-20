import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CollectionSummary, Product, StorefrontContentBlock } from '../../types';

import { DesktopNeoMinimalistHome } from './desktop-neo-minimalist-home';

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
}));

const mockProducts: Product[] = [
    {
        id: '1',
        name: 'Codex-Plu成品号',
        slug: 'codex-plu',
        description: '官方直连独享号，极速发卡',
        createdAt: '2026-09-01T00:00:00Z',
        featuredAsset: { id: 'a1', preview: 'https://img.test/codex.png' },
        assets: [],
        collections: [{ id: 'col-gpt', name: 'GPT订阅', slug: 'gpt', parentId: '' }],
        variants: [
            {
                id: 'v1',
                name: '默认规格',
                sku: 'CODEX-1',
                priceWithTax: 16800,
                currencyCode: 'CNY',
                stockLevel: 'IN_STOCK',
                featuredAsset: null,
                product: { id: '1', name: 'Codex-Plu成品号', featuredAsset: null },
                customFields: { fulfillmentType: 'digital' },
            },
        ],
    },
    {
        id: '4',
        name: '1美元Token额度',
        slug: 'token-1-usd',
        description: '小额体验API调用',
        createdAt: '2026-09-02T00:00:00Z',
        featuredAsset: null,
        assets: [],
        collections: [{ id: 'col-relay', name: '中专站充值', slug: 'relay', parentId: '' }],
        variants: [
            {
                id: 'v4',
                name: '1美元',
                sku: 'TOKEN-1',
                priceWithTax: 800,
                currencyCode: 'CNY',
                stockLevel: 'IN_STOCK',
                featuredAsset: null,
                product: { id: '4', name: '1美元Token额度', featuredAsset: null },
                customFields: { fulfillmentType: 'digital' },
            },
        ],
    },
];

const mockCollections: CollectionSummary[] = [
    {
        id: 'col-relay',
        name: '中专站充值',
        slug: 'relay',
        description: '',
        position: 1,
        parentId: '',
        featuredAsset: null,
    },
    {
        id: 'col-gpt',
        name: 'GPT订阅',
        slug: 'gpt',
        description: '',
        position: 2,
        parentId: '',
        featuredAsset: null,
    },
    {
        id: 'col-apple',
        name: '苹果ID',
        slug: 'apple',
        description: '',
        position: 3,
        parentId: '',
        featuredAsset: null,
    },
];

const mockManagedHeroes: StorefrontContentBlock[] = [
    {
        id: 'hero-1',
        code: 'HERO',
        type: 'HERO',
        enabled: true,
        position: 1,
        title: '中转站 Token 充值活动',
        subtitle: '1 / 5 / 10 美元档位，从小额体验到持续调用',
        body: '',
        imageUrl: 'https://img.test/hero.png',
        targetType: 'COLLECTION',
        targetValue: 'col-relay',
        ctaLabel: '查看充值档位',
        backgroundColor: null,
        textColor: null,
        startsAt: null,
        endsAt: null,
        items: [],
    },
];

const mockQuickLinks = [
    {
        id: 'ql-1',
        label: '中转站',
        icon: '⚡',
        disabled: false,
        onClick: vi.fn(),
    },
    {
        id: 'ql-2',
        label: '客服咨询',
        icon: '🎧',
        disabled: false,
        onClick: vi.fn(),
    },
];

describe('DesktopNeoMinimalistHome dynamic data rendering', () => {
    it('renders real products with real prices and real collection names', () => {
        const markup = renderToStaticMarkup(
            <DesktopNeoMinimalistHome
                products={mockProducts}
                collections={mockCollections}
                managedHeroes={mockManagedHeroes}
                quickLinks={mockQuickLinks}
                language="zh"
                storefrontName="MOYAO AI"
            />,
        );

        // Real products must be rendered
        expect(markup).toContain('Codex-Plu成品号');
        expect(markup).toContain('168');
        expect(markup).toContain('1美元Token额度');
        expect(markup).toContain('8');

        // Real image thumbnail must be rendered
        expect(markup).toContain('src="https://img.test/codex.png"');

        // Real collections must be rendered in category pills with counts
        expect(markup).toContain('中专站充值');
        expect(markup).toContain('GPT订阅');
        expect(markup).toContain('苹果ID');

        // Real hero content must be rendered
        expect(markup).toContain('中转站 Token 充值活动');
        expect(markup).toContain('1 / 5 / 10 美元档位，从小额体验到持续调用');
        expect(markup).toContain('查看充值档位');

        // Real quick links must be rendered
        expect(markup).toContain('中转站');
        expect(markup).toContain('客服咨询');

        // Must NOT contain hardcoded fake products or titles
        expect(markup).not.toContain('Claude 3.5 Sonnet &amp; OpenAI o3-mini');
        expect(markup).not.toContain('Cursor Pro 代码神器');
        expect(markup).not.toContain('Midjourney v6.1 标准订阅');
    });

    it('renders fallback featured product if no managed hero banner exists', () => {
        const markup = renderToStaticMarkup(
            <DesktopNeoMinimalistHome
                products={mockProducts}
                collections={mockCollections}
                managedHeroes={[]}
                language="zh"
                storefrontName="MOYAO AI"
            />,
        );

        // Uses the first product as featured
        expect(markup).toContain('Codex-Plu成品号');
        expect(markup).toContain('立即选购 ¥168');
    });
});
