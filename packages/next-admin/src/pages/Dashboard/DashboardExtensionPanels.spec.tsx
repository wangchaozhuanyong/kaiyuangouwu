import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralTodayExtensionWidget } from './DashboardExtensionPanels';

const apollo = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock('@apollo/client/react', () => apollo);
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
vi.mock('react-router-dom', () => ({
    Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const value = {
    businessDate: '2026-10-16',
    visitorCount: null,
    newCustomerCount: 2,
    consumerCount: 0,
    firstTimeConsumerCount: 0,
    returningConsumerCount: 0,
    orderCount: 0,
    todayInvitedCount: 0,
    todayInvitedPurchaserCount: 0,
    salesByCurrency: [],
};

beforeEach(() =>
    apollo.useQuery.mockReturnValue({
        loading: false,
        data: { referralTodayMetrics: value },
        refetch: vi.fn(),
    }),
);

describe('today customer and invitation statistics', () => {
    it('names first entry as a store customer and preserves unavailable visits', () => {
        const html = renderToStaticMarkup(<ReferralTodayExtensionWidget />);
        expect(html).toContain('新增本店客户');
        expect(html).not.toContain('新增注册');
        expect(html).toContain('—');
        expect(html).toContain('2026-10-16');
    });

    it('retains data and marks a failed background update explicitly', () => {
        apollo.useQuery.mockReturnValue({
            error: new Error('unavailable'),
            data: { referralTodayMetrics: value },
            refetch: vi.fn(),
        });
        const html = renderToStaticMarkup(<ReferralTodayExtensionWidget />);
        expect(html).toContain('今日数据更新失败');
        expect(html).toContain('上次成功读取的数据');
        expect(html).toContain('新增本店客户');
    });

    it('shows the initial failure with an actionable retry', () => {
        apollo.useQuery.mockReturnValue({ error: new Error('unavailable'), refetch: vi.fn() });
        const html = renderToStaticMarkup(<ReferralTodayExtensionWidget />);
        expect(html).toContain('role="alert"');
        expect(html).toContain('重试');
        expect(html).not.toContain('新增本店客户');
    });
});
