import { BlogDraft, emptyBlogDraft } from '@vendure/storefront-content-plugin';
import { createHash } from 'node:crypto';

import { SkillEvidence, skillSourceUrl } from './skills-source';

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
const shortTitle = (value: string) =>
    /[\u3400-\u9fff]/u.test(value)
        ? plain(value).slice(0, 18)
        : plain(value).split(' ').slice(0, 7).join(' ').slice(0, 80);
// The published excerpt and original headline together stay below 25 English words.
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
function newsTopic(title: string) {
    if (/pric|subscription|quota|billing|价格|订阅|额度/iu.test(title)) return '订阅、计费与额度说明';
    if (/deprecat|shutdown|retir|停用|弃用/iu.test(title)) return '版本弃用与迁移提醒';
    if (/computer use/iu.test(title)) return 'Computer Use 相关更新';
    if (/\bCLI\b|command.line/iu.test(title)) return '命令行工具更新';
    if (/storage|logging|privacy|安全|隐私/iu.test(title)) return '数据与使用规则说明';
    if (/science|research|科研|研究/iu.test(title)) return '科研与研究动态';
    return shortTitle(title);
}

/** Deterministic source brief. This function never invokes a model or invents a translation. */
export function freeNewsDraft(source: BriefSource, historyDay?: string): BlogDraft {
    if (!freeSourceSufficient(source) || !source.title.trim()) throw new Error('官方原文不足，不能整理快讯');
    const label = labels[source.sourceCode];
    if (!label) throw new Error('未知官方来源');
    const published = day(source.sourcePublishedAt);
    const collected = day(source.fetchedAt);
    const quote = excerpt(source.body, source.title);
    const feed = source.evidenceMode === 'OFFICIAL_RSS' ? feeds[source.sourceCode] : undefined;
    const basis = feed ? '官方订阅摘要' : '官方原文';
    if (quote.length < 12) throw new Error('缺少可核对的原文要点');
    const topic = newsTopic(source.title);
    const title = `${label} 官方动态：${topic}（${published}）`.slice(0, 160);
    const summary = `${label} 于${published}发布相关官方信息。本条快讯保留可核对的原文要点与来源入口，帮助读者确认更新内容。开放范围、账号条件与后续调整以官方说明为准；本文不补写未公布的价格、额度或性能结论。`;
    return {
        ...emptyBlogDraft(),
        title,
        summary,
        category: source.category,
        format: 'NEWS',
        tags: ['来源快讯', ...(historyDay ? ['历史补录'] : [])],
        candidateTitles: [
            title,
            `${label} ${published} 公告要点：${topic}`.slice(0, 160),
            `${topic}：${label} 官方来源速览`.slice(0, 160),
        ],
        body: [
            `## 发生了什么\n${label} 于${published}发布了相关官方信息。本文根据官方来源整理，原文入口见文末。`,
            `## 关键变化\n${basis}要点（节选）：「${safe(quote)}」`,
            ...(feed ? ['本条快讯仅依据官方 RSS 摘要整理；全文页面暂不可读取，不补充摘要之外的细节。'] : []),
            `这段原文用于核对消息内容，不代表本站进行了独立测试。为避免误译，未有可靠中文版本的原文要点保留原语言。`,
            `## 对用户的影响\n正在使用相关产品的读者，可以对照原文确认是否涉及自己的账号、工作流程或所用版本，再决定是否调整使用方式。`,
            `## 使用条件与限制\n功能是否对你的地区、套餐或账号开放，应以官方页面和账号内实际显示为准。公告未明确说明的价格、额度、兼容性及性能，本文不作推断。`,
            `## 参考来源\n[${label} 官方原文](${source.url})${historyNotice(historyDay, published, collected)}`,
        ].join('\n\n'),
        sources: [
            ...(feed
                ? [{ label: `${label} 官方 RSS 摘要`, url: feed, accessedAt: source.fetchedAt.toISOString() }]
                : []),
            { label: `${label} 原文入口`, url: source.url, accessedAt: source.fetchedAt.toISOString() },
        ],
        facts: [{ text: `${basis}要点`, sourceUrl: feed ?? source.url, quote }],
        seoDescription: summary,
    };
}

const purposes: Array<[RegExp, string]> = [
    [/frontend|front.end|web design|user interface|\bUI\b/iu, '前端界面设计'],
    [/browser|playwright|puppeteer/iu, '浏览器操作与网页测试'],
    [/\bpdf\b/iu, 'PDF 文档处理'],
    [/spreadsheet|xlsx|excel/iu, '表格文件处理'],
    [/presentation|powerpoint|pptx/iu, '演示文稿处理'],
    [/video|remotion|motion/iu, '视频与动效制作'],
    [/postgres|\bsql\b|database/iu, '数据库与 SQL'],
    [/security|vulnerability/iu, '安全检查'],
    [/\btest|testing/iu, '软件测试'],
    [/code review/iu, '代码审查'],
    [/\bseo\b|search engine/iu, '网站搜索优化'],
];
export function freeSkillDraft(e: SkillEvidence, identity: string, historyDay?: string): BlogDraft {
    if (!/^[a-f0-9]{40}$/u.test(e.commit) || e.stars < 1000 || !e.description || e.body.length < 200)
        throw new Error('Skill 原文、版本或热度不足');
    const purpose = purposes.find(([pattern]) => pattern.test(e.description))?.[1] ?? '可复用的工作流程';
    const quote = excerpt(e.description);
    if (quote.length < 12) throw new Error('Skill 用途依据不足');
    const rank = [...e.rankings].sort(
        (a, b) =>
            ['trending', 'hot', 'all-time'].indexOf(a.view) - ['trending', 'hot', 'all-time'].indexOf(b.view),
    )[0];
    if (!rank) throw new Error('缺少公开热度依据');
    const source = skillSourceUrl(e);
    const title = `${e.name}：${purpose} Skill 的用途与来源`.slice(0, 160);
    const summary = `本次介绍 ${e.name}，用途标签依据其固定版本说明整理。下方提供原文要点、适用前的检查项和 GitHub 仓库入口；仓库热度是采集时的收藏数，不代表该 Skill 的单独安装量或实际效果。`;
    const observed = day(e.observedAt);
    return {
        ...emptyBlogDraft(),
        title,
        summary,
        category: 'skills',
        format: 'SKILL',
        tags: ['热门 Skill', '来源整理', ...(historyDay ? ['历史补录'] : [])],
        candidateTitles: [title, `${e.name} 用途速览与固定版本原文`, `${purpose}相关 Skill：${e.name}`],
        body: [
            `## 这是什么\n${e.name} 是 ${e.repository} 仓库中提供的 Skill 文档。本文以固定 GitHub 提交中的 SKILL.md 为依据整理，具体能力与限制应核对原文。`,
            `## 用途与适用场景\n说明中的用途要点（原文节选）：「${safe(quote)}」`,
            `用途标签：${purpose}。这只是根据说明中的明确词语整理的标签，不替代完整使用文档，也不代表本站已经运行或测试该项目。`,
            `## 使用前应核对什么\n先阅读仓库说明、依赖要求和授权许可，再检查所需工具、文件及执行权限。不要仅凭热度运行不理解的脚本或提交敏感资料。`,
            `## 热度与来源\n截至${observed}，来源记录中的仓库收藏数为 ${e.stars} Star。该数字属于整个仓库；榜单记录为 ${rank.view} 第 ${rank.rank} 名，属于本次采集观察，不是历史某一天的热度快照。`,
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
