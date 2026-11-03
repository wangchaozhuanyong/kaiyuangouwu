import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import { freeDraftDigest, freeDraftIssues, freeNewsDraft, freeSkillDraft } from './free-content';
import { dayStart, historyDays, previousMonth } from './history';
import { SkillEvidence } from './skills-source';
import { decodeSourceResponse } from './source-response';
vi.mock(
    '@vendure/storefront-content-plugin',
    async () => import('../../storefront-content-plugin/src/shared/news-blog.js'),
);
const source = {
    title: 'Introducing a synthetic official feature for document work',
    body: 'This is synthetic source evidence for a test, not real news. '.repeat(12),
    url: 'https://openai.com/news/synthetic-fixture',
    category: 'chatgpt' as const,
    sourceCode: 'openai',
    sourcePublishedAt: new Date('2026-10-04T08:00:00Z'),
    fetchedAt: new Date('2026-11-02T08:00:00Z'),
};
describe('free source briefs and bounded historical replay', () => {
    it.each([
        ['Azure VM/VMSS router. WHEN: create a VM, dev/test, test workloads.', '虚拟机与伸缩集管理'],
        [
            'Make, edit, animate, or render a video, animation, or motion graphic. Do not use for a browser session.',
            '视频与动效制作',
        ],
        [
            'Turn on Cache Components in a Next.js app and resolve blocking routes. Use frontend tests later.',
            'Next.js 缓存组件配置',
        ],
        ['Inspect an unfamiliar source artifact. Not for frontend, video or browser tests.', null],
        ['Not for frontend design. Read the original workflow instructions.', null],
    ])('uses the main purpose instead of incidental or excluded triggers: %s', (description, expected) => {
        const result = freeSkillDraft(
            {
                name: 'synthetic-skill',
                repository: 'owner/repo',
                repositoryId: '123',
                directory: 'skills/demo',
                description,
                body: 'Synthetic test instructions. '.repeat(20),
                commit: 'a'.repeat(40),
                stars: 2000,
                rankings: [{ view: 'hot', rank: 2, url: 'https://www.skills.sh/hot', displayCount: '2K' }],
                observedAt: new Date().toISOString(),
                readme: '',
                aliases: [],
            },
            'synthetic',
        );
        if (expected) expect(result.title).toContain(expected);
        else {
            expect(result.title).toBe('synthetic-skill：原文用途与使用说明');
            expect(result.body).not.toContain('用途标签：');
        }
        expect(result.candidateTitles.join(' ')).not.toContain('undefined');
    });
    it('retains actual publication/collection dates and discloses historical reconstruction', () => {
        const draft = freeNewsDraft(source, '2026-10-05');
        expect(draft.body).toContain('2026-10-04');
        expect(draft.body).toContain('2026-11-02');
        expect(draft.body).toContain('不代表本站在模拟日期已经发布');
        expect(draft.sources[0].url).toBe(source.url);
        expect(source.body).toContain(draft.facts[0].quote);
        expect(draft.tags).toContain('历史补录');
    });
    it('checks full prose and metadata, independent of selected fact quotes', () => {
        const expected = freeNewsDraft(source);
        expect(freeDraftIssues(expected, expected)).toEqual([]);
        expect(
            freeDraftIssues({ ...expected, body: expected.body + '\n夸大且没有依据的收费承诺' }, expected),
        ).toHaveLength(1);
        expect(freeDraftIssues({ ...expected, title: '未经来源支持的标题' }, expected)).toHaveLength(1);
        expect(
            freeDraftDigest({
                ...expected,
                cover: { assetId: '1', url: '/asset.webp', alt: '模板', generated: false },
            }),
        ).toBe(freeDraftDigest(expected));
    });
    it('does not fabricate a brief from missing source evidence', () => {
        expect(() => freeNewsDraft({ ...source, body: '' })).toThrow('原文不足');
        expect(() => freeNewsDraft({ ...source, sourceCode: 'unknown' })).toThrow('未知官方来源');
    });
    it('uses a verified short official RSS summary without pretending to have read the full page', () => {
        const body =
            'Synthetic official feed summary with enough concrete source words for a short brief only. Additional supported details.';
        expect(() => freeNewsDraft({ ...source, body })).toThrow('原文不足');
        const brief = freeNewsDraft({ ...source, body, evidenceMode: 'OFFICIAL_RSS' });
        expect(brief.body).toContain('全文页面暂不可读取');
        expect(brief.facts[0].sourceUrl).toBe('https://openai.com/news/rss.xml');
        expect(brief.sources.some(x => x.url === brief.facts[0].sourceUrl)).toBe(true);
        expect(() =>
            freeNewsDraft({ ...source, body: 'Only a title', evidenceMode: 'OFFICIAL_RSS' }),
        ).toThrow('原文不足');
    });
    it('keeps excerpts short for both English and Chinese sources', () => {
        expect(freeNewsDraft(source).facts[0].quote?.split(' ').length).toBeLessThanOrEqual(16);
        expect(
            freeNewsDraft({ ...source, body: '这是明确标注为合成的中文测试资料。'.repeat(20) }).facts[0].quote
                ?.length,
        ).toBeLessThanOrEqual(28);
    });
    it('discloses that historical skills use current observed heat and fixed source versions', () => {
        const evidence: SkillEvidence = {
            repository: 'owner/repo',
            repositoryId: '123',
            directory: 'skills/test-skill',
            name: 'test-skill',
            description: 'Create frontend interfaces using the supplied project instructions.',
            body: 'Synthetic source instructions. '.repeat(20),
            readme: '',
            commit: 'a'.repeat(40),
            stars: 12000,
            rankings: [{ view: 'all-time', rank: 4, url: 'https://www.skills.sh/', displayCount: '12K' }],
            observedAt: '2026-11-02T08:00:00Z',
            aliases: [],
            sourceSnapshotAt: '2026-09-30T08:00:00Z',
        };
        const draft = freeSkillDraft(evidence, 'test-identity', '2026-10-06');
        expect(draft.skill?.sourceCommit).toBe(evidence.commit);
        expect(draft.skill?.stars).toBe(12000);
        expect(draft.body).toContain('不是历史某一天的热度快照');
        expect(draft.body).toContain('2026-09-30T08:00:00Z');
        expect(
            freeDraftIssues(
                { ...draft, skill: draft.skill ? { ...draft.skill, stars: 999999 } : undefined },
                draft,
            ),
        ).toHaveLength(1);
    });
    it('uses calendar month defaults and Malaysia day boundaries without moving historical dates on retry', () => {
        const now = new Date('2026-11-02T15:59:00Z');
        expect(previousMonth(now)).toEqual({ start: '2026-10-02', end: '2026-11-01' });
        expect(historyDays('2026-10-02', '2026-11-01', now)).toHaveLength(31);
        expect(historyDays('2026-10-02', '2026-11-01', new Date('2026-11-03T01:00:00Z'))).toHaveLength(31);
        expect(() => historyDays('2026-10-01', '2026-11-01', now)).toThrow('最多 31 天');
        expect(() => historyDays('2026-11-01', '2026-11-02', now)).toThrow();
        expect(() => dayStart('2026-02-30')).toThrow('日期无效');
    });
    it('decodes real HTTP encodings while rejecting expansion bombs and unknown encodings', () => {
        const bytes = Buffer.from('实际响应格式的合成测试正文'.repeat(10));
        for (const [kind, encoded] of [
            ['gzip', gzipSync(bytes)],
            ['br', brotliCompressSync(bytes)],
            ['deflate', deflateSync(bytes)],
        ] as const)
            expect(decodeSourceResponse(encoded, kind, 10000).equals(bytes)).toBe(true);
        expect(() => decodeSourceResponse(gzipSync(Buffer.alloc(10000)), 'gzip', 500)).toThrow('解压后过大');
        expect(() => decodeSourceResponse(Buffer.from('invalid'), 'gzip', 100)).toThrow();
        expect(() => decodeSourceResponse(Buffer.from('data'), 'unknown', 100)).toThrow('不支持');
        expect(decodeSourceResponse(Buffer.alloc(0), 'gzip', 100)).toHaveLength(0);
    });
});
