import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { StoreProfile } from './entities/store-profile.entity';
import { StoreProfileService } from './store-profile.service';

function channel(id = 'channel-1') {
    return {
        id,
        code: `store-${id}`,
        seller: { name: `Merchant ${id}` },
        customFields: {
            storefrontNameZh: `中文店铺 ${id}`,
            storefrontNameEn: `English store ${id}`,
        },
    };
}

function profile(overrides: Record<string, unknown> = {}) {
    return Object.assign(
        new StoreProfile({
            id: 'profile-1',
            channel: channel(),
            channelId: 'channel-1',
            status: 'DRAFT',
            isPublished: false,
            sortOrder: 0,
            descriptionZh: '',
            descriptionEn: '',
            logoAsset: null,
            logoAssetId: null,
        }),
        overrides,
    );
}

function createService(
    profileRepository: Record<string, unknown>,
    domainRepository: Record<string, unknown>,
) {
    const connection = {
        getRepository: vi.fn((_ctx, entity) => {
            if (entity === StoreProfile) return profileRepository;
            return domainRepository;
        }),
    };
    const channelService = { update: vi.fn(async (_ctx, input) => ({ ...channel(), ...input })) };
    return {
        channelService,
        service: new StoreProfileService(connection as any, channelService as any),
    };
}

describe('StoreProfileService', () => {
    it('creates an unpublished draft after the current last position', async () => {
        const save = vi.fn(async value => value);
        const repository = {
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn().mockResolvedValue([profile({ sortOrder: 4 })]),
            save,
        };
        const { service } = createService(repository, {});

        const created = await service.createDraft({} as any, channel('new') as any);

        expect(created).toMatchObject({
            channelId: 'new',
            status: 'DRAFT',
            isPublished: false,
            sortOrder: 5,
        });
        expect(save).toHaveBeenCalledOnce();
        expect(repository.find).toHaveBeenCalledWith({ order: { sortOrder: 'DESC' }, take: 1 });
    });

    it('requires an active primary domain before publishing', async () => {
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(async value => value),
        };
        const domainRepository = { findOne: vi.fn().mockResolvedValue(null) };
        const { service } = createService(profileRepository, domainRepository);

        await expect(
            service.update({} as any, { id: current.id, status: 'ACTIVE', isPublished: true }),
        ).rejects.toThrow('绑定并验证主域名');
        expect(profileRepository.save).not.toHaveBeenCalled();
    });

    it('automatically removes a suspended store from the App directory', async () => {
        const current = profile({ status: 'ACTIVE', isPublished: true });
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(async value => value),
        };
        const domainRepository = { find: vi.fn().mockResolvedValue([]) };
        const { service } = createService(profileRepository, domainRepository);

        const updated = await service.update({} as any, { id: current.id, status: 'SUSPENDED' });

        expect(updated).toMatchObject({ status: 'SUSPENDED', isPublished: false });
    });

    it('returns only published active stores that still have a verified primary domain', async () => {
        const first = profile({ status: 'ACTIVE', isPublished: true, sortOrder: 0 });
        const second = profile({
            id: 'profile-2',
            channel: channel('channel-2'),
            channelId: 'channel-2',
            status: 'ACTIVE',
            isPublished: true,
            sortOrder: 1,
        });
        const profileRepository = { find: vi.fn().mockResolvedValue([first, second]) };
        const domainRepository = {
            find: vi.fn().mockResolvedValue([{ channelId: 'channel-1', domain: 'store-one.example.com' }]),
        };
        const { service } = createService(profileRepository, domainRepository);

        const stores = await service.findPublished({} as any);

        expect(stores).toHaveLength(1);
        expect(stores[0]).toMatchObject({
            channelId: 'channel-1',
            domain: 'store-one.example.com',
            storefrontUrl: 'https://store-one.example.com',
        });
    });

    it('updates only the active Channel profile for a merchant', async () => {
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(async value => value),
        };
        const domainRepository = { find: vi.fn().mockResolvedValue([]) };
        const { channelService, service } = createService(profileRepository, domainRepository);
        const ctx = { channelId: 'channel-1' } as any;

        const updated = await service.updateForMerchant(ctx, {
            storefrontNameZh: '新店铺',
            storefrontNameEn: 'New Store',
            descriptionZh: '新的中文简介',
        });

        expect(profileRepository.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: { channelId: 'channel-1' } }),
        );
        expect(channelService.update).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                id: 'channel-1',
                customFields: expect.objectContaining({
                    storefrontNameZh: '新店铺',
                    storefrontNameEn: 'New Store',
                }),
            }),
        );
        expect(updated.descriptionZh).toBe('新的中文简介');
    });

    it('rejects an overlong storefront name before saving', async () => {
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(async value => value),
        };
        const { channelService, service } = createService(profileRepository, {});

        await expect(
            service.updateForMerchant({ channelId: 'channel-1' } as any, {
                storefrontNameZh: '这是一个明显超过限制长度的店铺显示名称',
            }),
        ).rejects.toThrow('1 至 16 个显示单位');
        expect(channelService.update).not.toHaveBeenCalled();
        expect(profileRepository.save).not.toHaveBeenCalled();
    });
});
