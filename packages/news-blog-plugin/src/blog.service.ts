import { Injectable, NotFoundException } from '@nestjs/common';
import {
    AdministratorService,
    Asset,
    EventBus,
    LanguageCode,
    Product,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import {
    StorefrontActivationService,
    StorefrontClientPluginAccessService,
    StorefrontDataChangedEvent,
} from '@vendure/store-management-plugin';
import {
    BlogCover,
    BlogDraft,
    BlogListInput,
    BlogPublicPage,
    BlogPublishedArticle,
    storefrontAssetUrl,
} from '@vendure/storefront-content-plugin';
import { In, IsNull, Not } from 'typeorm';

import {
    budgetDate,
    contentIssues,
    defaultSettings,
    EditorialSettings,
    hash,
    normalizeDraft,
    serializeDraft,
} from './content';
import { BlogArticle, BlogRevision, BlogRun, BlogSettings, BlogSource, BlogSourceItem } from './entities';
import { freeDraftDigest, freeSourceSufficient } from './free-content';
import {
    freeRecoveryCount,
    freeRecoveryDue,
    freeRecoveryLimit,
    isUnpaidFreeRun,
    nextFreeRecovery,
    runTelemetry,
} from './free-recovery';
import { historyDays, previousMonth } from './history';
import { BlogSkill, BlogSkillRecommendation, BlogSkillState } from './skill-entities';
import { sourceAllows, sourceCatalog } from './sources';

export interface BlogRunInput {
    articleId?: string;
    expectedVersion?: number;
    sourceIds?: string[];
    sectionIndex?: number;
    eventKey?: string;
    settingsVersion?: number;
    retryOfRunId?: string;
    recommendationId?: string;
    candidatesOnly?: boolean;
    templateOnly?: boolean;
    skillUpdateHash?: string;
    freeMode?: boolean;
    freeDigest?: string;
    historyStart?: string;
    historyEnd?: string;
    historyRunId?: string;
    historyDay?: string;
}
@Injectable()
export class BlogService {
    private enqueue?: (ctx: RequestContext, run: BlogRun) => Promise<void>;
    constructor(
        readonly connection: TransactionalConnection,
        private readonly administrators: AdministratorService,
        private readonly events: EventBus,
        private readonly access: StorefrontClientPluginAccessService,
        private readonly activation: StorefrontActivationService,
    ) {}
    registerQueue(enqueue: (ctx: RequestContext, run: BlogRun) => Promise<void>) {
        this.enqueue = enqueue;
    }
    async settings(ctx: RequestContext): Promise<BlogSettings> {
        const repo = this.connection.getRepository(ctx, BlogSettings);
        let row = await repo.findOne({ where: { channelId: ctx.channelId } });
        if (!row) {
            try {
                row = await repo.save(
                    new BlogSettings({
                        channelId: ctx.channelId,
                        version: 1,
                        enabled: false,
                        automationEnabled: false,
                        intervalMinutes: 30,
                        dailyMaxArticles: 3,
                        settingsJson: JSON.stringify(defaultSettings),
                        lastCollectedAt: null,
                        leaseUntil: null,
                    }),
                );
            } catch {
                row = await repo.findOne({ where: { channelId: ctx.channelId } });
                if (!row) throw new Error('博客配置创建失败');
            }
        }
        return row;
    }
    config(row: BlogSettings): EditorialSettings {
        return { ...defaultSettings, ...JSON.parse(row.settingsJson) };
    }
    async settingsView(ctx: RequestContext) {
        const row = await this.settings(ctx);
        const codex = this.config(row).skillEditorialMode === 'CODEX';
        const skillStatus = codex
            ? '由 Codex 每天整理一篇，来源校验通过后发布；结果见运行记录。'
            : this.config(row).skillEnabled
              ? (
                    await this.connection.rawConnection
                        .getRepository(BlogSkillState)
                        .findOneBy({ code: 'catalog' })
                )?.message
              : undefined;
        return {
            historyWindow: previousMonth(),
            skillStatus,
            skillCandidates:
                !codex && this.config(row).skillEnabled
                    ? (
                          await this.connection.rawConnection
                              .getRepository(BlogSkill)
                              .find({ order: { checkedAt: 'DESC' }, take: 30 })
                      ).map(x => ({
                          name: x.name,
                          repository: x.repository,
                          status: x.status,
                          message: x.message,
                          stars: JSON.parse(x.evidenceJson).stars,
                      }))
                    : [],
            ...this.config(row),
            enabled: row.enabled,
            automationEnabled: row.automationEnabled,
            intervalMinutes: row.intervalMinutes,
            dailyMaxArticles: row.dailyMaxArticles,
            version: row.version,
        };
    }
    async saveSettings(ctx: RequestContext, raw: Record<string, unknown>, expectedVersion: number) {
        const row = await this.settings(ctx);
        const config = this.config(row);
        config.skillEditorialMode = 'CODEX';
        config.coverMode = 'CATEGORY';
        config.freeMode = raw.freeMode === true;
        config.freeAutoPublish = config.freeMode && raw.freeAutoPublish === true;
        for (const key of [
            'title',
            'description',
            'textProviderCode',
            'textModel',
            'imageProviderCode',
            'imageModel',
            'imageProtocol',
        ] as const) {
            if (typeof raw[key] === 'string')
                config[key] = String(raw[key])
                    .trim()
                    .slice(0, key === 'description' ? 500 : 160);
        }
        for (const key of ['dailyBudgetMicros', 'textReserveMicros', 'imageReserveMicros'] as const) {
            const value = Number(raw[key] ?? config[key]);
            if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000)
                throw new Error('运营预算必须为有效的美元微单位金额');
            config[key] = value;
        }
        config.skillEnabled = raw.skillEnabled === true;
        if (raw.skillPublishTime !== undefined && typeof raw.skillPublishTime !== 'string')
            throw new Error('推荐时间必须为 HH:mm');
        config.skillPublishTime =
            typeof raw.skillPublishTime === 'string' ? raw.skillPublishTime : config.skillPublishTime;
        config.skillMinStars = Number(raw.skillMinStars ?? config.skillMinStars);
        if (
            !/^([01]\d|2[0-3]):[0-5]\d$/u.test(config.skillPublishTime) ||
            !Number.isSafeInteger(config.skillMinStars) ||
            config.skillMinStars < 1000 ||
            config.skillMinStars > 100000000
        )
            throw new Error('Skill 发布时间或 Star 门槛无效（至少 1000）');
        const interval = Number(raw.intervalMinutes ?? 30);
        const maximum = Number(raw.dailyMaxArticles ?? 3);
        if (
            !Number.isInteger(interval) ||
            interval < 30 ||
            interval > 1440 ||
            !Number.isInteger(maximum) ||
            maximum < 1 ||
            maximum > (config.freeMode ? 3 : 20)
        )
            throw new Error('采集间隔或每日篇数无效');
        if (
            ![
                'OPENAI_IMAGES',
                'OPENAI_RESPONSES_IMAGE',
                'OPENAI_COMPATIBLE_CHAT',
                'GEMINI_NATIVE',
                'GEMINI_NATIVE_STREAM',
                'GEMINI_INTERACTIONS',
            ].includes(config.imageProtocol)
        )
            throw new Error('配图协议无效');
        const result = await this.connection.getRepository(ctx, BlogSettings).update(
            { id: row.id, channelId: ctx.channelId, version: expectedVersion },
            {
                settingsJson: JSON.stringify(config),
                enabled: raw.enabled === true,
                automationEnabled: raw.automationEnabled === true,
                intervalMinutes: interval,
                dailyMaxArticles: maximum,
                version: expectedVersion + 1,
            },
        );
        if (result.affected !== 1) throw new Error('博客配置已更新，请重新读取后保存');
        await this.events.publish(
            new StorefrontDataChangedEvent(ctx, ['content', 'config'], {
                channelIds: [ctx.channelId],
                entityType: 'NewsBlog',
            }),
        );
        return this.settingsView(ctx);
    }
    async sources(ctx: RequestContext) {
        const repo = this.connection.getRepository(ctx, BlogSource);
        for (const source of sourceCatalog) {
            if (!(await repo.findOne({ where: { channelId: ctx.channelId, code: source.code } }))) {
                try {
                    await repo.save(
                        new BlogSource({
                            channelId: ctx.channelId,
                            code: source.code,
                            enabled: true,
                            version: 1,
                            status: 'NOT_COLLECTED',
                            message: '',
                            lastCollectedAt: null,
                            etag: null,
                            lastModified: null,
                        }),
                    );
                } catch {
                    /* Unique key resolves concurrent first reads. */
                }
            }
        }
        return (await repo.find({ where: { channelId: ctx.channelId }, order: { code: 'ASC' } })).map(
            row => ({
                ...row,
                name: sourceCatalog.find(x => x.code === row.code)?.name ?? row.code,
                url: sourceCatalog.find(x => x.code === row.code)?.url ?? '',
            }),
        );
    }
    async saveSource(ctx: RequestContext, code: string, enabled: boolean, version: number) {
        if (!sourceCatalog.some(x => x.code === code)) throw new Error('未知资讯源');
        const result = await this.connection
            .getRepository(ctx, BlogSource)
            .update({ channelId: ctx.channelId, code, version }, { enabled, version: version + 1 });
        if (result.affected !== 1) throw new Error('来源配置已变化');
        return this.sources(ctx);
    }
    async get(ctx: RequestContext, id: string) {
        const row = await this.connection
            .getRepository(ctx, BlogArticle)
            .findOne({ where: { id, channelId: ctx.channelId } });
        if (!row) throw new NotFoundException('文章不存在');
        return row;
    }
    view(row: BlogArticle) {
        return {
            id: String(row.id),
            slug: row.slug,
            version: row.version,
            state: row.state,
            publishedAt: row.publishedAt,
            draft: JSON.parse(row.draftJson),
            published: row.publishedJson ? JSON.parse(row.publishedJson) : null,
            issues: JSON.parse(row.issuesJson) as string[],
        };
    }
    async articles(ctx: RequestContext, state?: string) {
        const rows = await this.connection.getRepository(ctx, BlogArticle).find({
            where: { channelId: ctx.channelId, ...(state ? { state } : {}) },
            order: { updatedAt: 'DESC' },
            take: 200,
        });
        return rows.map(row => this.view(row));
    }
    async articleList(
        ctx: RequestContext,
        input: { term?: string; state?: string; skip?: number; take?: number } = {},
    ) {
        const skip = input.skip ?? 0;
        const take = input.take ?? 25;
        if (
            !Number.isSafeInteger(skip) ||
            skip < 0 ||
            skip > 100000 ||
            !Number.isSafeInteger(take) ||
            take < 1 ||
            take > 100
        )
            throw new Error('分页无效');
        const query = this.connection
            .getRepository(ctx, BlogArticle)
            .createQueryBuilder('a')
            .where('a.channelId = :channelId', { channelId: ctx.channelId });
        if (input.state) query.andWhere('a.state = :state', { state: input.state });
        const term = (input.term ?? '').trim().slice(0, 200).toLowerCase();
        if (term)
            query.andWhere("LOWER(a.draftJson) LIKE :term ESCAPE '!'", {
                term: `%${term.replace(/[!%_]/gu, '!$&')}%`,
            });
        const [rows, totalItems] = await query
            .orderBy('a.updatedAt', 'DESC')
            .addOrderBy('a.id', 'DESC')
            .skip(skip)
            .take(take)
            .getManyAndCount();
        return {
            totalItems,
            items: rows.map(row => {
                const view = this.view(row);
                return {
                    ...view,
                    draft: {
                        ...view.draft,
                        body: '',
                        sources: [],
                        facts: [],
                        sourceImages: [],
                        illustrations: [],
                    },
                    published: row.publishedJson ? { version: JSON.parse(row.publishedJson).version } : null,
                };
            }),
        };
    }
    async history(ctx: RequestContext, id: string) {
        await this.get(ctx, id);
        return this.connection.getRepository(ctx, BlogRevision).find({
            where: { channelId: ctx.channelId, articleId: Number(id) },
            order: { version: 'DESC' },
            take: 100,
        });
    }
    private async media(ctx: RequestContext, raw: unknown, trusted?: BlogCover): Promise<BlogCover | null> {
        if (!raw) return null;
        const value = raw as BlogCover;
        const asset = await this.connection
            .getRepository(ctx, Asset)
            .createQueryBuilder('asset')
            .innerJoin('asset.channels', 'channel')
            .leftJoinAndSelect('asset.tags', 'tags')
            .where('asset.id = :id', { id: value.assetId })
            .andWhere('channel.id = :channelId', { channelId: ctx.channelId })
            .getOne();
        if (
            !asset ||
            !asset.mimeType.startsWith('image/') ||
            asset.tags?.some(tag => tag.value === 'customer-avatar')
        )
            throw new Error('封面必须为当前店铺可发布的图片素材');
        return {
            ...(trusted?.assetId === String(asset.id) ? trusted : {}),
            assetId: String(asset.id),
            url: storefrontAssetUrl(asset),
            ...(trusted?.kind === 'SOURCE' ? { rightsConfirmed: value.rightsConfirmed === true } : {}),
            alt: String(value.alt ?? '').slice(0, 250),
            generated: value.generated === true,
        };
    }
    async save(
        ctx: RequestContext,
        input: { id?: string; slug: string; expectedVersion: number; draft: BlogDraft },
    ) {
        if (!/^[a-z0-9][a-z0-9_-]{0,99}$/u.test(input.slug))
            throw new Error('网址标识需为 1～100 位小写字母、数字或短横线');
        const originalRow = input.id ? await this.get(ctx, input.id) : null;
        const originalDraft = originalRow ? (JSON.parse(originalRow.draftJson) as BlogDraft) : null;
        const trustedMedia = [
            originalDraft?.cover,
            ...(originalDraft?.illustrations ?? []),
            ...(originalDraft?.sourceImages ?? []).map(x => x.asset),
        ];
        const provenance = (value: BlogCover | null) =>
            trustedMedia.find(x => x?.assetId === value?.assetId) ?? undefined;
        const draft = normalizeDraft(input.draft);
        draft.sourceImages = originalDraft?.sourceImages;
        draft.cover = await this.media(ctx, input.draft.cover, provenance(input.draft.cover));
        draft.illustrations = [];
        for (const image of (input.draft.illustrations ?? []).slice(0, 2)) {
            const checked = await this.media(ctx, image, provenance(image));
            if (checked)
                draft.illustrations.push({ ...checked, caption: String(image.caption ?? '').slice(0, 500) });
        }
        if (draft.relatedProductIds.length) {
            const rows = await this.connection
                .getRepository(ctx, Product)
                .createQueryBuilder('p')
                .innerJoin('p.channels', 'c')
                .where('p.id IN (:...ids)', { ids: draft.relatedProductIds })
                .andWhere('c.id = :channelId', { channelId: ctx.channelId })
                .getMany();
            if (rows.length !== draft.relatedProductIds.length) throw new Error('关联商品不属于当前店铺');
        }
        const issues = contentIssues(draft);
        let row: BlogArticle;
        if (originalRow) {
            row = originalRow;
            const original = JSON.parse(row.draftJson) as BlogDraft;
            if (original.skill) {
                draft.skill = original.skill;
                draft.category = 'skills';
                draft.format = 'SKILL';
            } else if (draft.category === 'skills') throw new Error('请从已核验的 Skill 推荐记录编辑');
            if (row.publishedAt && row.slug !== input.slug)
                throw new Error('已发布文章的网址不可修改，请保留原链接');
            const result = await this.connection.getRepository(ctx, BlogArticle).update(
                { id: row.id, channelId: ctx.channelId, version: input.expectedVersion },
                {
                    slug: input.slug,
                    draftJson: serializeDraft(draft),
                    version: input.expectedVersion + 1,
                    state: 'DRAFT',
                    issuesJson: JSON.stringify(issues),
                },
            );
            if (result.affected !== 1) throw new Error('文章版本已变化，请保留草稿并重新读取');
            row = await this.get(ctx, String(row.id));
        } else {
            if (draft.category === 'skills') throw new Error('Skill 文章必须来自已核验的推荐记录');
            if (input.expectedVersion !== 0) throw new Error('新文章版本无效');
            row = await this.connection.getRepository(ctx, BlogArticle).save(
                new BlogArticle({
                    channelId: ctx.channelId,
                    slug: input.slug,
                    eventKey: null,
                    version: 1,
                    state: 'DRAFT',
                    draftJson: serializeDraft(draft),
                    publishedJson: null,
                    publishedAt: null,
                    issuesJson: JSON.stringify(issues),
                }),
            );
        }
        if (!draft.cover && this.config(await this.settings(ctx)).coverMode === 'LEGACY')
            await this.request(ctx, 'MEDIA', `template:${row.id}:${row.version}`, {
                articleId: String(row.id),
                expectedVersion: row.version,
            });
        return this.view(row);
    }
    async publish(
        ctx: RequestContext,
        id: string,
        expectedVersion: number,
        withdraw = false,
        acceptIssues = false,
    ) {
        if (!ctx.activeUserId) throw new Error('发布需要登录的管理员');
        const settings = await this.settings(ctx);
        if (!settings.enabled && !withdraw) throw new Error('请先启用新闻博客');
        const admin = await this.administrators.findOneByUserId(ctx, ctx.activeUserId);
        if (!admin) throw new Error('无法确认实际审核人');
        const result = await this.connection.withTransaction(ctx, async tx => {
            const row = await this.get(tx, id);
            if (row.version !== expectedVersion) throw new Error('文章版本已变化');
            const draft = normalizeDraft(JSON.parse(row.draftJson));
            const raw = JSON.parse(row.draftJson) as BlogDraft;
            draft.skill = raw.skill;
            draft.cover = await this.media(tx, raw.cover, raw.cover ?? undefined);
            draft.illustrations = [];
            for (const image of raw.illustrations) {
                const checked = await this.media(tx, image, image);
                if (checked) draft.illustrations.push({ ...checked, caption: image.caption });
            }
            if (!withdraw && contentIssues(draft).length) throw new Error(contentIssues(draft).join('；'));
            if (
                !withdraw &&
                draft.sources.some(
                    source =>
                        !sourceCatalog.some(s => sourceAllows(s.code, source.url)) &&
                        !(
                            draft.skill &&
                            /^[a-f0-9]{40}$/u.test(draft.skill.sourceCommit) &&
                            source.url.startsWith(
                                `https://github.com/${draft.skill.repository}/blob/${draft.skill.sourceCommit}/`,
                            )
                        ),
                )
            )
                throw new Error('发布文章需提供已配置的官方来源');
            if (
                !withdraw &&
                (JSON.parse(row.issuesJson) as string[]).some(x => !contentIssues(draft).includes(x)) &&
                !acceptIssues
            )
                throw new Error('请核对并确认自动检查提示后再发布');
            const now = new Date().toISOString();
            const previous = row.publishedJson
                ? (JSON.parse(row.publishedJson) as BlogPublishedArticle)
                : null;
            const published: BlogPublishedArticle = {
                ...draft,
                id: String(row.id),
                slug: row.slug,
                version: row.version + 1,
                publishedAt: previous?.publishedAt ?? row.publishedAt?.toISOString() ?? now,
                publicationMode: 'MANUAL',
                updatedAt: now,
                reviewedAt: now,
                reviewerName: `${admin.firstName} ${admin.lastName}`.trim() || '编辑',
                readingMinutes: Math.max(1, Math.ceil(Array.from(draft.body).length / 450)),
            };
            const changed = await this.connection.getRepository(tx, BlogArticle).update(
                { id: row.id, channelId: tx.channelId, version: expectedVersion },
                {
                    version: expectedVersion + 1,
                    state: withdraw ? 'WITHDRAWN' : 'PUBLISHED',
                    publishedJson: withdraw ? null : JSON.stringify(published),
                    publishedAt: withdraw ? row.publishedAt : new Date(published.publishedAt),
                    publishedTitle: withdraw ? '' : draft.title,
                    publishedCategory: withdraw ? '' : draft.category,
                    publishedSearchText: withdraw
                        ? null
                        : `${draft.title} ${draft.summary} ${draft.tags.join(' ')}`,
                    publishedPinned: !withdraw && draft.pinned,
                },
            );
            if (changed.affected !== 1) throw new Error('发布版本冲突');
            await this.connection.getRepository(tx, BlogRevision).save(
                new BlogRevision({
                    channelId: tx.channelId,
                    articleId: Number(row.id),
                    version: expectedVersion + 1,
                    action: withdraw ? 'WITHDRAW' : 'PUBLISH',
                    actorId: String(ctx.activeUserId),
                    snapshotJson: withdraw ? row.publishedJson : JSON.stringify(published),
                }),
            );
            return this.view(await this.get(tx, id));
        });
        await this.events.publish(
            new StorefrontDataChangedEvent(ctx, ['content', 'config'], {
                channelIds: [ctx.channelId],
                entityType: 'NewsBlog',
            }),
        );
        return result;
    }
    async request(ctx: RequestContext, kind: string, requestKey: string, input: BlogRunInput = {}) {
        if (
            !['COLLECT', 'GENERATE', 'SECTION', 'MEDIA', 'SKILL', 'SKILL_REVIEW'].includes(kind) ||
            !/^[a-zA-Z0-9:_-]{8,150}$/u.test(requestKey)
        )
            throw new Error('任务类型或请求标识无效');
        if (
            kind === 'GENERATE' &&
            (!Array.isArray(input.sourceIds) || !input.sourceIds.length || input.sourceIds.length > 10)
        )
            throw new Error('请选择最多十条同一事件的来源');
        await this.settings(ctx);
        if (input.historyStart || input.historyEnd) {
            if (kind !== 'COLLECT' || !ctx.activeUserId || !ctx.userHasPermissions(['SuperAdmin' as never]))
                throw new Error('历史补采需要超级管理员从采集工作区发起');
            historyDays(input.historyStart ?? '', input.historyEnd ?? '');
        }
        const run = await this.connection.withTransaction(ctx, async tx => {
            const settingsRepo = this.connection.getRepository(tx, BlogSettings);
            // Acquire the channel budget write lock before reading spent/reserved amounts. Works on MySQL and SQLite.
            await settingsRepo
                .createQueryBuilder()
                .update()
                .set({ version: () => 'version' })
                .where('channelId = :channelId', { channelId: tx.channelId })
                .execute();
            const settings = await this.settings(tx);
            const config = this.config(settings);
            const repo = this.connection.getRepository(tx, BlogRun);
            if (input.historyStart && !config.freeMode) throw new Error('历史回放仅使用免费整理模式');
            if (input.historyDay) {
                if (!input.historyRunId) throw new Error('缺少历史任务来源');
                const parent = await repo.findOne({
                    where: { id: input.historyRunId, channelId: tx.channelId, kind: 'COLLECT' },
                });
                const range = parent ? (JSON.parse(parent.inputJson) as BlogRunInput) : null;
                if (
                    !config.freeMode ||
                    !range?.historyStart ||
                    !range.historyEnd ||
                    !historyDays(range.historyStart, range.historyEnd).includes(input.historyDay)
                )
                    throw new Error('历史任务范围无效');
            }
            if (config.freeMode && kind === 'SECTION')
                throw new Error('免费模式不调用段落改写模型，可直接编辑正文');
            // Server-owned mode: an API caller cannot turn a free request into a supplier call.
            input = {
                ...input,
                freeMode: config.freeMode,
            };
            if (kind === 'GENERATE' && input.sourceIds?.length) {
                let evidence = await this.connection
                    .getRepository(tx, BlogSourceItem)
                    .find({ where: { channelId: tx.channelId, id: In(input.sourceIds) } });
                if (
                    evidence.length !== input.sourceIds.length ||
                    evidence.some(
                        x =>
                            x.status !== 'READY' ||
                            (config.freeMode
                                ? !freeSourceSufficient({
                                      ...x,
                                      evidenceMode: JSON.parse(x.metadataJson || '{}').evidenceMode,
                                  })
                                : x.body.length < 200),
                    )
                )
                    throw new Error('资讯资料不足或不属于当前店铺');
                const eventKey = evidence[0].eventKey;
                if (evidence.some(x => x.eventKey !== eventKey))
                    throw new Error('一次生成只整理同一事件的来源');
                requestKey = `generate:${hash(
                    evidence
                        .map(x => x.eventKey + ':' + x.contentHash)
                        .sort()
                        .join('|'),
                )}`;
                evidence = await this.connection.getRepository(tx, BlogSourceItem).find({
                    where: { channelId: tx.channelId, eventKey, status: 'READY' },
                    order: { id: 'ASC' },
                    take: 10,
                });
                requestKey = `generate:${hash(
                    evidence
                        .map(x => x.eventKey + ':' + x.contentHash)
                        .sort()
                        .join('|'),
                )}`;
                input = { ...input, eventKey, sourceIds: evidence.map(x => String(x.id)) };
                if (input.retryOfRunId) requestKey += `:retry:${input.retryOfRunId}`;
                const active = await repo.find({
                    where: {
                        channelId: tx.channelId,
                        kind: 'GENERATE',
                        state: In(['QUEUED', 'RUNNING', 'DEFERRED']),
                    },
                });
                const matching = active.find(x => JSON.parse(x.inputJson).eventKey === eventKey);
                if (matching) return matching;
                const article = await this.connection
                    .getRepository(tx, BlogArticle)
                    .findOne({ where: { channelId: tx.channelId, eventKey } });
                const prior = await repo.findOne({ where: { channelId: tx.channelId, requestKey } });
                if (prior) return this.recoverFreeRun(tx, prior, settings);
                if (article && !input.articleId) {
                    if (article.state !== 'PUBLISHED')
                        throw new Error('该事件已有待处理草稿，请从文章管理继续审核');
                    input = { ...input, articleId: String(article.id), expectedVersion: article.version };
                }
            }
            if (kind === 'SKILL' || kind === 'SKILL_REVIEW') {
                if (config.skillEditorialMode !== 'LEGACY') throw new Error('请使用 Codex 中文精选导入');
                if (!config.skillEnabled || !input.recommendationId)
                    throw new Error('Skill 自动更新尚未启用或缺少推荐记录');
                const rec = await this.connection
                    .getRepository(tx, BlogSkillRecommendation)
                    .findOneByOrFail({ id: input.recommendationId, channelId: tx.channelId });
                if (kind === 'SKILL' && !input.skillUpdateHash && input.articleId)
                    throw new Error('Skill 初次推荐不能指定文章');
                if (
                    input.skillUpdateHash &&
                    (input.articleId !== rec.articleId || rec.status !== 'PUBLISHED')
                )
                    throw new Error('Skill 更新记录无效');
                requestKey =
                    kind === 'SKILL_REVIEW'
                        ? `skill-review:${rec.id}:${input.articleId}:${input.expectedVersion}`
                        : `skill:${rec.id}:${input.skillUpdateHash ?? rec.contentHash}`;
            }
            if ((kind === 'MEDIA' || kind === 'SECTION') && input.articleId)
                requestKey = `${kind.toLowerCase()}:${input.articleId}:${input.expectedVersion}:${input.sectionIndex ?? 'cover'}`;
            if (kind !== 'GENERATE' && input.retryOfRunId) requestKey += `:retry:${input.retryOfRunId}`;
            const existing = await repo.findOne({ where: { channelId: tx.channelId, requestKey } });
            if (existing) return this.recoverFreeRun(tx, existing, settings);
            if (!settings.enabled) throw new Error('新闻博客尚未启用');
            if (input.articleId) {
                const article = await this.get(tx, input.articleId);
                if (article.version !== input.expectedVersion) throw new Error('文章版本已变化');
            }
            if ((kind === 'SECTION' || kind === 'MEDIA') && !input.articleId) throw new Error('缺少文章');
            if (kind === 'GENERATE' && (!input.sourceIds?.length || input.sourceIds.length > 10))
                throw new Error('请选择需要整理的资讯');
            const today = input.historyDay ?? budgetDate();
            const reserved = config.freeMode
                ? 0
                : kind === 'GENERATE' || kind === 'SECTION' || kind === 'SKILL' || kind === 'SKILL_REVIEW'
                  ? config.textReserveMicros
                  : kind === 'MEDIA' &&
                      config.coverMode === 'LEGACY' &&
                      !input.candidatesOnly &&
                      !input.templateOnly &&
                      config.imageProviderCode &&
                      config.imageModel
                    ? config.imageReserveMicros
                    : 0;
            const runs = await repo.find({ where: { channelId: tx.channelId, budgetDate: today } });
            const events = await this.quotaEvents(tx, runs);
            if (
                kind === 'GENERATE' &&
                !events.has(input.eventKey) &&
                events.size >= settings.dailyMaxArticles
            )
                throw new Error('今日自动文章数量已达上限');
            if (
                !config.freeMode &&
                (kind === 'GENERATE' || kind === 'SECTION' || kind === 'SKILL' || kind === 'SKILL_REVIEW')
            ) {
                if (!config.textProviderCode || !config.textModel || reserved <= 0)
                    throw new Error('请先配置文本供应商、模型和单次预算');
            }
            if (
                reserved > 0 &&
                (config.dailyBudgetMicros <= 0 ||
                    runs.reduce((sum, x) => sum + Math.max(x.reservedMicros, x.chargedMicros), 0) + reserved >
                        config.dailyBudgetMicros)
            ) {
                if (kind !== 'MEDIA') throw new Error('今日运营预算不足');
                return repo.save(
                    new BlogRun({
                        channelId: tx.channelId,
                        requestKey,
                        kind,
                        state: 'QUEUED',
                        budgetDate: today,
                        reservedMicros: 0,
                        chargedMicros: 0,
                        inputJson: JSON.stringify({
                            ...input,
                            settingsVersion: settings.version,
                            templateOnly: true,
                        }),
                        telemetryJson: null,
                        message: '预算不足，使用模板封面',
                    }),
                );
            }
            return repo.save(
                new BlogRun({
                    channelId: tx.channelId,
                    requestKey,
                    kind,
                    state: 'QUEUED',
                    budgetDate: today,
                    reservedMicros: reserved,
                    chargedMicros: 0,
                    inputJson: JSON.stringify({ ...input, settingsVersion: settings.version }),
                    telemetryJson: null,
                    message: '',
                }),
            );
        });
        if (run.state === 'QUEUED' && this.enqueue) await this.enqueue(ctx, run);
        return run;
    }
    private async quotaEvents(ctx: RequestContext, runs: BlogRun[]) {
        const news = runs.filter(run => run.kind === 'GENERATE');
        const keys = news.map(run => JSON.parse(run.inputJson).eventKey).filter(Boolean) as string[];
        const articles = keys.length
            ? await this.connection.getRepository(ctx, BlogArticle).find({
                  where: { channelId: ctx.channelId, eventKey: In(keys) },
                  select: { eventKey: true },
              })
            : [];
        const created = new Set(articles.map(article => article.eventKey));
        return new Set(
            news
                .filter(run => {
                    const event = JSON.parse(run.inputJson).eventKey;
                    if (isUnpaidFreeRun(run) && runTelemetry(run).freeQuotaPending === true) return false;
                    return run.state !== 'FAILED' || !isUnpaidFreeRun(run) || created.has(event);
                })
                .map(run => JSON.parse(run.inputJson).eventKey ?? run.requestKey),
        );
    }
    /** Recovery shares the normal store quota lock; a failed free event must re-admit its daily slot. */
    async recoverFree(ctx: RequestContext, id: string, now = new Date()) {
        return this.connection.withTransaction(ctx, async tx => {
            await this.connection
                .getRepository(tx, BlogSettings)
                .createQueryBuilder()
                .update()
                .set({ version: () => 'version' })
                .where('channelId = :id', { id: tx.channelId })
                .execute();
            const run = await this.connection
                .getRepository(tx, BlogRun)
                .findOneByOrFail({ id, channelId: tx.channelId });
            return this.recoverFreeRun(tx, run, await this.settings(tx), now);
        });
    }
    private async recoverFreeRun(
        ctx: RequestContext,
        run: BlogRun,
        settings: BlogSettings,
        now = new Date(),
    ) {
        const repo = this.connection.getRepository(ctx, BlogRun);
        if (
            isUnpaidFreeRun(run) &&
            freeRecoveryCount(run) >= freeRecoveryLimit &&
            (run.state === 'UNKNOWN' ||
                (run.state === 'RUNNING' &&
                    run.startedAt &&
                    now.getTime() - run.startedAt.getTime() > 30 * 60000))
        ) {
            await repo.update(
                { id: run.id, state: run.state },
                {
                    state: 'FAILED',
                    completedAt: now,
                    telemetryJson: JSON.stringify({ ...runTelemetry(run), freeRecoveryVersion: 1 }),
                    message: '免费任务恢复次数已达上限，保留阶段结果供定向重试',
                },
            );
            return repo.findOneByOrFail({ id: run.id, channelId: ctx.channelId });
        }
        if (!freeRecoveryDue(run, now)) return run;
        const input = JSON.parse(run.inputJson) as BlogRunInput;
        let valid =
            settings.enabled && this.config(settings).freeMode && input.settingsVersion === settings.version;
        if (input.articleId) {
            const article = await this.get(ctx, input.articleId);
            const digest =
                input.freeDigest ?? runTelemetry(run).freeArticleDigest ?? runTelemetry(run).freeMediaDigest;
            valid =
                valid &&
                (article.version === input.expectedVersion ||
                    (!!digest &&
                        article.version === (input.expectedVersion ?? 0) + 1 &&
                        article.state === 'PENDING_REVIEW' &&
                        freeDraftDigest(JSON.parse(article.draftJson)) === digest));
        }
        if (!valid) {
            await repo.update(
                { id: run.id, state: run.state },
                {
                    state: 'FAILED',
                    completedAt: now,
                    telemetryJson: JSON.stringify({ ...runTelemetry(run), freeRecoveryVersion: 1 }),
                    message: '免费任务的配置或人工版本已变化，保留原稿供人工处理',
                },
            );
            return repo.findOneByOrFail({ id: run.id, channelId: ctx.channelId });
        }
        const date = input.historyDay ?? budgetDate(now);
        if (run.kind === 'GENERATE') {
            const events = await this.quotaEvents(
                ctx,
                await repo.find({ where: { channelId: ctx.channelId, budgetDate: date } }),
            );
            if (!events.has(input.eventKey ?? run.requestKey) && events.size >= settings.dailyMaxArticles) {
                await repo.update(
                    { id: run.id, state: run.state },
                    {
                        state: 'DEFERRED',
                        budgetDate: date,
                        telemetryJson: JSON.stringify({
                            ...(run.state === 'DEFERRED' ? runTelemetry(run) : nextFreeRecovery(run, now)),
                            freeQuotaPending: true,
                            retryAfter: new Date(now.getTime() + 5 * 60000).toISOString(),
                        }),
                        message: '免费文章名额已用完，保留任务等待名额恢复',
                    },
                );
                return repo.findOneByOrFail({ id: run.id, channelId: ctx.channelId });
            }
        }
        await repo.update(
            {
                id: run.id,
                channelId: ctx.channelId,
                state: run.state,
                ...(run.state === 'RUNNING' && run.startedAt ? { startedAt: run.startedAt } : {}),
            },
            {
                state: 'DEFERRED',
                budgetDate: date,
                completedAt: null,
                telemetryJson: JSON.stringify(
                    run.state === 'DEFERRED'
                        ? { ...runTelemetry(run), freeQuotaPending: false, retryAfter: now.toISOString() }
                        : nextFreeRecovery(run, now),
                ),
                message: '免费任务已保留阶段结果，将在退避后继续；不会调用收费接口',
            },
        );
        return repo.findOneByOrFail({ id: run.id, channelId: ctx.channelId });
    }
    async publishFree(
        ctx: RequestContext,
        id: string,
        version: number,
        digest: string,
        settingsVersion: number,
    ) {
        await this.connection.withTransaction(ctx, async tx => {
            await this.connection
                .getRepository(tx, BlogSettings)
                .createQueryBuilder()
                .update()
                .set({ version: () => 'version' })
                .where('channelId = :id', { id: tx.channelId })
                .execute();
            const settings = await this.settings(tx);
            const config = this.config(settings);
            if (
                !settings.enabled ||
                !config.freeMode ||
                !config.freeAutoPublish ||
                settings.version !== settingsVersion
            )
                throw new Error('免费自动发布设置已变化');
            const row = await this.get(tx, id);
            const draft = JSON.parse(row.draftJson) as BlogDraft;
            if (
                row.version !== version ||
                row.state !== 'PENDING_REVIEW' ||
                row.publishedJson ||
                !draft.tags.includes('来源快讯') ||
                freeDraftDigest(draft) !== digest ||
                contentIssues(draft).length ||
                (JSON.parse(row.issuesJson) as string[]).length
            )
                throw new Error('免费快讯的版本、来源整理结果或素材检查未通过');
            const now = new Date().toISOString();
            const published: BlogPublishedArticle = {
                ...draft,
                id: String(row.id),
                slug: row.slug,
                version: version + 1,
                publishedAt: now,
                updatedAt: now,
                reviewedAt: null,
                reviewerName: null,
                publicationMode: 'AUTOMATIC',
                readingMinutes: Math.max(1, Math.ceil(Array.from(draft.body).length / 450)),
            };
            const updated = await this.connection.getRepository(tx, BlogArticle).update(
                { id: row.id, channelId: tx.channelId, version },
                {
                    version: version + 1,
                    state: 'PUBLISHED',
                    publishedJson: JSON.stringify(published),
                    publishedAt: new Date(now),
                    publishedTitle: draft.title,
                    publishedCategory: draft.category,
                    publishedSearchText: `${draft.title} ${draft.summary} ${draft.tags.join(' ')}`,
                    publishedPinned: draft.pinned,
                    issuesJson: '[]',
                },
            );
            if (updated.affected !== 1) throw new Error('自动发布期间文章已被修改');
            await this.connection.getRepository(tx, BlogRevision).save(
                new BlogRevision({
                    channelId: tx.channelId,
                    articleId: Number(row.id),
                    version: version + 1,
                    action: 'AUTO_PUBLISH',
                    actorId: 'system:news-blog-free',
                    snapshotJson: JSON.stringify(published),
                }),
            );
        });
        await this.events.publish(
            new StorefrontDataChangedEvent(ctx, ['content', 'config'], {
                channelIds: [ctx.channelId],
                entityType: 'NewsBlog',
            }),
        );
    }
    async reconcile(ctx: RequestContext, id: string, actualCostMicros: number) {
        if (
            !ctx.activeUserId ||
            !Number.isSafeInteger(actualCostMicros) ||
            actualCostMicros < 0 ||
            actualCostMicros > 1_000_000_000
        )
            throw new Error('请填写已核对的供应商实际费用');
        const repo = this.connection.getRepository(ctx, BlogRun);
        const row = await repo.findOne({ where: { id, channelId: ctx.channelId, state: 'UNKNOWN' } });
        if (!row) throw new Error('任务状态已变化，请重新读取');
        const telemetry = {
            ...(row.telemetryJson ? JSON.parse(row.telemetryJson) : {}),
            reconciliation: {
                confirmedFailed: true,
                originalReservedMicros: row.reservedMicros,
                actualCostMicros,
                actorId: String(ctx.activeUserId),
                at: new Date().toISOString(),
            },
        };
        const result = await repo.update(
            { id, channelId: ctx.channelId, state: 'UNKNOWN' },
            {
                state: 'FAILED',
                reservedMicros: 0,
                chargedMicros: actualCostMicros,
                telemetryJson: JSON.stringify(telemetry),
                message: '管理员已核对供应商结果并确认未完成；可重试，新调用将重新计费',
            },
        );
        if (result.affected !== 1) throw new Error('任务状态已变化');
        return repo.findOneOrFail({ where: { id, channelId: ctx.channelId } });
    }
    async retry(ctx: RequestContext, id: string, requestKey: string) {
        const previous = await this.connection
            .getRepository(ctx, BlogRun)
            .findOne({ where: { id, channelId: ctx.channelId } });
        if (!previous || previous.state !== 'FAILED' || previous.reservedMicros > 0)
            throw new Error('仅可重试已确认失败且没有付费调用的任务；结果不明需先核对');
        const input = JSON.parse(previous.inputJson) as BlogRunInput;
        if (input.articleId) {
            const article = await this.get(ctx, input.articleId);
            input.expectedVersion = article.version;
        }
        return this.request(ctx, previous.kind, requestKey, { ...input, retryOfRunId: String(previous.id) });
    }
    async runs(ctx: RequestContext) {
        return this.connection
            .getRepository(ctx, BlogRun)
            .find({ where: { channelId: ctx.channelId }, order: { createdAt: 'DESC' }, take: 100 });
    }
    async sourceItems(ctx: RequestContext) {
        const items = await this.connection
            .getRepository(ctx, BlogSourceItem)
            .find({ where: { channelId: ctx.channelId }, order: { sourcePublishedAt: 'DESC' }, take: 100 });
        return items.map(item => ({
            ...item,
            evidenceMode:
                JSON.parse(item.metadataJson || '{}').evidenceMode === 'OFFICIAL_RSS'
                    ? 'OFFICIAL_RSS'
                    : 'PAGE_TEXT',
        }));
    }
    private async publicEnabled(ctx: RequestContext, asset = false) {
        if (ctx.apiType === 'shop' && (await this.activation.getAccessMode(ctx)) === 'CLOSED')
            throw new NotFoundException('店铺未开放');
        const row = await this.connection
            .getRepository(ctx, BlogSettings)
            .findOne({ where: { channelId: ctx.channelId } });
        if (
            !row?.enabled ||
            (!asset && ctx.languageCode !== LanguageCode.zh_Hans) ||
            !(await this.access.isEnabled(ctx, 'news-blog-entry'))
        )
            throw new NotFoundException('新闻博客未开放');
        return row;
    }
    private publicSnapshot(raw: string | null, detail = false): BlogPublishedArticle {
        if (!raw) throw new NotFoundException('已发布文章不存在');
        const { sourceImages: _candidates, ...published } = JSON.parse(raw) as BlogPublishedArticle;
        return {
            ...published,
            candidateTitles: [],
            facts: [],
            ...(detail ? {} : { body: '', sources: [], illustrations: [], relatedProductIds: [] }),
        };
    }
    async read(raw: unknown, input: BlogListInput = {}, slug?: string): Promise<BlogPublicPage> {
        const ctx = raw as RequestContext;
        const settings = await this.publicEnabled(ctx);
        const config = this.config(settings);
        const base = () =>
            this.connection
                .getRepository(ctx, BlogArticle)
                .createQueryBuilder('article')
                .where('article.channelId = :channelId', { channelId: ctx.channelId })
                .andWhere('article.publishedJson IS NOT NULL');
        const filtered = () => {
            const query = base();
            if (input.category)
                query.andWhere('article.publishedCategory = :category', { category: input.category });
            const term = (input.term ?? '').trim().toLowerCase().slice(0, 200);
            if (term)
                query.andWhere("LOWER(article.publishedSearchText) LIKE :term ESCAPE '!'", {
                    term: `%${term.replace(/[!%_]/gu, '!$&')}%`,
                });
            return query;
        };
        const skip = input.skip ?? 0;
        const take = input.take ?? 12;
        if (
            !Number.isSafeInteger(skip) ||
            skip < 0 ||
            skip > 100000 ||
            !Number.isSafeInteger(take) ||
            take < 1 ||
            take > 48
        )
            throw new Error('分页无效');
        const [rows, totalItems] = await filtered()
            .orderBy('article.publishedAt', 'DESC')
            .addOrderBy('article.id', 'DESC')
            .skip(skip)
            .take(take)
            .getManyAndCount();
        const featuredRow = await filtered()
            .orderBy('article.publishedPinned', 'DESC')
            .addOrderBy('article.publishedAt', 'DESC')
            .getOne();
        const articleRow = slug ? await base().andWhere('article.slug = :slug', { slug }).getOne() : null;
        if (slug && !articleRow) throw new NotFoundException('已发布文章不存在');
        const article = articleRow ? this.publicSnapshot(articleRow.publishedJson, true) : null;
        const related = article
            ? await base()
                  .andWhere('article.publishedCategory = :category', { category: article.category })
                  .andWhere('article.id != :id', { id: article.id })
                  .orderBy('article.publishedAt', 'DESC')
                  .take(3)
                  .getMany()
            : [];
        return {
            title: config.title,
            description: config.description,
            totalItems,
            items: rows.map(x => this.publicSnapshot(x.publishedJson)),
            featured: featuredRow ? this.publicSnapshot(featuredRow.publishedJson) : null,
            article,
            relatedArticles: related.map(x => this.publicSnapshot(x.publishedJson)),
        };
    }
    async sitemap(raw: unknown) {
        const ctx = raw as RequestContext;
        try {
            await this.publicEnabled(ctx);
        } catch (error) {
            if (error instanceof NotFoundException) return [];
            throw error;
        }
        const rows = await this.connection
            .getRepository(ctx, BlogArticle)
            .find({ where: { channelId: ctx.channelId, publishedJson: Not(IsNull()) } });
        return rows.map(x => {
            if (!x.publishedJson) throw new NotFoundException('已发布文章不存在');
            const a = JSON.parse(x.publishedJson) as BlogPublishedArticle;
            return { slug: x.slug, updatedAt: a.updatedAt ?? a.reviewedAt ?? a.publishedAt };
        });
    }
    async assertCurrent(raw: unknown, page: BlogPublicPage) {
        const ctx = raw as RequestContext;
        await this.publicEnabled(ctx);
        for (const item of [
            ...page.items,
            ...(page.article ? [page.article] : []),
            ...(page.featured ? [page.featured] : []),
            ...page.relatedArticles,
        ]) {
            const row = await this.connection
                .getRepository(ctx, BlogArticle)
                .findOne({ where: { id: item.id, channelId: ctx.channelId } });
            if (
                !row?.publishedJson ||
                (JSON.parse(row.publishedJson) as BlogPublishedArticle).version !== item.version
            )
                throw new NotFoundException('文章发布状态已变化');
        }
    }
    async isAssetPublic(raw: unknown, identifier: string) {
        const ctx = raw as RequestContext;
        try {
            // Asset URLs have no locale prefix; the Chinese publication owns their admission.
            await this.publicEnabled(ctx.copy({ languageCode: LanguageCode.zh_Hans }), true);
        } catch {
            return false;
        }
        const asset = await this.connection.getRepository(ctx, Asset).findOne({
            where: [{ source: identifier }, { preview: identifier }],
            relations: ['channels', 'tags'],
        });
        if (
            !asset ||
            !asset.channels.some(channel => String(channel.id) === String(ctx.channelId)) ||
            asset.tags?.some(tag => tag.value === 'customer-avatar')
        )
            return false;
        const rows = await this.connection
            .getRepository(ctx, BlogArticle)
            .createQueryBuilder('a')
            .where('a.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('a.publishedJson LIKE :pattern', { pattern: `%"assetId":"${String(asset.id)}"%` })
            .getMany();
        return rows.some(row => {
            if (!row.publishedJson) return false;
            const x = JSON.parse(row.publishedJson) as BlogPublishedArticle;
            return [x.cover, ...x.illustrations].some(media => media?.assetId === String(asset.id));
        });
    }
}
