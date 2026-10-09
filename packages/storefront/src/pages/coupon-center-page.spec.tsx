import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { DesktopLayoutContext } from '../desktop-layout';
import { CouponCenterPageContext } from '../storefront-page-contexts';
import { readStorefrontStylesheet } from '../test-stylesheet';

import {
    CouponCenterPage,
    CouponQueryBoundary,
    couponTabCountDisplay,
    type CouponCenterPageProps,
} from './coupon-center-page';

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { canGoBack: () => false } }),
}));

describe('coupon center paginated navigation counts', () => {
    const clients: QueryClient[] = [];
    afterEach(() => {
        clients.splice(0).forEach(client => client.clear());
    });

    function fixture() {
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
        });
        clients.push(client);
        const api = Object.assign(
            new ShopApi({
                code: 'coupon-counts-test',
                defaultLanguageCode: 'zh_Hans',
                currencyCode: 'MYR',
                countryCode: 'MY',
                locale: 'zh-MY',
                label: 'Malaysia',
            }),
            {
                myCouponsPage: vi
                    .fn<ShopApi['myCouponsPage']>()
                    .mockResolvedValue({ items: [], totalItems: 0 }),
                myCouponUsageRecordsPage: vi
                    .fn<ShopApi['myCouponUsageRecordsPage']>()
                    .mockResolvedValue({ items: [], totalItems: 0 }),
            },
        );
        const queryKey = ['coupon-counts', 'owned-page', 0] as const;
        const props: CouponCenterPageProps = {
            pagination: { api, queryKey: ['coupon-counts'] },
            coupons: [],
            myCoupons: [],
            usageRecords: [],
            currencyCode: 'MYR',
            displayCurrencyCode: 'MYR',
            language: 'zh',
            loading: false,
            campaignsLoading: false,
            campaignsError: '',
            myCouponsLoading: false,
            myCouponsError: '',
            usageRecordsLoading: false,
            usageRecordsError: '',
            onRetryCampaigns: vi.fn(),
            onRetryMyCoupons: vi.fn(),
            onRetryUsageRecords: vi.fn(),
            onClaim: vi.fn().mockResolvedValue(null),
        };
        const render = (desktop = true) =>
            renderToStaticMarkup(
                <QueryClientProvider client={client}>
                    <DesktopLayoutContext.Provider value={desktop}>
                        <CouponCenterPageContext.Provider value={props}>
                            <CouponCenterPage />
                        </CouponCenterPageContext.Provider>
                    </DesktopLayoutContext.Provider>
                </QueryClientProvider>,
            );
        const readOwnedPage = () =>
            client.fetchQuery({
                queryKey,
                queryFn: ({ signal }) =>
                    api.myCouponsPage(
                        { skip: 0, take: 20, statuses: ['AVAILABLE', 'RETURNED', 'LOCKED'] },
                        signal,
                    ),
            });
        return { client, api, queryKey, props, render, readOwnedPage };
    }

    function count(markup: string, label: string) {
        return markup.match(new RegExp(`<span>${label}</span><small>([^<]*)</small>`))?.[1];
    }

    it('shows pending and then the total for unused coupons while Activities remains selected', async () => {
        const { api, render, readOwnedPage } = fixture();
        let resolvePage: (page: Awaited<ReturnType<ShopApi['myCouponsPage']>>) => void = () => undefined;
        api.myCouponsPage.mockReturnValueOnce(
            new Promise(resolve => {
                resolvePage = resolve;
            }),
        );
        const request = readOwnedPage();
        const pendingMarkup = render();
        resolvePage({ items: [], totalItems: 3 });
        await request;

        expect(count(pendingMarkup, '未使用')).toBe('…');
        expect(count(pendingMarkup, '未领取')).toBe('0');
        expect(pendingMarkup).toContain('aria-current="page"><span>当前活动</span>');
        expect(count(render(), '未使用')).toBe('3');
    });

    it('shows an unknown unused total on initial failure without changing campaign ownership state', async () => {
        const { api, render, readOwnedPage } = fixture();
        api.myCouponsPage.mockRejectedValueOnce(new Error('读取失败'));
        await readOwnedPage().catch(() => undefined);

        const markup = render();
        expect(count(markup, '未使用')).toBe('—');
        expect(count(markup, '未领取')).toBe('0');
    });

    it('shows zero only after a successful empty unused page', async () => {
        const { render, readOwnedPage } = fixture();
        await readOwnedPage();
        expect(count(render(), '未使用')).toBe('0');
    });

    it('retains a confirmed unused total after background failure', async () => {
        const { client, api, queryKey, render, readOwnedPage } = fixture();
        client.setQueryData(queryKey, { items: [], totalItems: 12 });
        await client.invalidateQueries({ queryKey, refetchType: 'none' });
        api.myCouponsPage.mockRejectedValueOnce(new Error('后台读取失败'));
        await readOwnedPage().catch(() => undefined);
        expect(count(render(), '未使用')).toBe('12');
    });

    it.each([false, true])('keeps actual claim dates and usage validity separate (desktop=%s)', desktop => {
        const { props, render } = fixture();
        props.coupons = [
            {
                id: 'campaign-claim-window',
                name: '指定商品活动',
                kind: 'PRODUCT_PERCENTAGE',
                startsAt: null,
                endsAt: '2026-11-01T15:59:00.000Z',
                claimStartsAt: '2026-10-08T14:56:00.000Z',
                claimEndsAt: '2026-10-15T14:56:00.000Z',
                validityDays: 7,
                minimumSpend: 150000,
                currencyCode: 'MYR',
                discountAmount: null,
                discountRate: 8,
                remainingIssueCount: 12,
                claimed: false,
                claimable: true,
            },
        ];

        const markup = render(desktop);
        const format = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
        expect(markup).toContain('适用范围：指定商品');
        expect(markup).toContain('领取时间');
        expect(markup).toContain(format.format(new Date(props.coupons[0].claimStartsAt ?? '')));
        expect(markup).toContain(format.format(new Date(props.coupons[0].claimEndsAt ?? '')));
        expect(markup).toContain('领取后 7 天内有效');
        expect(markup).toContain('最晚至');
        expect(markup).toContain('desktop-coupon-ticket');
        expect(markup).not.toContain('coupon-activity-card');
    });
});

