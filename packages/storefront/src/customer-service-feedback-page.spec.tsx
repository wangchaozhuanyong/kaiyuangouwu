// @vitest-environment jsdom
/* eslint-disable import/order -- prettier-plugin-organize-imports places type-only imports after runtime imports. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopApi } from './api';
import type { ActiveCustomer, CustomerServiceFeedback, StorefrontContentBlock } from './types';

import { SupportContent } from './pages/support-page';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const content = {
    id: 'support',
    code: 'support',
    type: 'SUPPORT',
    enabled: true,
    position: 0,
    startsAt: null,
    endsAt: null,
    title: '客服中心',
    subtitle: '',
    body: '',
    imageUrl: null,
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    ctaLabel: '',
    settings: {},
    items: [],
} as StorefrontContentBlock;

const saved: CustomerServiceFeedback = {
    id: 'feedback-1',
    orderCode: null,
    rating: 5,
    tags: [],
    comment: '',
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
};

describe('customer service feedback page', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    async function render(api: ShopApi) {
        await act(async () => {
            root.render(
                <SupportContent
                    api={api}
                    customer={{ id: 'customer-1' } as ActiveCustomer}
                    content={content}
                    language="zh"
                />,
            );
            await Promise.resolve();
        });
    }

    it('waits for the server before showing a successful submission', async () => {
        let resolveSubmit: (value: CustomerServiceFeedback) => void = () => undefined;
        const submit = vi.fn(
            () =>
                new Promise<CustomerServiceFeedback>(resolve => {
                    resolveSubmit = resolve;
                }),
        );
        await render({
            contentReviewsApi: {
                myCustomerServiceFeedback: vi.fn().mockResolvedValue(null),
                submitCustomerServiceFeedback: submit,
            },
        } as unknown as ShopApi);

        await act(async () => {
            host.querySelector<HTMLButtonElement>('.support-evaluation-submit-btn')?.click();
            await Promise.resolve();
        });
        expect(submit).toHaveBeenCalledOnce();
        expect(host.textContent).not.toContain('已收到您的服务评价');
        await act(async () => {
            resolveSubmit(saved);
            await Promise.resolve();
        });
        expect(host.textContent).toContain('已收到您的服务评价');
    });

    it('keeps the form open when the server rejects the submission', async () => {
        await render({
            contentReviewsApi: {
                myCustomerServiceFeedback: vi.fn().mockResolvedValue(null),
                submitCustomerServiceFeedback: vi.fn().mockRejectedValue(new Error('offline')),
            },
        } as unknown as ShopApi);

        await act(async () => {
            host.querySelector<HTMLButtonElement>('.support-evaluation-submit-btn')?.click();
            await Promise.resolve();
        });
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('提交失败');
        expect(host.textContent).not.toContain('已收到您的服务评价');
    });
});
