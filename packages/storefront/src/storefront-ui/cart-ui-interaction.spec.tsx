// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopLayoutContext } from '../desktop-layout';
import { StoreCustomerCoupon, StorefrontCart } from '../types';

import { CartGroup, CouponSheet } from './cart-ui';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, to, ...props }: import('react').PropsWithChildren<{ to: string }>) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const coupon: StoreCustomerCoupon = {
    id: 'coupon-1',
    campaignId: 'campaign-1',
    campaignName: '新客优惠券',
    campaignKind: 'ORDER_FIXED',
    status: 'AVAILABLE',
    minimumSpend: 1000,
    currencyCode: 'MYR',
    discountAmount: 500,
    discountRate: null,
    claimedAt: '2026-09-01T00:00:00.000Z',
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: null,
    lockedAt: null,
    usedAt: null,
    returnedAt: null,
    expiredAt: null,
    lockedOrderId: null,
    usedOrderId: null,
    returnCount: 0,
    usable: true,
};

describe('CouponSheet interactions', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('applies the selected coupon and closes only after the request succeeds', async () => {
        const onApply = vi.fn().mockResolvedValue(null);
        const onClose = vi.fn();
        await act(async () => {
            root.render(
                <CouponSheet
                    coupons={[coupon]}
                    orderId="order-1"
                    language="zh"
                    loading={false}
                    onApply={onApply}
                    onRemove={vi.fn().mockResolvedValue(null)}
                    onBrowseCoupons={vi.fn()}
                    onClose={onClose}
                />,
            );
            await Promise.resolve();
        });

        const applyButton = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
            button => button.textContent === '使用',
        );
        await act(async () => {
            applyButton?.click();
            await Promise.resolve();
        });

        expect(onApply).toHaveBeenCalledWith(coupon.id);
        expect(onClose).toHaveBeenCalledOnce();
    });
    it.each([false, true])('preserves stock recovery and selection rules in desktop=%s', async desktop => {
        const onQuantity = vi.fn();
        const onSelect = vi.fn();
        const line: StorefrontCart['lines'][number] = {
            id: 'line-stock',
            quantity: 5,
            selected: false,
            available: true,
            productVariant: {
                id: 'variant-stock',
                name: '库存商品',
                sku: 'STOCK',
                priceWithTax: 1000,
                currencyCode: 'MYR',
                stockLevel: 'IN_STOCK',
                saleableStockLevel: 2,
                featuredAsset: null,
                product: { id: 'product-stock', name: '库存商品', featuredAsset: null },
                customFields: { fulfillmentType: 'physical' },
            },
        };
        const renderGroup = async (selected: boolean) => {
            await act(async () => {
                root.render(
                    <DesktopLayoutContext.Provider value={desktop}>
                        <CartGroup
                            title="商品"
                            hint=""
                            lines={[{ ...line, selected }]}
                            market={{
                                code: 'my',
                                defaultLanguageCode: 'zh_Hans',
                                currencyCode: 'MYR',
                                countryCode: 'MY',
                                locale: 'zh-CN',
                                label: 'Malaysia',
                            }}
                            locale="zh-CN"
                            language="zh"
                            loading={false}
                            favoriteProductIds={[]}
                            pinnedLineIds={[]}
                            openActionLineId={null}
                            onSelect={onSelect}
                            onQuantity={onQuantity}
                            onSelectAll={vi.fn()}
                            onRemove={vi.fn()}
                            onFavorite={vi.fn()}
                            onPin={vi.fn()}
                            onShare={vi.fn().mockResolvedValue(undefined)}
                            onActionOpenChange={vi.fn()}
                        />
                    </DesktopLayoutContext.Provider>,
                );
                await Promise.resolve();
            });
        };
        await renderGroup(false);
        expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
        expect(container.textContent).toContain('库存不足，当前最多可购买 2 件');
        const correction = [...container.querySelectorAll('button')].find(
            button => button.textContent === '调整为 2 件',
        );
        expect(correction).toBeDefined();
        await act(async () => {
            correction?.click();
            await Promise.resolve();
        });
        expect(onQuantity).toHaveBeenCalledWith('line-stock', 2);
        await renderGroup(true);
        const selectedCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
        expect(selectedCheckbox?.disabled).toBe(false);
        await act(async () => {
            selectedCheckbox?.click();
            await Promise.resolve();
        });
        expect(onSelect).toHaveBeenCalledWith('line-stock', false);
    });
});
