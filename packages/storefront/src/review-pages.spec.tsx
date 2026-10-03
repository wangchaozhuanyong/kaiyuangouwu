// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- Async mocks match the review API. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { languageCodeFor } from './i18n';
import { storefrontQueryKeys } from './query-client';
import { ReviewCenterPage } from './review-pages';
import {
    ActiveCustomer,
    MarketConfig,
    StorefrontReviewCandidate,
    SubmitStorefrontReviewInput,
} from './types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const candidate: StorefrontReviewCandidate = {
    orderLineId: 'line-1',
    orderId: 'order-1',
    orderCode: 'QA-ORDER',
    orderState: 'Delivered',
    productId: 'product-1',
    productVariantId: 'variant-1',
    productName: 'QA 商品',
    variantName: 'QA 商品',
    sku: 'QA-SKU',
    unitPriceWithTax: 81000,
    currencyCode: 'MYR',
    fulfillmentType: 'physical',
    imageUrl: null,
};
const customer: ActiveCustomer = {
    id: 'customer-1',
    firstName: 'QA',
    lastName: 'Tester',
    emailAddress: 'qa@example.invalid',
    phoneNumber: null,
    addresses: [],
    orders: { items: [], totalItems: 0 },
};
const market: MarketConfig = {
    code: 'sim',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'CNY',
    countryCode: 'CN',
    locale: 'zh-CN',
    label: 'QA',
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let submitReview: ReturnType<typeof vi.fn<(input: SubmitStorefrontReviewInput) => Promise<void>>>;
let onNotify: ReturnType<typeof vi.fn<(message: string) => void>>;
let candidates: StorefrontReviewCandidate[];
let api: ShopApi;
function required<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
}
const button = (selector: string) => required<HTMLButtonElement>(selector);
const drawer = () => document.querySelector<HTMLElement>('.review-composer-sheet');
const input = () => required<HTMLInputElement>('.review-composer input:not([type])');
const body = () => required<HTMLTextAreaElement>('.review-composer textarea');
const actions = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.review-candidate-action'));
function change(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype =
        element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (!descriptor?.set) throw new Error('Native input setter missing');
    descriptor.set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
}
function render(nextCustomer = customer, nextMarket = market) {
    root.render(
        <QueryClientProvider client={client}>
            <ReviewCenterPage
                api={api}
                customer={nextCustomer}
                market={nextMarket}
                language="zh"
                onBack={vi.fn()}
                onProduct={vi.fn()}
                onShop={vi.fn()}
                onSignIn={vi.fn()}
                onNotify={onNotify}
            />
        </QueryClientProvider>,
    );
}
beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    candidates = [candidate, { ...candidate, orderLineId: 'line-2', unitPriceWithTax: 2800 }];
    submitReview = vi.fn(async () => undefined);
    onNotify = vi.fn();
    api = {
        myReviews: vi.fn(async () => []),
        reviewCandidates: vi.fn(async () => candidates),
        submitReview,
    } as unknown as ShopApi;
    const code = storefrontQueryKeys.market(market);
    const lang = languageCodeFor('zh');
    client.setQueryData(storefrontQueryKeys.customerReviews(code, lang, customer.id), []);
    client.setQueryData(storefrontQueryKeys.reviewCandidates(code, lang, customer.id), {
        pages: [candidates],
        pageParams: [0],
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    act(() => render());
});
afterEach(() => {
    act(() => root.unmount());
    client.clear();
    host.remove();
    vi.unstubAllGlobals();
});

