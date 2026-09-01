import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CouponQueryBoundary, couponTabCountDisplay } from './coupon-center-page';

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
