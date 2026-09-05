import type { ReactElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';

import type { StoreCouponRecord } from '../../graphql/marketing.graphql';
import { CampaignDetailDialog, PromotionsModule, SensitiveDialog } from './PromotionsModule';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);

describe('PromotionsModule sensitive actions', () => {
    beforeEach(() => {
        apolloMocks.useMutation.mockReturnValue([vi.fn(), { loading: false }]);
        apolloMocks.useQuery.mockReturnValue({
            data: {
                activeChannel: { id: 'channel-1', code: 'default', defaultCurrencyCode: 'CNY' },
                storeCouponCampaigns: [],
                storeFlashSales: [],
                storeCouponLedger: { items: [], totalItems: 0 },
                storeCouponDailyReport: [],
            },
            error: undefined,
            loading: false,
            refetch: vi.fn(),
        });
    });

    it('marks the campaign filter as a search field that credential autofill must ignore', () => {
        const html = renderToStaticMarkup(
            <MemoryRouter>
                <PromotionsModule />
            </MemoryRouter>,
        );

        expect(html).toContain('type="search"');
        expect(html).toContain('name="promotion-search"');
        expect(html).toContain('autoComplete="off"');
        expect(html).toContain('aria-label="搜索营销活动"');
    });

    it('shows the server rejection reason inside the open dialog', () => {
        const html = renderToStaticMarkup(
            <SensitiveDialog
                action={{
                    kind: 'DELETE',
                    id: 'promotion-1',
                    name: '刪10减10',
                    subject: '优惠券',
                }}
                pending={false}
                error="该优惠券已经发放 3 张，不能删除；可停止发放或批量作废未使用券"
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );

        expect(html).toContain('role="alert"');
        expect(html).toContain('操作未完成');
        expect(html).toContain('该优惠券已经发放 3 张，不能删除');
        expect(html).toContain('name="promotion-sensitive-action-confirmation"');
        expect(html).toContain('autoComplete="off"');
        expect(html).not.toContain('autoComplete="current-password"');
    });

    it('shows a visible details entry and replaces deletion with archive after a coupon was claimed', () => {
        apolloMocks.useQuery.mockReturnValue({
            data: {
                activeChannel: { id: 'channel-1', code: 'default', defaultCurrencyCode: 'CNY' },
                storeCouponCampaigns: [couponRecord()],
                storeFlashSales: [],
                storeCouponLedger: { items: [], totalItems: 0 },
                storeCouponDailyReport: [],
            },
            error: undefined,
            loading: false,
            refetch: vi.fn(),
        });

        const html = renderToStaticMarkup(
            <MemoryRouter>
                <PromotionsModule />
            </MemoryRouter>,
        );

        expect(html).toContain('查看详情');
        expect(html).toContain('归档');
        expect(html).not.toContain('aria-label="删除优惠券"');
    });

    it('renders the complete read-only coupon settings detail', () => {
        apolloMocks.useQuery.mockReturnValue({
            data: {
                collections: { items: [{ id: 'collection-1', name: '新品分类' }] },
                productVariants: { items: [] },
            },
            error: undefined,
            loading: false,
        });

        const html = renderToStaticMarkup(
            <CampaignDetailDialog
                campaign={{ type: 'COUPON', item: couponRecord() }}
                currencyCode="CNY"
                onClose={vi.fn()}
            />,
        );

        expect(html).toContain('优惠券活动设置详情');
        expect(html).toContain('新品分类');
        expect(html).toContain('创建时间');
        expect(html).toContain('删除策略');
        expect(html).toContain('已领取 1 张，只可归档');
    });
});

function couponRecord(): StoreCouponRecord {
    return {
        id: 'promotion-1',
        createdAt: '2026-09-04T00:00:00.000Z',
        updatedAt: '2026-09-04T01:00:00.000Z',
        name: '测试优惠券',
        couponCode: 'CPN_TEST',
        kind: 'COLLECTION_PERCENTAGE',
        enabled: true,
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-30T00:00:00.000Z',
        minimumSpend: 10_000,
        discountAmount: null,
        discountRate: 9,
        collectionIds: ['collection-1'],
        productVariantIds: [],
        usageLimit: 100,
        perCustomerUsageLimit: 1,
        claimStartsAt: '2026-09-01T00:00:00.000Z',
        claimEndsAt: '2026-09-30T00:00:00.000Z',
        validityDays: 7,
        issueLimit: 100,
        perCustomerClaimLimit: 1,
        stackPolicy: 'EXCLUSIVE',
        returnOnCancellation: true,
        returnOnFullRefund: true,
        archivedAt: null,
        remainingIssueCount: 99,
        claimedCount: 1,
        availableCount: 1,
        lockedCount: 0,
        usedCount: 0,
        returnedCount: 0,
        expiredCount: 0,
        revokedCount: 0,
        redeemedOrderCount: 0,
        refundedOrderCount: 0,
        discountAmountTotal: 0,
        assistedRevenueTotal: 0,
    };
}

function renderToStaticMarkup(element: ReactElement) {
    return renderMarkup(<FeatureHelpProvider>{element}</FeatureHelpProvider>);
}
