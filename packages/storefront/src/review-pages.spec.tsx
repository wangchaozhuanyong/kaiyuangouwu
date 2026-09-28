// @vitest-environment jsdom
/* eslint-disable import/order -- prettier-plugin-organize-imports places type-only imports after runtime imports. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ShopApi } from './api';
import type { ActiveCustomer, MarketConfig, StorefrontReviewCandidate } from './types';

import { languageCodeFor } from './i18n';
import { storefrontQueryKeys } from './query-client';
import { ReviewCenterPage } from './review-pages';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('product review rating', () => {
    it('does not submit a review until the buyer chooses a rating', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const submitReview = vi.fn();
        const candidate = {
            orderLineId: 'line-1',
            orderId: 'order-1',
            orderCode: 'QA-ORDER',
            orderState: 'Delivered',
            productId: 'product-1',
            productVariantId: 'variant-1',
            productName: 'QA 商品',
            variantName: 'QA 商品',
            sku: 'QA-SKU',
            fulfillmentType: 'physical',
            imageUrl: null,
        } satisfies StorefrontReviewCandidate;
        const api = {
            myReviews: vi.fn().mockResolvedValue([]),
            reviewCandidates: vi.fn().mockResolvedValue([candidate]),
            submitReview,
        } as unknown as ShopApi;
        const customer = {
            id: 'customer-1',
            firstName: 'QA',
            lastName: 'Tester',
            emailAddress: 'qa@example.invalid',
            phoneNumber: null,
            addresses: [],
            orders: { items: [], totalItems: 0 },
        } satisfies ActiveCustomer;
        const market = {
            code: 'sim',
            defaultLanguageCode: 'zh_Hans',
            currencyCode: 'CNY',
            countryCode: 'CN',
            locale: 'zh-CN',
            label: 'QA',
        } as MarketConfig;
        const marketCode = storefrontQueryKeys.market(market);
        const languageCode = languageCodeFor('zh');
        client.setQueryData(storefrontQueryKeys.customerReviews(marketCode, languageCode, customer.id), []);
        client.setQueryData(storefrontQueryKeys.reviewCandidates(marketCode, languageCode, customer.id), {
            pages: [[candidate]],
            pageParams: [0],
        });
        const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: vi.fn(),
        });
        try {
            act(() => {
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
            expect(host.querySelector('.review-candidate-row')).not.toBeNull();
            act(() => {
                host.querySelector<HTMLButtonElement>('.review-candidate-row')?.click();
            });
            expect(host.querySelector('.review-submit')).not.toBeNull();
            expect(host.querySelectorAll('.review-rating-input button[aria-pressed="true"]')).toHaveLength(0);
            act(() => {
                host.querySelector<HTMLButtonElement>('.review-submit')?.click();
            });
            expect(submitReview).not.toHaveBeenCalled();
            expect(host.querySelector('[role="alert"]')?.textContent).toContain('请先选择商品评分');
            act(() => {
                host.querySelector<HTMLButtonElement>(
                    '.review-rating-input button[aria-label="4 星"]',
                )?.click();
            });
            expect(
                host
                    .querySelector<HTMLButtonElement>('.review-rating-input button[aria-pressed="true"]')
                    ?.getAttribute('aria-label'),
            ).toBe('4 星');
        } finally {
            act(() => root.unmount());
            client.clear();
            host.remove();
            if (scrollIntoView) {
                Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView);
            } else {
                Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
            }
        }
    });
});
