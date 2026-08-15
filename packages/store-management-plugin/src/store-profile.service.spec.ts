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

    it('keeps legacy directory publication disabled when a store is updated', async () => {
        const current = profile({ status: 'ACTIVE', isPublished: true });
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(async value => value),
        };
        const domainRepository = { find: vi.fn().mockResolvedValue([]) };
        const { service } = createService(profileRepository, domainRepository);

        const updated = await service.update({} as any, { id: current.id, status: 'ACTIVE' });

        expect(updated).toMatchObject({ status: 'ACTIVE', isPublished: false });
    });

    it('allows a SuperAdmin to update both storefront names', async () => {
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(async value => value),
        };
        const domainRepository = { find: vi.fn().mockResolvedValue([]) };
        const { channelService, service } = createService(profileRepository, domainRepository);
        const ctx = {} as any;

        await service.update(ctx, {
            id: current.id,
            storefrontNameZh: '软件商城',
            storefrontNameEn: 'Software Shop',
        });

        expect(channelService.update).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                id: 'channel-1',
                customFields: expect.objectContaining({
                    storefrontNameZh: '软件商城',
                    storefrontNameEn: 'Software Shop',
                }),
            }),
        );
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
