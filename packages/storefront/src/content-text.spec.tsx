// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ContentText } from '../../storefront-content-plugin/src/shared/content-text';

import { AnnouncementContent } from './components/common/announcement-content';
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

describe('announcement reading content', () => {
    it('preserves published text, whitespace and link parameters when separating paragraphs', () => {
        const content =
            '历史公告\r\n\r\n01 账号安全\r\n请保护账号。\r\n \r\nhttps://example.com/?a=1&b=2\r\n  原有缩进';
        const doc = new DOMParser().parseFromString(
            renderToStaticMarkup(<AnnouncementContent content={content} />),
            'text/html',
        );
        expect(doc.querySelector('.announcement-prose')?.textContent).toBe(content.replace(/\r\n/g, '\n'));
        expect(doc.querySelectorAll('.announcement-prose > p')).toHaveLength(3);
        expect(doc.querySelector('strong')?.textContent).toBe('01 账号安全');
    });

    it('keeps HTML, scripts and markdown literal instead of creating active content', () => {
        const content =
            '01 安全说明\n<img src=x onerror=alert(1)>\n\n<script>alert(2)</script>\n[链接](javascript:alert(1))';
        const doc = new DOMParser().parseFromString(
            renderToStaticMarkup(<AnnouncementContent content={content} />),
            'text/html',
        );
        expect(doc.querySelector('.announcement-prose')?.textContent).toBe(content);
        expect(doc.querySelector('img, script, a')).toBeNull();
    });

    it('does not treat dates or single-line amounts as section headings', () => {
        const content = '2026年9月25日\n历史公告\n\n10.50\n\n普通内容\n下一行';
        const doc = new DOMParser().parseFromString(
            renderToStaticMarkup(<AnnouncementContent content={content} />),
            'text/html',
        );
        expect(doc.querySelector('strong')).toBeNull();
        expect(doc.querySelector('.announcement-prose')?.textContent).toBe(content);
    });
});
