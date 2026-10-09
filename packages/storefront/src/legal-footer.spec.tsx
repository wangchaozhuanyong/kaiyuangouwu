import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { LegalFooter } from './storefront-ui/page-shell';
import { StorefrontContentBlock } from './types';

const legalBlock: StorefrontContentBlock = {
    id: 'legal-1',
    code: 'privacy-policy',
    type: 'LEGAL',
    enabled: true,
    position: 0,
    startsAt: null,
    endsAt: null,
    imageUrl: null,
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    title: '首页不应显示的后台标题',
    subtitle: '这是隐私政策摘要',
    body: '这是只能在二级页展示的完整隐私政策正文',
    ctaLabel: '',
    items: [],
};

describe('LegalFooter', () => {
    it('首页只展示法律文件入口，不展示隐私政策正文或摘要', () => {
        const markup = renderToStaticMarkup(
            <LegalFooter
                storefrontName="Demo Store"
                language="zh"
                content={legalBlock}
                onContentTarget={vi.fn()}
            />,
        );

        expect(markup).toContain('Demo Store');
        expect(markup).toContain('隐私政策');
        expect(markup).not.toContain(legalBlock.title);
        expect(markup).not.toContain(legalBlock.subtitle);
        expect(markup).not.toContain(legalBlock.body);
    });

    it('uses the independently configured footer brand and ordered enabled links', () => {
        const content: StorefrontContentBlock = {
            ...legalBlock,
            type: 'FOOTER',
            title: '后台页脚品牌',
            items: [
                {
                    id: 'last',
                    enabled: true,
                    position: 2,
                    imageUrl: null,
                    targetType: 'PAGE',
                    targetValue: '/support',
                    label: '帮助中心',
                    description: '',
                },
                {
                    id: 'hidden',
                    enabled: false,
                    position: 0,
                    imageUrl: null,
                    targetType: 'PAGE',
                    targetValue: '/legal?id=privacy',
                    label: '停用入口',
                    description: '',
                },
                {
                    id: 'first',
                    enabled: true,
                    position: 1,
                    imageUrl: null,
                    targetType: 'PAGE',
                    targetValue: '/legal?id=terms',
                    label: '自定义条款',
                    description: '',
                },
            ],
        };
        const markup = renderToStaticMarkup(
            <LegalFooter
                storefrontName="Demo Store"
                language="zh"
                content={content}
                onContentTarget={vi.fn()}
            />,
        );
        expect(markup).toContain('后台页脚品牌');
        expect(markup).not.toContain('Demo Store');
        expect(markup).not.toContain('停用入口');
        expect(markup).not.toContain('隐私政策');
        expect(markup.indexOf('自定义条款')).toBeLessThan(markup.indexOf('帮助中心'));
        expect(markup).not.toContain(content.body);
        expect(content.items[0].id).toBe('last');
    });

    it('falls back to the store name and respects an explicitly empty footer link list', () => {
        const markup = renderToStaticMarkup(
            <LegalFooter
                storefrontName="Demo Store"
                language="en"
                content={{ ...legalBlock, type: 'FOOTER', title: '  ', items: [] }}
                onContentTarget={vi.fn()}
            />,
        );
        expect(markup).toContain('Demo Store');
        expect(markup).not.toContain('<nav');
        expect(markup).not.toContain('Privacy Policy');
        expect(markup).not.toContain('Terms of use');
    });
});
