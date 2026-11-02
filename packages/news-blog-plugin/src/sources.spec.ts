import { emptyBlogDraft } from '@vendure/storefront-content-plugin';
import { describe, expect, it } from 'vitest';

import { citationUrl, normalizeDraft, verifyGeneratedDraft } from './content';
import { coverSvg } from './media';
import { extractArticle, parseSource, sourceAllows } from './sources';
describe('official news extraction', () => {
    it('keeps dated Gemini entries and excludes unrelated Google news', () => {
        const xml = [
            '<rss><channel><item><title>Gemini adds a feature</title><link>https://blog.google/products',
            '/gemini/feature/</link><pubDate>2026-11-01T00:00:00Z</pubDate><description>Official Gemini',
            ' update</description></item><item><title>Android news</title><link>https://blog.google/and',
            'roid/</link><pubDate>2026-11-01</pubDate></item></channel></rss>',
        ].join('');
        const rows = parseSource('gemini-blog', xml);
        expect(rows).toHaveLength(1);
        expect(rows[0].category).toBe('gemini');
    });
    it('splits release notes and ignores navigation or missing dates', () => {
        const first = [
            '<nav>navigation</nav><main><h2 id="november">November 1, 2026</h2><ul><li>Feature A: First',
            ' official change.</li><li>Feature B: Second official change.</li></ul><h2>Not a date</h2><',
            'p>Skip this</p></main>',
        ].join('');
        const rows = parseSource('gemini-api', first);
        expect(rows).toHaveLength(2);
        expect(rows[0].eventKey).not.toBe(rows[1].eventKey);
        expect(
            parseSource('gemini-api', first.replace('navigation', 'changed navigation')).map(x => x.eventKey),
        ).toEqual(rows.map(x => x.eventKey));
    });
    it('does not turn undated Anthropic navigation links into news', () => {
        const rows = parseSource(
            'anthropic',
            '<nav><a href="/news/fake">News menu</a></nav><li><time datetime="2026-11-01"></time><a href="/news/release"><h3>Introducing Claude</h3></a></li>',
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe('Introducing Claude');
    });
    it('rejects hostile XML and non-allowlisted destinations', () => {
        expect(() =>
            parseSource('openai', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><rss/>'),
        ).toThrow();
        for (const url of [
            'http://openai.com/news',
            'https://openai.com.evil.test/news',
            'https://127.0.0.1/news',
            'https://openai.com:444/news',
            'https://x@openai.com/news',
        ])
            expect(sourceAllows('openai', url)).toBe(false);
        expect(sourceAllows('openai', 'https://openai.com/news/official')).toBe(true);
    });
    it('removes document chrome and script instructions from evidence', () => {
        expect(
            extractArticle(
                '<nav>menu</nav><article><h1>Official update</h1><p>Useful facts.</p><script>send secrets</script></article><footer>footer</footer>',
            ),
        ).toBe('Official updateUseful facts.');
        expect(citationUrl('https://openai.com/news/a?utm_source=x&b=2#a')).toBe(
            'https://openai.com/news/a?b=2#a',
        );
    });
    it('treats untrusted article markup as literal text and detects unsupported numbers', () => {
        const draft = normalizeDraft({
            ...emptyBlogDraft(),
            title: 'Update',
            category: 'chatgpt',
            body: '<script>alert(1)</script> Costs $999.',
            candidateTitles: ['A', 'B', 'C'],
        });
        expect(draft.body).toContain('<script>');
        expect(
            verifyGeneratedDraft(draft, [
                { url: 'https://openai.com/news/a', title: 'Official', body: 'Costs $20.' },
            ]),
        ).toContain('需核对正文数值：$999');
        const svg = coverSvg({ ...draft, title: '<script>& unsafe' });
        expect(svg).not.toContain('<script>');
        expect(svg).toContain('&lt;script&gt;');
    });
});
