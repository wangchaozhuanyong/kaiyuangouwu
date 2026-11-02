import { BlogCategory } from '@vendure/storefront-content-plugin';
import { load } from 'cheerio';

import { citationUrl, hash } from './content';
export const sourceCatalog = [
    {
        code: 'openai',
        name: 'OpenAI 官方资讯',
        url: 'https://openai.com/news/rss.xml',
        hosts: ['openai.com'],
        category: 'chatgpt',
        mode: 'RSS',
    },
    {
        code: 'anthropic',
        name: 'Anthropic 官方资讯',
        url: 'https://www.anthropic.com/news',
        hosts: ['www.anthropic.com', 'anthropic.com'],
        category: 'claude',
        mode: 'HTML',
    },
    {
        code: 'gemini-blog',
        name: 'Google Gemini 官方博客',
        url: 'https://blog.google/rss/',
        historyUrl: 'https://blog.google/products-and-platforms/products/gemini/',
        hosts: ['blog.google'],
        category: 'gemini',
        mode: 'RSS',
    },
    {
        code: 'gemini-api',
        name: 'Gemini API 更新记录',
        url: 'https://ai.google.dev/gemini-api/docs/changelog',
        hosts: ['ai.google.dev'],
        category: 'gemini',
        mode: 'CHANGELOG',
    },
] as const;
export interface CollectedItem {
    url: string;
    title: string;
    body: string;
    publishedAt: Date;
    category: BlogCategory;
    eventKey: string;
    entryKey: string;
}
const clip = (value: string) =>
    Buffer.from(value)
        .subarray(0, 55000)
        .toString('utf8')
        .replace(/\uFFFD$/u, '');