describe('coupon center query states', () => {
    it('does not render a zero count when unused-coupon loading fails', () => {
        expect(couponTabCountDisplay('UNUSED', 0, false, '', false, '读取失败', false, '')).toBe('—');
        expect(couponTabCountDisplay('UNUSED', 0, false, '', true, '', false, '')).toBe('…');
        expect(couponTabCountDisplay('UNCLAIMED', 0, false, '', false, '读取失败', false, '')).toBe('—');
        expect(couponTabCountDisplay('UNCLAIMED', 3, false, '', false, '读取失败', false, '')).toBe('—');
        expect(couponTabCountDisplay('UNUSED', 2, false, '', false, '读取失败', false, '')).toBe(2);
    });

    it('does not present campaign query failures as zero current activities', () => {
        expect(couponTabCountDisplay('ACTIVITIES', 0, false, '活动读取失败', false, '', false, '')).toBe('—');
        expect(couponTabCountDisplay('ACTIVITIES', 0, true, '', false, '', false, '')).toBe('…');
    });

    it('shows a retryable error instead of an empty state when the query fails', () => {
        const markup = renderToStaticMarkup(
            <CouponQueryBoundary
                loading={false}
                error="优惠券读取失败"
                hasData={false}
                language="zh"
                onRetry={vi.fn()}
                empty={<span>暂无未使用优惠券</span>}
            >
                <span>优惠券数据</span>
            </CouponQueryBoundary>,
        );

        expect(markup).toContain('优惠券读取失败');
        expect(markup).toContain('重试');
        expect(markup).not.toContain('暂无未使用优惠券');
    });

    it('shows a loading skeleton instead of an empty state while data is pending', () => {
        const markup = renderToStaticMarkup(
            <CouponQueryBoundary
                loading
                error=""
                hasData={false}
                language="zh"
                onRetry={vi.fn()}
                empty={<span>暂无使用记录</span>}
            >
                <span>使用记录</span>
            </CouponQueryBoundary>,
        );

        expect(markup).toContain('正在加载优惠券数据');
        expect(markup).not.toContain('暂无使用记录');
    });
});

describe('coupon center instruction layout', () => {
    it('keeps long rules readable in responsive label and value columns', () => {
        const stylesheet = readStorefrontStylesheet();

        expect(stylesheet).toMatch(
            /\.coupon-center-details > div\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(4em, 6em\) minmax\(0, 1fr\);/,
        );
        expect(stylesheet).toMatch(/\.coupon-center-details dd\s*\{[^}]*overflow-wrap:\s*anywhere;/);
        expect(stylesheet).not.toMatch(/\.coupon-center-details dd\s*\{[^}]*white-space:\s*nowrap;/);
    });
});
