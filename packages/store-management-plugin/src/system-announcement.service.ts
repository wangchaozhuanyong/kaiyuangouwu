import { Injectable, Optional } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import {
    ContentTranslationService,
    isUsableEnglishTranslation,
    PreparedLocalizedContentField,
} from '@vendure/content-translation-plugin';
import {
    Channel,
    EventBus,
    ForbiddenError,
    idsAreEqual,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { storefrontContentPermission } from '@vendure/storefront-content-plugin';
import { In } from 'typeorm';

import { SystemAnnouncement } from './entities/system-announcement.entity';
import { StorefrontDataChangedEvent } from './realtime/storefront-data-changed.event';
import {
    CreateSystemAnnouncementInput,
    StorefrontAnnouncementPageOptions,
    StorefrontSystemAnnouncementList,
    SystemAnnouncementPublicView,
    UpdateSystemAnnouncementInput,
} from './types';

@Injectable()
export class SystemAnnouncementService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly translations: ContentTranslationService,
        @Optional() private readonly eventBus?: EventBus,
    ) {}

    async findAll(ctx: RequestContext): Promise<SystemAnnouncement[]> {
        this.assertAdminAccess(ctx, storefrontContentPermission.Read);
        const repository = this.connection.getRepository(ctx, SystemAnnouncement);
        if (!this.isPlatform(ctx)) {
            const announcements = await repository
                .createQueryBuilder('announcement')
                .leftJoin('announcement.channels', 'scopeChannel', 'scopeChannel.id = :channelId', {
                    channelId: ctx.channelId,
                })
                .leftJoinAndSelect('announcement.channels', 'targetChannel')
                .where('(announcement.ownerChannelId IS NULL OR announcement.ownerChannelId = :channelId)', {
                    channelId: ctx.channelId,
                })
                .andWhere('(announcement.targetMode = :allMode OR scopeChannel.id = :channelId)', {
                    allMode: 'ALL',
                    channelId: ctx.channelId,
                })
                .orderBy('announcement.priority', 'DESC')
                .addOrderBy('announcement.createdAt', 'DESC')
                .addOrderBy('announcement.id', 'DESC')
                .getMany();
            return announcements.filter(announcement => this.isReadable(ctx, announcement));
        }
        return repository.find({
            relations: { channels: true },
            order: { priority: 'DESC', createdAt: 'DESC', id: 'DESC' },
        });
    }

    async findActive(ctx: RequestContext): Promise<SystemAnnouncementPublicView[]> {
        return (await this.findActivePage(ctx, { take: 20 })).items;
    }

    async findActivePage(
        ctx: RequestContext,
        options?: StorefrontAnnouncementPageOptions | null,
    ): Promise<StorefrontSystemAnnouncementList> {
        const announcements = await this.activeQuery(ctx)
            .addSelect('COALESCE(announcement.startsAt, announcement.createdAt)', 'announcement_published_at')
            .orderBy('announcement_published_at', 'DESC')
            .addOrderBy('announcement.createdAt', 'DESC')
            .addOrderBy('announcement.id', 'DESC')
            .getMany();
        // Translation eligibility uses the shared language validator. Apply it before
        // pagination so untranslated records never hide older, readable announcements.
        // The homepage uses the same order and eligibility before taking its bounded subset.
        const visible = this.publicViews(ctx, announcements);
        const skip = pageInteger(options?.skip, 0, 0, Number.MAX_SAFE_INTEGER);
        const take = pageInteger(options?.take, 20, 1, 100);
        return { items: visible.slice(skip, skip + take), totalItems: visible.length };
    }

    async findActiveById(ctx: RequestContext, id: ID): Promise<SystemAnnouncementPublicView | null> {
        const announcement = await this.activeQuery(ctx).andWhere('announcement.id = :id', { id }).getOne();
        return announcement ? (this.publicViews(ctx, [announcement])[0] ?? null) : null;
    }

    private activeQuery(ctx: RequestContext) {
        const now = new Date();
        return this.connection
            .getRepository(ctx, SystemAnnouncement)
            .createQueryBuilder('announcement')
            .leftJoin('announcement.channels', 'targetChannel')
            .where('announcement.enabled = :enabled', { enabled: true })
            .andWhere('(announcement.startsAt IS NULL OR announcement.startsAt <= :now)', { now })
            .andWhere('(announcement.endsAt IS NULL OR announcement.endsAt > :now)', { now })
            .andWhere('(announcement.targetMode = :allMode OR targetChannel.id = :channelId)', {
                allMode: 'ALL',
                channelId: ctx.channelId,
            })
            .distinct(true);
    }

    private publicViews(
        ctx: RequestContext,
        announcements: SystemAnnouncement[],
    ): SystemAnnouncementPublicView[] {
        const isZh = String(ctx.languageCode).toLowerCase().startsWith('zh');
        return announcements
            .filter(announcement => isZh || hasCompleteAnnouncementTranslation(announcement))
            .map(announcement => ({
                id: announcement.id,
                createdAt: announcement.createdAt,
                title: localizedText(announcement.titleZh, announcement.titleEn, isZh),
                content: localizedText(announcement.contentZh, announcement.contentEn, isZh),
                linkUrl: announcement.linkUrl,
                startsAt: announcement.startsAt,
                endsAt: announcement.endsAt,
            }));
    }

    async create(ctx: RequestContext, input: CreateSystemAnnouncementInput): Promise<SystemAnnouncement> {
        this.assertAdminAccess(ctx, storefrontContentPermission.Create);
        const { values, prepared } = await this.normalize(ctx, input);
        const repository = this.connection.getRepository(ctx, SystemAnnouncement);
        const saved = await repository.save(repository.create(values));
        await this.recordTranslationState(ctx, saved, prepared);
        await this.publishChanged(ctx, saved);
        return saved;
    }

    async update(ctx: RequestContext, input: UpdateSystemAnnouncementInput): Promise<SystemAnnouncement> {
        this.assertAdminAccess(ctx, storefrontContentPermission.Update);
        const repository = this.connection.getRepository(ctx, SystemAnnouncement);
        const announcement = await repository.findOne({
            where: { id: input.id },
            relations: { channels: true },
        });
        if (!announcement) throw new UserInputError('找不到该系统公告');
        this.assertManageable(ctx, announcement);
        const previousAllChannels = announcement.targetMode === 'ALL';
        const previousChannelIds = announcement.channels.map(channel => channel.id);
        const { values, prepared } = await this.normalize(ctx, input, announcement);
        Object.assign(announcement, values);
        const saved = await repository.save(announcement);
        await this.recordTranslationState(ctx, saved, prepared);
        await this.publishChanged(ctx, saved, previousAllChannels, previousChannelIds);
        return saved;
    }

    async delete(ctx: RequestContext, id: ID) {
        this.assertAdminAccess(ctx, storefrontContentPermission.Delete);
        const repository = this.connection.getRepository(ctx, SystemAnnouncement);
        const announcement = await repository.findOne({ where: { id }, relations: { channels: true } });
        if (!announcement) return { result: 'NOT_DELETED', message: '找不到该系统公告' };
        this.assertManageable(ctx, announcement);
        await repository.remove(announcement);
        await this.publishChanged(ctx, announcement);
        return { result: 'DELETED' };
    }

    async translationLocks(ctx: RequestContext, id: ID) {
        this.assertAdminAccess(ctx, storefrontContentPermission.Read);
        const announcement = await this.connection.getRepository(ctx, SystemAnnouncement).findOne({
            where: { id },
            relations: { channels: true },
        });
        if (!announcement) throw new UserInputError('找不到该系统公告');
        if (!this.isPlatform(ctx) && !this.isReadable(ctx, announcement)) throw new ForbiddenError();
        const states = await this.translations.findStates(ctx, {
            channelId: announcement.ownerChannelId ?? null,
            entityType: SystemAnnouncement.name,
            entityId: id,
        });
        const byField = new Map(states.map(state => [state.fieldPath, state]));
        return {
            titleEnLocked: byField.get('title')?.locked ?? false,
            contentEnLocked: byField.get('content')?.locked ?? false,
        };
    }

    private async publishChanged(
        ctx: RequestContext,
        announcement: SystemAnnouncement,
        previousAllChannels = false,
        previousChannelIds: ID[] = [],
    ): Promise<void> {
        const allChannels = previousAllChannels || announcement.targetMode === 'ALL';
        const channelIds = Array.from(
            new Set([...previousChannelIds, ...announcement.channels.map(channel => channel.id)].map(String)),
        );
        await this.eventBus?.publish(
            new StorefrontDataChangedEvent(ctx, ['content'], {
                allChannels,
                channelIds,
                entityType: 'SystemAnnouncement',
                entityIds: [announcement.id],
            }),
        );
    }

    private async normalize(
        ctx: RequestContext,
        input: CreateSystemAnnouncementInput | UpdateSystemAnnouncementInput,
        existing?: SystemAnnouncement,
    ) {
        const platform = this.isPlatform(ctx);
        const ownerChannelId = existing ? (existing.ownerChannelId ?? null) : platform ? null : ctx.channelId;
        const targetMode = input.targetMode ?? existing?.targetMode ?? (platform ? 'ALL' : 'SINGLE');
        if (!['ALL', 'SINGLE', 'MULTIPLE'].includes(targetMode)) {
            throw new UserInputError('公告发布范围不正确');
        }
        const channelIds = Array.from(
            new Set(
                (
                    input.channelIds ??
                    existing?.channels.map(channel => channel.id) ??
                    (platform ? [] : [ctx.channelId])
                ).map(String),
            ),
        );
        if (
            !platform &&
            (targetMode !== 'SINGLE' || channelIds.length !== 1 || !idsAreEqual(channelIds[0], ctx.channelId))
        ) {
            throw new UserInputError('店铺公告只能发布到当前经营店铺');
        }
        if (targetMode === 'SINGLE' && channelIds.length !== 1) {
            throw new UserInputError('指定单个网店时必须选择 1 个网店');
        }
        if (targetMode === 'MULTIPLE' && channelIds.length < 2) {
            throw new UserInputError('指定多个网店时至少选择 2 个网店');
        }
        if (
            ownerChannelId != null &&
            (targetMode !== 'SINGLE' ||
                channelIds.length !== 1 ||
                !idsAreEqual(channelIds[0], ownerChannelId))
        ) {
            throw new UserInputError('店铺发布的公告必须保留在原发布店铺');
        }
        const channels =
            targetMode === 'ALL'
                ? []
                : platform
                  ? await this.connection.getRepository(ctx, Channel).find({ where: { id: In(channelIds) } })
                  : [ctx.channel];
        if (
            targetMode !== 'ALL' &&
            (channels.length !== channelIds.length ||
                channels.some(channel => channel.code === DEFAULT_CHANNEL_CODE))
        ) {
            throw new UserInputError('所选经营店铺不存在或已被删除');
        }
        const titleZh = requiredText(input.titleZh, '中文标题', 120);
        const contentZh = requiredText(input.contentZh, '中文内容', 2_000);
        const titleEn = optionalText(input.titleEn, 120);
        const contentEn = optionalText(input.contentEn, 2_000);
        const existingStates = existing
            ? await this.translations.findStates(ctx, {
                  channelId: existing.ownerChannelId ?? null,
                  entityType: SystemAnnouncement.name,
                  entityId: existing.id,
              })
            : [];
        const stateByField = new Map(existingStates.map(state => [state.fieldPath, state]));
        const titleState = stateByField.get('title');
        const contentState = stateByField.get('content');
        const prepared = await this.translations.prepareLocalizedFields([
            {
                path: 'title',
                sourceText: titleZh,
                targetText: titleEn,
                existingSourceText: existing?.titleZh,
                existingTargetText: existing?.titleEn,
                manualLock: requestedManualLock(
                    input.titleEnLocked,
                    titleEn,
                    existing?.titleEn,
                    titleState?.locked,
                ),
                existingLocked: titleState?.locked,
                required: true,
            },
            {
                path: 'content',
                sourceText: contentZh,
                targetText: contentEn,
                existingSourceText: existing?.contentZh,
                existingTargetText: existing?.contentEn,
                manualLock: requestedManualLock(
                    input.contentEnLocked,
                    contentEn,
                    existing?.contentEn,
                    contentState?.locked,
                ),
                existingLocked: contentState?.locked,
                required: true,
            },
        ]);
        const english = new Map(prepared.map(field => [field.path, field.translatedText]));
        const priority = Number(input.priority ?? 0);
        if (!Number.isInteger(priority) || priority < 0 || priority > 999) {
            throw new UserInputError('优先级必须是 0 到 999 的整数');
        }
        const startsAt = validOptionalDate(input.startsAt, '开始时间');
        const endsAt = validOptionalDate(input.endsAt, '结束时间');
        if (startsAt && endsAt && startsAt >= endsAt) {
            throw new UserInputError('公告结束时间必须晚于开始时间');
        }
        const linkUrl = optionalText(input.linkUrl, 500) || null;
        if (linkUrl && !isSafeAnnouncementLink(linkUrl)) {
            throw new UserInputError('跳转链接只能使用 HTTPS、HTTP 或站内相对路径');
        }
        return {
            prepared,
            values: {
                enabled: input.enabled !== false,
                priority,
                titleZh,
                titleEn: english.get('title') ?? '',
                contentZh,
                contentEn: english.get('content') ?? '',
                linkUrl,
                startsAt,
                endsAt,
                targetMode,
                ownerChannelId,
                channels,
            },
        };
    }

    private isPlatform(ctx: RequestContext): boolean {
        return ctx.channel.code === DEFAULT_CHANNEL_CODE;
    }

    private assertAdminAccess(ctx: RequestContext, permission: Permission): void {
        if (
            ctx.apiType !== 'admin' ||
            !ctx.activeUserId ||
            (!ctx.userHasPermissions([Permission.SuperAdmin]) &&
                (this.isPlatform(ctx) || !ctx.userHasPermissions([permission])))
        ) {
            throw new ForbiddenError();
        }
    }

    private isStoreAnnouncement(ctx: RequestContext, announcement: SystemAnnouncement): boolean {
        return (
            announcement.ownerChannelId != null &&
            idsAreEqual(announcement.ownerChannelId, ctx.channelId) &&
            announcement.targetMode === 'SINGLE' &&
            announcement.channels.length === 1 &&
            idsAreEqual(announcement.channels[0].id, ctx.channelId)
        );
    }

    private isReadable(ctx: RequestContext, announcement: SystemAnnouncement): boolean {
        return (
            this.isStoreAnnouncement(ctx, announcement) ||
            (announcement.ownerChannelId == null &&
                (announcement.targetMode === 'ALL' ||
                    ((announcement.targetMode === 'SINGLE'
                        ? announcement.channels.length === 1
                        : announcement.channels.length >= 2) &&
                        announcement.channels.some(channel => idsAreEqual(channel.id, ctx.channelId)))))
        );
    }

    private assertManageable(ctx: RequestContext, announcement: SystemAnnouncement): void {
        if (!this.isPlatform(ctx) && !this.isStoreAnnouncement(ctx, announcement)) {
            throw new UserInputError('只能管理当前经营店铺自行发布的单店公告，平台公告只读');
        }
    }

    private recordTranslationState(
        ctx: RequestContext,
        announcement: SystemAnnouncement,
        prepared: PreparedLocalizedContentField[],
    ): Promise<void> {
        return this.translations.recordPreparedFields(
            ctx,
            {
                channelId: announcement.ownerChannelId ?? null,
                entityType: SystemAnnouncement.name,
                entityId: announcement.id,
            },
            prepared,
        );
    }
}

