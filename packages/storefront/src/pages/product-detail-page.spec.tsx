// @vitest-environment jsdom
/* eslint-disable import/order -- prettier-plugin-organize-imports places type-only imports after runtime imports. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductDetailPageContext } from '../storefront-page-contexts';
import type { MarketConfig, Product, StorefrontCouponCampaign } from '../types';

import { ProductDetailPage } from './product-detail-page';

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { back: vi.fn() } }),
}));
vi.mock('../desktop-layout', () => ({ useDesktopLayout: () => true }));
vi.mock('../review-pages', () => ({ ProductReviewsSection: () => <section>真实评价内容</section> }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const market = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
} as MarketConfig;
const product = {
    id: 'product-1',
    createdAt: '2026-09-25T00:00:00.000Z',
    name: '真实商品',
    slug: 'real-product',
    description: '后台商品说明',
    assets: [],
    featuredAsset: null,
    collections: [{ id: 'category-1', name: '分类', slug: 'category', parentId: '' }],
    variants: [
        {
            id: 'available',
            name: '可购买规格',
            sku: 'AVAILABLE',
            priceWithTax: 1800,
            currencyCode: 'MYR',
            saleableStockLevel: 3,
            featuredAsset: null,
            product: { id: 'product-1', name: '真实商品', featuredAsset: null },
            customFields: { fulfillmentType: 'physical' },
        },
        {
            id: 'sold-out',
            name: '缺货规格',
            sku: 'SOLD-OUT',
            priceWithTax: 1900,
            currencyCode: 'MYR',
            saleableStockLevel: 0,
            featuredAsset: null,
            product: { id: 'product-1', name: '真实商品', featuredAsset: null },
            customFields: { fulfillmentType: 'physical' },
        },
    ],
} as Product;

describe('desktop product purchase controls', () => {
    let root: ReturnType<typeof createRoot>;
    let host: HTMLDivElement;
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it('passes the selected quantity and variant to both purchase actions and switches real content', () => {
        const onAdd = vi.fn();
        const onBuyNow = vi.fn();
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        act(() =>
            root.render(
                <ProductDetailPageContext.Provider
                    value={{
                        api: {} as never,
                        product,
                        products: [],
                        cartQuantity: 0,
                        market,
                        locale: market.locale,
                        language: 'zh',
                        storefrontName: 'Store',
                        logoUrl: null,
                        flashSaleItems: [],
                        couponCampaigns: [],
                        customerCoupons: [],
                        addingVariantId: null,
                        favorite: false,
                        onAdd,
                        onBuyNow,
                        onFavorite: vi.fn(),
                        onNotify: vi.fn(),
                    }}
                >
                    <ProductDetailPage />
                </ProductDetailPageContext.Provider>,
            ),
        );
        const button = (label: string) =>
            Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === label);
        act(() => host.querySelector<HTMLButtonElement>('[aria-label="增加数量"]')?.click());
        act(() => host.querySelector<HTMLButtonElement>('[aria-label="增加数量"]')?.click());
        expect(host.querySelector('.detail-quantity output')?.textContent).toBe('3');
        expect(host.querySelector<HTMLButtonElement>('[aria-label="增加数量"]')?.disabled).toBe(true);
        act(() => button('加入购物车')?.click());
        act(() => button('立即购买')?.click());
        expect(onAdd).toHaveBeenCalledWith(product.variants[0], 3);
        expect(onBuyNow).toHaveBeenCalledWith(product.variants[0], 3);
        act(() => host.querySelector<HTMLButtonElement>('.detail-variant-choice.is-sold-out')?.click());
        expect(host.querySelector('.detail-quantity output')?.textContent).toBe('1');
        expect(host.querySelector<HTMLButtonElement>('.detail-action-bar button:last-child')?.disabled).toBe(
            true,
        );
        act(() => button('真实评价')?.click());
        expect(host.textContent).toContain('真实评价内容');
        expect(host.querySelector('.detail-description')).toBeNull();
    });

    it('estimates a threshold coupon against the selected quantity and labels the total', () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        act(() =>
            root.render(
                <ProductDetailPageContext.Provider
                    value={{
                        api: {} as never,
                        product,
                        products: [],
                        cartQuantity: 0,
                        market,
                        locale: market.locale,
                        language: 'zh',
                        storefrontName: 'Store',
                        logoUrl: null,
                        flashSaleItems: [],
                        couponCampaigns: [
                            {
                                id: 'threshold-coupon',
                                name: '满额减免',
                                kind: 'ORDER_FIXED',
                                minimumSpend: 5_000,
                                discountAmount: 500,
                                currencyCode: 'MYR',
                                claimable: true,
                            } as StorefrontCouponCampaign,
                        ],
                        customerCoupons: [],
                        addingVariantId: null,
                        favorite: false,
                        onAdd: vi.fn(),
                        onBuyNow: vi.fn(),
                        onFavorite: vi.fn(),
                        onNotify: vi.fn(),
                    }}
                >
                    <ProductDetailPage />
                </ProductDetailPageContext.Provider>,
            ),
        );
        expect(host.querySelector('.detail-coupon-price')).toBeNull();
        act(() => host.querySelector<HTMLButtonElement>('[aria-label="增加数量"]')?.click());
        expect(host.querySelector('.detail-coupon-price')).toBeNull();
        act(() => host.querySelector<HTMLButtonElement>('[aria-label="增加数量"]')?.click());
        expect(host.querySelector('.detail-coupon-price')?.textContent).toContain('3件券后合计');
        expect(host.querySelector('.detail-coupon-price')?.textContent).toContain('49');
        expect(host.querySelector('.detail-coupon-note')?.textContent).toContain('结算页为准');
    });
});
