import { Permission, RequestContext } from '@vendure/core';
import { storefrontContentPermission } from '@vendure/storefront-content-plugin';
import { describe, expect, it, vi } from 'vitest';

import { SystemAnnouncementService } from './system-announcement.service';

describe('SystemAnnouncementService', () => {
    it('exposes persisted creation time for the recent homepage notice selector', async () => {
        const createdAt = new Date('2026-09-24T08:00:00.000Z');
        const repository = repositoryHarness([
            {
                id: 'recent',
                createdAt,
                titleZh: '配送通知',
                titleEn: 'Delivery notice',
                contentZh: '配送安排已更新',
                contentEn: 'Delivery arrangements have changed',
                linkUrl: null,
                startsAt: null,
                endsAt: null,
            },
        ]);
        const result = await serviceWith(repository).findActive({
            languageCode: 'zh_Hans',
            channelId: 'channel-1',
        } as any);
        expect(result[0]?.createdAt).toEqual(createdAt);
        expect(repository.queryBuilder.orderBy).toHaveBeenCalledWith('announcement.createdAt', 'DESC');
    });

    it('normalizes and saves a scheduled announcement', async () => {
        const repository = repositoryHarness();
        const service = serviceWith(repository);

        await service.create(platformContext, {
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

    it('does not publish Chinese text stored in the English announcement fields', async () => {
        const repository = repositoryHarness([
            {
                id: '1',
                titleZh: '中文标题',
                titleEn: '中文标题',
                contentZh: '中文内容',
                contentEn: '中文内容',
                linkUrl: null,
                startsAt: null,
                endsAt: null,
            },
        ]);
        const service = serviceWith(repository);

        await expect(
            service.findActive({ languageCode: 'en', channelId: 'channel-1' } as any),
        ).resolves.toEqual([]);
    });

    it('rejects unsafe announcement links', async () => {
        const service = serviceWith(repositoryHarness());
        await expect(
            service.create(platformContext, {
                titleZh: '测试',
                contentZh: '测试内容',
                linkUrl: 'javascript:alert(1)',
            }),
        ).rejects.toThrow('跳转链接');
    });

    it('paginates the complete active archive beyond the homepage limit', async () => {
        const records = Array.from({ length: 45 }, (_, index) => publicAnnouncement(String(index)));
        const repository = repositoryHarness(records);
        const service = serviceWith(repository);
        const context = { languageCode: 'zh_Hans', channelId: 'channel-1' } as any;

        const result = await service.findActivePage(context, { skip: 20, take: 20 });

        expect(result.totalItems).toBe(45);
        expect(result.items.map(item => item.id)).toEqual(records.slice(20, 40).map(item => item.id));
        expect(repository.queryBuilder.take).not.toHaveBeenCalled();
        expect(repository.queryBuilder.addSelect).toHaveBeenCalledWith(
            'COALESCE(announcement.startsAt, announcement.createdAt)',
            'announcement_published_at',
        );
        expect(repository.queryBuilder.orderBy).toHaveBeenCalledWith('announcement_published_at', 'DESC');
        expect(repository.queryBuilder.addOrderBy.mock.calls).toEqual([
            ['announcement.createdAt', 'DESC'],
            ['announcement.id', 'DESC'],
        ]);

        await service.findActive(context);
        expect(repository.queryBuilder.take).toHaveBeenCalledWith(20);
    });

    it('filters unusable English translations before counting and paginating the archive', async () => {
        const untranslated = Array.from({ length: 25 }, (_, index) => ({
            ...publicAnnouncement(`untranslated-${index}`),
            contentEn: index % 2 ? '' : '尚未翻译',
        }));
        const repository = repositoryHarness([
            ...untranslated,
            publicAnnouncement('readable-one'),
            publicAnnouncement('readable-two'),
        ]);

        const result = await serviceWith(repository).findActivePage(
            { languageCode: 'en', channelId: 'channel-1' } as any,
            { skip: 1, take: 1 },
        );

        expect(result.totalItems).toBe(2);
        expect(result.items.map(item => item.id)).toEqual(['readable-two']);
        expect(result.items[0]).toMatchObject({ title: 'Announcement', content: 'Published notice' });
    });

    it('bounds archive pagination and keeps a successful empty page distinct from missing data', async () => {
        const records = Array.from({ length: 125 }, (_, index) => publicAnnouncement(String(index)));
        const service = serviceWith(repositoryHarness(records));
        const context = { languageCode: 'zh_Hans', channelId: 'channel-1' } as any;

        expect((await service.findActivePage(context, { skip: -5, take: 1_000 })).items).toHaveLength(100);
        expect((await service.findActivePage(context, { skip: 1.9, take: 0 })).items[0].id).toBe('1');
        expect((await service.findActivePage(context, null)).items).toHaveLength(20);
        expect((await service.findActivePage(context, { take: Number.NaN })).items).toHaveLength(20);
        expect(await service.findActivePage(context, { skip: 500 })).toEqual({ items: [], totalItems: 125 });
        expect(await serviceWith(repositoryHarness()).findActivePage(context)).toEqual({
            items: [],
            totalItems: 0,
        });
    });

    it.each(['list', 'detail'] as const)(
        'keeps enabled, schedule and current-store constraints on the public %s query',
        async mode => {
            const repository = repositoryHarness();
            const service = serviceWith(repository);
            const context = { languageCode: 'zh_Hans', channelId: 'current-store' } as any;

            if (mode === 'list') await service.findActivePage(context);
            else await service.findActiveById(context, 'older-announcement');

            expect(repository.queryBuilder.where).toHaveBeenCalledWith('announcement.enabled = :enabled', {
                enabled: true,
            });
            expect(repository.queryBuilder.andWhere).toHaveBeenCalledWith(
                '(announcement.startsAt IS NULL OR announcement.startsAt <= :now)',
                { now: expect.any(Date) },
            );
            expect(repository.queryBuilder.andWhere).toHaveBeenCalledWith(
                '(announcement.endsAt IS NULL OR announcement.endsAt > :now)',
                { now: expect.any(Date) },
            );
            expect(repository.queryBuilder.andWhere).toHaveBeenCalledWith(
                '(announcement.targetMode = :allMode OR targetChannel.id = :channelId)',
                { allMode: 'ALL', channelId: 'current-store' },
            );
            expect(repository.queryBuilder.distinct).toHaveBeenCalledWith(true);
        },
    );

    it('reads a direct announcement independently of the homepage limit and returns only public fields', async () => {
        const repository = repositoryHarness();
        repository.queryBuilder.getOne.mockResolvedValue(publicAnnouncement('older-announcement'));

        const result = await serviceWith(repository).findActiveById(
            { languageCode: 'zh_Hans', channelId: 'channel-1' } as any,
            'older-announcement',
        );

        expect(result).toEqual({
            id: 'older-announcement',
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
            title: '公告标题',
            content: '公告正文',
            linkUrl: null,
            startsAt: null,
            endsAt: null,
        });
        expect(repository.queryBuilder.andWhere).toHaveBeenCalledWith('announcement.id = :id', {
            id: 'older-announcement',
        });
        expect(repository.queryBuilder.getMany).not.toHaveBeenCalled();
        expect(repository.queryBuilder.take).not.toHaveBeenCalled();
    });

    it('returns null for a filtered-out detail or one without a complete English translation', async () => {
        const repository = repositoryHarness();
        const service = serviceWith(repository);
        const context = { languageCode: 'en', channelId: 'channel-1' } as any;

        expect(await service.findActiveById(context, 'not-visible')).toBeNull();
        repository.queryBuilder.getOne.mockResolvedValue({
            ...publicAnnouncement('untranslated'),
            titleEn: '',
        });
        expect(await service.findActiveById(context, 'untranslated')).toBeNull();
        repository.queryBuilder.getOne.mockResolvedValue({
            ...publicAnnouncement('untranslated'),
            contentEn: '中文内容',
        });
        expect(await service.findActiveById(context, 'untranslated')).toBeNull();
    });

    it('requires two valid Channels for a multiple-store announcement', async () => {
        const repository = repositoryHarness();
        const channelRepository = { find: vi.fn().mockResolvedValue([{ id: 'channel-1' }]) };
        const service = serviceWith(repository, channelRepository);

        await expect(
            service.create(platformContext, {
                titleZh: '指定网店公告',
                contentZh: '只有指定网店可见',
                targetMode: 'MULTIPLE',
                channelIds: ['channel-1'],
            }),
        ).rejects.toThrow('至少选择 2 个网店');
    });

    it('returns the persisted manual-lock state for each English field', async () => {
        const repository = repositoryHarness();
        repository.findOne.mockResolvedValue(storedAnnouncement('ALL', []));
        const service = serviceWith(repository, undefined, [
            { fieldPath: 'content', locked: false },
            { fieldPath: 'title', locked: true },
        ]);

        await expect(service.translationLocks(platformContext, 'announcement-1')).resolves.toEqual({
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

        await service.update(platformContext, {
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
        prepareLocalizedFields: vi.fn(fields =>
            Promise.resolve(
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
        ),
        recordPreparedFields: vi.fn(() => Promise.resolve(undefined)),
        findStates: vi.fn(() => Promise.resolve(translationStates)),
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
        innerJoin: vi.fn(),
        leftJoinAndSelect: vi.fn(),
        where: vi.fn(),
        andWhere: vi.fn(),
        distinct: vi.fn(),
        addSelect: vi.fn(),
        orderBy: vi.fn(),
        addOrderBy: vi.fn(),
        take: vi.fn(),
        getMany: vi.fn(() => Promise.resolve(activeAnnouncements)),
        getOne: vi.fn((): Promise<any> => Promise.resolve(null)),
    };
    for (const method of [
        'leftJoin',
        'innerJoin',
        'leftJoinAndSelect',
        'where',
        'andWhere',
        'distinct',
        'addSelect',
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
        save: vi.fn(value => Promise.resolve(value)),
        find: vi.fn(() => Promise.resolve(activeAnnouncements)),
        findOne: vi.fn((): Promise<any> => Promise.resolve(null)),
        remove: vi.fn(),
    };
}

function publicAnnouncement(id: string) {
    return {
        id,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        titleZh: '公告标题',
        contentZh: '公告正文',
        titleEn: 'Announcement',
        contentEn: 'Published notice',
        linkUrl: null,
        startsAt: null,
        endsAt: null,
    };
}

const contentPermissions = [
    storefrontContentPermission.Read,
    storefrontContentPermission.Create,
    storefrontContentPermission.Update,
    storefrontContentPermission.Delete,
];
function adminContext(channelId: string, permissions = contentPermissions): RequestContext {
    return {
        apiType: 'admin',
        activeUserId: 'admin-1',
        channelId,
        channel: { id: channelId, code: channelId },
        languageCode: 'zh_Hans',
        userHasPermissions: (required: Permission[]) =>
            required.some(permission => permissions.includes(permission)),
    } as any;
}
const platformContext = adminContext('__default_channel__', [Permission.SuperAdmin]);
const storeContext = adminContext('store-a');
const announcementInput = { titleZh: '店铺通知', contentZh: '本店配送安排已更新' };
function storedAnnouncement(
    targetMode: 'ALL' | 'SINGLE' | 'MULTIPLE',
    channelIds: string[],
    ownerChannelId: string | null = targetMode === 'SINGLE' && channelIds.length === 1 ? channelIds[0] : null,
) {
    return {
        id: 'announcement-1',
        ...announcementInput,
        titleEn: 'Store notice',
        contentEn: 'Store delivery arrangements have changed',
        targetMode,
        ownerChannelId,
        channels: channelIds.map(id => ({ id, code: id })),
        enabled: true,
        priority: 0,
        linkUrl: null,
        startsAt: null,
        endsAt: null,
    };
}

describe('SystemAnnouncementService store scope', () => {
    it('creates a store notice in its own single-store scope when scope is omitted', async () => {
        const repository = repositoryHarness();
        await serviceWith(repository).create(storeContext, announcementInput);
        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                targetMode: 'SINGLE',
                ownerChannelId: 'store-a',
                channels: [storeContext.channel],
            }),
        );
    });

    it.each([
        { targetMode: 'ALL', channelIds: [] },
        { targetMode: 'MULTIPLE', channelIds: ['store-a', 'store-b'] },
        { targetMode: 'SINGLE', channelIds: ['store-b'] },
        { targetMode: 'SINGLE', channelIds: [] },
        { targetMode: 'SINGLE', channelIds: ['store-a', 'store-b'] },
    ] as const)('rejects a forged publication scope $targetMode $channelIds', async scope => {
        const repository = repositoryHarness();
        await expect(
            serviceWith(repository).create(storeContext, {
                ...announcementInput,
                ...scope,
                channelIds: [...scope.channelIds],
            }),
        ).rejects.toThrow('只能发布到当前经营店铺');
        expect(repository.create).not.toHaveBeenCalled();
        expect(repository.save).not.toHaveBeenCalled();
    });

    it('updates and deletes its own single-store notice and preserves omitted scope', async () => {
        const repository = repositoryHarness();
        repository.findOne.mockResolvedValue(storedAnnouncement('SINGLE', ['store-a']));
        const service = serviceWith(repository);
        await service.update(storeContext, { id: 'announcement-1', ...announcementInput });
        expect(repository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                targetMode: 'SINGLE',
                channels: [storeContext.channel],
            }),
        );
        await expect(service.delete(storeContext, 'announcement-1')).resolves.toEqual({ result: 'DELETED' });
        expect(repository.remove).toHaveBeenCalledOnce();
    });

    it('rejects an attempt to widen the scope of an owned notice', async () => {
        const repository = repositoryHarness();
        repository.findOne.mockResolvedValue(storedAnnouncement('SINGLE', ['store-a']));
        await expect(
            serviceWith(repository).update(storeContext, {
                id: 'announcement-1',
                ...announcementInput,
                targetMode: 'ALL',
            }),
        ).rejects.toThrow('只能发布到当前经营店铺');
        expect(repository.save).not.toHaveBeenCalled();
    });

    it.each([
        ['ALL', []],
        ['MULTIPLE', ['store-a', 'store-b']],
        ['SINGLE', ['store-b']],
        ['SINGLE', ['store-a', 'store-b']],
    ] as const)(
        'blocks editing and deleting %s notices outside the exclusive store scope',
        async (mode, ids) => {
            const repository = repositoryHarness();
            repository.findOne.mockResolvedValue(storedAnnouncement(mode, [...ids]));
            const service = serviceWith(repository);
            // SuperAdmin must obey store scope after switching into a store.
            const superAdminInStore = adminContext('store-a', [Permission.SuperAdmin]);
            await expect(
                service.update(superAdminInStore, {
                    id: 'announcement-1',
                    ...announcementInput,
                }),
            ).rejects.toThrow('只能管理当前经营店铺自行发布的单店公告');
            await expect(service.delete(superAdminInStore, 'announcement-1')).rejects.toThrow(
                '只能管理当前经营店铺自行发布的单店公告',
            );
            expect(repository.save).not.toHaveBeenCalled();
            expect(repository.remove).not.toHaveBeenCalled();
        },
    );

    it('lists its own and applicable platform notices, retaining the targets needed for ownership checks', async () => {
        const own = storedAnnouncement('SINGLE', ['store-a']);
        const all = storedAnnouncement('ALL', []);
        const multiple = storedAnnouncement('MULTIPLE', ['store-a', 'store-b']);
        const platformSingle = storedAnnouncement('SINGLE', ['store-a'], null);
        const repository = repositoryHarness([
            own,
            storedAnnouncement('SINGLE', ['store-b']),
            all,
            multiple,
            platformSingle,
            storedAnnouncement('SINGLE', ['store-a', 'store-b']),
        ]);
        await expect(serviceWith(repository).findAll(storeContext)).resolves.toEqual([
            own,
            all,
            multiple,
            platformSingle,
        ]);
        expect(repository.queryBuilder.leftJoin).toHaveBeenCalledWith(
            'announcement.channels',
            'scopeChannel',
            'scopeChannel.id = :channelId',
            { channelId: 'store-a' },
        );
        expect(repository.queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
            'announcement.channels',
            'targetChannel',
        );
        expect(repository.queryBuilder.where).toHaveBeenCalledWith(
            '(announcement.ownerChannelId IS NULL OR announcement.ownerChannelId = :channelId)',
            { channelId: 'store-a' },
        );
    });

    it('prevents reading another store notice translation locks by ID', async () => {
        const repository = repositoryHarness();
        repository.findOne.mockResolvedValue(storedAnnouncement('SINGLE', ['store-b']));
        await expect(
            serviceWith(repository).translationLocks(storeContext, 'announcement-1'),
        ).rejects.toThrow();
    });

    it.each([null, undefined])(
        'treats platform and legacy targeted notices as read-only in the target store (%s)',
        async owner => {
            const repository = repositoryHarness();
            const record = { ...storedAnnouncement('SINGLE', ['store-a']), ownerChannelId: owner };
            repository.findOne.mockResolvedValue(record);
            const service = serviceWith(repository);
            await expect(service.translationLocks(storeContext, record.id)).resolves.toEqual({
                titleEnLocked: false,
                contentEnLocked: false,
            });
            await expect(
                service.update(storeContext, { id: record.id, ...announcementInput }),
            ).rejects.toThrow('平台公告只读');
            await expect(service.delete(storeContext, record.id)).rejects.toThrow('平台公告只读');
            expect(repository.save).not.toHaveBeenCalled();
            expect(repository.remove).not.toHaveBeenCalled();
        },
    );

    it('does not accept caller-supplied publication ownership', async () => {
        const repository = repositoryHarness();
        await serviceWith(repository).create(storeContext, {
            ...announcementInput,
            ownerChannelId: 'store-b',
        } as any);
        expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ ownerChannelId: 'store-a' }));
    });

    it('does not allow the platform to retarget a store-owned notice', async () => {
        const repository = repositoryHarness();
        repository.findOne.mockResolvedValue(storedAnnouncement('SINGLE', ['store-a']));
        await expect(
            serviceWith(repository).update(platformContext, {
                id: 'announcement-1',
                ...announcementInput,
                targetMode: 'ALL',
            }),
        ).rejects.toThrow('原发布店铺');
    });

    it('preserves platform access to the complete admin list', async () => {
        const announcements = [storedAnnouncement('ALL', []), storedAnnouncement('SINGLE', ['store-a'])];
        const repository = repositoryHarness(announcements);
        await expect(serviceWith(repository).findAll(platformContext)).resolves.toEqual(announcements);
        expect(repository.find).toHaveBeenCalledWith(
            expect.objectContaining({ relations: { channels: true } }),
        );
    });

    it.each([
        ['ALL', []],
        ['SINGLE', ['store-a']],
        ['MULTIPLE', ['store-a', 'store-b']],
    ] as const)('preserves platform CRUD for %s publication scope', async (mode, ids) => {
        const repository = repositoryHarness();
        const channels = [...ids].map(id => ({ id, code: id }));
        const service = serviceWith(repository, { find: vi.fn().mockResolvedValue(channels) });
        await service.create(platformContext, {
            ...announcementInput,
            targetMode: mode,
            channelIds: [...ids],
        });
        expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ targetMode: mode, channels }));
        repository.findOne.mockResolvedValue(storedAnnouncement(mode, [...ids]));
        await service.update(platformContext, { id: 'announcement-1', ...announcementInput });
        await expect(service.delete(platformContext, 'announcement-1')).resolves.toEqual({
            result: 'DELETED',
        });
    });

    it('rejects using the platform management channel as an operating target', async () => {
        const repository = repositoryHarness();
        const service = serviceWith(repository, {
            find: vi.fn().mockResolvedValue([platformContext.channel]),
        });
        await expect(
            service.create(platformContext, {
                ...announcementInput,
                targetMode: 'SINGLE',
                channelIds: [platformContext.channelId],
            }),
        ).rejects.toThrow('所选经营店铺不存在');
        expect(repository.save).not.toHaveBeenCalled();
    });

    it.each([
        ['read', storefrontContentPermission.Read],
        ['create', storefrontContentPermission.Create],
        ['update', storefrontContentPermission.Update],
        ['delete', storefrontContentPermission.Delete],
    ] as const)(
        'requires the corresponding %s permission before touching records',
        async (action, permission) => {
            const repository = repositoryHarness();
            const service = serviceWith(repository);
            const ctx = adminContext(
                'store-a',
                contentPermissions.filter(p => p !== permission),
            );
            const operation =
                action === 'read'
                    ? service.findAll(ctx)
                    : action === 'create'
                      ? service.create(ctx, announcementInput)
                      : action === 'update'
                        ? service.update(ctx, { id: 'announcement-1', ...announcementInput })
                        : service.delete(ctx, 'announcement-1');
            await expect(operation).rejects.toThrow();
            expect(repository.findOne).not.toHaveBeenCalled();
            expect(repository.createQueryBuilder).not.toHaveBeenCalled();
            expect(repository.save).not.toHaveBeenCalled();
            expect(repository.remove).not.toHaveBeenCalled();
        },
    );

    it('requires SuperAdmin in the platform context despite delegated content permissions', async () => {
        const service = serviceWith(repositoryHarness());
        const delegatedPlatform = adminContext('__default_channel__');
        await expect(service.findAll(delegatedPlatform)).rejects.toThrow();
        await expect(service.create(delegatedPlatform, announcementInput)).rejects.toThrow();
        await expect(
            service.update(delegatedPlatform, { id: 'announcement-1', ...announcementInput }),
        ).rejects.toThrow();
        await expect(service.delete(delegatedPlatform, 'announcement-1')).rejects.toThrow();
    });

    it('rejects unauthenticated or Shop-context admin operations', async () => {
        const service = serviceWith(repositoryHarness());
        await expect(
            service.create({ ...storeContext, activeUserId: undefined } as any, announcementInput),
        ).rejects.toThrow();
        await expect(service.findAll({ ...storeContext, apiType: 'shop' } as any)).rejects.toThrow();
    });
});