function requiredText(value: string, label: string, maxLength: number): string {
    const normalized = value?.trim();
    if (!normalized) throw new UserInputError(`${label}不能为空`);
    if (normalized.length > maxLength) throw new UserInputError(`${label}不能超过 ${maxLength} 个字符`);
    return normalized;
}

function optionalText(value: string | null | undefined, maxLength: number): string {
    const normalized = value?.trim() ?? '';
    if (normalized.length > maxLength) throw new UserInputError(`内容不能超过 ${maxLength} 个字符`);
    return normalized;
}

function requestedManualLock(
    explicit: boolean | null | undefined,
    targetText: string,
    existingTargetText: string | null | undefined,
    existingLocked: boolean | undefined,
): boolean | undefined {
    if (explicit != null) return explicit;
    const normalizedExistingTarget = existingTargetText?.trim() ?? '';
    if (targetText && targetText !== normalizedExistingTarget) return true;
    if (existingLocked != null) return existingLocked;
    if (existingTargetText == null) return Boolean(targetText);
    return undefined;
}

function validOptionalDate(value: Date | null | undefined, label: string): Date | null {
    if (value == null) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new UserInputError(`${label}格式不正确`);
    return date;
}

function isSafeAnnouncementLink(value: string): boolean {
    return /^(https?:\/\/|\/|#\/)/i.test(value);
}

function localizedText(zh: string, en: string, isZh: boolean): string {
    return (isZh ? zh || en : en).trim();
}

function hasCompleteAnnouncementTranslation(announcement: SystemAnnouncement): boolean {
    return (
        announcement.titleZh.trim().length > 0 &&
        announcement.contentZh.trim().length > 0 &&
        isUsableEnglishTranslation(announcement.titleEn) &&
        isUsableEnglishTranslation(announcement.contentEn)
    );
}

function pageInteger(value: number | null | undefined, fallback: number, min: number, max: number): number {
    return value == null || !Number.isFinite(value)
        ? fallback
        : Math.min(max, Math.max(min, Math.trunc(value)));
}
