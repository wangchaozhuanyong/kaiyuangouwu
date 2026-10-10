import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    EventBus,
    ForbiddenError,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In, IsNull, Not } from 'typeorm';

import { StorefrontDataChangedEvent } from '../realtime/storefront-data-changed.event';
import { StorefrontActivationService } from '../storefront-activation.service';

import { assertSeoAdmin, canReadSeo, canWriteSeo, seoEntityBelongsToChannel } from './storefront-seo.access';
import {
    defaultStorefrontSeoDocument,
    defaultStorefrontSeoSettings,
    publicStorefrontSeoSettings,
    storefrontSeoSettingsIdentity,
    type StorefrontSeoDocument,
    type StorefrontSeoIdentity,
    type StorefrontSeoIssue,
    type StorefrontSeoPayload,
    type StorefrontSeoRecordView,
    type StorefrontSeoSettings,
    type StorefrontSeoTargetType,
} from './storefront-seo.contract';
import { StorefrontSeoRecord, StorefrontSeoRevision } from './storefront-seo.entity';
import { validateSeoEvidence } from './storefront-seo.evidence';
import {
    seoObject,
    validateSeoDocument,
    validateSeoIdentity,
    validateSeoPayloadSize,
    validateSeoSettings,
} from './storefront-seo.validation';

export interface SaveStorefrontSeoDraftInput extends StorefrontSeoIdentity {
    expectedVersion: number;
    draft: unknown;
}
export interface PublishStorefrontSeoRecordInput extends StorefrontSeoIdentity {
    expectedVersion: number;
}
export interface RestoreStorefrontSeoRevisionInput extends PublishStorefrontSeoRecordInput {
    revision: number;
}

