// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CategoryIntro } from './category-intro';

function render(description: string | null | undefined, language: 'zh' | 'en' = 'zh') {
    return new DOMParser().parseFromString(
        renderToStaticMarkup(<CategoryIntro description={description} language={language} />),
        'text/html',
    );
}

describe('category overview', () => {
    it('renders the published collection description as reading content', () => {
        const doc = render('<p>四档订阅，按额度选择。</p><p>人工核对后交付。</p>');
        const section = doc.querySelector('.category-intro');
        if (!section) throw new Error('Category overview was not rendered');
        expect(section.getAttribute('aria-label')).toBe('分类说明');
        expect(section.querySelectorAll('.content-text p')).toHaveLength(2);
        expect(section.textContent).toContain('按额度选择');
    });

    it('never executes markup from the description', () => {
        const doc = render('<p>说明</p><script>alert(1)</script><img src=x onerror=alert(2)>');
        expect(doc.querySelector('.category-intro script, .category-intro img')).toBeNull();
        expect(doc.querySelector('.category-intro')?.textContent).toContain('说明');
    });

    it('keeps an authored line break inside one description', () => {
        const doc = render('第一行\n第二行');
        const text = doc.querySelector('.category-intro .content-text');
        expect(text?.querySelectorAll('br')).toHaveLength(1);
        expect(text?.textContent).toBe('第一行第二行');
    });

    it.each([null, undefined, '', '   \n  '])('renders nothing for an empty description (%s)', value => {
        expect(render(value).querySelector('.category-intro')).toBeNull();
    });

    it('labels the section in the active storefront language', () => {
        expect(render('Overview', 'en').querySelector('.category-intro')?.getAttribute('aria-label')).toBe(
            'Category overview',
        );
    });

    it('renders a trailing FAQ section as collapsed disclosures with answers in the initial HTML', () => {
        const doc = render(
            '正文说明。\n\n## 常见问题\n### 可以买一个月吗？\n可以。\n### 怎么交付？\n人工核对后开通。',
        );
        const faq = doc.querySelector('.category-faq');
        if (!faq) throw new Error('FAQ block was not rendered');
        expect(faq.querySelector('h2')?.textContent).toBe('常见问题');
        expect(
            Array.from(faq.querySelectorAll('details:not([open]) > summary')).map(node => node.textContent),
        ).toEqual(['可以买一个月吗？', '怎么交付？']);
        expect(Array.from(faq.querySelectorAll('details > p')).map(node => node.textContent)).toEqual([
            '可以。',
            '人工核对后开通。',
        ]);
        expect(doc.querySelector('.category-intro')?.textContent).toContain('正文说明。');
    });

    it('omits the FAQ block when the description has no FAQ section', () => {
        expect(render('只有正文说明。').querySelector('.category-faq')).toBeNull();
    });

    it('uses the English FAQ heading for the English storefront', () => {
        const doc = render('Intro.\n\n## FAQ\n### Question?\nAnswer.', 'en');
        expect(doc.querySelector('.category-faq h2')?.textContent).toBe('FAQ');
    });

    it('never renders markup from an FAQ answer', () => {
        const doc = render('## 常见问题\n### 问题？\n<script>alert(1)</script>');
        expect(doc.querySelector('.category-faq script')).toBeNull();
        expect(doc.querySelector('.category-faq details > p')?.textContent).toBe('<script>alert(1)</script>');
    });
});
