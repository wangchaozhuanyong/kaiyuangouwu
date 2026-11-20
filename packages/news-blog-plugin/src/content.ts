import {
    blogCategories,
    BlogDraft,
    type BlogNewsEdition,
    BlogSkillProfile,
    emptyBlogDraft,
    skillDomains,
    skillProfileBody,
} from '@vendure/storefront-content-plugin';
import { createHash } from 'node:crypto';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const budgetDate = (date = new Date()) =>
    new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
export const newsSourceReviewIssue = '请逐项对照原文核对中英文的数字、适用对象和生效时间';
export const englishEditionReviewIssue = '中文稿已修改，请核对英文稿并更新或确认仍适用';
export interface EditorialSettings {
    /** LEGACY only permits restoration/testing of historical queue snapshots; settings writes select the current flow. */
    skillEditorialMode: 'CODEX' | 'LEGACY';
    coverMode: 'CATEGORY' | 'LEGACY';
    freeMode: boolean;
    freeAutoPublish: boolean;
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
    skillEditorialMode: 'CODEX',
    coverMode: 'CATEGORY',
    freeMode: false,
    freeAutoPublish: false,
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
export function normalizeSkillProfile(raw: unknown): BlogSkillProfile {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('缺少 Skill 用途资料');
    const value = raw as Record<string, unknown>;
    if (!Object.hasOwn(skillDomains, String(value.domain))) throw new Error('Skill 领域无效');
    const list = (key: string, min: number, max: number) => {
        const items = Array.isArray(value[key])
            ? [...new Set(value[key].map(x => text(x, 400)).filter(Boolean))]
            : [];
        if (items.length < min || items.length > max) throw new Error(`Skill ${key} 数量无效`);
        return items;
    };
    const example = value.example as Record<string, unknown> | undefined;
    const profile: BlogSkillProfile = {
        domain: value.domain as BlogSkillProfile['domain'],
        displayName: text(value.displayName, 80),
        purpose: text(value.purpose, 300),
        audience: text(value.audience, 200),
        industries: list('industries', 0, 4),
        capabilities: list('capabilities', 2, 6),
        example: { input: text(example?.input, 600), output: text(example?.output, 600) },
        prerequisites: list('prerequisites', 1, 6),
        limitations: list('limitations', 1, 6),
    };
    for (const entry of [
        profile.displayName,
        profile.purpose,
        profile.audience,
        ...profile.capabilities,
        profile.example.input,
        profile.example.output,
        ...profile.prerequisites,
        ...profile.limitations,
    ]) {
        if (!/[\u3400-\u9fff]/u.test(entry) || /<[^>]+>|\u0000/u.test(entry))
            throw new Error('用途资料须为清晰中文纯文本');
    }
    return profile;
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
    const english = (x.translations as { en?: Partial<BlogNewsEdition> } | undefined)?.en;
    if (english !== undefined) {
        if (!english || typeof english !== 'object' || Array.isArray(english))
            throw new Error('英文稿格式无效');
        if (draft.category === 'skills') throw new Error('双语资讯翻译仅适用于新闻文章');
        draft.translations = {
            en: {
                title: text(english.title, 160),
                summary: text(english.summary, 800),
                body: text(english.body, 50000),
                seoDescription: text(english.seoDescription, 800),
                tags: Array.isArray(english.tags)
                    ? [...new Set(english.tags.map(tag => text(tag, 160)).filter(Boolean))].slice(0, 12)
                    : [],
            },
        };
    }

    if (x.skillProfile !== undefined) {
        if (draft.category !== 'skills') throw new Error('用途资料仅用于 Skill 文章');
        draft.skillProfile = normalizeSkillProfile({
            ...(x.skillProfile as object),
            displayName: draft.title,
            purpose: draft.summary,
        });
        draft.body = skillProfileBody(draft.skillProfile);
    }
    for (const k of ['tags', 'candidateTitles', 'relatedProductIds'] as const)
        draft[k] = Array.isArray(x[k])
            ? [...new Set(x[k].map(v => text(v, 160)).filter(Boolean))].slice(
                  0,
                  k === 'candidateTitles' ? 3 : 12,
              )
            : [];
    if (draft.skillProfile) {
        const domains: string[] = Object.values(skillDomains);
        draft.tags = [
            skillDomains[draft.skillProfile.domain],
            ...draft.skillProfile.industries,
            ...draft.tags.filter(tag => !domains.includes(tag)),
        ].slice(0, 12);
    }
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
    if (
        draft.category !== 'skills' &&
        (draft.summary.includes('本条快讯保留可核对的原文要点') ||
            draft.body.includes('未有可靠中文版本的原文要点保留原语言'))
    )
        issues.push('请根据原文写明具体事件、变化和影响，替换旧快讯模板');
    if (draft.category !== 'skills') {
        if (
            [draft.title, draft.summary, draft.body, draft.seoDescription]
                .filter(Boolean)
                .some(value => !/\p{Script=Han}/u.test(value))
        )
            issues.push('中文资讯的标题、摘要、正文和搜索描述均需使用中文');
        const untranslatedPassage = [draft.title, draft.summary, draft.body, draft.seoDescription].some(
            value =>
                value
                    .replace(/https?:\/\/[^\s)]+/gu, '')
                    .split(/[\n。！？：“”「」]/u)
                    .some(
                        part =>
                            !/\p{Script=Han}/u.test(part) &&
                            (part.match(/\b[a-z]+(?:['’-][a-z]+)*\b/giu) || []).length >= 8,
                    ),
        );
        if (untranslatedPassage) issues.push('中文资讯中有未翻译的英文语句，请翻译成完整中文');
    }
    const english = draft.translations?.en;
    if (english) {
        if (
            [english.title, english.summary, english.body, english.seoDescription].some(
                value => !/[a-z]/iu.test(value),
            ) ||
            [english.title, english.summary, english.body, english.seoDescription, ...english.tags].some(
                value => /\p{Script=Han}/u.test(value),
            )
        )
            issues.push('英文资讯的标题、摘要、正文、标签和搜索描述均需使用英文');
        const englishWords = (value: string) => value.match(/\b[a-z]+(?:['’-][a-z]+)*\b/giu)?.length ?? 0;
        if (
            englishWords(english.title) < 2 ||
            englishWords(english.summary) < 3 ||
            englishWords(english.body.replace(/^#{1,3}\s.*$/gmu, '')) < 6 ||
            englishWords(english.seoDescription) < 3
        ) {
            issues.push('英文资讯需有完整标题、摘要、正文和搜索描述');
        }
    }

    const urls = new Set(draft.sources.map(x => x.url));
    if (draft.facts.some(x => !urls.has(x.sourceUrl))) issues.push('事实引用不在本文来源内');
    if ([draft.cover, ...draft.illustrations].some(x => x?.kind === 'SOURCE' && !x.rightsConfirmed))
        issues.push('请确认来源图片的使用依据');
    return issues;
}
type NewsEvidence = { url: string; body: string; title: string };

function numberClaims(value: string) {
    const matches = value
        .normalize('NFKC')
        .replace(/https?:\/\/[^\s)]+/gu, '')
        .replace(/^\s*\d+[.)、]\s+/gmu, '')
        .matchAll(
            /([$¥€£]|\bUSD\b|\bCNY\b)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*(%|percent\b|per cent\b|美元|dollars?\b|人民币|欧元|euros?\b|英镑|pounds?\b|[万亿倍]|times\b|×|x\b))?/giu,
        );
    return Array.from(matches, ([label, prefix, digits, suffix]) => {
        const amount = digits.replaceAll(',', '').replace(/(\.\d*?[1-9])0+$|\.0+$/u, '$1');
        const unit = (prefix ?? suffix ?? '')
            .toLowerCase()
            .replace(/^percent$|^per cent$/u, '%')
            .replace(/^usd$|^dollars?$|^美元$/u, '$')
            .replace(/^cny$|^人民币$/u, '¥')
            .replace(/^euros?$|^欧元$/u, '€')
            .replace(/^pounds?$|^英镑$/u, '£')
            .replace(/^times$|^[倍×]$/u, 'x');
        return { label: label.trim(), amount, unit };
    });
}

export function isNewsEvidenceIssue(issue: string): boolean {
    return (
        issue.startsWith('需核对正文数值：') ||
        issue === '事实依据缺少可核对的原文引句' ||
        issue === '模型添加了未提供的来源'
    );
}

export function verifyNewsEvidence(draft: BlogDraft, evidence: NewsEvidence[]): string[] {
    const issues: string[] = [];
    const urls = new Set(evidence.map(x => x.url));
    if (draft.sources.some(x => !urls.has(x.url))) issues.push('模型添加了未提供的来源');
    const sourceNumbers = evidence.flatMap(item => numberClaims(item.title + '\n' + item.body));
    const exactClaims = new Set(sourceNumbers.map(({ amount, unit }) => amount + ':' + unit));
    const exactNumbers = new Set(sourceNumbers.map(({ amount }) => amount));
    const english = draft.translations?.en;
    const numbers = numberClaims(
        [
            draft.title,
            draft.summary,
            draft.body,
            draft.seoDescription,
            ...draft.candidateTitles,
            ...(english
                ? [english.title, english.summary, english.body, english.seoDescription, ...english.tags]
                : []),
            ...draft.facts.map(x => x.text),
        ].join('\n'),
    );
    for (const { label, amount, unit } of numbers) {
        if (unit ? !exactClaims.has(amount + ':' + unit) : !exactNumbers.has(amount))
            issues.push(`需核对正文数值：${label}`);
    }
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

export function verifyGeneratedDraft(draft: BlogDraft, evidence: NewsEvidence[]): string[] {
    const issues = verifyNewsEvidence(draft, evidence);
    if (draft.category !== 'skills' && !draft.translations?.en) issues.push('缺少英文资讯稿');
    if (draft.candidateTitles.length !== 3) issues.push('候选标题不足三个');
    if (!draft.facts.length) issues.push('缺少事实依据');
    return issues;
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
