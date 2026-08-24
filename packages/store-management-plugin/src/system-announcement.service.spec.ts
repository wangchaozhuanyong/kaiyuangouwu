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
                titleEn: '',
                contentEn: '',
                priority: 10,
                linkUrl: '/maintenance',
            }),
        );
        expect(repository.save).toHaveBeenCalled();
    });

    it('returns only repository-selected active announcements with language fallback', async () => {
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

        await expect(service.findActive({ languageCode: 'en' } as any)).resolves.toEqual([
            expect.objectContaining({ title: '中文标题', content: '中文内容' }),
        ]);
        expect(repository.queryBuilder.where).toHaveBeenCalledWith('announcement.enabled = :enabled', {
            enabled: true,
        });
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
});

function serviceWith(repository: ReturnType<typeof repositoryHarness>) {
    return new SystemAnnouncementService({ getRepository: () => repository } as any);
}

function repositoryHarness(activeAnnouncements: any[] = []) {
    const queryBuilder = {
        where: vi.fn(),
        andWhere: vi.fn(),
        orderBy: vi.fn(),
        addOrderBy: vi.fn(),
        take: vi.fn(),
        getMany: vi.fn(async () => activeAnnouncements),
    };
    for (const method of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'take'] as const) {
        queryBuilder[method].mockReturnValue(queryBuilder);
    }
    return {
        queryBuilder,
        createQueryBuilder: vi.fn(() => queryBuilder),
        create: vi.fn(value => value),
        save: vi.fn(async value => value),
        find: vi.fn(async () => activeAnnouncements),
        findOne: vi.fn(async () => null),
        remove: vi.fn(),
    };
}
