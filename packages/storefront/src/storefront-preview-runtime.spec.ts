// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installStorefrontPreviewRuntime } from './storefront-preview-runtime';

const nativeFetch = window.fetch.bind(window);

afterEach(() => {
    window.fetch = nativeFetch;
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
});

describe('storefront preview runtime', () => {
    it('provides independent category columns and distinct catalog pages for local scroll acceptance', async () => {
        const fallbackFetch = vi.fn();
        window.fetch = fallbackFetch;
        window.history.replaceState(
            {},
            '',
            '/?storefrontPreviewEmbedded=1&storefrontPreviewScenario=catalog-scroll',
        );
        installStorefrontPreviewRuntime();
        const fetchPage = async (skip: number) => {
            const response = await window.fetch('/shop-api', {
                body: JSON.stringify({
                    query: 'storefrontCatalog',
                    variables: { input: { skip, take: 12 } },
                }),
            });
            return (await response.json()).data;
        };
        const first = await fetchPage(0);
        const second = await fetchPage(12);
        expect(first.collections.items[0].children).toHaveLength(22);
        expect(first.storefrontCatalog.items).toHaveLength(12);
        expect(first.storefrontCatalog.totalItems).toBe(36);
        expect(second.storefrontCatalog.items[0].id).not.toBe(first.storefrontCatalog.items[0].id);
        expect(fallbackFetch).not.toHaveBeenCalled();
    });
    it('isolates digital deliveries, returns and review history in the aftercare sample', async () => {
        const fallbackFetch = vi.fn();
        window.fetch = fallbackFetch;
        window.history.replaceState(
            {},
            '',
            '/?storefrontPreviewEmbedded=1&storefrontPreviewAuth=authenticated&storefrontPreviewScenario=aftercare',
        );
        installStorefrontPreviewRuntime();
        const { data } = await (await window.fetch('/shop-api')).json();
        expect(data.order.digitalDeliveries).toHaveLength(2);
        expect(data.order.autoCardDeliveries).toHaveLength(2);
        expect(data.order.manualDigitalDeliveries).toHaveLength(3);
        expect(data.storefrontOrderByConfirmationToken.id).toBe(data.order.id);
        expect(data.myAfterSalesRequests).toHaveLength(4);
        expect(data.myStorefrontReviews).toHaveLength(3);
        expect(data.myReferralOverview.ledger).toHaveLength(12);
        expect(data.referralProgram.enabled).toBe(true);
        expect(fallbackFetch).not.toHaveBeenCalled();
    });

    it('isolates long-content samples from normal data and real API requests', async () => {
        const fallbackFetch = vi.fn();
        window.fetch = fallbackFetch;
        window.history.replaceState(
            {},
            '',
            '/?storefrontPreviewEmbedded=1&storefrontPreviewAuth=authenticated&storefrontPreviewScenario=dense',
        );
        installStorefrontPreviewRuntime();
        const { data } = await (await window.fetch('/shop-api')).json();
        expect(data.storefrontCart.lines).toHaveLength(3);
        expect(data.storefrontCart.checkoutOrder.totalQuantity).toBe(6);
        expect(data.activeCustomer.orders.items).toHaveLength(4);
        expect(data.activeCustomer.addresses).toHaveLength(3);
        expect(data.order.fulfillments[0].trackingCode.length).toBeGreaterThan(32);
        expect(data.products.items[1].name.length).toBeGreaterThan(80);
        expect(fallbackFetch).not.toHaveBeenCalled();

        window.fetch = fallbackFetch;
        window.history.replaceState(
            {},
            '',
            '/?storefrontPreviewEmbedded=1&storefrontPreviewAuth=authenticated',
        );
        installStorefrontPreviewRuntime();
        const normal = await (await window.fetch('/shop-api')).json();
        expect(normal.data.storefrontCart.lines).toHaveLength(1);
        expect(normal.data.activeCustomer.orders.items).toHaveLength(0);
        expect(normal.data.product.name).toBe('日常随行杯');
    });

    it('serves the selected read-only fixture without contacting the local Shop API', async () => {
        const fallbackFetch = vi.fn(() => Promise.resolve(new Response('external')));
        window.fetch = fallbackFetch;
        window.history.replaceState(
            {},
            '',
            '/?storefrontPreviewEmbedded=1&storefrontPreviewPreset=neo-minimalist&storefrontPreviewAuth=guest',
        );

        installStorefrontPreviewRuntime();
        const response = await window.fetch('/shop-api', { method: 'POST' });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.data.storefrontVisualPreset.presetId).toBe('neo-minimalist');
        expect(payload.data.activeCustomer).toBeNull();
        expect(fallbackFetch).not.toHaveBeenCalled();
    });

    it('does not intercept non-preview pages or unrelated requests', async () => {
        const fallbackFetch = vi.fn(() => Promise.resolve(new Response('external')));
        window.fetch = fallbackFetch;
        window.history.replaceState({}, '', '/');

        installStorefrontPreviewRuntime();
        await window.fetch('/shop-api', { method: 'POST' });

        expect(fallbackFetch).toHaveBeenCalledOnce();
    });

    it('matches both current coupon page responses so an empty preview does not become an API error', async () => {
        const fallbackFetch = vi.fn();
        window.fetch = fallbackFetch;
        window.history.replaceState(
            {},
            '',
            '/?storefrontPreviewEmbedded=1&storefrontPreviewAuth=authenticated',
        );
        installStorefrontPreviewRuntime();

        const payload = await (await window.fetch('/shop-api', { method: 'POST' })).json();
        expect(payload.data.myStorefrontCoupons).toEqual([]);
        expect(payload.data.myStorefrontCouponUsageRecords).toEqual([]);
        expect(payload.data.myStorefrontCouponsPage).toEqual({ items: [], totalItems: 0 });
        expect(payload.data.myStorefrontCouponUsageRecordsPage).toEqual({ items: [], totalItems: 0 });
        expect(fallbackFetch).not.toHaveBeenCalled();
    });

    it('supplies review, order and order-count contracts for account page acceptance', async () => {
        const fallbackFetch = vi.fn();
        window.fetch = fallbackFetch;
        window.history.replaceState(
            {},
            '',
            '/?storefrontPreviewEmbedded=1&storefrontPreviewAuth=authenticated',
        );
        installStorefrontPreviewRuntime();

        const { data } = await (await window.fetch('/shop-api', { method: 'POST' })).json();
        expect(data.myStorefrontReviews).toEqual([]);
        expect(data.myStorefrontReviewCandidates).toHaveLength(1);
        expect(data.myStorefrontReviewCandidates[0].orderLineId).toBe('qa-review-line');
        expect(data.myAfterSalesRequests).toEqual([]);
        expect(data.order.id).toBe('order-1');
        expect(data.activeCustomer.pending.totalItems).toBe(0);
        expect(data.activeCustomer.shipping.totalItems).toBe(0);
        expect(data.activeCustomer.receiving.totalItems).toBe(0);
        expect(fallbackFetch).not.toHaveBeenCalled();
    });

    it('returns a valid bodyless realtime response instead of throwing inside the preview fetch shim', async () => {
        const fallbackFetch = vi.fn();
        window.fetch = fallbackFetch;
        window.history.replaceState({}, '', '/?storefrontPreviewEmbedded=1');
        installStorefrontPreviewRuntime();

        const response = await window.fetch('/storefront-realtime');
        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
        expect(fallbackFetch).not.toHaveBeenCalled();
    });
});