@Injectable()
export class StorefrontSeoService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly activation: StorefrontActivationService,
        private readonly eventBus: EventBus,
    ) {}

    async workspace(ctx: RequestContext) {
        assertSeoAdmin(ctx, storefrontSeoSettingsIdentity);
        const rows = await this.connection.getRepository(ctx, StorefrontSeoRecord).find({
            where: { channelId: ctx.channelId },
            order: { targetType: 'ASC', targetId: 'ASC', languageCode: 'ASC' },
        });
        const documents: StorefrontSeoRecordView[] = [];
        for (const row of rows) {
            const identity = this.identity(row);
            if (
                row.targetType !== 'SETTINGS' &&
                canReadSeo(ctx, identity) &&
                (await seoEntityBelongsToChannel(this.connection, ctx, identity))
            )
                documents.push(this.view(ctx, identity, row));
        }
        const settings = this.view(
            ctx,
            storefrontSeoSettingsIdentity,
            rows.find(row => row.targetType === 'SETTINGS') ?? null,
        );
        const accessMode = await this.activation.getAccessMode(ctx);
        const diagnostics: StorefrontSeoIssue[] = [];
        const issue = (
            code: string,
            message: string,
            severity: StorefrontSeoIssue['severity'] = 'WARNING',
            identity = storefrontSeoSettingsIdentity,
        ) => {
            const path = this.publicPath(identity);
            diagnostics.push({
                ...identity,
                code,
                message: path ? `${path}：${message}` : message,
                severity,
            });
        };
        if (accessMode !== 'LIVE')
            issue(
                'STORE_NOT_LIVE',
                accessMode === 'PREVIEW'
                    ? '公开预览保持不索引，不改变营业或付款状态'
                    : '店铺未开放，不能索引',
            );
        if (!settings.published) issue('SEO_SETTINGS_UNPUBLISHED', '搜索策略尚未发布');
        else if (!(settings.published as StorefrontSeoSettings).indexingEnabled)
            issue('INDEXING_DISABLED', '已发布策略关闭搜索收录');
        for (const document of documents) {
            if (document.targetType === 'PAGE' && document.targetId === 'about')
                issue(
                    'PAGE_ROUTE_NOT_RENDERED',
                    '当前 storefront 没有独立 about 路由，保存元信息不会创建页面',
                    'WARNING',
                    document,
                );
            if (!document.published)
                issue(
                    'SEO_DRAFT_ONLY',
                    document.targetType === 'ARTICLE'
                        ? '只有草稿，文章尚未公开'
                        : '只有草稿，公开页面继续使用已公开实体的默认信息',
                    'INFO',
                    document,
                );
            else {
                const payload = document.published as StorefrontSeoDocument;
                if (payload.indexMode === 'NOINDEX')
                    issue('PAGE_NOINDEX', '此页面已发布为不索引', 'INFO', document);
                if (document.targetType === 'ARTICLE' && !payload.article?.body.trim())
                    issue(
                        'ARTICLE_CONTENT_INCOMPLETE',
                        '已发布文章缺少正文，公开服务保持不收录',
                        'ERROR',
                        document,
                    );
                if (
                    settings.published &&
                    !(settings.published as StorefrontSeoSettings).enabledLanguages.includes(
                        document.languageCode as 'en',
                    )
                )
                    issue('LANGUAGE_DISABLED', '已发布搜索策略未启用此语言', 'WARNING', document);
            }
        }
        issue('PLATFORM_NOT_MEASURED', '平台记录为人工提供证据；没有在线同步或真实索引验收', 'INFO');
        return { channelId: String(ctx.channelId), accessMode, settings, documents, diagnostics };
    }

    async getRecord(ctx: RequestContext, raw: StorefrontSeoIdentity): Promise<StorefrontSeoRecordView> {
        const identity = await this.authorize(ctx, raw);
        return this.view(ctx, identity, await this.find(ctx, identity));
    }

    async history(ctx: RequestContext, raw: StorefrontSeoIdentity) {
        const identity = await this.authorize(ctx, raw);
        const row = await this.find(ctx, identity);
        if (!row) return [];
        const rows = await this.connection.getRepository(ctx, StorefrontSeoRevision).find({
            where: { recordId: row.id, channelId: ctx.channelId },
            order: { version: 'DESC' },
            take: 100,
        });
        return rows.map(revision => ({
            id: String(revision.id),
            version: revision.version,
            payload: revision.payloadJson ? (JSON.parse(revision.payloadJson) as StorefrontSeoPayload) : null,
            publishedAt: revision.publishedAt,
            publishedBy: revision.publishedBy,
        }));
    }

    saveDraft(ctx: RequestContext, input: SaveStorefrontSeoDraftInput): Promise<StorefrontSeoRecordView> {
        return this.connection.withTransaction(ctx, async tx => {
            const identity = await this.authorize(tx, input, true);
            const draft = this.normalize(identity, input.draft);
            await this.assertRelatedProducts(tx, draft, identity);
            const repository = this.connection.getRepository(tx, StorefrontSeoRecord);
            const row = await this.find(tx, identity);
            this.assertVersion(input.expectedVersion, row?.version ?? 0);
            if (!row) {
                try {
                    await repository.insert(
                        new StorefrontSeoRecord({
                            ...identity,
                            channelId: tx.channelId,
                            draftJson: JSON.stringify(draft),
                            publishedJson: null,
                            version: 1,
                            publishedVersion: 0,
                            publishedAt: null,
                            publishedByUserId: null,
                        }),
                    );
                } catch (error) {
                    if (this.isDuplicate(error))
                        throw new UserInputError(
                            'SEO_VERSION_CONFLICT: 配置已被其他人创建，请重新读取后处理草稿',
                        );
                    throw error;
                }
            } else {
                const result = await repository
                    .createQueryBuilder()
                    .update()
                    .set({ draftJson: JSON.stringify(draft), version: row.version + 1 })
                    .where({ id: row.id, channelId: tx.channelId, version: input.expectedVersion })
                    .execute();
                this.assertUpdated(result.affected);
            }
            return this.view(tx, identity, await this.find(tx, identity));
        });
    }

    publish(ctx: RequestContext, input: PublishStorefrontSeoRecordInput) {
        return this.connection.withTransaction(ctx, async tx => {
            const identity = await this.authorize(tx, input, true);
            const row = await this.find(tx, identity);
            this.assertVersion(input.expectedVersion, row?.version ?? 0);
            if (!row) throw new UserInputError('请先保存搜索配置草稿');
            const payload = this.normalize(identity, JSON.parse(row.draftJson), true);
            await this.assertRelatedProducts(tx, payload, identity);
            if (identity.targetType === 'SETTINGS') {
                const settings = payload as StorefrontSeoSettings;
                if (
                    settings.organization.businessType === 'LocalBusiness' &&
                    (!settings.organization.publicAddress ||
                        !settings.organization.evidenceUrl ||
                        !settings.organization.reviewedAt)
                )
                    throw new UserInputError('启用实体商家资料前请确认真实营业地址、证据与审核日期');
                if (
                    settings.enabledLanguages.some(
                        language => !tx.channel.availableLanguageCodes.includes(language as never),
                    )
                )
                    throw new UserInputError('搜索语言必须已在当前店铺启用');
            }
            await this.publishSnapshot(tx, row, payload);
            return this.view(tx, identity, await this.find(tx, identity));
        });
    }

    unpublish(ctx: RequestContext, input: PublishStorefrontSeoRecordInput) {
        return this.connection.withTransaction(ctx, async tx => {
            const identity = await this.authorize(tx, input, true);
            const row = await this.find(tx, identity);
            this.assertVersion(input.expectedVersion, row?.version ?? 0);
            if (!row || !row.publishedJson) throw new UserInputError('没有可撤回的已发布版本');
            await this.publishSnapshot(tx, row, null);
            return this.view(tx, identity, await this.find(tx, identity));
        });
    }

    restoreRevision(ctx: RequestContext, input: RestoreStorefrontSeoRevisionInput) {
        return this.connection.withTransaction(ctx, async tx => {
            const identity = await this.authorize(tx, input, true);
            const row = await this.find(tx, identity);
            this.assertVersion(input.expectedVersion, row?.version ?? 0);
            if (!row || !Number.isSafeInteger(input.revision) || input.revision < 1)
                throw new UserInputError('历史版本无效');
            const revision = await this.connection
                .getRepository(tx, StorefrontSeoRevision)
                .findOne({ where: { recordId: row.id, channelId: tx.channelId, version: input.revision } });
            if (!revision?.payloadJson) throw new UserInputError('历史配置不存在；撤回记录不能恢复为配置');
            const payload = this.normalize(identity, JSON.parse(revision.payloadJson));
            await this.assertRelatedProducts(tx, payload, identity);
            const result = await this.connection
                .getRepository(tx, StorefrontSeoRecord)
                .createQueryBuilder()
                .update()
                .set({ draftJson: JSON.stringify(payload), version: row.version + 1 })
                .where({ id: row.id, channelId: tx.channelId, version: input.expectedVersion })
                .execute();
            this.assertUpdated(result.affected);
            return this.view(tx, identity, await this.find(tx, identity));
        });
    }

    /** Fresh database read; no draft data or SEO snapshot of mutable catalog facts. */
    async publishedSettings(ctx: RequestContext): Promise<StorefrontSeoSettings | null> {
        this.assertStore(ctx);
        const record = await this.find(ctx, storefrontSeoSettingsIdentity);
        return record?.publishedJson ? (JSON.parse(record.publishedJson) as StorefrontSeoSettings) : null;
    }
    async publicConfiguration(ctx: RequestContext) {
        const settings = await this.publishedSettings(ctx);
        return settings ? publicStorefrontSeoSettings(settings) : null;
    }
    async publishedConfiguration(ctx: RequestContext) {
        this.assertStore(ctx);
        const record = await this.find(ctx, storefrontSeoSettingsIdentity);
        return record?.publishedJson
            ? {
                  payload: publicStorefrontSeoSettings(
                      JSON.parse(record.publishedJson) as StorefrontSeoSettings,
                  ),
                  version: record.publishedVersion,
                  publishedAt: record.publishedAt,
              }
            : null;
    }
    async publishedRecord(ctx: RequestContext, raw: StorefrontSeoIdentity) {
        this.assertStore(ctx);
        const identity = this.validIdentity(raw);
        if (identity.targetType === 'SETTINGS') throw new UserInputError('请通过店铺设置接口读取');
        if (!(await seoEntityBelongsToChannel(this.connection, ctx, identity))) return null;
        const record = await this.find(ctx, identity);
        return record?.publishedJson
            ? {
                  payload: JSON.parse(record.publishedJson) as StorefrontSeoDocument,
                  version: record.publishedVersion,
                  publishedAt: record.publishedAt,
              }
            : null;
    }
    async publishedDocument(
        ctx: RequestContext,
        raw: StorefrontSeoIdentity,
    ): Promise<StorefrontSeoDocument | null> {
        this.assertStore(ctx);
        const identity = this.validIdentity(raw);
        if (identity.targetType === 'SETTINGS') throw new UserInputError('请通过店铺设置接口读取');
        if (!(await seoEntityBelongsToChannel(this.connection, ctx, identity))) return null;
        const row = await this.find(ctx, identity);
        return row?.publishedJson ? (JSON.parse(row.publishedJson) as StorefrontSeoDocument) : null;
    }
    async listPublished(ctx: RequestContext, targetTypes?: StorefrontSeoTargetType[]) {
        this.assertStore(ctx);
        const types = (targetTypes ?? ['HOME', 'PRODUCT', 'COLLECTION', 'PAGE', 'ARTICLE']).filter(
            type => type !== 'SETTINGS',
        );
        if (!types.length) return [];
        const rows = await this.connection.getRepository(ctx, StorefrontSeoRecord).find({
            where: { channelId: ctx.channelId, targetType: In(types), publishedJson: Not(IsNull()) },
            order: { targetType: 'ASC', targetId: 'ASC', languageCode: 'ASC' },
        });
        return rows
            .filter(
                (row): row is StorefrontSeoRecord & { publishedJson: string } => row.publishedJson != null,
            )
            .map(row => ({
                ...this.identity(row),
                publishedVersion: row.publishedVersion,
                publishedAt: row.publishedAt,
                payload: JSON.parse(row.publishedJson) as StorefrontSeoDocument,
            }));
    }

    private async publishSnapshot(
        ctx: RequestContext,
        row: StorefrontSeoRecord,
        payload: StorefrontSeoPayload | null,
    ) {
        const publishedAt = new Date();
        const publishedVersion = row.publishedVersion + 1;
        const json = payload == null ? null : JSON.stringify(payload);
        const result = await this.connection
            .getRepository(ctx, StorefrontSeoRecord)
            .createQueryBuilder()
            .update()
            .set({
                publishedJson: json,
                draftJson: json == null ? row.draftJson : json,
                version: row.version + 1,
                publishedVersion,
                publishedAt,
                publishedByUserId: String(ctx.activeUserId),
            })
            .where({ id: row.id, channelId: ctx.channelId, version: row.version })
            .execute();
        this.assertUpdated(result.affected);
        await this.connection.getRepository(ctx, StorefrontSeoRevision).insert(
            new StorefrontSeoRevision({
                recordId: row.id,
                channelId: ctx.channelId,
                version: publishedVersion,
                payloadJson: json,
                publishedAt,
                publishedBy: String(ctx.activeUserId),
            }),
        );
        await this.eventBus.publish(
            new StorefrontDataChangedEvent(ctx, ['content', 'config'], {
                channelIds: [ctx.channelId],
                entityType: 'StorefrontSeoRecord',
                entityIds: [row.id],
            }),
        );
    }
    private find(ctx: RequestContext, identity: StorefrontSeoIdentity) {
        return this.connection
            .getRepository(ctx, StorefrontSeoRecord)
            .findOne({ where: { channelId: ctx.channelId, ...identity } });
    }
    private identity(row: StorefrontSeoRecord): StorefrontSeoIdentity {
        return {
            targetType: row.targetType,
            targetId: row.targetId,
            languageCode: row.languageCode as StorefrontSeoIdentity['languageCode'],
        };
    }
    private publicPath(identity: StorefrontSeoIdentity): string | null {
        const locale = identity.languageCode === 'zh_Hans' ? 'zh' : 'en';
        const id = encodeURIComponent(identity.targetId);
        if (identity.targetType === 'HOME') return `/${locale}/`;
        if (identity.targetType === 'PRODUCT') return `/${locale}/product?id=${id}`;
        if (identity.targetType === 'COLLECTION') return `/${locale}/category?collectionId=${id}`;
        if (identity.targetType === 'ARTICLE') return `/${locale}/guides/${id}`;
        if (identity.targetType !== 'PAGE' || identity.targetId === 'about') return null;
        if (identity.targetId === 'terms' || identity.targetId === 'privacy')
            return `/${locale}/legal?id=${id}`;
        if (identity.targetId === 'promo') return '/promo';
        return `/${locale}/${id}`;
    }
    private view(
        ctx: RequestContext,
        identity: StorefrontSeoIdentity,
        row: StorefrontSeoRecord | null,
    ): StorefrontSeoRecordView {
        return {
            ...identity,
            id: row ? String(row.id) : null,
            channelId: String(ctx.channelId),
            draft: row
                ? (JSON.parse(row.draftJson) as StorefrontSeoPayload)
                : identity.targetType === 'SETTINGS'
                  ? defaultStorefrontSeoSettings()
                  : defaultStorefrontSeoDocument(identity.targetType),
            published: row?.publishedJson ? (JSON.parse(row.publishedJson) as StorefrontSeoPayload) : null,
            version: row?.version ?? 0,
            publishedVersion: row?.publishedVersion ?? 0,
            publishedAt: row?.publishedAt ?? null,
            updatedAt: row?.updatedAt ?? null,
            canWrite: canWriteSeo(ctx, identity),
        };
    }
    private async authorize(ctx: RequestContext, raw: StorefrontSeoIdentity, write = false) {
        const identity = this.validIdentity(raw);
        assertSeoAdmin(ctx, identity, write);
        if (!(await seoEntityBelongsToChannel(this.connection, ctx, identity))) throw new ForbiddenError();
        return identity;
    }
    private validIdentity(raw: StorefrontSeoIdentity) {
        try {
            return validateSeoIdentity(raw);
        } catch (error) {
            throw new UserInputError((error as Error).message);
        }
    }
    private normalize(
        identity: StorefrontSeoIdentity,
        raw: unknown,
        publishing = false,
    ): StorefrontSeoPayload {
        try {
            const payload =
                identity.targetType === 'SETTINGS'
                    ? validateSeoSettings(
                          raw,
                          validateSeoEvidence(seoObject(raw, Object.keys(defaultStorefrontSeoSettings()))),
                      )
                    : validateSeoDocument(raw, identity, publishing);
            validateSeoPayloadSize(payload);
            return payload;
        } catch (error) {
            throw new UserInputError((error as Error).message);
        }
    }
    private async assertRelatedProducts(
        ctx: RequestContext,
        payload: StorefrontSeoPayload,
        identity: StorefrontSeoIdentity,
    ) {
        if (identity.targetType !== 'ARTICLE') return;
        for (const targetId of (payload as StorefrontSeoDocument).article?.relatedProductIds ?? []) {
            const productIdentity = this.validIdentity({
                targetType: 'PRODUCT',
                targetId,
                languageCode: identity.languageCode,
            });
            if (!(await seoEntityBelongsToChannel(this.connection, ctx, productIdentity)))
                throw new UserInputError('相关商品必须属于当前店铺');
        }
    }
    private assertStore(ctx: RequestContext) {
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE) throw new ForbiddenError();
    }
    private assertVersion(expected: number, actual: number) {
        if (!Number.isSafeInteger(expected) || expected < 0 || expected !== actual)
            throw new UserInputError('SEO_VERSION_CONFLICT: 配置已更新，请重新读取并处理草稿后再保存');
    }
    private assertUpdated(affected: number | null | undefined) {
        if (affected !== 1)
            throw new UserInputError('SEO_VERSION_CONFLICT: 配置已更新，请重新读取并处理草稿后再保存');
    }
    private isDuplicate(error: unknown) {
        const code =
            (error as { code?: string; driverError?: { code?: string } })?.driverError?.code ??
            (error as { code?: string })?.code;
        return ['ER_DUP_ENTRY', '23505', 'SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE'].includes(
            code ?? '',
        );
    }
}
