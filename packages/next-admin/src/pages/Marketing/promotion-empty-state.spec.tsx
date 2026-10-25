// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { CouponList, FlashSaleList } from './promotion-lists';
import { CouponLedger } from './promotion-reports';

vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('marketing filtered empty results', () => {
    it.each(['coupons', 'flash-sales'])(
        'offers reset rather than first creation for filtered %s',
        async type => {
            const host = document.createElement('div');
            const root = createRoot(host);
            const reset = vi.fn();
            const create = vi.fn();
            const common = {
                actionPending: false,
                onCreate: create,
                onRename: vi.fn(),
                onView: vi.fn(),
                onSensitive: vi.fn(),
                onResetFilters: reset,
            };
            try {
                await act(async () =>
                    root.render(
                        type === 'coupons' ? (
                            <CouponList
                                {...common}
                                coupons={[]}
                                currencyCode="CNY"
                                onCopy={vi.fn()}
                                onGrant={vi.fn()}
                                onAppearance={vi.fn()}
                            />
                        ) : (
                            <FlashSaleList {...common} sales={[]} />
                        ),
                    ),
                );
                expect(host.textContent).toContain('没有匹配的活动');
                expect(host.textContent).not.toContain('还没有');
                await act(async () => host.querySelector('button')!.click());
                expect(reset).toHaveBeenCalledOnce();
                expect(create).not.toHaveBeenCalled();
            } finally {
                await act(async () => root.unmount());
            }
        },
    );
    it('retains first-creation guidance for a genuinely empty dataset', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            await act(async () =>
                root.render(
                    <FlashSaleList
                        sales={[]}
                        actionPending={false}
                        onCreate={vi.fn()}
                        onRename={vi.fn()}
                        onView={vi.fn()}
                        onSensitive={vi.fn()}
                    />,
                ),
            );
            expect(host.textContent).toContain('还没有秒杀活动');
        } finally {
            await act(async () => root.unmount());
        }
    });
    it('gives each ledger filter a distinct programmatic name', async () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        try {
            await act(async () =>
                root.render(
                    <CouponLedger
                        pageSize={20}
                        onPageSizeChange={vi.fn()}
                        coupons={[]}
                        currencyCode="CNY"
                        page={0}
                        setPage={vi.fn()}
                        campaign="ALL"
                        setCampaign={vi.fn()}
                        event="ALL"
                        setEvent={vi.fn()}
                        data={{ items: [], totalItems: 0 }}
                        loading={false}
                        onRetry={vi.fn()}
                    />,
                ),
            );
            expect(host.querySelector('select[aria-label="按优惠券活动筛选流水"]')).not.toBeNull();
            expect(host.querySelector('select[aria-label="按优惠券事件筛选流水"]')).not.toBeNull();
        } finally {
            await act(async () => root.unmount());
        }
    });
});
