import { blogCategories, BlogDraft, emptyBlogDraft } from '@vendure/storefront-content-plugin';
import { createHash } from 'node:crypto';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const budgetDate = (date = new Date()) =>
    new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
export interface EditorialSettings {
    skillEnabled: boolean;
    skillPublishTime: string;
    skillMinStars: number;
    title: string;
    description: string;
    textProviderCode: string;
    textModel: string;
    imageProviderCode: string;
    imageModel: string;
    imageProtocol: string;
    dailyBudgetMicros: number;
    textReserveMicros: number;
    imageReserveMicros: number;
}
export const defaultSettings: EditorialSettings = {
    skillEnabled: false,
    skillPublishTime: '09:00',
    skillMinStars: 1000,
    title: 'AI 最新资讯与实用指南',
    description: '关注 ChatGPT、Claude、Gemini 的产品更新、使用方法与行业动态',
    textProviderCode: '',
    textModel: '',
    imageProviderCode: '',
    imageModel: '',
    imageProtocol: 'OPENAI_IMAGES',
    dailyBudgetMicros: 0,
    textReserveMicros: 0,
    imageReserveMicros: 0,
};
function text(value: unknown, max: number): string {
    if (typeof value !== 'string') return '';
    return value
        .replace(/\u0000/gu, '')
        .trim()
        .slice(0, max);
}
export function citationUrl(raw: unknown): string {
    const url = new URL(text(raw, 2048));
    if (url.protocol !== 'https:' || url.username || url.password || url.port)
        throw new Error('来源必须为公开 HTTPS 地址');
    for (const key of [...url.searchParams.keys()])
        if (/^(utm_|fbclid|gclid)/u.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
}
export function normalizeDraft(raw: unknown): BlogDraft {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('文章格式无效');
    const x = raw as Record<string, unknown>;
    const draft = emptyBlogDraft();
    for (const k of ['title', 'summary', 'body', 'seoDescription'] as const)
        draft[k] = text(x[k], k === 'body' ? 50000 : k === 'title' ? 160 : 800);
    if (!blogCategories.includes(x.category as never)) throw new Error('文章分类无效');
    draft.category = x.category as BlogDraft['category'];
    if (!['NEWS', 'ANALYSIS', 'GUIDE', 'COMPARISON', 'SKILL'].includes(String(x.format)))
        throw new Error('文章类型无效');
    draft.format = x.format as BlogDraft['format'];
    draft.pinned = x.pinned === true;
    for (const k of ['tags', 'candidateTitles', 'relatedProductIds'] as const)
        draft[k] = Array.isArray(x[k])
            ? [...new Set(x[k].map(v => text(v, 160)).filter(Boolean))].slice(
                  0,
                  k === 'candidateTitles' ? 3 : 12,
              )
            : [];
    draft.sources = Array.isArray(x.sources)
        ? x.sources.slice(0, 20).map(v => ({
              label: text(v.label, 200),
              url: citationUrl(v.url),
              accessedAt: new Date(v.accessedAt).toISOString(),
          }))
        : [];
    draft.facts = Array.isArray(x.facts)
        ? x.facts.slice(0, 60).map(v => ({
              text: text(v.text, 1000),
              sourceUrl: citationUrl(v.sourceUrl),
              quote: text(v.quote, 1500),
          }))
        : [];
    // Media is server-owned and is attached by the service after asset/channel validation.
    if (Buffer.byteLength(JSON.stringify(draft), 'utf8') > 56000)
        throw new Error('文章内容过长，请精简正文与来源后保存');
    return draft;
}
export function contentIssues(draft: BlogDraft): string[] {
    const issues: string[] = [];
    if (!draft.title || draft.body.length < 100 || !draft.summary) issues.push('标题、摘要或正文不完整');
    if (!draft.sources.length) issues.push('缺少可核对的官方来源');
    const urls = new Set(draft.sources.map(x => x.url));
    if (draft.facts.some(x => !urls.has(x.sourceUrl))) issues.push('事实引用不在本文来源内');
    if (!draft.cover) issues.push('封面尚未准备完成');
    if ([draft.cover, ...draft.illustrations].some(x => x?.kind === 'SOURCE' && !x.rightsConfirmed))
        issues.push('请确认来源图片的使用依据');
    return issues;
}
export function verifyGeneratedDraft(
    draft: BlogDraft,
    evidence: Array<{ url: string; body: string; title: string }>,
): string[] {
    const issues: string[] = [];
    const urls = new Set(evidence.map(x => x.url));
    if (draft.sources.some(x => !urls.has(x.url))) issues.push('模型添加了未提供的来源');
    const joined = evidence
        .map(x => x.title + ' ' + x.body)
        .join(' ')
        .toLowerCase();
    const numbers =
        [draft.title, draft.summary, draft.body, ...draft.candidateTitles, ...draft.facts.map(x => x.text)]
            .join(' ')
            .match(/(?:[$¥€]\s*)?\d+(?:[.,]\d+)*(?:\s*%|\s*美元|\s*万|\s*倍)?/gu) ?? [];
    for (const number of numbers) {
        if (number.trim().length > 1 && !joined.includes(number.trim().toLowerCase()))
            issues.push(`需核对正文数值：${number}`);
    }
    if (draft.candidateTitles.length !== 3) issues.push('候选标题不足三个');
    if (!draft.facts.length) issues.push('缺少事实依据');
    for (const fact of draft.facts) {
        const source = evidence.find(x => x.url === fact.sourceUrl);
        if (
            !source ||
            !fact.quote ||
            fact.quote.trim().length < 12 ||
            !source.body.replace(/\s+/gu, ' ').includes(fact.quote.replace(/\s+/gu, ' ').trim())
        )
            issues.push('事实依据缺少可核对的原文引句');
    }
    return [...new Set(issues)];
}

/** MySQL TEXT limit also applies after attaching provenance and private candidates. */
export function serializeDraft(draft: BlogDraft): string {
    const bounded = { ...draft, sourceImages: draft.sourceImages?.slice(0, 3) };
    let value = JSON.stringify(bounded);
    while (Buffer.byteLength(value, 'utf8') > 60000 && bounded.sourceImages?.length) {
        bounded.sourceImages.pop();
        value = JSON.stringify(bounded);
    }
    if (Buffer.byteLength(value, 'utf8') > 60000) throw new Error('正文与图片信息过长，请精简后再保存');
    return value;
}
