// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- Async mocks match the review API contract. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { ProductReviewsSection, ReviewCenterPage } from './review-pages';
import { ActiveCustomer, MarketConfig, StorefrontReview, StorefrontReviewCandidate } from './types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const market = {
    code: 'store-a',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
} as MarketConfig;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
    act(() => root.unmount());
    client.clear();
    host.remove();
});

function button(label: string): HTMLButtonElement {
    const element = Array.from(host.querySelectorAll('button')).find(item =>
        item.textContent?.includes(label),
    );
    if (!element) throw new Error(`Missing button: ${label}`);
    return element;
}

it('shows old-order candidate images from the review API and loads the next page', async () => {
    const candidate = (index: number): StorefrontReviewCandidate => ({
        orderLineId: `line-${index}`,
        orderId: `order-${index}`,
        orderCode: `ORDER-${index}`,
        orderState: 'Delivered',
        productId: `product-${index}`,
        productVariantId: `variant-${index}`,
        productName: `商品 ${index}`,
        variantName: `商品 ${index}`,
        sku: `SKU-${index}`,
        unitPriceWithTax: 81000,
        currencyCode: 'MYR',
        fulfillmentType: 'physical',
        imageUrl: `/assets/preview/older-order-${index}.webp`,
    });
    const firstPage = Array.from({ length: 20 }, (_, index) => candidate(index + 1));
    const reviewCandidates = vi.fn(async ({ skip }: { skip: number }) =>
        skip === 0 ? firstPage : [candidate(21)],
    );
    const api = { myReviews: vi.fn(async () => []), reviewCandidates } as unknown as ShopApi;
    const customer: ActiveCustomer = {
        id: 'customer-a',
        firstName: '顾',
        lastName: '客',
        emailAddress: 'customer@example.test',
        phoneNumber: null,
        addresses: [],
        orders: { items: [], totalItems: 25 },
    };

    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                <ReviewCenterPage
                    api={api}
                    customer={customer}
                    market={market}
                    language="zh"
                    onBack={vi.fn()}
                    onProduct={vi.fn()}
                    onShop={vi.fn()}
                    onSignIn={vi.fn()}
                    onNotify={vi.fn()}
                />
            </QueryClientProvider>,
        );
    });
    await act(() => vi.waitFor(() => expect(host.textContent).toContain('查看其余商品')));
    expect(host.querySelector('.review-section-count')?.textContent).toContain('20+');
    expect(host.querySelector<HTMLImageElement>('.review-candidate-image img')?.src).toContain(
        'older-order-1.webp',
    );
    await act(async () => button('查看其余商品').click());
    await act(async () => {
        button('加载更多商品').click();
    });
    await act(() => vi.waitFor(() => expect(host.textContent).toContain('商品 21')));
    expect(reviewCandidates).toHaveBeenLastCalledWith({ skip: 20, take: 20 }, expect.any(AbortSignal));
});

it('loads every approved product review page instead of stopping after twenty', async () => {
    const review = (index: number): StorefrontReview => ({
        id: `review-${index}`,
        createdAt: '2026-09-28T00:00:00.000Z',
        updatedAt: '2026-09-28T00:00:00.000Z',
        state: 'APPROVED',
        rating: 5,
        title: `评价 ${index}`,
        body: `真实体验 ${index}`,
        images: [],
        customerName: '顾客',
        anonymous: false,
        productName: '商品',
        sku: 'SKU',
        merchantResponse: null,
        moderatedAt: null,
        verifiedPurchase: true,
    });
    const productReviews = vi.fn(async (_productId: string, options: { skip: number }) => ({
        items:
            options.skip === 0 ? Array.from({ length: 20 }, (_, index) => review(index + 1)) : [review(21)],
        totalItems: 21,
        averageRating: 5,
    }));
    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                <ProductReviewsSection
                    api={{ productReviews } as unknown as ShopApi}
                    productId="product-a"
                    market={market}
                    language="zh"
                />
            </QueryClientProvider>,
        );
    });
    await act(() =>
        vi.waitFor(() => expect(host.querySelectorAll('.product-review-list article')).toHaveLength(20)),
    );
    await act(async () => {
        button('查看更多评价').click();
    });
    await act(() =>
        vi.waitFor(() => expect(host.querySelectorAll('.product-review-list article')).toHaveLength(21)),
    );
    expect(productReviews).toHaveBeenLastCalledWith(
        'product-a',
        { skip: 20, take: 20 },
        expect.any(AbortSignal),
    );
});
