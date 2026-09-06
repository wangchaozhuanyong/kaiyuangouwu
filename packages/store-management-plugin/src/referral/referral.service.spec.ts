import type { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { ReferralPosterTemplate } from '../entities/referral-poster-template.entity';
import { ReferralWallet } from '../entities/referral-wallet.entity';

import { referralPosterCopy } from './referral-poster-presets';
import { ReferralPosterView } from './referral-poster-view';
import { ReferralService, supportsReferralPessimisticLock } from './referral.service';

describe('referral database locking', () => {
    it.each(['postgres', 'mysql', 'mariadb', 'mssql'])('keeps row locking enabled for %s', driverType => {
        expect(supportsReferralPessimisticLock(driverType)).toBe(true);
    });

    it.each(['sqljs', 'sqlite', 'better-sqlite3', 'unknown'])(
        'skips unsupported row locking for %s',
        driverType => {
            expect(supportsReferralPessimisticLock(driverType)).toBe(false);
        },
    );
});

describe('referral program optimistic concurrency', () => {
    const service = Object.create(ReferralService.prototype) as ReferralService;

    it('accepts the current config version and rejects a stale version', () => {
        const current = new Date('2026-08-27T10:00:01.000Z');

        expect(() => (service as any).assertExpectedUpdatedAt(current, current.toISOString())).not.toThrow();
        expect(() => (service as any).assertExpectedUpdatedAt(current, '2026-08-27T10:00:00.000Z')).toThrow(
            /CONCURRENT_MODIFICATION/,
        );
    });
});

describe('referral poster stale editor regression', () => {
    function fixture() {
        const record = {
            ...referralPosterCopy,
            id: 'poster-1',
            channelId: 'channel-1',
            name: 'Poster',
            enabled: true,
            position: 0,
            layoutVariant: 'STANDARD_CENTER',
            posterBackgroundAssetId: null,
            shareBackgroundAssetId: null,
            foregroundColor: '#152c49',
            accentColor: '#2565ae',
            overlayOpacity: 0,
        };
        const config = {
            id: 'config-1',
            updatedAt: new Date('2026-09-06T10:00:01Z'),
            posterTemplates: ['BRAND_MINIMAL'],
            defaultPosterTemplate: 'BRAND_MINIMAL',
        };
        const repository = {
            findOne: vi.fn(() => Promise.resolve({ ...record })),
            find: vi.fn(() => Promise.resolve([{ ...record }])),
            save: vi.fn(value => {
                Object.assign(record, value);
                return Promise.resolve(value);
            }),
        };
        const service = Object.assign(Object.create(ReferralService.prototype), {
            connection: {
                getRepository: (_ctx: unknown, entity: { name: string }) =>
                    entity.name === 'ReferralPosterTemplate'
                        ? repository
                        : { save: (value: unknown) => Promise.resolve(value) },
            },
            getOrCreateConfig: () => Promise.resolve(config),
            lockConfigOrThrow: () => Promise.resolve(config),
            configView: () => Promise.resolve(config),
            posterTemplateById: () => Promise.resolve(record),
            eventBus: { publish: vi.fn() },
            posters: new ReferralPosterView({ getRepository: () => repository } as never, {} as never),
        }) as ReferralService;
        const { enabled: _enabled, ...content } = record;
        return { service, record, config, repository, content };
    }

    it('rejects an editor opened before another administrator disabled the template', async () => {
        const { service, config, record, content } = fixture();
        const snapshot = { ...content, expectedUpdatedAt: config.updatedAt, name: 'Old editor' };
        await service.setPosterTemplateEnabled(
            { channelId: 'channel-1' } as never,
            record.id,
            false,
            config.updatedAt,
        );
        await expect(
            service.updatePosterTemplate({ channelId: 'channel-1' } as never, snapshot),
        ).rejects.toThrow('CONCURRENT_MODIFICATION');
        expect(record).toMatchObject({ enabled: false, name: 'Poster' });
    });

    it('preserves disabled state during a current content edit and rejects an older content snapshot', async () => {
        const { service, config, record, content } = fixture();
        await service.setPosterTemplateEnabled(
            { channelId: 'channel-1' } as never,
            record.id,
            false,
            config.updatedAt,
        );
        const snapshot = { ...content, expectedUpdatedAt: config.updatedAt, name: 'New copy' };
        await service.updatePosterTemplate({ channelId: 'channel-1' } as never, snapshot);
        expect(record).toMatchObject({ enabled: false, name: 'New copy' });
        await expect(
            service.updatePosterTemplate({ channelId: 'channel-1' } as never, {
                ...snapshot,
                name: 'Old copy',
            }),
        ).rejects.toThrow('CONCURRENT_MODIFICATION');
        expect(record.name).toBe('New copy');
    });

    it('rejects missing versions and attempts to smuggle status through content editing', async () => {
        const { service, config, content } = fixture();
        await expect(
            service.updatePosterTemplate({ channelId: 'channel-1' } as never, content as never),
        ).rejects.toThrow('CONCURRENT_MODIFICATION');
        await expect(
            service.updatePosterTemplate(
                { channelId: 'channel-1' } as never,
                { ...content, expectedUpdatedAt: config.updatedAt, enabled: false } as never,
            ),
        ).rejects.toThrow('启停操作');
    });
});

describe('referral admin customer wallets', () => {
    it('returns only the selected customer wallets from the active channel', async () => {
        const find = vi.fn().mockResolvedValue([{ id: 'wallet-1', currencyCode: 'CNY' }]);
        const connection = {
            getRepository: vi.fn().mockReturnValue({ find }),
        };
        const service = new ReferralService(
            connection as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { signingSecret: 'test-storefront-visitor-hash-secret' } as any,
        );

        await expect(
            service.adminCustomerWallets({ channelId: 'channel-1' } as any, 'customer-1'),
        ).resolves.toEqual([{ id: 'wallet-1', currencyCode: 'CNY' }]);
        expect(connection.getRepository).toHaveBeenCalledWith(expect.anything(), ReferralWallet);
        expect(find).toHaveBeenCalledWith({
            where: { channelId: 'channel-1', customerId: 'customer-1' },
            order: { currencyCode: 'ASC' },
        });
    });
});

describe('referral program attribution window validation', () => {
    const service = new ReferralService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { signingSecret: 'test-storefront-visitor-hash-secret' } as any,
    );
    const programInput = (attributionWindowDays: number) => ({
        enabled: true,
        rewardRate: 5,
        releaseDelayDays: 7,
        minimumOrderAmount: 0,
        maxRewardPerOrder: null,
        allowBalanceSpend: true,
        attributionWindowDays,
        defaultPosterTemplate: 'BRAND_MINIMAL',
    });

    it.each([180, 365])('accepts an attribution window of %i days', attributionWindowDays => {
        expect(() =>
            (service as any).validateProgramInput(programInput(attributionWindowDays)),
        ).not.toThrow();
    });

    it('rejects an attribution window longer than 365 days', () => {
        expect(() => (service as any).validateProgramInput(programInput(366))).toThrow(
            '邀请来源有效期必须在1至365天之间',
        );
    });
});

