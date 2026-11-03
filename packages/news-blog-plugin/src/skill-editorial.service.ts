import { Injectable } from '@nestjs/common';
import { EventBus, RequestContext, TransactionalConnection } from '@vendure/core';
import { StorefrontDataChangedEvent } from '@vendure/store-management-plugin';
import {
    BlogDraft,
    BlogPublishedArticle,
    BlogSkillInfo,
    BlogSkillProfile,
    skillDomains,
    skillProfileBody,
} from '@vendure/storefront-content-plugin';

import { BlogService } from './blog.service';
import { budgetDate, contentIssues, hash, normalizeSkillProfile, serializeDraft } from './content';
import { BlogArticle, BlogRevision, BlogRun, BlogSettings } from './entities';
import { BlogSkill, BlogSkillRecommendation } from './skill-entities';
import { BlogSkillsCatalog } from './skills-catalog';
import { BlogSkillsHttp } from './skills-http';
import {
    fingerprint,
    nearDuplicate,
    parseSkillBoard,
    preferredSkillRanking,
    SkillEvidence,
} from './skills-source';

export interface SkillEditorialInput {
    requestKey: string;
    articleId?: string;
    expectedVersion: number;
    repository: string;
    directory: string;
    commit: string;
    profile: BlogSkillProfile;
    tags?: string[];
    ranking?: 'trending' | 'hot' | 'all-time';
    claims: Array<{ field: string; quote: string }>;
}
export interface SkillEditorialReceipt {
    articleId: string;
    slug: string;
    version: number;
    action: 'PUBLISH' | 'UPDATE';
    publishedAt: string;
}
/** This is a content writer, never a model client or arbitrary script runner. */
@Injectable()
export class BlogSkillEditorialService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly blog: BlogService,
        private readonly catalog: BlogSkillsCatalog,
        private readonly http: BlogSkillsHttp,
        private readonly events: EventBus,
    ) {}
    private async lock(ctx: RequestContext) {
        await this.connection
            .getRepository(ctx, BlogSettings)
            .createQueryBuilder()
            .update()
            .set({ version: () => 'version' })
            .where('channelId = :id', { id: ctx.channelId })
            .execute();
        const settings = await this.blog.settings(ctx);
        const config = this.blog.config(settings);
        if (
            !settings.enabled ||
            !config.skillEnabled ||
            !config.freeMode ||
            config.skillEditorialMode !== 'CODEX'
        )
            throw new Error('当前店铺尚未启用免费 Codex Skill 编辑');
        return settings;
    }
    async import(ctx: RequestContext, input: SkillEditorialInput): Promise<SkillEditorialReceipt> {
        if (
            Buffer.byteLength(JSON.stringify(input), 'utf8') > 40000 ||
            !/^codex-skill:[a-zA-Z0-9:_-]{8,120}$/u.test(input.requestKey) ||
            !Number.isSafeInteger(input.expectedVersion) ||
            input.expectedVersion < 0 ||
            Boolean(input.articleId) !== input.expectedVersion > 0
        )
            throw new Error('内容导入标识、大小或版本无效');
        const profile = normalizeSkillProfile(input.profile);
        const payloadHash = hash(JSON.stringify(input));
        const admission = await this.connection.withTransaction(ctx, async tx => {
            const settings = await this.lock(tx);
            const repo = this.connection.getRepository(tx, BlogRun);
            let run = await repo.findOneBy({ channelId: tx.channelId, requestKey: input.requestKey });
            if (run) {
                const saved = JSON.parse(run.inputJson) as { payloadHash: string };
                if (saved.payloadHash !== payloadHash) throw new Error('同一请求号不能提交不同内容');
                if (run.state === 'SUCCEEDED')
                    return {
                        receipt: JSON.parse(run.telemetryJson ?? '{}').receipt as SkillEditorialReceipt,
                    };
                if (
                    run.state === 'RUNNING' &&
                    run.startedAt &&
                    Date.now() - run.startedAt.getTime() < 15 * 60000
                )
                    throw new Error('相同内容正在处理中，请等待回执');
                await repo.update(run.id, { state: 'RUNNING', startedAt: new Date(), completedAt: null });
            } else {
                run = await repo.save(
                    new BlogRun({
                        channelId: tx.channelId,
                        requestKey: input.requestKey,
                        kind: 'SKILL_EDITORIAL',
                        state: 'RUNNING',
                        budgetDate: budgetDate(),
                        reservedMicros: 0,
                        chargedMicros: 0,
                        inputJson: JSON.stringify({
                            payloadHash,
                            articleId: input.articleId,
                            expectedVersion: input.expectedVersion,
                        }),
                        telemetryJson: null,
                        message: '核对固定版本原文与中文用途资料',
                        startedAt: new Date(),
                        completedAt: null,
                    }),
                );
            }
            return { runId: String(run.id), settingsVersion: settings.version };
        });
        if ('receipt' in admission && admission.receipt) {
            await this.changed(ctx);
            return admission.receipt;
        }
        const runId = admission.runId;
        if (!runId) throw new Error('导入回执缺少任务记录');
        try {
            const evidence = await this.catalog.editorialSource(
                input.repository,
                input.directory,
                input.commit,
            );
            const identity = hash(`${evidence.repositoryId}:${evidence.directory}`);
            const old = input.articleId ? await this.blog.get(ctx, input.articleId) : null;
            const original = old?.publishedJson
                ? (JSON.parse(old.publishedJson) as BlogPublishedArticle)
                : null;
            if (
                old &&
                (!original?.skill ||
                    old.state !== 'PUBLISHED' ||
                    old.version !== input.expectedVersion ||
                    original.skill.repositoryId !== evidence.repositoryId ||
                    (!original.skill.directoryUrl.endsWith('/' + evidence.directory) &&
                        original.skill.identity !== identity))
            )
                throw new Error('文章来源、版本或编辑状态已变化，保留人工修改');
            if (!original) {
                const view = input.ranking;
                if (!view || !['trending', 'hot', 'all-time'].includes(view)) throw new Error('缺少热度榜单');
                const url =
                    'https://www.skills.sh' + (input.ranking === 'all-time' ? '/' : '/' + input.ranking);
                const board = parseSkillBoard(await this.http.read(url), view);
                const match = board.find(
                    row =>
                        row.repository.toLowerCase() === evidence.repository.toLowerCase() &&
                        row.slug === evidence.name,
                );
                if (!match) throw new Error('未在当前榜单核对到这个 Skill');
                evidence.rankings = match.rankings;
            }
            const draft = editorialDraft(profile, evidence, input.claims, original?.skill, input.tags);
            const receipt = await this.connection.withTransaction(ctx, async tx => {
                const settings = await this.lock(tx);
                if (settings.version !== admission.settingsVersion) throw new Error('店铺设置已变化');
                if (evidence.stars < this.blog.config(settings).skillMinStars)
                    throw new Error('仓库热度未达到店铺要求');
                const articles = this.connection.getRepository(tx, BlogArticle);
                const recommendations = this.connection.getRepository(tx, BlogSkillRecommendation);
                let current: BlogArticle;
                if (old) {
                    current = await this.blog.get(tx, String(old.id));
                    if (current.version !== input.expectedVersion || current.state !== 'PUBLISHED')
                        throw new Error('人工编辑版本已变化');
                    // Preserve merchant media bindings and merchandising while changing editorial copy.
                    const prior = JSON.parse(current.draftJson) as BlogDraft;
                    draft.cover = prior.cover;
                    draft.sourceImages = prior.sourceImages;
                    draft.illustrations = prior.illustrations;
                    draft.relatedProductIds = prior.relatedProductIds;
                    draft.pinned = prior.pinned;
                } else {
                    const history = await recommendations.find({ where: { channelId: tx.channelId } });
                    const candidates = await this.connection
                        .getRepository(tx, BlogSkill)
                        .find({ where: { repositoryId: evidence.repositoryId } });
                    const aliases = candidates
                        .filter(x => x.name === evidence.name && x.contentHash === fingerprint(evidence.body))
                        .flatMap(x => [x.identity, ...(JSON.parse(x.evidenceJson) as SkillEvidence).aliases]);
                    if (
                        history.some(x => {
                            const prior = JSON.parse(x.evidenceJson) as SkillEvidence;
                            return (
                                x.identity === identity ||
                                aliases.includes(x.identity) ||
                                prior.aliases?.includes(identity) ||
                                (prior.name === evidence.name &&
                                    prior.repositoryId === evidence.repositoryId &&
                                    fingerprint(prior.body) === fingerprint(evidence.body)) ||
                                nearDuplicate(prior.body, evidence.body)
                            );
                        })
                    )
                        throw new Error('这个 Skill 已有介绍，请更新原文章');
                    const day = budgetDate();
                    if (history.some(x => x.day === day)) throw new Error('今天已经推荐一篇 Skill');
                    const slug = `${evidence.name.slice(0, 70)}-${identity.slice(0, 8)}`;
                    current = await articles.save(
                        new BlogArticle({
                            channelId: tx.channelId,
                            slug,
                            eventKey: null,
                            version: 1,
                            state: 'DRAFT',
                            draftJson: serializeDraft(draft),
                            publishedJson: null,
                            publishedAt: null,
                            issuesJson: '[]',
                        }),
                    );
                    await recommendations.save(
                        new BlogSkillRecommendation({
                            channelId: tx.channelId,
                            day,
                            identity,
                            repositoryId: evidence.repositoryId,
                            status: 'PUBLISHED',
                            message: 'Codex 中文用途介绍，原文已核对',
                            articleId: String(current.id),
                            contentHash: fingerprint(evidence.body),
                            evidenceJson: JSON.stringify(evidence),
                        }),
                    );
                }
                const now = new Date().toISOString();
                const published: BlogPublishedArticle = {
                    ...draft,
                    id: String(current.id),
                    slug: current.slug,
                    version: current.version + 1,
                    publishedAt: original?.publishedAt ?? now,
                    updatedAt: now,
                    reviewedAt: null,
                    reviewerName: null,
                    publicationMode: 'AUTOMATIC',
                    readingMinutes: Math.max(1, Math.ceil(Array.from(draft.body).length / 450)),
                };
                const changed = await articles.update(
                    { id: current.id, channelId: tx.channelId, version: current.version },
                    {
                        version: published.version,
                        state: 'PUBLISHED',
                        draftJson: serializeDraft(draft),
                        publishedJson: JSON.stringify(published),
                        publishedAt: new Date(published.publishedAt),
                        publishedTitle: draft.title,
                        publishedCategory: 'skills',
                        publishedPinned: draft.pinned,
                        publishedSearchText: `${draft.title} ${draft.summary} ${draft.tags.join(' ')} ${profile.audience}`,
                        issuesJson: '[]',
                    },
                );
                if (changed.affected !== 1) throw new Error('发布版本冲突');
                await this.connection.getRepository(tx, BlogRevision).save(
                    new BlogRevision({
                        channelId: tx.channelId,
                        articleId: Number(current.id),
                        version: published.version,
                        action: old ? 'CODEX_UPDATE' : 'CODEX_PUBLISH',
                        actorId: 'system:news-blog-codex',
                        snapshotJson: JSON.stringify(published),
                    }),
                );
                const result: SkillEditorialReceipt = {
                    articleId: String(current.id),
                    slug: current.slug,
                    version: published.version,
                    action: old ? 'UPDATE' : 'PUBLISH',
                    publishedAt: published.publishedAt,
                };
                await this.connection.getRepository(tx, BlogRun).update(
                    { id: runId, channelId: tx.channelId },
                    {
                        state: 'SUCCEEDED',
                        completedAt: new Date(),
                        message: '中文用途介绍已发布',
                        telemetryJson: JSON.stringify({
                            externalModelCalls: 0,
                            payloadHash,
                            receipt: result,
                        }),
                    },
                );
                return result;
            });
            await this.changed(ctx);
            return receipt;
        } catch (error) {
            await this.connection.getRepository(ctx, BlogRun).update(
                { id: runId, channelId: ctx.channelId, state: 'RUNNING' },
                {
                    state: 'FAILED',
                    completedAt: new Date(),
                    message: (error instanceof Error ? error.message : 'Skill 导入失败').slice(0, 500),
                },
            );
            throw error;
        }
    }
    private changed(ctx: RequestContext) {
        return this.events.publish(
            new StorefrontDataChangedEvent(ctx, ['content', 'config'], {
                channelIds: [ctx.channelId],
                entityType: 'NewsBlog',
            }),
        );
    }
}

