import 'reflect-metadata';

import { ContentTranslationService } from '@vendure/content-translation-plugin';
import { Channel, EntityNotFoundError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { StoreProfile } from './entities/store-profile.entity';
import { StoreProfileService } from './store-profile.service';
import { StoreActivationReadiness } from './types';

function channel(id = 'channel-1') {
    return {
        id,
        code: `store-${id}`,
        sellerId: 'platform-seller',
        seller: { id: 'platform-seller', name: `Merchant ${id}` },
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
            updatedAt: new Date('2026-08-27T10:00:00.000Z'),
            channel: channel(),
            channelId: 'channel-1',
            status: 'DRAFT',
            isPublished: false,
            sortOrder: 0,
            descriptionZh: '',
            descriptionEn: '',
            internalNote: '',
            logoAsset: null,
            logoAssetId: null,
            logoOnLightAsset: null,
            logoOnLightAssetId: null,
            logoOnDarkAsset: null,
            logoOnDarkAssetId: null,
            taglineZh: null,
            taglineEn: null,
            brandBackgroundColor: null,
            brandPrimaryColor: null,
            brandAccentColor: null,
            brandHighlightColor: null,
            legalEntityName: null,
            legalRegistrationCountry: null,
            supportEmail: null,
            privacyEmail: null,
        }),
        overrides,
    );
}

function createService(
    profileRepository: Record<string, unknown>,
    domainRepository: Record<string, unknown>,
    readiness: StoreActivationReadiness = {
        ready: true,
        checks: [],
    },
) {
    const profileLockBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn(() => (profileRepository.findOne as () => Promise<unknown>)()),
    };
    Object.assign(profileRepository, {
        createQueryBuilder: vi.fn().mockReturnValue(profileLockBuilder),
    });
    const channelLockBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(channel()),
    };
    const assets = domainRepository.assets as Array<{ id: string; channelId: string }> | undefined;
    const findOneInChannel = vi.fn((_ctx, _entity, id, channelId) =>
        Promise.resolve(assets?.find(asset => asset.id === id && asset.channelId === channelId)),
    );
    const connection = {
        getRepository: vi.fn((_ctx, entity) => {
            if (entity === StoreProfile) return profileRepository;
            if (entity === Channel) {
                return { createQueryBuilder: vi.fn().mockReturnValue(channelLockBuilder) };
            }
            return domainRepository;
        }),
        findOneInChannel,
    };
    const channelService = {
        getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default', sellerId: 'platform-seller' }),
        findOne: vi.fn((_ctx, id) => Promise.resolve(channel(String(id)))),
        update: vi.fn((_ctx, input) => Promise.resolve({ ...channel(), ...input })),
    };
    const activationReadinessService = { get: vi.fn().mockResolvedValue(readiness) };
    const translations = {
        prepareLocalizedFields: vi.fn(fields =>
            Promise.resolve(
                fields.map((field: any) => ({
                    path: field.path,
                    sourceText: field.sourceText,
                    translatedText:
                        field.targetText?.trim() || field.existingTargetText || `translated-${field.path}`,
                    status: 'AUTO_TRANSLATED',
                    origin: 'AUTO',
                    locked: false,
                })),
            ),
        ),
        recordPreparedFields: vi.fn(() => Promise.resolve()),
    };
    return {
        translations,
        activationReadinessService,
        channelService,
        findOneInChannel,
        service: new StoreProfileService(
            connection as any,
            channelService as any,
            activationReadinessService as any,
            translations as any,
        ),
    };
}

