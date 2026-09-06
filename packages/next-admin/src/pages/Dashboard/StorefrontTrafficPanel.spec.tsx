import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontTrafficPanel, StorefrontTrafficReport } from './StorefrontTrafficPanel';

const apollo = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock('@apollo/client/react', () => apollo);

const report = {
    businessDate: '2026-09-05',
    timezone: 'Asia/Shanghai',
    firstRecordedAt: null,
    lastRecordedAt: null,
    days: [{ businessDate: '2026-09-05', visitorCount: null, pageViewCount: null, ipCount: null }],
};

beforeEach(() =>
    apollo.useQuery.mockReturnValue({
        loading: false,
        data: { storefrontTraffic: report },
        refetch: vi.fn(),
    }),
);

describe('storefront traffic panel', () => {
    it('shows missing collection as unavailable instead of inventing zero visits', () => {
        const html = renderToStaticMarkup(<StorefrontTrafficReport report={report} />);
        expect(html).toContain('暂无新版访问记录');
        expect(html).toContain('—');
        expect(html).not.toContain('>0<');
    });

    it('distinguishes visitors, page views and network addresses', () => {
        const html = renderToStaticMarkup(
            <StorefrontTrafficReport
                report={{
                    ...report,
                    firstRecordedAt: '2026-09-05T01:00:00Z',
                    lastRecordedAt: '2026-09-05T01:00:00Z',
                    days: [
                        { businessDate: report.businessDate, visitorCount: 2, pageViewCount: 7, ipCount: 1 },
                    ],
                }}
            />,
        );
        for (const label of [
            '今日独立访客',
            '今日浏览量',
            '今日独立 IP',
            '估算',
            '不等于人数',
            '>2<',
            '>7<',
            '>1<',
        ]) {
            expect(html).toContain(label);
        }
    });

    it('renders an error without presenting stale counts as the current report', () => {
        apollo.useQuery.mockReturnValue({
            error: new Error('unavailable'),
            data: { storefrontTraffic: report },
            refetch: vi.fn(),
        });
        const html = renderToStaticMarkup(<StorefrontTrafficPanel />);
        expect(html).toContain('访问统计加载失败');
        expect(html).not.toContain('今日浏览量');
    });

    it('provides date controls and points to the shop-domain privacy preference', () => {
        const html = renderToStaticMarkup(<StorefrontTrafficPanel />);
        expect(html).toContain('最近 7 天');
        expect(html).toContain('最近 30 天');
        expect(html).toContain('我的 → 访问统计');
        expect(html).not.toContain('已排除本浏览器访问');
    });
});
