import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { LegalFooter } from './App';
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

        expect(markup).toContain('服务与政策');
        expect(markup).toContain('隐私政策');
        expect(markup).not.toContain(legalBlock.title);
        expect(markup).not.toContain(legalBlock.subtitle);
        expect(markup).not.toContain(legalBlock.body);
    });
});