describe('StoreProfileService', () => {
    it.each(['admin', 'merchant'] as const)(
        'preserves reviewed English through %s publish, repeat and rollback without a provider',
        async mode => {
            const current = profile({
                channel: {
                    ...channel(),
                    customFields: { storefrontNameZh: '大马通', storefrontNameEn: 'DAMATONG' },
                },
                descriptionZh: '原简介',
                descriptionEn: 'Reviewed description',
                taglineZh: '原口号',
                taglineEn: 'Reviewed tagline',
            });
            const repository = {
                findOne: vi.fn().mockResolvedValue(current),
                save: vi.fn(value => Promise.resolve(value)),
            };
            const { service, translations } = createService(repository, {
                find: vi.fn().mockResolvedValue([]),
            });
            const translate = vi.fn().mockRejectedValue(new Error('User Rate Limit Exceeded'));
            const realTranslations = new ContentTranslationService({} as any, {
                provider: { name: 'unavailable-test-provider', isConfigured: () => false, translate },
                glossary: {},
                sourceLanguageCode: 'zh_Hans',
                targetLanguageCode: 'en',
            });
            translations.prepareLocalizedFields.mockImplementation(fields =>
                realTranslations.prepareLocalizedFields(fields),
            );
            const update = (nameZh: string, descriptionZh: string, taglineZh: string) => {
                const input = {
                    id: current.id,
                    expectedUpdatedAt: current.updatedAt,
                    storefrontNameZh: nameZh,
                    storefrontNameEn: 'DAMATONG',
                    storefrontNameEnLocked: true,
                    descriptionZh,
                    descriptionEn: 'Reviewed description',
                    descriptionEnLocked: true,
                    taglineZh,
                    taglineEn: 'Reviewed tagline',
                    taglineEnLocked: true,
                };
                return mode === 'admin'
                    ? service.update({ channelId: current.channelId } as any, input)
                    : service.updateForMerchant({ channelId: current.channelId } as any, input);
            };
            for (const name of ['大马通 DAMATONG', '大马通 DAMATONG', '大马通']) {
                const restored = name === '大马通';
                const result = await update(
                    name,
                    restored ? '原简介' : '新简介',
                    restored ? '原口号' : '新口号',
                );
                expect(result.channel.customFields).toMatchObject({
                    storefrontNameZh: name,
                    storefrontNameEn: 'DAMATONG',
                });
                expect(result).toMatchObject({
                    descriptionEn: 'Reviewed description',
                    taglineEn: 'Reviewed tagline',
                });
                expect(translations.recordPreparedFields).toHaveBeenLastCalledWith(
                    expect.anything(),
                    expect.objectContaining({ entityType: 'StoreProfile', entityId: current.id }),
                    expect.arrayContaining([
                        expect.objectContaining({
                            path: 'storefrontName',
                            translatedText: 'DAMATONG',
                            locked: true,
                        }),
                        expect.objectContaining({
                            path: 'description',
                            translatedText: 'Reviewed description',
                            locked: true,
                        }),
                        expect.objectContaining({
                            path: 'tagline',
                            translatedText: 'Reviewed tagline',
                            locked: true,
                        }),
                    ]),
                );
            }
            expect(translate).not.toHaveBeenCalled();
            expect(repository.save).toHaveBeenCalledTimes(3);
        },
    );

    it.each(['', '中文英文'])('rejects an invalid manually locked name %j before saving', async nameEn => {
        const current = profile();
        const repository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(),
        };
        const { service, translations } = createService(repository, {});
        const translate = vi.fn();
        const realTranslations = new ContentTranslationService({} as any, {
            provider: { name: 'test', isConfigured: () => false, translate },
            glossary: {},
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
        });
        translations.prepareLocalizedFields.mockImplementation(fields =>
            realTranslations.prepareLocalizedFields(fields),
        );
        await expect(
            service.update({} as any, {
                id: current.id,
                expectedUpdatedAt: current.updatedAt,
                storefrontNameZh: '大马通 DAMATONG',
                storefrontNameEn: nameEn,
                storefrontNameEnLocked: true,
            }),
        ).rejects.toThrow(/人工锁定/);
        expect(repository.save).not.toHaveBeenCalled();
        expect(translate).not.toHaveBeenCalled();
    });

    it('creates an unpublished draft after the current last position', async () => {
        const save = vi.fn(value => Promise.resolve(value));
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

    it('self-heals a missing profile for a legacy merchant Channel', async () => {
        const created = profile({ channelId: 'legacy-store', channel: channel('legacy-store') });
        const profileRepository = {
            findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
            find: vi.fn().mockResolvedValue([]),
            save: vi.fn().mockResolvedValue(created),
        };
        const domainRepository = { find: vi.fn().mockResolvedValue([]) };
        const { channelService, service } = createService(profileRepository, domainRepository);

        const result = await service.findForMerchant({ channelId: 'legacy-store' } as any);

        expect(channelService.findOne).toHaveBeenCalledWith(expect.anything(), 'legacy-store');
        expect(profileRepository.save).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ channelId: 'legacy-store', status: 'DRAFT', isPublished: false });
    });

    it('reuses a concurrently-created profile when legacy repair races', async () => {
        const winner = profile({ channelId: 'legacy-store', channel: channel('legacy-store') });
        const profileRepository = {
            findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner),
            find: vi.fn().mockResolvedValue([]),
            save: vi.fn().mockRejectedValue(new Error('duplicate Channel profile')),
        };
        const domainRepository = { find: vi.fn().mockResolvedValue([]) };
        const { service } = createService(profileRepository, domainRepository);

        await expect(service.createDraft({} as any, channel('legacy-store') as any)).resolves.toBe(winner);
    });

    it('does not create merchant profiles for provisioning template Channels', async () => {
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn().mockResolvedValue([]),
            save: vi.fn(),
        };
        const { channelService, service } = createService(profileRepository, {});
        channelService.findOne.mockResolvedValue({
            ...channel('template'),
            customFields: { isStoreProvisioningTemplate: true },
        } as any);

        await expect(service.findForMerchant({ channelId: 'template' } as any)).rejects.toBeInstanceOf(
            EntityNotFoundError,
        );
        expect(profileRepository.save).not.toHaveBeenCalled();
    });

    it('keeps legacy directory publication disabled when a store is updated', async () => {
        const current = profile({ status: 'ACTIVE', isPublished: true });
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const domainRepository = { find: vi.fn().mockResolvedValue([]) };
        const { service } = createService(profileRepository, domainRepository);

        const updated = await service.update({} as any, {
            id: current.id,
            expectedUpdatedAt: current.updatedAt,
            status: 'ACTIVE',
        });

        expect(updated).toMatchObject({ status: 'ACTIVE', isPublished: false, isOperational: true });
    });

    it('rejects activation until every launch check passes', async () => {
        const current = profile({ status: 'DRAFT' });
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const readiness: StoreActivationReadiness = {
            ready: false,
            checks: [
                { code: 'DOMAIN', ready: false, message: '验证并设置主域名', messageEn: '' },
                {
                    code: 'PAYMENT',
                    ready: false,
                    message: '启用至少一种非测试支付方式',
                    messageEn: '',
                },
            ],
        };
        const { service } = createService(profileRepository, {}, readiness);

        await expect(
            service.update({} as any, {
                id: current.id,
                expectedUpdatedAt: current.updatedAt,
                status: 'ACTIVE',
            }),
        ).rejects.toThrow('验证并设置主域名；启用至少一种非测试支付方式');
        expect(profileRepository.save).not.toHaveBeenCalled();
    });

    it('allows a SuperAdmin to update both storefront names', async () => {
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const domainRepository = { find: vi.fn().mockResolvedValue([]) };
        const { channelService, service } = createService(profileRepository, domainRepository);
        const ctx = {} as any;

        await service.update(ctx, {
            id: current.id,
            expectedUpdatedAt: current.updatedAt,
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

    it('updates descriptions and an internal note without revalidating unchanged storefront names', async () => {
        const current = profile({
            channel: {
                ...channel(),
                customFields: {
                    storefrontNameZh: '历史超长店铺名称需要单独修复',
                    storefrontNameEn: 'Legacy',
                },
            },
        });
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const domainRepository = { find: vi.fn().mockResolvedValue([]) };
        const { channelService, service } = createService(profileRepository, domainRepository);

        const updated = await service.update({} as any, {
            id: current.id,
            expectedUpdatedAt: current.updatedAt,
            descriptionZh: ' AI 软件商城 ',
            internalNote: ' 马来西亚团队跟进 ',
        });

        expect(channelService.update).not.toHaveBeenCalled();
        expect(updated.descriptionZh).toBe('AI 软件商城');
        expect(updated.internalNote).toBe('马来西亚团队跟进');
    });

    it('normalizes channel branding and rejects invalid colors', async () => {
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const domainRepository = { find: vi.fn().mockResolvedValue([]) };
        const { service } = createService(profileRepository, domainRepository);

        const updated = await service.updateForMerchant({ channelId: 'channel-1' } as any, {
            expectedUpdatedAt: current.updatedAt,
            taglineZh: ' 全球模型，一钥直达 ',
            taglineEn: ' One Key to Every Model. ',
            brandBackgroundColor: '#070b14',
            brandPrimaryColor: '#635bff',
            brandAccentColor: '#22d3ee',
            brandHighlightColor: '#8b5cf6',
        });

        expect(updated).toMatchObject({
            taglineZh: '全球模型，一钥直达',
            taglineEn: 'One Key to Every Model.',
            brandBackgroundColor: '#070B14',
            brandPrimaryColor: '#635BFF',
            brandAccentColor: '#22D3EE',
            brandHighlightColor: '#8B5CF6',
        });

        await expect(
            service.updateForMerchant({ channelId: 'channel-1' } as any, {
                expectedUpdatedAt: current.updatedAt,
                brandPrimaryColor: 'blue',
            }),
        ).rejects.toThrow('#RRGGBB');
    });

    it('normalizes legal identity fields and rejects invalid contact emails', async () => {
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const { service } = createService(profileRepository, { find: vi.fn().mockResolvedValue([]) });

        const updated = await service.updateForMerchant({ channelId: 'channel-1' } as any, {
            expectedUpdatedAt: current.updatedAt,
            legalEntityName: ' MOYAO AI Example Limited ',
            legalRegistrationCountry: ' Malaysia ',
            supportEmail: ' Support@MOYAOAI.com ',
            privacyEmail: ' Privacy@MOYAOAI.com ',
        });

        expect(updated).toMatchObject({
            legalEntityName: 'MOYAO AI Example Limited',
            legalRegistrationCountry: 'Malaysia',
            supportEmail: 'support@moyaoai.com',
            privacyEmail: 'privacy@moyaoai.com',
        });
        await expect(
            service.updateForMerchant({ channelId: 'channel-1' } as any, {
                expectedUpdatedAt: current.updatedAt,
                privacyEmail: 'not-an-email',
            }),
        ).rejects.toThrow('隐私邮箱格式无效');
    });

    it('updates only the active Channel profile for a merchant', async () => {
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const domainRepository = { find: vi.fn().mockResolvedValue([]) };
        const { channelService, service } = createService(profileRepository, domainRepository);
        const ctx = { channelId: 'channel-1' } as any;

        const updated = await service.updateForMerchant(ctx, {
            expectedUpdatedAt: current.updatedAt,
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

    it('only accepts branding assets assigned to the active Channel', async () => {
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const asset = { id: 'asset-channel-1', channelId: 'channel-1' };
        const { findOneInChannel, service } = createService(profileRepository, {
            assets: [asset],
            find: vi.fn().mockResolvedValue([]),
        });
        const ctx = { channelId: 'channel-1' } as any;

        const updated = await service.updateForMerchant(ctx, {
            expectedUpdatedAt: current.updatedAt,
            logoOnLightAssetId: asset.id,
        });

        expect(findOneInChannel).toHaveBeenCalledWith(ctx, expect.any(Function), asset.id, 'channel-1');
        expect(updated.logoOnLightAssetId).toBe(asset.id);

        await expect(
            service.updateForMerchant(ctx, {
                expectedUpdatedAt: current.updatedAt,
                logoOnDarkAssetId: 'asset-channel-2',
            }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('accepts the actual Damatong publisher names through the API service', async () => {
        const configPath = '../../dev-server/scripts/damatong-storefront-config.mjs';
        const { damatongStorefront } = await import(configPath);
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const { channelService, service } = createService(profileRepository, {
            find: vi.fn().mockResolvedValue([]),
        });

        await service.update({} as any, {
            id: current.id,
            expectedUpdatedAt: current.updatedAt,
            storefrontNameZh: damatongStorefront.storefrontNameZh,
            storefrontNameEn: damatongStorefront.storefrontNameEn,
            storefrontNameEnLocked: true,
        });

        expect(channelService.update).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                customFields: expect.objectContaining({
                    storefrontNameZh: damatongStorefront.storefrontNameZh,
                    storefrontNameEn: damatongStorefront.storefrontNameEn,
                }),
            }),
        );
    });

    it.each(['admin', 'merchant'] as const)(
        'rejects the production overlong English name before %s writes',
        async mode => {
            const current = profile();
            const profileRepository = {
                findOne: vi.fn().mockResolvedValue(current),
                save: vi.fn(value => Promise.resolve(value)),
            };
            const { channelService, service } = createService(profileRepository, {});
            const input = {
                id: current.id,
                expectedUpdatedAt: current.updatedAt,
                storefrontNameEn: 'DAMATONG Marketplace',
                storefrontNameEnLocked: true,
            };
            const ctx = { channelId: 'channel-1' } as any;

            await expect(
                mode === 'admin' ? service.update(ctx, input) : service.updateForMerchant(ctx, input),
            ).rejects.toThrow('1 至 16 个显示单位');
            expect(channelService.update).not.toHaveBeenCalled();
            expect(profileRepository.save).not.toHaveBeenCalled();
        },
    );

    it('rejects an overlong storefront name before saving', async () => {
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const { channelService, service } = createService(profileRepository, {});

        await expect(
            service.updateForMerchant({ channelId: 'channel-1' } as any, {
                expectedUpdatedAt: current.updatedAt,
                storefrontNameZh: '这是一个明显超过限制长度的店铺显示名称',
            }),
        ).rejects.toThrow('1 至 16 个显示单位');
        expect(channelService.update).not.toHaveBeenCalled();
        expect(profileRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a stale profile version before applying changes', async () => {
        const current = profile();
        const profileRepository = {
            findOne: vi.fn().mockResolvedValue(current),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const { service } = createService(profileRepository, { find: vi.fn().mockResolvedValue([]) });

        await expect(
            service.update({} as any, {
                id: current.id,
                expectedUpdatedAt: new Date('2026-08-27T09:59:59.000Z'),
                descriptionZh: '旧页面修改',
            }),
        ).rejects.toThrow(/CONCURRENT_MODIFICATION/);
        expect(profileRepository.save).not.toHaveBeenCalled();
    });
});
