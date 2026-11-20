import type { BlogFact, BlogNewsEdition } from '@vendure/storefront-content-plugin';

import archive from './reviewed-news-archive.json';

type EditorialCopy = Pick<BlogNewsEdition, 'title' | 'summary'> & { analysis: string };

/** Several Gemini bulletins share one official changelog URL and publication date. */
type ArchiveEntry = {
    url: string;
    match?: string;
    quote: string;
    zh: EditorialCopy;
    en: EditorialCopy;
};
const bySource = new Map<string, ArchiveEntry[]>();
function sourceKey(value: string) {
    try {
        const url = new URL(value);
        return url.origin + url.pathname.replace(/\/$/u, '') + url.search + url.hash;
    } catch {
        return '';
    }
}
for (const item of archive) {
    const key = sourceKey(item.url);
    bySource.set(key, [...(bySource.get(key) ?? []), item]);
}
export const reviewedNewsSourceUrls: readonly string[] = [...new Set(archive.map(item => item.url))];

function edition({ title, summary, analysis }: EditorialCopy, en: boolean): BlogNewsEdition {
    return {
        title,
        summary,
        body: [
            en ? '## What changed' : '## 具体变化',
            summary,
            en ? '## Why it matters' : '## 这意味着什么',
            analysis,
        ].join('\n\n'),
        seoDescription: summary,
        tags: [],
    };
}

export function reviewedNewsForSource(
    url: string,
    evidence = '',
): { zh: BlogNewsEdition; en: BlogNewsEdition; facts: BlogFact[] } | undefined {
    const entries = bySource.get(sourceKey(url));
    if (!entries) return;
    const text = evidence.toLowerCase();
    const matches = entries.filter(
        candidate => !candidate.match || text.includes(candidate.match.toLowerCase()),
    );
    if (matches.length !== 1) return;
    const entry = matches[0];
    return {
        zh: edition(entry.zh, false),
        en: edition(entry.en, true),
        facts: [{ sourceUrl: url, text: entry.zh.title, quote: entry.quote }],
    };
}