describe('referral poster template channel isolation', () => {
    it('cannot update a template that does not belong to the active channel', async () => {
        const findOne = vi.fn().mockResolvedValue(null);
        const connection = {
            getRepository: vi.fn().mockReturnValue({ findOne }),
        };
        const service = new ReferralService(
            connection as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { signingSecret: 'test-storefront-visitor-hash-secret' } as any,
        );

        (service as any).getOrCreateConfig = vi.fn().mockResolvedValue({ id: 'config-1' });
        (service as any).lockConfigOrThrow = vi.fn().mockResolvedValue({ id: 'config-1' });

        await expect(
            service.updatePosterTemplate({ channelId: 'channel-1' } as any, {
                id: 'template-from-another-channel',
                expectedUpdatedAt: new Date(),
                name: '超市海报',
                position: 0,
                layoutVariant: 'STANDARD_CENTER',
                posterBackgroundAssetId: null,
                shareBackgroundAssetId: null,
                titleZh: '好友邀请函',
                titleEn: 'Invitation for friends',
                headlineZh: '分享好物',
                headlineEn: 'Share good things',
                rewardTextZh: '好友消费可获得 {rewardRate}% 奖励用于消费抵扣',
                rewardTextEn: 'Earn {rewardRate}% in spending rewards',
                siteIntroZh: '',
                siteIntroEn: '',
                serviceTextZh: '',
                serviceTextEn: '',
                foregroundColor: '#FFFFFF',
                accentColor: '#FF4D4F',
                overlayOpacity: 28,
            }),
        ).rejects.toThrow('找不到该邀请海报模板');
        expect(connection.getRepository).toHaveBeenCalledWith(expect.anything(), ReferralPosterTemplate);
        expect(findOne).toHaveBeenCalledWith({
            where: { id: 'template-from-another-channel', channelId: 'channel-1' },
        });
    });

    it('persists enabled default poster templates and rejects disabled template as default', async () => {
        const configRecord = {
            id: 'config-1',
            channelId: 'channel-1',
            enabled: true,
            rewardRateBps: 500,
            releaseDelayDays: 7,
            minimumOrderAmount: 0,
            maxRewardPerOrder: null,
            currencyCode: 'CNY',
            allowBalanceSpend: true,
            attributionWindowDays: 30,
            defaultPosterTemplate: 'BRAND_MINIMAL',
            posterTemplates: ['BRAND_MINIMAL', 'BENEFIT_RED_GOLD'],
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        const save = vi.fn().mockResolvedValue(configRecord);
        const find = vi.fn().mockResolvedValue([]);
        const findOne = vi.fn().mockResolvedValue(null);
        const connection = {
            rawConnection: { hasMetadata: () => false },
            getRepository: vi.fn().mockImplementation((_ctx: any, entity: any) => {
                if (entity.name === 'ReferralPosterTemplate') {
                    return { find, findOne };
                }
                return { save, findOne: vi.fn().mockResolvedValue(configRecord) };
            }),
        };
        const service = new ReferralService(
            connection as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { signingSecret: 'test-storefront-visitor-hash-secret' } as any,
        );
        (service as any).eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
        (service as any).getOrCreateConfig = vi.fn().mockResolvedValue(configRecord);
        (service as any).lockConfigOrThrow = vi.fn().mockResolvedValue(configRecord);

        // Updating with disabled template as default should reject
        await expect(
            service.updateProgram(
                {
                    channelId: 'channel-1',
                    currencyCode: 'CNY',
                    channel: { defaultCurrencyCode: 'CNY' },
                } as any,
                {
                    expectedUpdatedAt: configRecord.updatedAt,
                    enabled: true,
                    rewardRate: 5,
                    releaseDelayDays: 7,
                    minimumOrderAmount: 0,
                    allowBalanceSpend: true,
                    attributionWindowDays: 30,
                    defaultPosterTemplate: 'CLOUD_BRIDGE_ORBIT',
                    posterTemplates: ['BRAND_MINIMAL', 'BENEFIT_RED_GOLD'],
                },
            ),
        ).rejects.toThrow('默认海报模板无效或已停用');

        // Updating with enabled template as default should succeed and save posterTemplates
        const result = await service.updateProgram(
            { channelId: 'channel-1', currencyCode: 'CNY', channel: { defaultCurrencyCode: 'CNY' } } as any,
            {
                expectedUpdatedAt: configRecord.updatedAt,
                enabled: true,
                rewardRate: 5,
                releaseDelayDays: 7,
                minimumOrderAmount: 0,
                allowBalanceSpend: true,
                attributionWindowDays: 30,
                defaultPosterTemplate: 'BENEFIT_RED_GOLD',
                posterTemplates: ['BRAND_MINIMAL', 'BENEFIT_RED_GOLD'],
            },
        );

        expect(configRecord.defaultPosterTemplate).toBe('BENEFIT_RED_GOLD');
        expect(configRecord.posterTemplates).toEqual(['BRAND_MINIMAL', 'BENEFIT_RED_GOLD']);
        expect(result.posterTemplates).toEqual(['BRAND_MINIMAL', 'BENEFIT_RED_GOLD']);
    });
});

describe('managed system poster content', () => {
    it('reads only active Channel blocks and ignores blocks with a conflicting purpose', async () => {
        const find = vi.fn().mockResolvedValue([
            {
                code: 'referral-poster-brand-minimal',
                imageAsset: { id: 'shop-a-asset' },
                textColor: '#173452',
                settings: {
                    purpose: 'referral-system-poster',
                    templateId: 'BRAND_MINIMAL',
                    copy: { headlineZh: '本店独有标题' },
                },
            },
            {
                code: 'referral-poster-product-story',
                imageAsset: { id: 'unrelated-asset' },
                settings: {
                    purpose: 'unrelated-purpose',
                    templateId: 'PRODUCT_STORY',
                    copy: { headlineZh: '不应显示的内容' },
                },
            },
        ]);
        const connection = {
            rawConnection: { hasMetadata: () => true },
            getRepository: vi.fn().mockReturnValue({ find }),
        };
        const service = new ReferralPosterView(connection as any, {} as any);
        const result = await service.systemPosterTemplates(
            { channelId: 'shop-a', languageCode: 'zh_Hans' } as RequestContext,
            ['BRAND_MINIMAL'],
        );
        expect(find.mock.calls[0][0].where.channelId).toBe('shop-a');
        expect(result[0]).toMatchObject({
            id: 'BRAND_MINIMAL',
            enabled: true,
            headlineZh: '本店独有标题',
            posterBackgroundAsset: { id: 'shop-a-asset' },
        });
        expect(result[2].enabled).toBe(false);
        expect(result[2].posterBackgroundAsset).toBeNull();
        expect(result[2]).not.toMatchObject({ headlineZh: '不应显示的内容' });
    });
});
