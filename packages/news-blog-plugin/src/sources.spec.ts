import { emptyBlogDraft } from '@vendure/storefront-content-plugin';
import { assert, describe, expect, it } from 'vitest';

import { citationUrl, contentIssues, normalizeDraft, verifyGeneratedDraft } from './content';
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
    it('reads dated official Gemini archive cards without treating undated links as posts', () => {
        const rows = parseSource(
            'gemini-blog',
            `<uni-flex-card headline="Gemini synthetic update"
            cta-url="https://blog.google/products/gemini/synthetic/"
            data-ga4-analytics-lead-click='{"publish_date":"2026-10-13|16:00"}'></uni-flex-card>
            <uni-flex-card headline="Undated" cta-url="https://blog.google/products/gemini/undated/"></uni-flex-card>`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].publishedAt.toISOString()).toBe('2026-10-13T00:00:00.000Z');
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
    it('reads relocated Markdown release notes while preserving HTML entry identities', () => {
        const html =
            '<h2 id="11-02-2026">November 2, 2026</h2><ul><li>Model Alpha: First synthetic change.</li><li>Model Beta: Second synthetic change.</li></ul>';
        const markdown = [
            '> ## Agent context, not news',
            '# Release notes',
            '## November 2, 2026 {% id="11-02-2026" %}',
            '* **Model Alpha**: First synthetic change.',
            '* **Model Beta**: Second synthetic change.',
        ].join('\n');
        const rows = parseSource('gemini-api', markdown);
        expect(rows).toHaveLength(2);
        expect(rows.map(x => x.eventKey)).toEqual(parseSource('gemini-api', html).map(x => x.eventKey));
        expect(rows[0]).toMatchObject({
            title: 'Model Alpha',
            body: 'Model Alpha: First synthetic change.',
            url: 'https://ai.google.dev/gemini-api/docs/changelog#11-02-2026',
        });
    });
    it('keeps Markdown continuations together and ignores code examples and undated sections', () => {
        const rows = parseSource(
            'gemini-api',
            [
                '```md',
                '## November 1, 2026 {% id="not-real" %}',
                '* Fake example: must not become news.',
                '```',
                '## November 2, 2026 {% id="11-02-2026" %}',
                '* **Model `Alpha`**: Read the [official guide](/docs/alpha).',
                '  Continued explanation.',
                '  * A nested detail, not a separate release.',
                '* **Model Beta**: A second change.',
                '## Related documentation',
                '* Undated navigation must not become news.',
            ].join('\n'),
        );
        expect(rows).toHaveLength(2);
        expect(rows[0].title).toBe('Model Alpha');
        expect(rows[0].body).toContain('official guide');
        expect(rows[0].body).toContain('Continued explanation');
        expect(rows[0].body).toContain('nested detail');
        expect(rows.some(x => /Fake example|Undated navigation/u.test(x.body))).toBe(false);
    });
    it('allows only the migrated official changelog paths on AI Studio', () => {
        for (const path of ['/docs/changelog', '/docs/changelog.md'])
            expect(sourceAllows('gemini-api', `https://aistudio.google.com${path}`)).toBe(true);
        expect(sourceAllows('gemini-api', 'https://ai.google.dev/gemini-api/docs/changelog')).toBe(true);
        for (const path of ['/app', '/api/private', '/docs/pricing'])
            expect(sourceAllows('gemini-api', `https://aistudio.google.com${path}`)).toBe(false);
        expect(sourceAllows('gemini-blog', 'https://aistudio.google.com/docs/changelog')).toBe(false);
        expect(sourceAllows('gemini-api', 'https://aistudio.google.com.evil.test/docs/changelog')).toBe(
            false,
        );
    });
    it('does not turn undated Anthropic navigation links into news', () => {
        const rows = parseSource(
            'anthropic',
            '<nav><a href="/news/fake">News menu</a></nav><li><time datetime="2026-11-01"></time><a href="/news/release"><h3>Introducing Claude</h3></a></li>',
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe('Introducing Claude');
    });
    it('uses the dated article heading instead of sibling descriptions and category links', () => {
        const rows = parseSource(
            'anthropic',
            `<li><a href="/news/synthetic-release"><h3>Introducing a synthetic Claude update</h3></a>
            <a href="/news/synthetic-release"><p>A separate description must not replace the headline.</p></a>
            <a href="/news/product">Product</a><time>Oct 22, 2026</time>
            <div aria-hidden="true"><a href="/news/synthetic-release"><h3>Introducing a synthetic Claude update</h3></a>
            <a href="/news/synthetic-release"><p>Repeated description</p></a></div></li>`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe('Introducing a synthetic Claude update');
        expect(rows[0].url).toBe('https://www.anthropic.com/news/synthetic-release');
    });
    it('rejects observed Anthropic category destinations while retaining the source index', () => {
        for (const slug of ['announcements', 'features', 'product', 'policy', 'security', 'safeguards']) {
            expect(sourceAllows('anthropic', `https://www.anthropic.com/news/${slug}`)).toBe(false);
            expect(sourceAllows('anthropic', `https://anthropic.com/news/${slug}/?page=2`)).toBe(false);
        }
        expect(sourceAllows('anthropic', 'https://www.anthropic.com/news')).toBe(true);
        expect(sourceAllows('anthropic', 'https://www.anthropic.com/news/synthetic-release')).toBe(true);
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
        ).toBe('Official update Useful facts.');
        expect(citationUrl('https://openai.com/news/a?utm_source=x&b=2#a')).toBe(
            'https://openai.com/news/a?b=2#a',
        );
    });
    it('checks evidence and language in both editions and never exports the source fragment as a translation', () => {
        const url = 'https://openai.com/news/fixture';
        const source = {
            url,
            title: 'A fixture',
            body: 'This complete sentence is synthetic source evidence.',
        };
        const draft = normalizeDraft({
            ...emptyBlogDraft(),
            title: '一条核对后的资讯',
            summary: '中文摘要解释实际事件。',
            body: '## 变更内容\n' + '这是一条专用于测试的完整消息，中文正文说明资料的含义。'.repeat(5),
            seoDescription: '中文资讯搜索描述',
            candidateTitles: ['标题甲', '标题乙', '标题丙'],
            sources: [{ url, label: '官方原文', accessedAt: '2026-10-01' }],
            facts: [{ sourceUrl: url, quote: source.body, text: '已核对测试来源' }],
            translations: {
                en: {
                    title: 'Reviewed report',
                    summary: 'A summary in English.',
                    body: '## What changed\nThe source describes synthetic test evidence.',
                    tags: ['News'],
                    seoDescription: 'Description in English.',
                },
            },
        });
        expect(contentIssues(draft)).toEqual([]);
        expect(verifyGeneratedDraft(draft, [source])).toEqual([]);
        expect(
            contentIssues({
                ...draft,
                body:
                    draft.body +
                    '\n官方指出：「The discount now applies across every product surface for eligible customers.」',
            }),
        ).toContain('中文资讯中有未翻译的英文语句，请翻译成完整中文');
        const en = draft.translations?.en;
        assert(en);
        expect(
            verifyGeneratedDraft(
                { ...draft, translations: { en: { ...en, body: 'The report claims 9999 customers.' } } },
                [source],
            ),
        ).toContain('需核对正文数值：9999');
        expect(contentIssues({ ...draft, translations: { en: { ...en, title: '错误中文标题' } } })).toContain(
            '英文资讯的标题、摘要、正文、标签和搜索描述均需使用英文',
        );
        expect(verifyGeneratedDraft({ ...draft, translations: undefined }, [source])).toContain(
            '缺少英文资讯稿',
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
