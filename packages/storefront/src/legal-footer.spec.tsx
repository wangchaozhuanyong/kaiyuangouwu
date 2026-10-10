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

    it.each([
        {
            language: 'zh' as const,
            storefrontName: '闪铸商城',
            storefrontNameAliases: ['Flash Cast Mall'],
            storefrontTagline: '  精选好物，便捷购物  ',
            storefrontDescription:
                '闪铸商城（Flash Cast Mall）：提供精选商品与服务。\n保留完整的第二段说明。',
            expectedTitle: '闪铸商城 · 精选好物，便捷购物',
            expectedDescription: '提供精选商品与服务。\n保留完整的第二段说明。',
        },
        {
            language: 'en' as const,
            storefrontName: 'Flash Cast Mall',
            storefrontNameAliases: ['闪铸商城'],
            storefrontTagline: 'Selected products, simple shopping',
            storefrontDescription: 'flash cast mall (闪铸商城) — offers selected products and services.',
            expectedTitle: 'Flash Cast Mall · Selected products, simple shopping',
            expectedDescription: 'Offers selected products and services.',
        },
    ])(
        'shows the brand and tagline once while removing only its known introduction prefix ($language)',
        ({ expectedTitle, expectedDescription, ...props }) => {
            const markup = renderToStaticMarkup(<LegalFooter {...props} />);
            expect(markup).toContain(`<h2 class="legal-footer-title">${expectedTitle}</h2>`);
            expect(markup).toContain(`>${expectedDescription}</p>`);
            expect(markup.match(/class="legal-footer-introduction"/g)).toHaveLength(1);
        },
    );

    it.each([
        'Demo Storefront offers more products.',
        'Demo Store2 offers more products.',
        'Discover products from Demo Store.',
        'Demo Store (since 2020) offers selected products.',
        'Demo Store（服务马来西亚）提供精选商品。',
    ])(
        'preserves partial names, later mentions and unknown parenthetical facts: %s',
        storefrontDescription => {
            const markup = renderToStaticMarkup(
                <LegalFooter
                    storefrontName="Demo Store"
                    storefrontNameAliases={['示例商城']}
                    storefrontDescription={storefrontDescription}
                    language="en"
                />,
            );
            expect(markup).toContain(`>${storefrontDescription}</p>`);
        },
    );

    it('keeps an introduction without restoring policy links when links are explicitly disabled', () => {
        const markup = renderToStaticMarkup(
            <LegalFooter
                storefrontName="Demo Store"
                storefrontTagline="Simple shopping"
                storefrontDescription="Demo Store: offers selected products."
                language="en"
                showLinks={false}
            />,
        );
        expect(markup).toContain('Demo Store · Simple shopping');
        expect(markup).toContain('>Offers selected products.</p>');
        expect(markup).not.toContain('<nav');
        expect(markup).not.toContain('Privacy Policy');
        expect(markup).not.toContain('Terms of use');
    });

    it('does not add a title separator or an empty introduction for blank optional content', () => {
        const markup = renderToStaticMarkup(
            <LegalFooter
                storefrontName="Demo Store"
                storefrontTagline="  "
                storefrontDescription={'\n '}
                language="en"
            />,
        );
        expect(markup).not.toContain('legal-footer-introduction');
        expect(markup).not.toContain('Demo Store ·');
    });
});
