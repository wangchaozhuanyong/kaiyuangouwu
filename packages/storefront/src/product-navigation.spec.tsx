import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { minimumProductPrice } from './catalog-page-utils';
import { ProductCard } from './components/common/product-card';
import { buildProductRowSmartInfo, ProductRow } from './components/common/product-row';
import { ProductDetailPage } from './pages/product-detail-page';
import { SharePosterModal } from './share-poster-modal';
import { ProductDetailPageContext } from './storefront-page-contexts';
import { productImage as displayProductImage, formatMoney } from './storefront-ui/product-display';
import { ProductGallery } from './storefront-ui/product-gallery';
import { productImage as metadataProductImage } from './storefront-utils';
import { readStorefrontStylesheet } from './test-stylesheet';
import { MarketConfig, Product } from './types';

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { back: vi.fn() } }),
}));

vi.mock('./review-pages', () => ({ ProductReviewsSection: () => null }));

const market: MarketConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

function stylesheetRule(stylesheet: string, selector: string): string {
    return stylesheet.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

const digitalProduct: Product = {
    id: 'product-1',
    createdAt: '2026-08-25T00:00:00.000Z',
    name: 'ChatGPT Plus 成品号',
    slug: 'chatgpt-plus',
    description: '数字商品',
    featuredAsset: null,
    assets: [],
    collections: [],
    variants: [
        {
            id: 'variant-1',
            name: '默认规格',
            sku: 'CHATGPT-PLUS',
            priceWithTax: 9900,
            currencyCode: 'MYR',
            saleableStockLevel: null,
            featuredAsset: null,
            product: { id: 'product-1', name: 'ChatGPT Plus 成品号', featuredAsset: null },
            autoCardAvailableStock: 10,
            customFields: {
                fulfillmentType: 'digital',
                digitalDeliveryMode: 'auto_card',
            },
        },
    ],
};

describe('product image navigation layers', () => {
    it('shows distinct prices and stock for variants with the same name', () => {
        const product: Product = {
            ...digitalProduct,
            variants: [
                { ...digitalProduct.variants[0], id: 'available', priceWithTax: 1800 },
                {
                    ...digitalProduct.variants[0],
                    id: 'sold-out',
                    priceWithTax: 18500,
                    autoCardAvailableStock: 0,
                },
            ],
        };
        const markup = renderToStaticMarkup(
            <ProductDetailPageContext.Provider
                value={{
                    product,
                    market,
                    locale: market.locale,
                    language: 'zh',
                    products: [],
                    flashSaleItems: [
                        {
                            productId: product.id,
                            productVariantId: 'available',
                            productName: product.name,
                            variantName: product.variants[0].name,
                            originalPrice: 1800,
                            salePrice: 1600,
                            currencyCode: 'MYR',
                            imageUrl: null,
                        },
                    ],
                    couponCampaigns: [],
                    customerCoupons: [],
                    storefrontName: 'Store',
                    cartQuantity: 0,
                    api: {} as import('./api').ShopApi,
                    logoUrl: null,
                    favorite: false,
                    onAdd: vi.fn(),
                    onBuyNow: vi.fn(),
                    onFavorite: vi.fn(),
                    onNotify: vi.fn(),
                    addingVariantId: null,
                }}
            >
                <ProductDetailPage />
            </ProductDetailPageContext.Provider>,
        );
        expect(markup).toContain('detail-variant-grid');
        expect(markup).toContain(formatMoney(1600, 'MYR', market.locale));
        expect(markup).toContain(formatMoney(18500, 'MYR', market.locale));
        expect(markup).toContain('库存 10');
        expect(markup).toContain('已售罄');
        expect(markup).toContain('detail-variant-choice is-active" aria-pressed="true"');
    });

    it.each(['parent', 'child', 'grandchild', 'unrelated'])(
        'shows a category coupon price only for a product in the selected %s category tree',
        collectionId => {
            const markup = renderToStaticMarkup(
                <ProductDetailPageContext.Provider
                    value={{
                        product: {
                            ...digitalProduct,
                            variants: digitalProduct.variants.map(variant => ({
                                ...variant,
                                storeCouponCollectionIds: ['parent', 'child', 'grandchild'],
                            })),
                            collections: [
                                {
                                    id: 'grandchild',
                                    name: '下级分类',
                                    slug: 'grandchild',
                                    parentId: 'child',
                                },
                            ],
                        },
                        market,
                        locale: market.locale,
                        language: 'zh',
                        products: [],
                        flashSaleItems: [],
                        couponCampaigns: [
                            {
                                id: 'category-coupon',
                                name: '分类八折',
                                kind: 'COLLECTION_PERCENTAGE',
                                startsAt: null,
                                endsAt: null,
                                claimStartsAt: null,
                                claimEndsAt: null,
                                validityDays: null,
                                minimumSpend: 0,
                                currencyCode: 'MYR',
                                discountAmount: null,
                                discountRate: 8,
                                collectionIds: [collectionId],
                                productVariantIds: [],
                                remainingIssueCount: null,
                                claimed: false,
                                claimable: true,
                            },
                        ],
                        customerCoupons: [],
                        storefrontName: 'Store',
                        cartQuantity: 0,
                        api: {} as import('./api').ShopApi,
                        logoUrl: null,
                        favorite: false,
                        onAdd: vi.fn(),
                        onBuyNow: vi.fn(),
                        onFavorite: vi.fn(),
                        onNotify: vi.fn(),
                        addingVariantId: null,
                    }}
                >
                    <ProductDetailPage />
                </ProductDetailPageContext.Provider>,
            );
            if (collectionId === 'unrelated') {
                expect(markup).not.toContain('查看优惠券，券后价');
            } else {
                expect(markup).toMatch(/aria-label="查看优惠券，券后价 MYR\s79\.2"/u);
            }
        },
    );

    it('keeps product artwork square without a padded desktop frame', () => {
        const markup = renderToStaticMarkup(
            <ProductCard
                product={digitalProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );

        expect(markup).toContain('product-card-media');
        expect(markup).not.toContain('min-[900px]:aspect-[4/3]');
        expect(markup).not.toContain('min-[900px]:p-3');
        const styles = readStorefrontStylesheet(['./styles/product-card.css']);
        expect(styles).toContain('aspect-ratio: var(--product-media-ratio);');
        expect(styles).toContain('object-fit: contain;');
        expect(styles).not.toMatch(/\.product-card-media[^}]*scale\(/);
    });

    it('shows the cheapest variant on both product cards and defaults detail to that variant', () => {
        const base = digitalProduct.variants[0];
        const product: Product = {
            ...digitalProduct,
            variants: [
                { ...base, id: 'expensive', priceWithTax: 24000, autoCardAvailableStock: 0 },
                { ...base, id: 'cheapest', priceWithTax: 1700, autoCardAvailableStock: 0 },
                { ...base, id: 'available', priceWithTax: 2000, autoCardAvailableStock: 6 },
            ],
        };
        const props = { product, market, locale: market.locale, language: 'zh' as const, onOpen: vi.fn() };
        const card = renderToStaticMarkup(<ProductCard {...props} />);
        const row = renderToStaticMarkup(<ProductRow {...props} />);
        const detail = (initialVariantId?: string) =>
            renderToStaticMarkup(
                <ProductDetailPageContext.Provider
                    value={{
                        ...props,
                        initialVariantId,
                        products: [],
                        flashSaleItems: [],
                        couponCampaigns: [],
                        customerCoupons: [],
                        storefrontName: 'Store',
                        cartQuantity: 0,
                        api: {} as import('./api').ShopApi,
                        logoUrl: null,
                        favorite: false,
                        onAdd: vi.fn(),
                        onBuyNow: vi.fn(),
                        onFavorite: vi.fn(),
                        onNotify: vi.fn(),
                        addingVariantId: null,
                    }}
                >
                    <ProductDetailPage />
                </ProductDetailPageContext.Provider>,
            );

        expect(minimumProductPrice(product)).toBe(1700);
        for (const markup of [card, row]) {
            expect(markup.replace(/<[^>]*>/gu, '').replaceAll('&nbsp;', ' ')).toMatch(/MYR\s*17\b/u);
            expect(markup).toContain('部分规格有货');
            expect(markup).not.toContain('已售罄');
        }
        expect(detail()).toMatch(/class="detail-price"[^>]*><strong>MYR[^<]*17\b/u);
        expect(detail('available')).toMatch(/class="detail-price"[^>]*><strong>MYR[^<]*20\b/u);
    });

    it('renders the same cover in cards, rows, detail, sharing and metadata when the gallery starts elsewhere', () => {
        const cover = { id: 'cover', preview: '/assets/preview/current-cover.png' };
        const detail = { id: 'detail', preview: '/assets/preview/previous-cover.png' };
        const product = { ...digitalProduct, featuredAsset: cover, assets: [detail, cover] };
        const commonProps = {
            product,
            market,
            locale: market.locale,
            language: 'zh' as const,
            onOpen: vi.fn(),
        };
        const card = renderToStaticMarkup(<ProductCard {...commonProps} />);
        const row = renderToStaticMarkup(<ProductRow {...commonProps} />);
        const gallery = renderToStaticMarkup(<ProductGallery product={product} language="zh" />);
        const page = renderToStaticMarkup(
            <ProductDetailPageContext.Provider
                value={{
                    ...commonProps,
                    products: [],
                    flashSaleItems: [],
                    couponCampaigns: [],
                    customerCoupons: [],
                    storefrontName: 'Store',
                    cartQuantity: 0,
                    api: {} as import('./api').ShopApi,
                    logoUrl: null,
                    favorite: false,
                    onAdd: () => undefined,
                    onBuyNow: () => undefined,
                    onFavorite: () => undefined,
                    onNotify: () => undefined,
                    addingVariantId: null,
                }}
            >
                <ProductDetailPage />
            </ProductDetailPageContext.Provider>,
        );
        const poster = renderToStaticMarkup(
            <SharePosterModal
                product={product}
                storefrontName="Store"
                logoUrl={null}
                language="zh"
                formattedPrice="¥99"
                onClose={vi.fn()}
                onNotify={vi.fn()}
            />,
        );

        for (const markup of [card, row, poster]) {
            expect(markup).toContain('/assets/preview/current-cover.png');
            expect(markup).not.toContain('/assets/preview/previous-cover.png');
        }
        for (const markup of [gallery, page]) {
            const mainImage = markup.match(/<section class="detail-gallery">[\s\S]*?<\/section>/)?.[0];
            expect(mainImage).toContain('/assets/preview/current-cover.png');
            expect(mainImage).not.toContain('/assets/preview/previous-cover.png');
            expect(markup).toContain('/assets/preview/previous-cover.png');
        }
        expect(page).not.toContain('detail-description-media');
        expect(gallery).toContain('查看第2张商品图');
        expect(gallery).not.toContain('查看第3张商品图');
        expect(displayProductImage(product)).toBe(cover.preview);
        expect(metadataProductImage(product)).toBe(cover.preview);
    });

    it('renders a separately managed cover and a safe empty gallery', () => {
        const coverOnly = { ...digitalProduct, featuredAsset: { id: 'cover', preview: '/cover.png' } };
        const markup = renderToStaticMarkup(<ProductGallery product={coverOnly} language="zh" />);
        expect(markup).toContain('/cover.png');
        expect(markup).not.toContain('detail-gallery-thumbnails');

        const empty = renderToStaticMarkup(<ProductGallery product={digitalProduct} language="zh" />);
        expect(empty).toContain('image-placeholder');
        expect(empty).not.toContain('gallery-count');
        expect(empty).not.toContain('<img');
    });

    it('derives compact one-line product information from fulfillment and warranty data', () => {
        const info = buildProductRowSmartInfo(
            { ...digitalProduct, description: 'ChatGPT Plus 正规渠道，质保一个月' },
            'zh',
        );

        expect(info).toEqual({
            primary: '数字商品 · 邮箱自动发货',
            secondary: '质保一个月',
        });
    });

    it('renders clean flush-left fulfillment badge without pill background in ProductCard', () => {
        const physicalProduct: Product = {
            ...digitalProduct,
            variants: [
                {
                    ...digitalProduct.variants[0],
                    customFields: {
                        fulfillmentType: 'physical',
                        digitalDeliveryMode: undefined,
                    },
                },
            ],
        };
        const markup = renderToStaticMarkup(
            <ProductCard
                product={physicalProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );

        expect(markup).toContain('product-card-delivery');
        expect(markup).not.toContain('bg-[var(--accent-soft)]');
        expect(markup).toContain('实物商品 · 需要配送');
    });

    it('does not cover manual digital product images with a delivery badge', () => {
        const manualServiceProduct: Product = {
            ...digitalProduct,
            variants: [
                {
                    ...digitalProduct.variants[0],
                    customFields: {
                        ...digitalProduct.variants[0].customFields,
                        digitalDeliveryMode: 'manual_service',
                    },
                },
            ],
        };
        const markup = renderToStaticMarkup(
            <ProductCard
                product={manualServiceProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );

        expect(markup).not.toContain('人工数字服务');
        expect(markup).toContain('不限库存');
    });

    it('keeps the full-card link and favorite action without rendering quick add controls', () => {
        const markup = renderToStaticMarkup(
            <ProductCard
                product={digitalProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
                onFavorite={vi.fn()}
            />,
        );

        expect(markup).toContain('product-card-detail-link');
        expect(markup).toContain('product-card-favorite');
        expect(markup).toContain('aria-label="收藏 ChatGPT Plus 成品号"');
        expect(markup).toContain('ai-product-cover');
        expect(markup).toContain('库存 10');
        expect(markup).not.toContain('加入购物车');
        expect(markup).not.toContain('含税');
    });

    it('keeps list-row content inside the navigation link without add buttons', () => {
        const markup = renderToStaticMarkup(
            <ProductRow
                product={digitalProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );
        const stylesheet = readStorefrontStylesheet();

        expect(markup).toContain('product-row-detail-link');
        expect(markup).toContain('ai-product-cover');
        expect(markup).toContain('库存 10');
        expect(markup).not.toContain('加入购物车');
        expect(markup).toMatch(
            /<a[^>]*product-row-detail-link[^>]*href="\/product\?id=[^"]+"[^>]*>[\s\S]*ai-product-cover[\s\S]*<\/a>/,
        );
        expect(stylesheet).not.toMatch(
            /\.product-row-detail-link\s*\{[^}]*(?:position:\s*absolute|z-index:)/,
        );
        expect(stylesheet).not.toMatch(/\.row-add\s*\{/);
    });

    it('keeps list-row prices inline instead of applying copy layout to nested price spans', () => {
        const markup = renderToStaticMarkup(
            <ProductRow
                product={digitalProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );
        const stylesheet = readStorefrontStylesheet();

        expect(markup).toContain('price-lockup');
        expect(stylesheet).toMatch(/\.price-lockup\s*\{[^}]*display:\s*inline-flex;/);
        expect(stylesheet).toMatch(/\.product-row-desc\s*\{/);
        expect(stylesheet).not.toMatch(/\.product-row\s+span\s*,\s*\.product-row\s+small\s*\{/);
    });

    it('shows sold-out status with a wrapping title and compact description', () => {
        const soldOutProduct: Product = {
            ...digitalProduct,
            name: 'A very long product title that must remain on one line',
            variants: [{ ...digitalProduct.variants[0], autoCardAvailableStock: 0 }],
        };
        const markup = renderToStaticMarkup(
            <ProductCard
                product={soldOutProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );

        expect(markup).toContain('已售罄');
        expect(markup).toContain('product-card-stock is-sold-out');
        expect(markup).toContain('product-card-subtitle');
        expect(markup).toContain('product-card-name');
    });

    it('does not use the internal SKU as customer-facing fallback copy', () => {
        const productWithoutDescription = { ...digitalProduct, description: '' };
        const cardMarkup = renderToStaticMarkup(
            <ProductCard
                product={productWithoutDescription}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );
        const rowMarkup = renderToStaticMarkup(
            <ProductRow
                product={productWithoutDescription}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );

        expect(cardMarkup).not.toContain('CHATGPT-PLUS');
        expect(rowMarkup).not.toContain('CHATGPT-PLUS');
    });

    it('uses the active content language instead of the currency locale for stock labels', () => {
        const soldOutProduct: Product = {
            ...digitalProduct,
            variants: [{ ...digitalProduct.variants[0], autoCardAvailableStock: 0 }],
        };
        const markup = renderToStaticMarkup(
            <ProductCard
                product={soldOutProduct}
                market={market}
                locale="zh-CN"
                language="en"
                onOpen={vi.fn()}
            />,
        );

        expect(markup).toContain('Sold out');
        expect(markup).not.toContain('已售罄');
    });

    it('ensures product detail header has transparent background, dark frosted buttons and no blur when unscrolled', () => {
        const stylesheet = readStorefrontStylesheet();

        expect(stylesheet).toMatch(/\.subpage\s*\{[^}]*overflow-x:\s*clip;/);
        expect(stylesheet).toMatch(/\.topbar\.product-detail-header[\s\S]*?background:\s*transparent;/);
        expect(stylesheet).toMatch(/\.topbar\.product-detail-header[\s\S]*?backdrop-filter:\s*none;/);
        expect(stylesheet).toMatch(/\.topbar\.product-detail-header[\s\S]*?margin-bottom:\s*-52px;/);
        expect(stylesheet).toMatch(
            /\.topbar\.product-detail-header\s+button[\s\S]*?background:\s*rgba\(24,\s*28,\s*26,\s*0\.46\);/,
        );
        expect(stylesheet).toMatch(
            /\.topbar\.product-detail-header\.is-scrolled[\s\S]*?background:\s*rgba\(255,\s*255,\s*255,\s*0\.96\);/,
        );
    });

    it('uses the same detail header state rules for every skin', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/visual-presets.css']);

        expect(stylesheet).not.toMatch(
            /html\[data-storefront-preset='modern-oriental'\]\s+\.product-detail-header/,
        );
        expect(stylesheet).not.toMatch(
            /html\[data-storefront-preset\]\s+:is\(\s*\.topbar:not\(\.product-detail-header\)/,
        );
        expect(stylesheet).toMatch(/\.topbar\s*\{[^}]*background:\s*var\(--surface\);/);
    });

    it('uses a compact borderless desktop product toolbar instead of a tall mobile-style title band', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/desktop-pages.css']);
        const toolbarRule = stylesheetRule(
            stylesheet,
            String.raw`\.desktop-store-layout\s+\.desktop-product-toolbar`,
        );
        const shareRule = stylesheetRule(
            stylesheet,
            String.raw`\.desktop-store-layout\s+\.desktop-product-toolbar-share`,
        );

        expect(toolbarRule).toMatch(/min-height:\s*40px;/);
        expect(toolbarRule).toMatch(/justify-content:\s*space-between;/);
        expect(shareRule).toMatch(/background:\s*var\(--accent-soft\);/);
    });

    it('keeps desktop product buying surfaces on the shared skin geometry contract', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/desktop-pages.css']);
        const priceRule = stylesheetRule(
            stylesheet,
            String.raw`\.desktop-product-buying\s+\.detail-price-line`,
        );
        const optionRule = stylesheetRule(
            stylesheet,
            String.raw`\.desktop-product-buying\s+\.detail-options\s+button`,
        );

        expect(priceRule).toMatch(/border-radius:\s*var\(--skin-control-radius\);/);
        expect(priceRule).toMatch(
            /background:\s*color-mix\(in srgb, var\(--accent\) 7%, var\(--surface-elevated, var\(--surface\)\)\);/,
        );
        expect(optionRule).toMatch(/border-radius:\s*var\(--skin-control-radius\);/);
    });

    it('aligns the text description panel with the product information navigation', () => {
        const stylesheet = readStorefrontStylesheet(['./styles/desktop-pages.css']);
        const descriptionRule = stylesheetRule(
            stylesheet,
            String.raw`\.desktop-store-layout\s+\.detail-description`,
        );
        expect(descriptionRule).toMatch(/width:\s*100%;/);
        expect(descriptionRule).toMatch(/margin-inline:\s*0;/);
        expect(descriptionRule).toMatch(/align-self:\s*stretch;/);
    });

    it('ensures product-card provides a unified card frame with background, border-radius and shadow', () => {
        const markup = renderToStaticMarkup(
            <ProductCard
                product={digitalProduct}
                market={market}
                locale={market.locale}
                language="zh"
                onOpen={vi.fn()}
            />,
        );
        expect(markup).toContain('product-card');

        const stylesheet = readStorefrontStylesheet(['./styles/product-card.css']);
        expect(stylesheet).toMatch(
            /\.product-card\s*\{[^}]*background:\s*var\(--product-card-surface,\s*var\(--surface\)\);/,
        );
        expect(stylesheet).toMatch(/\.product-card\s*\{[^}]*border-radius:\s*var\(--skin-card-radius\);/);
        expect(stylesheet).toMatch(/\.product-card\s*\{[^}]*box-shadow:\s*var\(--skin-card-shadow\);/);
    });
});
