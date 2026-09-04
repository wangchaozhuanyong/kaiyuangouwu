import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ManagedLegalPage } from './pages/legal-page';
import { StorefrontContentBlock } from './types';

function createLegalBlock(kind: 'privacy' | 'terms'): StorefrontContentBlock {
    const isPrivacy = kind === 'privacy';

    return {
        id: `legal-${kind}`,
        code: isPrivacy ? 'privacy-policy' : 'terms-of-use',
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
        title: isPrivacy ? '后台隐私政策标题' : '后台使用条款标题',
        subtitle: '',
        body: isPrivacy ? '隐私政策正文' : '使用条款正文',
        ctaLabel: '',
        items: [],
    };
}

describe('ManagedLegalPage', () => {
    it.each([
        ['privacy', '后台隐私政策标题', '隐私政策正文'],
        ['terms', '后台使用条款标题', '使用条款正文'],
    ] as const)('同步后台标题并移除 %s 页面正文的重复标题', (kind, title, body) => {
        const markup = renderToStaticMarkup(
            <ManagedLegalPage
                kind={kind}
                language="zh"
                storefrontName="Demo Store"
                contentBlocks={[createLegalBlock(kind)]}
                onBack={vi.fn()}
            />,
        );

        expect(markup).toContain(`<strong>${title}</strong>`);
        expect(markup).not.toContain('<h1');
        expect(markup).not.toContain('legal-managed-intro');
        expect(markup).toContain(body);
    });

    it('保留后台配置的法律文件摘要', () => {
        const legalBlock = createLegalBlock('privacy');
        legalBlock.subtitle = '后台隐私政策摘要';

        const markup = renderToStaticMarkup(
            <ManagedLegalPage
                kind="privacy"
                language="zh"
                storefrontName="Demo Store"
                contentBlocks={[legalBlock]}
                onBack={vi.fn()}
            />,
        );

        expect(markup).toContain('<header class="legal-managed-intro"><p>后台隐私政策摘要</p></header>');
        expect(markup).not.toContain('<h1');
    });

    it('自动展示经营主体和可点击的联系邮箱', () => {
        const legalBlock = createLegalBlock('privacy');
        legalBlock.body = '负责人：{{legalEntityName}}；隐私联系：{{privacyEmail}}';

        const markup = renderToStaticMarkup(
            <ManagedLegalPage
                kind="privacy"
                language="zh"
                storefrontName="MOYAO AI"
                contentBlocks={[legalBlock]}
                legalIdentity={{
                    legalEntityName: 'MOYAO AI Example Limited',
                    legalRegistrationCountry: 'Malaysia',
                    supportEmail: 'support@moyaoai.com',
                    privacyEmail: 'privacy@moyaoai.com',
                }}
                onBack={vi.fn()}
            />,
        );

        expect(markup).toContain('legal-identity-card');
        expect(markup).toContain('MOYAO AI Example Limited');
        expect(markup).toContain('Malaysia');
        expect(markup).toContain('href="mailto:support@moyaoai.com"');
        expect(markup).toContain('href="mailto:privacy@moyaoai.com"');
        expect(markup).not.toContain('{{legalEntityName}}');
        expect(markup).not.toContain('{{privacyEmail}}');
    });
});
