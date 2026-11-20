import { BlogDraft, emptyBlogDraft } from '@vendure/storefront-content-plugin';
import { createHash } from 'node:crypto';

import { reviewedNewsForSource } from './reviewed-news';
import { preferredSkillRanking, SkillEvidence, skillSourceUrl } from './skills-source';

export interface BriefSource {
    title: string;
    body: string;
    url: string;
    category: BlogDraft['category'];
    sourcePublishedAt: Date;
    fetchedAt: Date;
    sourceCode: string;
    evidenceMode?: string;
}
const labels: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    'gemini-blog': 'Google Gemini',
    'gemini-api': 'Gemini API',
};
const feeds: Record<string, string> = {
    openai: 'https://openai.com/news/rss.xml',
    'gemini-blog': 'https://blog.google/rss/',
};
export function freeSourceSufficient(source: Pick<BriefSource, 'body' | 'sourceCode' | 'evidenceMode'>) {
    return (
        source.body.length >= 200 ||
        (source.evidenceMode === 'OFFICIAL_RSS' && !!feeds[source.sourceCode] && source.body.length >= 80)
    );
}
const day = (date: Date | string) =>
    new Date(new Date(date).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const plain = (value: string) => value.replace(/\s+/gu, ' ').trim();
function excerpt(body: string, title = '') {
    let value = plain(body);
    if (title && value.startsWith(plain(title))) value = value.slice(plain(title).length).trim();
    return (
        /[\u3400-\u9fff]/u.test(value)
            ? value.slice(0, 28)
            : value.split(' ').slice(0, 16).join(' ').slice(0, 96)
    ).trim();
}
const safe = (value: string) => value.replace(/([\\`*_[\]<>])/gu, '\\$1');
function historyNotice(historyDay: string | undefined, sourceDate: string, collectedAt: string) {
    return historyDay
        ? `\n\n## 历史补录说明\n模拟整理日期：${historyDay}；来源日期：${sourceDate}；本次采集日期：${collectedAt}。这是根据本次可核对资料补录的历史内容，不代表本站在模拟日期已经发布，也不保证还原当日网页版本。`
        : '';
}
/** A reviewed edition belongs to this source and to a specific set of verified claims. */
export function reviewedSourceNews(source: Pick<BriefSource, 'url' | 'title' | 'body'>) {
    const edition = reviewedNewsForSource(source.url, source.title + ' ' + source.body);
    if (!edition?.facts.length) return;
    const evidence = plain(source.body);
    if (
        edition.facts.every(
            fact =>
                fact.sourceUrl === source.url &&
                fact.quote &&
                plain(fact.quote).length >= 12 &&
                evidence.includes(plain(fact.quote)),
        )
    )
        return edition;
}

/** Free publication never pays for translation or substitutes a generic template for reporting. */
export function freeNewsDraft(source: BriefSource, historyDay?: string): BlogDraft | null {
    if (!freeSourceSufficient(source) || !source.title.trim()) throw new Error('官方原文不足，不能整理快讯');
    const label = labels[source.sourceCode];
    if (!label) throw new Error('未知官方来源');
    const edition = reviewedSourceNews(source);
    if (!edition) return null;
    const published = day(source.sourcePublishedAt);
    const collected = day(source.fetchedAt);
    const feed = source.evidenceMode === 'OFFICIAL_RSS' ? feeds[source.sourceCode] : undefined;
    const body =
        edition.zh.body +
        (feed ? '\n\n本篇依据官方订阅摘要整理，全文页面暂不可读取。' : '') +
        historyNotice(historyDay, published, collected);
    const englishBody =
        edition.en.body +
        (feed
            ? '\n\nThis brief is based on the official feed summary. The full article was unavailable.'
            : '') +
        (historyDay
            ? `\n\n## Archive note\nThe source is dated ${published} and was collected on ${collected}. ` +
              `The replay date (${historyDay}) is not the publication date of this article.`
            : '');
    return {
        ...emptyBlogDraft(),
        ...edition.zh,
        body,
        category: source.category,
        format: 'NEWS',
        tags: ['来源快讯', ...edition.zh.tags, ...(historyDay ? ['历史补录'] : [])],
        candidateTitles: [edition.zh.title],
        translations: { en: { ...edition.en, body: englishBody } },
        sources: [
            ...(feed
                ? [{ label: `${label} 官方 RSS 摘要`, url: feed, accessedAt: source.fetchedAt.toISOString() }]
                : []),
            { label: `${label} 官方原文`, url: source.url, accessedAt: source.fetchedAt.toISOString() },
        ],
        facts: edition.facts.map(fact => ({ ...fact, sourceUrl: feed ?? fact.sourceUrl })),
    };
}

const purposes: Array<[RegExp, string]> = [
    [/\b(?:Azure\s+)?(?:VMSS|VMs?|virtual machines?)\b/iu, '虚拟机与伸缩集管理'],
    [/\bCache Components\b/iu, 'Next.js 缓存组件配置'],
    [/\bAzure\b.{0,40}\bquotas?\b/iu, 'Azure 配额与用量管理'],
    [/frontend|front.end|web design|user interface|\bUI\b/iu, '前端界面设计'],
    [/browser|playwright|puppeteer/iu, '浏览器操作与网页测试'],
    [/\bpdf\b/iu, 'PDF 文档处理'],
    [/spreadsheet|xlsx|excel/iu, '表格文件处理'],
    [/presentation|powerpoint|pptx/iu, '演示文稿处理'],
    [/video|remotion|motion/iu, '视频与动效制作'],
    [/postgres|\bsql\b|database/iu, '数据库与 SQL'],
    [/security|vulnerability/iu, '安全检查'],
    [/\b(?:tests?|testing)\b/iu, '软件测试'],
    [/code review/iu, '代码审查'],
    [/\bseo\b|search engine/iu, '网站搜索优化'],
];
function skillPurpose(description: string) {
    // Classify the subject in the leading sentence, rather than triggers and exclusions later in the text.
    const lead = plain(description).split(
        /[.!?。！？](?:\s|$)|\b(?:WHEN|DO NOT|NOT FOR)\s*:|\b(?:not for|do not use|does not)\b/iu,
    )[0];
    return purposes
        .map(([pattern, label]) => ({ index: lead.search(pattern), label }))
        .filter(x => x.index >= 0)
        .sort((a, b) => a.index - b.index)[0]?.label;
}
export function freeSkillDraft(e: SkillEvidence, identity: string, historyDay?: string): BlogDraft {
    if (!/^[a-f0-9]{40}$/u.test(e.commit) || e.stars < 1000 || !e.description || e.body.length < 200)
        throw new Error('Skill 原文、版本或热度不足');
    const purpose = skillPurpose(e.description);
    const quote = excerpt(e.description);
    if (quote.length < 12) throw new Error('Skill 用途依据不足');
    const rank = preferredSkillRanking(e);
    if (!rank) throw new Error('缺少公开热度依据');
    const source = skillSourceUrl(e);
    const title = `${e.name}：${purpose ? `${purpose} Skill 的用途与来源` : '原文用途与使用说明'}`.slice(
        0,
        160,
    );
    const summary = `本次依据固定版本说明介绍 ${e.name}。下方提供原文用途要点、适用前的检查项和 GitHub 仓库入口；仓库热度是采集时的收藏数，不代表该 Skill 的单独安装量或实际效果。`;
    const observed = day(e.observedAt);
    return {
        ...emptyBlogDraft(),
        title,
        summary,
        category: 'skills',
        format: 'SKILL',
        tags: ['热门 Skill', '来源整理', ...(historyDay ? ['历史补录'] : [])],
        candidateTitles: [
            title,
            `${e.name} 用途速览与固定版本原文`,
            `${purpose ?? '原文用途'}介绍：${e.name}`,
        ],
        body: [
            `## 这是什么\n${e.name} 是 ${e.repository} 仓库中提供的 Skill 文档。本文以固定 GitHub 提交中的 SKILL.md 为依据整理，具体能力与限制应核对原文。`,
            `## 用途与适用场景\n说明中的用途要点（原文节选）：「${safe(quote)}」`,
            purpose
                ? `用途标签：${purpose}。这只是根据主要用途说明整理的标签，不替代完整使用文档，也不代表本站已经运行或测试该项目。`
                : '主要用途请核对上方原文与下方固定版本说明；本文没有为未明确的能力添加用途标签。',
            `## 使用前应核对什么\n先阅读仓库说明、依赖要求和授权许可，再检查所需工具、文件及执行权限。不要仅凭热度运行不理解的脚本或提交敏感资料。`,
            `## 热度与来源\n截至${observed}，来源记录中的仓库收藏数为 ${e.stars} Star。该数字属于整个仓库；榜单记录为 ${rank.view} 第 ${rank.rank} 名，属于本次采集观察，不是历史某一天的热度快照。本段保留整理时的记录，最近采集的热度见本文来源卡片。`,
            `## 查看与开始使用\n[查看 GitHub 仓库](https://github.com/${e.repository})`,
            `[核对本次固定版本的 SKILL.md](${source})${historyNotice(historyDay, e.sourceSnapshotAt ?? '固定版本原文', observed)}`,
        ].join('\n\n'),
        sources: [{ label: '固定版本 SKILL.md', url: source, accessedAt: e.observedAt }],
        facts: [{ text: 'Skill 原文用途说明', sourceUrl: source, quote }],
        seoDescription: summary,
        skill: {
            identity,
            name: e.name,
            repository: e.repository,
            repositoryId: e.repositoryId,
            repositoryUrl: `https://github.com/${e.repository}`,
            directoryUrl: `https://github.com/${e.repository}/tree/${e.commit}${e.directory ? `/${e.directory}` : ''}`,
            stars: e.stars,
            trend: rank.view === 'all-time' ? 'EVERGREEN' : 'RECENT',
            rankingUrl: rank.url,
            rankingLabel: rank.view === 'trending' ? 'Trending' : rank.view === 'hot' ? 'Hot' : 'All Time',
            rank: rank.rank,
            observedAt: e.observedAt,
            sourceCommit: e.commit,
        },
    };
}

/** Covers every textual/public claim; images are checked independently by existing asset rules. */
export function freeDraftDigest(draft: BlogDraft) {
    const { cover: _cover, illustrations: _illustrations, sourceImages: _candidates, ...content } = draft;
    return createHash('sha256')
        .update(
            JSON.stringify(content, (_key, value) =>
                value && typeof value === 'object' && !Array.isArray(value)
                    ? Object.fromEntries(
                          Object.keys(value)
                              .sort()
                              .map(key => [key, value[key]]),
                      )
                    : value,
            ),
        )
        .digest('hex');
}
export const freeDraftIssues = (actual: BlogDraft, expected: BlogDraft) =>
    freeDraftDigest(actual) === freeDraftDigest(expected)
        ? []
        : ['免费整理内容与固定来源结果不一致，需人工审核'];
