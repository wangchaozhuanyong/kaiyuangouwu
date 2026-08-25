import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    ContentTranslationService,
    PreparedLocalizedContentField,
} from '@vendure/content-translation-plugin';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { SystemAnnouncement } from './entities/system-announcement.entity';
import {
    CreateSystemAnnouncementInput,
    SystemAnnouncementPublicView,
    UpdateSystemAnnouncementInput,
} from './types';

@Injectable()
export class SystemAnnouncementService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly translations: ContentTranslationService,
    ) {}

    findAll(ctx: RequestContext): Promise<SystemAnnouncement[]> {
        return this.connection.getRepository(ctx, SystemAnnouncement).find({
            order: { priority: 'DESC', createdAt: 'DESC' },
        });
    }

    async findActive(ctx: RequestContext): Promise<SystemAnnouncementPublicView[]> {
        const now = new Date();
        const announcements = await this.connection
            .getRepository(ctx, SystemAnnouncement)
            .createQueryBuilder('announcement')
            .where('announcement.enabled = :enabled', { enabled: true })
            .andWhere('(announcement.startsAt IS NULL OR announcement.startsAt <= :now)', { now })
            .andWhere('(announcement.endsAt IS NULL OR announcement.endsAt > :now)', { now })
            .orderBy('announcement.priority', 'DESC')
            .addOrderBy('announcement.createdAt', 'DESC')
            .take(20)
            .getMany();
        const isZh = String(ctx.languageCode).toLowerCase().startsWith('zh');
        return announcements.filter(hasCompleteAnnouncementTranslation).map(announcement => ({
            id: announcement.id,
            title: localizedText(announcement.titleZh, announcement.titleEn, isZh),
            content: localizedText(announcement.contentZh, announcement.contentEn, isZh),
            linkUrl: announcement.linkUrl,
            startsAt: announcement.startsAt,
            endsAt: announcement.endsAt,
        }));
    }

    async create(ctx: RequestContext, input: CreateSystemAnnouncementInput): Promise<SystemAnnouncement> {
        const { values, prepared } = await this.normalize(input);
        const repository = this.connection.getRepository(ctx, SystemAnnouncement);
        const saved = await repository.save(repository.create(values));
        await this.recordTranslationState(ctx, saved, prepared);
        return saved;
    }

    async update(ctx: RequestContext, input: UpdateSystemAnnouncementInput): Promise<SystemAnnouncement> {
        const repository = this.connection.getRepository(ctx, SystemAnnouncement);
        const announcement = await repository.findOne({ where: { id: input.id } });
        if (!announcement) throw new UserInputError('找不到该系统公告');
        const { values, prepared } = await this.normalize(input, announcement);
        Object.assign(announcement, values);
        const saved = await repository.save(announcement);
        await this.recordTranslationState(ctx, saved, prepared);
        return saved;
    }

    async delete(ctx: RequestContext, id: ID) {
        const repository = this.connection.getRepository(ctx, SystemAnnouncement);
        const announcement = await repository.findOne({ where: { id } });
        if (!announcement) return { result: 'NOT_DELETED', message: '找不到该系统公告' };
        await repository.remove(announcement);
        return { result: 'DELETED' };
    }

    private async normalize(
        input: CreateSystemAnnouncementInput | UpdateSystemAnnouncementInput,
        existing?: SystemAnnouncement,
    ) {
        const titleZh = requiredText(input.titleZh, '中文标题', 120);
        const contentZh = requiredText(input.contentZh, '中文内容', 2_000);
        const prepared = await this.translations.prepareLocalizedFields([
            {
                path: 'title',
                sourceText: titleZh,
                targetText: optionalText(input.titleEn, 120),
                existingSourceText: existing?.titleZh,
                existingTargetText: existing?.titleEn,
                required: true,
            },
            {
                path: 'content',
                sourceText: contentZh,
                targetText: optionalText(input.contentEn, 2_000),
                existingSourceText: existing?.contentZh,
                existingTargetText: existing?.contentEn,
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
            },
        };
    }

    private recordTranslationState(
        ctx: RequestContext,
        announcement: SystemAnnouncement,
        prepared: PreparedLocalizedContentField[],
    ): Promise<void> {
        return this.translations.recordPreparedFields(
            ctx,
            {
                channelId: null,
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
    return (isZh ? zh || en : en || zh).trim();
}

function hasCompleteAnnouncementTranslation(announcement: SystemAnnouncement): boolean {
    return [announcement.titleZh, announcement.titleEn, announcement.contentZh, announcement.contentEn].every(
        value => value.trim().length > 0,
    );
}
