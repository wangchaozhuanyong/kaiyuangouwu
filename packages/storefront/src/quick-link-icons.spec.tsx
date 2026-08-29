import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderColorfulQuickIcon } from './storefront-ui/product-display';

function renderQuickIcon(label: string, imageUrl?: string | null): string {
    return renderToStaticMarkup(<>{renderColorfulQuickIcon(label, 0, imageUrl)}</>);
}

describe('quick-link icons', () => {
    it.each([
        '代充服务',
        '充值中心',
        '中转站',
        'API Hub',
        'AI 工具',
        '苹果ID',
        'Apple ID',
        '增值服务',
        '海外账号',
        'Global Account',
        '售后保障',
        '商品质保',
        'Customer Support',
        '优惠券',
        'Coupon Center',
    ])('uses the Dashboard-managed image before the generated fallback for %s', label => {
        const markup = renderQuickIcon(label, ' https://cdn.example.com/managed-quick-icon.webp ');

        expect(markup).toContain('colorful-icon-img-wrap');
        expect(markup).toContain('src="https://cdn.example.com/managed-quick-icon.webp"');
        expect(markup).not.toContain('<svg');
    });

    it('keeps the generated semantic icon when no managed image is configured', () => {
        const markup = renderQuickIcon('中转站');

        expect(markup).toContain('colorful-icon-badge');
        expect(markup).toContain('lucide-cpu');
        expect(markup).not.toContain('<img');
    });

    it('treats a blank managed image URL as unconfigured', () => {
        const markup = renderQuickIcon('苹果ID', '   ');

        expect(markup).toContain('colorful-icon-badge');
        expect(markup).toContain('lucide-smartphone');
        expect(markup).not.toContain('<img');
    });
});