export function editorialDraft(
    profile: BlogSkillProfile,
    evidence: SkillEvidence,
    claims: SkillEditorialInput['claims'],
    original?: BlogSkillInfo,
    tags: string[] = [],
): BlogDraft {
    if (
        !Array.isArray(tags) ||
        tags.length > 4 ||
        tags.some(
            tag =>
                typeof tag !== 'string' ||
                tag.length > 30 ||
                !/[\u3400-\u9fff]/u.test(tag) ||
                /<[^>]+>/u.test(tag),
        )
    )
        throw new Error('用途标签无效');
    const fields: Record<string, string> = {
        purpose: profile.purpose,
        audience: profile.audience,
        ...Object.fromEntries(profile.capabilities.map((x, i) => [`capabilities.${i}`, x])),
        ...Object.fromEntries(profile.prerequisites.map((x, i) => [`prerequisites.${i}`, x])),
        ...Object.fromEntries(profile.limitations.map((x, i) => [`limitations.${i}`, x])),
        ...Object.fromEntries(tags.map((tag, i) => [`tags.${i}`, tag])),
    };
    if (!Array.isArray(claims) || claims.length > 30) throw new Error('用途依据无效');
    const normalized = evidence.body.replace(/\s+/gu, ' ');
    for (const field of Object.keys(fields)) {
        const claim = claims.find(x => x.field === field);
        if (
            !claim ||
            typeof claim.quote !== 'string' ||
            claim.quote.trim().length < 12 ||
            claim.quote.length > 800 ||
            !normalized.includes(claim.quote.replace(/\s+/gu, ' ').trim())
        )
            throw new Error(`用途缺少原文依据：${field}`);
    }
    const sourceUrl = `https://github.com/${evidence.repository}/blob/${evidence.commit}/${evidence.directory ? evidence.directory + '/' : ''}SKILL.md`;
    const ranking =
        preferredSkillRanking(evidence) ??
        (original
            ? {
                  view: original.trend === 'EVERGREEN' ? 'all-time' : 'hot',
                  rank: original.rank,
                  url: original.rankingUrl,
                  displayCount: '',
              }
            : undefined);
    if (!ranking) throw new Error('缺少热度依据');
    const skill: BlogSkillInfo = original
        ? {
              ...original,
              sourceCommit: evidence.commit,
              directoryUrl: `https://github.com/${evidence.repository}/tree/${evidence.commit}${evidence.directory ? '/' + evidence.directory : ''}`,
          }
        : {
              identity: hash(`${evidence.repositoryId}:${evidence.directory}`),
              name: evidence.name,
              repository: evidence.repository,
              repositoryId: evidence.repositoryId,
              repositoryUrl: `https://github.com/${evidence.repository}`,
              directoryUrl: `https://github.com/${evidence.repository}/tree/${evidence.commit}${evidence.directory ? '/' + evidence.directory : ''}`,
              stars: evidence.stars,
              trend: ranking.view === 'all-time' ? 'EVERGREEN' : 'RECENT',
              rankingUrl: ranking.url,
              rankingLabel:
                  ranking.view === 'all-time' ? 'All Time' : ranking.view === 'hot' ? 'Hot' : 'Trending',
              rank: ranking.rank,
              observedAt: evidence.observedAt,
              sourceCommit: evidence.commit,
          };
    const draft: BlogDraft = {
        skill,
        skillProfile: profile,
        title: profile.displayName,
        summary: profile.purpose,
        seoDescription: profile.purpose,
        category: 'skills',
        format: 'SKILL',
        candidateTitles: [profile.displayName],
        tags: [...new Set([skillDomains[profile.domain], ...tags, ...profile.industries, evidence.name])],
        sources: [{ label: '固定版本 Skill 原文', url: sourceUrl, accessedAt: new Date().toISOString() }],
        facts: Object.entries(fields).map(([field, text]) => ({
            text,
            sourceUrl,
            quote: claims.find(x => x.field === field)?.quote ?? '',
        })),
        body: skillProfileBody(profile),
        cover: null,
        illustrations: [],
        relatedProductIds: [],
        pinned: false,
    };
    if (contentIssues(draft).length) throw new Error('Skill 内容检查未通过');
    serializeDraft(draft);
    return draft;
}
