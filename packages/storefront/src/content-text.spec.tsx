// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ContentText } from '../../storefront-content-plugin/src/shared/content-text';

import { sanitizeProductDescription } from './rich-text';

describe('shared content rendering', () => {
    it.each(['p', 'div', 'span', 'small'] as const)('preserves the exact plain text in %s', as => {
        const value = '第一行\n\n第二段\n  缩进说明 & <账号>';
        const doc = new DOMParser().parseFromString(
            renderToStaticMarkup(
                <ContentText as={as} className="existing-surface">
                    {value}
                </ContentText>,
            ),
            'text/html',
        );
        const node = doc.querySelector('.content-text');
        if (!node) throw new Error('Content text was not rendered');
        expect(node.tagName.toLowerCase()).toBe(as);
        expect(node.textContent).toBe(value);
        expect(node.getAttribute('data-content-format')).toBe('plain');
        expect(node.classList.contains('existing-surface')).toBe(true);
        expect(node.querySelector('账号')).toBeNull();
    });

    it('does not interpret HTML supplied to a plain content field', () => {
        const value = '<img src=x onerror=alert(1)>\n<script>alert(2)</script>';
        const doc = new DOMParser().parseFromString(
            renderToStaticMarkup(<ContentText>{value}</ContentText>),
            'text/html',
        );
        expect(doc.querySelector('img, script')).toBeNull();
        expect(doc.body.textContent).toBe(value);
    });

    it('renders legacy rich text through the sanitizer', () => {
        const html = sanitizeProductDescription(
            '<p>第一段</p><p></p><ol start="5"><li>规则</li></ol><script>alert(1)</script>',
        );
        const doc = new DOMParser().parseFromString(
            renderToStaticMarkup(<ContentText html={html} />),
            'text/html',
        );
        expect(doc.querySelector('[data-content-format="rich"]')?.tagName).toBe('DIV');
        expect(doc.querySelectorAll('p')).toHaveLength(2);
        expect(doc.querySelector('ol')?.getAttribute('start')).toBe('5');
        expect(doc.querySelector('script')).toBeNull();
    });
});