const clean = (value: string) => load(`<div>${value}</div>`).text().replace(/\s+/gu, ' ').trim();
export function sourceAllows(code: string, raw: string): boolean {
    try {
        const u = new URL(raw);
        const source = sourceCatalog.find(x => x.code === code);
        return (
            !!source &&
            u.protocol === 'https:' &&
            !u.port &&
            !u.username &&
            !u.password &&
            (source.hosts as readonly string[]).includes(u.hostname) &&
            // These are observed taxonomy pages, never dated article evidence.
            !(
                code === 'anthropic' &&
                /^\/news\/(?:announcements|features|product|policy|security|safeguards)\/?$/iu.test(
                    u.pathname,
                )
            )
        );
    } catch {
        return false;
    }
}
function item(code: string, raw: Record<string, unknown>): CollectedItem | null {
    const source = sourceCatalog.find(x => x.code === code);
    if (!source) return null;
    let url: string;
    try {
        url = citationUrl(raw.url);
    } catch {
        return null;
    }
    if (!sourceAllows(code, url)) return null;
    if (source.mode !== 'CHANGELOG') {
        const canonical = new URL(url);
        canonical.hash = '';
        url = canonical.href;
    }
    const title = clean(typeof raw.title === 'string' ? raw.title : '').slice(0, 500);
    const publishedAt = new Date(typeof raw.date === 'string' ? raw.date : '');
    if (!title || !Number.isFinite(publishedAt.getTime())) return null;
    const category: BlogCategory =
        /research|policy|safety|invest|fund|partnership/iu.test(title) &&
        !/chatgpt|codex|claude|gemini|gpt[- ]?\d/iu.test(title)
            ? 'industry'
            : source.category;
    return {
        url,
        title,
        body: clip(clean(typeof raw.body === 'string' ? raw.body : '').slice(0, 30000)),
        publishedAt,
        category,
        entryKey: typeof raw.entryKey === 'string' && raw.entryKey ? raw.entryKey : url,
        // Stable source identity survives title/date edits; model names alone do not identify releases.
        eventKey: hash(
            `${source.code}:${typeof raw.entryKey === 'string' && raw.entryKey ? raw.entryKey : url}`,
        ),
    };
}
/** Parse dated entries only: undated links and navigation changes never become news. */
export function parseSource(code: string, html: string): CollectedItem[] {
    const source = sourceCatalog.find(x => x.code === code);
    if (!source) throw new Error('未知资讯源');
    const rows: CollectedItem[] = [];
    if (code === 'gemini-blog' && /<uni-flex-card\b/iu.test(html)) {
        const $ = load(html);
        $('uni-flex-card').each((_, node) => {
            const card = $(node);
            try {
                const analytics = JSON.parse(card.attr('data-ga4-analytics-lead-click') ?? '{}') as Record<
                    string,
                    unknown
                >;
                const published =
                    typeof analytics.publish_date === 'string' ? analytics.publish_date.split('|')[0] : '';
                const row = item(code, {
                    url: card.attr('cta-url'),
                    title: card.attr('headline'),
                    date: published,
                    body: card.attr('description') ?? card.text(),
                });
                if (row) rows.push(row);
            } catch {
                /* An undated or malformed card cannot become a news item. */
            }
        });
    } else if (source.mode === 'RSS') {
        if (/<!DOCTYPE|<!ENTITY/iu.test(html)) throw new Error('不接受带实体声明的订阅');
        const $ = load(html, { xmlMode: true });
        $('item,entry').each((_, node) => {
            const x = $(node);
            const link = x.children('link').attr('href') || x.children('link').text();
            const title = x.children('title').text();
            const body = x.children('description,summary,content').text();
            if (code === 'gemini-blog' && !/gemini/iu.test(`${title} ${body} ${link}`)) return;
            const row = item(code, {
                url: link,
                title,
                date: x.children('pubDate,published,updated').first().text(),
                body,
            });
            if (row) rows.push(row);
        });
    } else {
        const $ = load(html);
        $('script,style,nav,header,footer').remove();
        if (source.mode === 'CHANGELOG') {
            $('h2').each((_, node) => {
                const title = $(node).text().trim();
                const date = new Date(title);
                if (!Number.isFinite(date.getTime())) return;
                const content = $(node).nextUntil('h2').text().trim();
                // Split release notes into individual list items before hashing.
                const entries = $(node).nextUntil('h2').find('li').toArray();
                const parts = entries.length ? entries.map(li => $(li).text()) : [content];
                for (const part of parts) {
                    const heading = part
                        .split(/[:：\n]/u)[0]
                        .trim()
                        .slice(0, 180);
                    const row = item(code, {
                        url: `${source.url}#${$(node).attr('id') ?? date.toISOString().slice(0, 10)}`,
                        entryKey: `${$(node).attr('id') ?? date.toISOString().slice(0, 10)}:${heading.toLowerCase()}`,
                        title: heading,
                        date: date.toISOString(),
                        body: part,
                    });
                    if (row)
                        rows.push({
                            ...row,
                            url: `${source.url}#${$(node).attr('id') ?? date.toISOString().slice(0, 10)}`,
                        });
                }
            });
        } else {
            $('a[href*="/news/"]').each((_, node) => {
                const a = $(node);
                // A card repeats its URL in descriptions and categories. Only its semantic heading is news.
                const title = a.find('h2,h3,h4').first().text().trim();
                if (!title) return;
                let url: string;
                try {
                    const href = a.attr('href');
                    if (!href) return;
                    url = new URL(href, source.url).href;
                } catch {
                    return;
                }
                const scope = a.closest('article,li,[class*="listItem"],[class*="post"]');
                const block = scope.length ? scope : a;
                const date =
                    block.find('time').attr('datetime') ??
                    block
                        .text()
                        .match(
                            /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}/iu,
                        )?.[0];
                const row = item(code, { url, title, date, body: '' });
                if (row) rows.push(row);
            });
        }
    }
    return [...new Map(rows.map(x => [x.eventKey, x])).values()];
}
export function extractArticle(html: string): string {
    const $ = load(html);
    $('script,style,nav,header,footer,aside,form,button').remove();
    const body = $('article').first();
    const main = body.length ? body : $('main').first();
    return clip(main.text().replace(/\s+/gu, ' ').trim().slice(0, 30000));
}

export function newsPriority(entry: { title: string; sourcePublishedAt: Date }, now = Date.now()) {
    const importance = /introduc|launch|releas|发布|推出|上线/iu.test(entry.title)
        ? 20
        : /pric|quota|limit|价格|额度/iu.test(entry.title)
          ? 15
          : /feature|update|功能|更新/iu.test(entry.title)
            ? 10
            : 5;
    return importance - (now - entry.sourcePublishedAt.getTime()) / 86400000;
}