describe('review drawer', () => {
    it('opens the correct order line and requires an explicit rating', () => {
        const rows = host.querySelectorAll('.review-candidate-row');
        expect(rows).toHaveLength(2);
        expect(host.textContent).not.toContain('QA-SKU');
        expect(rows[0].textContent).toContain('MYR 810');
        expect(rows[1].textContent).toContain('MYR 28');
        act(() => actions()[1].click());
        expect(drawer()?.dataset.side).toBe('right');
        expect(drawer()?.getAttribute('aria-modal')).toBe('true');
        expect(drawer()?.querySelector('.review-composer-summary')?.textContent).toContain('订单行 line-2');
        expect(drawer()?.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
        act(() => button('.review-submit').click());
        expect(submitReview).not.toHaveBeenCalled();
        expect(drawer()?.querySelector('[role="alert"]')?.textContent).toContain('请先选择商品评分');
    });
    it('retains separate drafts and restores focus and body scrolling after closing', () => {
        const opener = actions()[0];
        opener.focus();
        const oldOverflow = document.body.style.overflow;
        act(() => opener.click());
        act(() => {
            change(input(), '我的评价标题');
            change(body(), '这是我填写的评价内容，关闭后继续。');
            button('[aria-label="4 星"]').click();
        });
        expect(document.body.style.overflow).toBe('hidden');
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(drawer()).toBeNull();
        expect(document.activeElement).toBe(opener);
        expect(document.body.style.overflow).toBe(oldOverflow);
        act(() => actions()[1].click());
        expect(input().value).toBe('');
        act(() => button('.review-cancel').click());
        act(() => opener.click());
        expect(input().value).toBe('我的评价标题');
        expect(body().value).toContain('关闭后继续');
        expect(button('[aria-label="4 星"]').getAttribute('aria-pressed')).toBe('true');
        const close = button('.review-composer-sheet > header button');
        act(() => {
            close.focus();
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
            );
        });
        expect(document.activeElement).toBe(button('.review-submit'));
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        });
        expect(document.activeElement).toBe(close);
    });
    it('keeps a failed submission editable, prevents closing while pending, and refreshes on retry', async () => {
        let resolveSubmit!: () => void;
        submitReview.mockRejectedValueOnce(new Error('Failed to fetch')).mockImplementationOnce(
            () =>
                new Promise<void>(resolve => {
                    resolveSubmit = resolve;
                }),
        );
        act(() => actions()[0].click());
        act(() => {
            button('[aria-label="5 星"]').click();
            change(input(), '真实购买体验');
            change(body(), '包装完整，使用体验符合商品说明。');
        });
        await act(async () => button('.review-submit').click());
        expect(drawer()?.querySelector('[role="alert"]')).not.toBeNull();
        expect(input().value).toBe('真实购买体验');
        await act(async () => button('.review-submit').click());
        expect(button('.review-submit').disabled).toBe(true);
        expect(button('[aria-label="1 星"]').disabled).toBe(true);
        act(() => button('.review-composer-sheet > header button').click());
        expect(drawer()).not.toBeNull();
        candidates = candidates.slice(1);
        await act(async () => {
            resolveSubmit();
            await new Promise(resolve => setTimeout(resolve, 30));
        });
        expect(submitReview).toHaveBeenCalledTimes(2);
        expect(submitReview.mock.calls[1][0]).toMatchObject({
            orderLineId: 'line-1',
            rating: 5,
            title: '真实购买体验',
        });
        expect(drawer()).toBeNull();
        expect(actions()).toHaveLength(1);
        expect(onNotify).toHaveBeenCalledTimes(1);
    });
    it('keeps image drafts across closing and enforces the existing upload limits', () => {
        const create = vi.fn(() => 'blob:local-review-test');
        const revoke = vi.fn();
        const oldCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
        const oldRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
        try {
            act(() => actions()[0].click());
            const upload = (files: File[]) => {
                const picker = required<HTMLInputElement>('.review-image-add input');
                Object.defineProperty(picker, 'files', { configurable: true, value: files });
                act(() => {
                    picker.dispatchEvent(new Event('change', { bubbles: true }));
                });
            };
            upload(
                Array.from(
                    { length: 5 },
                    (_, index) => new File(['x'], `${index}.png`, { type: 'image/png' }),
                ),
            );
            expect(drawer()?.querySelector('[role="alert"]')?.textContent).toContain('最多上传 4 张');
            expect(create).not.toHaveBeenCalled();
            upload([new File(['x'], 'bad.txt', { type: 'text/plain' })]);
            expect(drawer()?.querySelector('[role="alert"]')?.textContent).toContain('JPG、PNG 或 WebP');
            upload([new File(['x'], 'photo.png', { type: 'image/png' })]);
            expect(drawer()?.querySelectorAll('.review-image-preview')).toHaveLength(1);
            act(() => button('.review-cancel').click());
            expect(revoke).toHaveBeenCalledWith('blob:local-review-test');
            act(() => actions()[0].click());
            expect(drawer()?.querySelectorAll('.review-image-preview')).toHaveLength(1);
            act(() => button('[aria-label="移除图片 1"]').click());
            expect(drawer()?.querySelectorAll('.review-image-preview')).toHaveLength(0);
        } finally {
            if (oldCreate) Object.defineProperty(URL, 'createObjectURL', oldCreate);
            else Reflect.deleteProperty(URL, 'createObjectURL');
            if (oldRevoke) Object.defineProperty(URL, 'revokeObjectURL', oldRevoke);
            else Reflect.deleteProperty(URL, 'revokeObjectURL');
        }
    });
    it('clears drafts when the customer changes', async () => {
        act(() => actions()[0].click());
        act(() => change(input(), '私有草稿'));
        await act(async () => {
            render({ ...customer, id: 'customer-2' });
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(drawer()).toBeNull();
        await act(async () => {
            render();
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        act(() => actions()[0].click());
        expect(input().value).toBe('');
    });
});

describe('review list navigation', () => {
    it('shows one panel and lets keyboard navigation and the empty action select the right list', async () => {
        const pending = button('#review-pending-tab');
        const submitted = button('#review-submitted-tab');
        const pendingPanel = required<HTMLElement>('#review-pending-panel');
        const submittedPanel = required<HTMLElement>('#review-submitted-panel');
        expect(pending.textContent).toBe('待评价2');
        expect(submitted.textContent).toBe('我的评价0');
        expect(pendingPanel.hidden).toBe(false);
        expect(submittedPanel.hidden).toBe(true);
        expect(host.textContent).not.toContain('选择一件商品');
        pending.focus();
        await act(() =>
            pending.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
        );
        expect(document.activeElement).toBe(submitted);
        expect(submitted.getAttribute('aria-selected')).toBe('true');
        expect(submitted.tabIndex).toBe(0);
        expect(pending.tabIndex).toBe(-1);
        expect(pendingPanel.hidden).toBe(true);
        expect(submittedPanel.hidden).toBe(false);
        expect(submittedPanel.getAttribute('aria-labelledby')).toBe(submitted.id);
        expect(submittedPanel.textContent).toContain('去评价');
        act(() => button('#review-submitted-panel .empty-state-action').click());
        expect(pendingPanel.hidden).toBe(false);
        expect(document.activeElement).toBe(pending);
        await act(() => pending.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
        expect(document.activeElement).toBe(submitted);
        await act(() =>
            submitted.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })),
        );
        expect(document.activeElement).toBe(pending);
        await act(() =>
            pending.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })),
        );
        expect(document.activeElement).toBe(submitted);
    });
});
