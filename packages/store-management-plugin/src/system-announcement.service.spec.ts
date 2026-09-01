import { describe, expect, it, vi } from 'vitest';

import { SystemAnnouncementService } from './system-announcement.service';

describe('SystemAnnouncementService', () => {
    it('normalizes and saves a scheduled announcement', async () => {
        const repository = repositoryHarness();
        const service = serviceWith(repository);

        await service.create({ languageCode: 'zh_Hans' } as any, {
            titleZh: '  系统维护  ',
            contentZh: '  周日凌晨维护  ',
            titleEn: '',
            contentEn: '',
            enabled: true,
            priority: 10,
            linkUrl: '/maintenance',
            startsAt: new Date('2026-08-23T00:00:00.000Z'),
            endsAt: new Date('2026-08-24T00:00:00.000Z'),
        });

        expect(repository.create).toHaveBeenCalledWith(
            expect.objectContaining({
                titleZh: '系统维护',
                contentZh: '周日凌晨维护',
                titleEn: 'translated-title',
                contentEn: 'translated-content',
                priority: 10,
                linkUrl: '/maintenance',
            }),
        );
        expect(repository.save).toHaveBeenCalled();
    });

    it('does not publish an announcement with incomplete English content', async () => {
        const repository = repositoryHarness([
            {
                id: '1',
                titleZh: '中文标题',
                titleEn: '',
                contentZh: '中文内容',
                contentEn: '',
                linkUrl: null,
                startsAt: null,
                endsAt: null,
            },
        ]);
        const service = serviceWith(repository);

        await expect(
            service.findActive({ languageCode: 'en', channelId: 'channel-1' } as any),
        ).resolves.toEqual([]);
        expect(repository.queryBuilder.where).toHaveBeenCalledWith('announcement.enabled = :enabled', {
            enabled: true,
        });
        expect(repository.queryBuilder.andWhere).toHaveBeenCalledWith(
            '(announcement.targetMode = :allMode OR targetChannel.id = :channelId)',
            { allMode: 'ALL', channelId: 'channel-1' },
        );
    });

    it('rejects unsafe announcement links', async () => {
        const service = serviceWith(repositoryHarness());
        await expect(
            service.create({ languageCode: 'zh_Hans' } as any, {
                titleZh: '测试',
                contentZh: '测试内容',
                linkUrl: 'javascript:alert(1)',
            }),
        ).rejects.toThrow('跳转链接');
    });

    it('requires two valid Channels for a multiple-store announcement', async () => {
        const repository = repositoryHarness();
        const channelRepository = { find: vi.fn().mockResolvedValue([{ id: 'channel-1' }]) };
        const service = serviceWith(repository, channelRepository);

        await expect(
            service.create({ languageCode: 'zh_Hans' } as any, {
                titleZh: '指定网店公告',
                contentZh: '只有指定网店可见',
                targetMode: 'MULTIPLE',
                channelIds: ['channel-1'],
            }),
        ).rejects.toThrow('至少选择 2 个网店');
    });

    it('returns the persisted manual-lock state for each English field', async () => {
        const service = serviceWith(repositoryHarness(), undefined, [
            { fieldPath: 'content', locked: false },
            { fieldPath: 'title', locked: true },
        ]);

        await expect(
            service.translationLocks({ languageCode: 'zh_Hans' } as any, 'announcement-1'),
        ).resolves.toEqual({
            titleEnLocked: true,
            contentEnLocked: false,
        });
    });

    it('regenerates automatic English after an existing manual lock is removed', async () => {
        const repository = repositoryHarness();
        repository.findOne.mockResolvedValue({
            id: 'announcement-1',
            titleZh: '系统维护',
            titleEn: 'Reviewed maintenance',
            contentZh: '周日凌晨维护',
            contentEn: 'Reviewed body',
            targetMode: 'ALL',
            channels: [],
            enabled: true,
            priority: 0,
            linkUrl: null,
            startsAt: null,
            endsAt: null,
        });
        const service = serviceWith(repository, undefined, [
            { fieldPath: 'title', locked: true },
            { fieldPath: 'content', locked: true },
        ]);

        await service.update({ languageCode: 'zh_Hans' } as any, {
            id: 'announcement-1',
            titleZh: '系统维护',
            titleEn: 'Reviewed maintenance',
            titleEnLocked: false,
            contentZh: '周日凌晨维护',
            contentEn: 'Reviewed body',
            contentEnLocked: false,
        });

        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                titleEn: 'translated-title',
                contentEn: 'translated-content',
            }),
        );
    });
});

function serviceWith(
    repository: ReturnType<typeof repositoryHarness>,
    channelRepository: any = repository,
    translationStates: Array<{ fieldPath: string; locked: boolean }> = [],
) {
    const translations = {
        prepareLocalizedFields: vi.fn(async fields =>
            fields.map((field: any) => {
                const locked = field.manualLock ?? Boolean(field.targetText?.trim());
                return {
                    path: field.path,
                    sourceText: field.sourceText,
                    translatedText: locked ? field.targetText?.trim() : `translated-${field.path}`,
                    status: locked ? 'MANUAL_LOCKED' : 'AUTO_TRANSLATED',
                    origin: locked ? 'MANUAL' : 'AUTO',
                    locked,
                };
            }),
        ),
        recordPreparedFields: vi.fn(async () => undefined),
        findStates: vi.fn(async () => translationStates),
    };
    return new SystemAnnouncementService(
        {
            getRepository: (_ctx: unknown, entity: { name?: string }) =>
                entity.name === 'Channel' ? channelRepository : repository,
        } as any,
        translations as any,
    );
}

function repositoryHarness(activeAnnouncements: any[] = []) {
    const queryBuilder = {
        leftJoin: vi.fn(),
        where: vi.fn(),
        andWhere: vi.fn(),
        distinct: vi.fn(),
        orderBy: vi.fn(),
        addOrderBy: vi.fn(),
        take: vi.fn(),
        getMany: vi.fn(async () => activeAnnouncements),
    };
    for (const method of [
        'leftJoin',
        'where',
        'andWhere',
        'distinct',
        'orderBy',
        'addOrderBy',
        'take',
    ] as const) {
        queryBuilder[method].mockReturnValue(queryBuilder);
    }
    return {
        queryBuilder,
        createQueryBuilder: vi.fn(() => queryBuilder),
        create: vi.fn(value => value),
        save: vi.fn(async value => value),
        find: vi.fn(async () => activeAnnouncements),
        findOne: vi.fn(async (): Promise<any> => null),
        remove: vi.fn(),
    };
}
