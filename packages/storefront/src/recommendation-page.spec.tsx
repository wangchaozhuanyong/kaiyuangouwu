import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { RecommendationPage } from './storefront-ui/content-ui';
import { MarketConfig, Product, StorefrontContentBlock } from './types';

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
    createdAt: '2026-09-04T00:00:00.000Z',
    name: '推荐商品',
    slug: 'recommended-product',
    description: '',
    featuredAsset: null,
    assets: [],
    collections: [],
    variants: [],
};

const block: StorefrontContentBlock = {
    id: 'recommendations-1',
    code: 'homepage-recommendations',
    type: 'RECOMMENDATIONS',
    enabled: true,
    position: 0,
    startsAt: null,
    endsAt: null,
    imageUrl: null,
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    title: '猜你喜欢',
    subtitle: '',
    body: '',
    ctaLabel: '',
    items: [],
};

function renderRecommendationPage(managedBlock?: StorefrontContentBlock) {
    return renderToStaticMarkup(
        <RecommendationPage
            products={[product]}
            block={managedBlock}
            market={market}
            locale={market.locale}
            language="zh"
            onBack={vi.fn()}
            onProduct={vi.fn()}
        />,
    );
}

describe('RecommendationPage managed copy', () => {
    it('does not replace an intentionally empty Dashboard subtitle', () => {
        const markup = renderRecommendationPage(block);

        expect(markup).toContain('猜你喜欢');
        expect(markup).not.toContain('结合你的购买品类和浏览记录推荐');
    });

    it('keeps the bundled copy only for stores without a recommendations block', () => {
        expect(renderRecommendationPage()).toContain('结合你的购买品类和浏览记录推荐');
    });
});
