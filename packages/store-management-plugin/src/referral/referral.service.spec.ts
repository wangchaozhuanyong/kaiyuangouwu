import { Refund, type RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { ReferralBalanceUse } from '../entities/referral-balance-use.entity';
import { ReferralLedgerEntry } from '../entities/referral-ledger-entry.entity';
import { ReferralPosterTemplate } from '../entities/referral-poster-template.entity';
import { ReferralReward } from '../entities/referral-reward.entity';
import { ReferralWallet } from '../entities/referral-wallet.entity';

import { referralPosterCopy } from './referral-poster-presets';
import { ReferralPosterView } from './referral-poster-view';
import { ReferralService, supportsReferralPessimisticLock } from './referral.service';

describe('referral display currency boundaries', () => {
    it.each(['MYR', 'USD'])(
        'preserves source reward thresholds and caps but disables the unavailable %s view',
        async currencyCode => {
            const view = new ReferralPosterView(
                {
                    getRepository: () => ({ find: () => Promise.resolve([]) }),
                    rawConnection: { hasMetadata: () => false },
                } as any,
                {} as any,
            );
            const config = {
                channelId: 'store-1',
                enabled: true,
                minimumOrderAmount: 10_000,
                maxRewardPerOrder: 2_000,
                currencyCode: 'CNY',
                rewardRateBps: 500,
                posterTemplates: [],
                defaultPosterTemplate: '',
            } as any;
            const context = {
                channelId: 'store-1',
                currencyCode,
                languageCode: 'zh_Hans',
                channel: { defaultCurrencyCode: 'CNY', customFields: {} },
            } as any;
            await expect(view.configView(context, config, false)).resolves.toMatchObject({
                enabled: false,
                minimumOrderAmount: 10_000,
                maxRewardPerOrder: 2_000,
                currencyCode: 'CNY',
            });
            await expect(
                view.configView(
                    { ...context, currencyCode: 'CNY' },
                    {
                        ...config,
                        minimumOrderAmount: 0,
                        maxRewardPerOrder: 0,
                    },
                    true,
                ),
            ).resolves.toMatchObject({
                enabled: true,
                minimumOrderAmount: 0,
                maxRewardPerOrder: 0,
                currencyCode: 'CNY',
            });
        },
    );
});

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

describe('referral balance refund receipts', () => {
    function fixture(driver = 'mysql') {
        const wallet = {
            id: 'wallet',
            customerId: 'customer',
            currencyCode: 'MYR',
            availableBalance: 0,
            pendingBalance: 0,
            reservedBalance: 0,
        };
        const use = {
            id: 'use',
            walletId: wallet.id,
            amount: 1000,
            refundedAmount: 0,
            status: 'CAPTURED',
            wallet,
        };
        const entries = new Map<string, unknown>();
        const useRepository = {
            findOne: vi.fn((_options: unknown) => Promise.resolve({ ...use })),
            save: vi.fn((value: typeof use) => Promise.resolve(Object.assign(use, value))),
        };
        const ledgerRepository = {
            findOne: vi.fn(({ where }) => Promise.resolve(entries.get(where.idempotencyKey))),
            save: vi.fn(entry => {
                entries.set(entry.idempotencyKey, entry);
                return Promise.resolve(entry);
            }),
        };
        const walletRepository = {
            findOneByOrFail: vi.fn(() => Promise.resolve({ ...wallet })),
            save: vi.fn((value: typeof wallet) => Promise.resolve(Object.assign(wallet, value))),
        };
        const service = Object.assign(Object.create(ReferralService.prototype), {
            connection: {
                rawConnection: { options: { type: driver } },
                getRepository: (_ctx: unknown, entity: unknown) => {
                    if (entity === Refund)
                        return {
                            findOne: ({ where }: { where: { id: string } }) =>
                                Promise.resolve({
                                    id: where.id,
                                    total: where.id === 'refund-a' ? 300 : 700,
                                    payment: { method: 'referral-balance' },
                                }),
                        };
                    if (entity === ReferralReward) return { findOne: () => Promise.resolve(null) };
                    if (entity === ReferralBalanceUse) return useRepository;
                    if (entity === ReferralLedgerEntry) return ledgerRepository;
                    if (entity === ReferralWallet) return walletRepository;
                    throw new Error('Unexpected entity');
                },
            },
            lockRow: vi.fn(() => Promise.resolve(undefined)),
        });
        return { service, wallet, use, entries, useRepository, ledgerRepository };
    }

    it('ignores a duplicate receipt without reducing the remaining refundable amount', async () => {
        const { service, use, wallet, entries, useRepository, ledgerRepository } = fixture();
        const ctx = { channelId: 'store' } as RequestContext;
        await service.restoreBalanceUseForRefund(ctx, 'order', 'refund-a');
        await service.restoreBalanceUseForRefund(ctx, 'order', 'refund-a');
        expect(use.refundedAmount).toBe(300);
        expect(wallet.availableBalance).toBe(300);
        expect(useRepository.save).toHaveBeenCalledTimes(1);
        expect(useRepository.findOne).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { channelId: 'store', orderId: 'order' },
                lock: { mode: 'pessimistic_write' },
            }),
        );
        expect(ledgerRepository.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
        );
        await service.restoreBalanceUseForRefund(ctx, 'order', 'refund-b');
        expect(use.refundedAmount).toBe(1000);
        expect(wallet.availableBalance).toBe(1000);
        expect(use.status).toBe('REFUNDED');
        expect(entries.size).toBe(2);
    });

    it('credits a partial refund toward debt without requiring the wallet to reach zero', async () => {
        const { service, use, wallet, entries } = fixture();
        wallet.availableBalance = -1000;
        await service.restoreBalanceUseForRefund({ channelId: 'store' }, 'order', 'refund-a');
        expect(wallet.availableBalance).toBe(-700);
        expect(use.refundedAmount).toBe(300);
        expect(entries.size).toBe(1);
    });

    it('keeps captured funds outstanding after cancellation and credits each settled refund only once', async () => {
        const { service, use, wallet, entries, useRepository } = fixture();
        wallet.availableBalance = -1000;
        await service.restoreBalanceUseForRefund({ channelId: 'store' }, 'order', 'refund-a');
        await service.handleCancelledOrder({ channelId: 'store' }, 'order');
        expect(wallet.availableBalance).toBe(-700);
        expect(use).toMatchObject({ refundedAmount: 300, status: 'PARTIALLY_REFUNDED' });
        await service.restoreBalanceUseForRefund({ channelId: 'store' }, 'order', 'refund-b');
        await service.handleCancelledOrder({ channelId: 'store' }, 'order');
        await service.restoreBalanceUseForRefund({ channelId: 'store' }, 'order', 'refund-b');
        expect(wallet.availableBalance).toBe(0);
        expect(use).toMatchObject({ refundedAmount: 1000, status: 'REFUNDED' });
        expect(entries.size).toBe(2);
        expect(
            useRepository.findOne.mock.calls.every(([options]) => (options as { lock?: unknown }).lock),
        ).toBe(true);
    });

    it('releases an uncaptured reservation on cancellation without creating a refund receipt', async () => {
        const { service, use, wallet, entries } = fixture();
        use.status = 'RESERVED';
        wallet.reservedBalance = 1000;
        await service.handleCancelledOrder({ channelId: 'store' }, 'order');
        await service.handleCancelledOrder({ channelId: 'store' }, 'order');
        expect(wallet.availableBalance).toBe(1000);
        expect(wallet.reservedBalance).toBe(0);
        expect(use).toMatchObject({ refundedAmount: 1000, status: 'RELEASED' });
        expect(entries.size).toBe(1);
    });

    it('does not reimburse again after cancellation released the entire balance use', async () => {
        const { service, use, wallet, entries } = fixture();
        Object.assign(use, { refundedAmount: 1000, status: 'RELEASED' });
        await service.restoreBalanceUseForRefund({ channelId: 'store' }, 'order', 'refund-a');
        expect(wallet.availableBalance).toBe(0);
        expect(use.refundedAmount).toBe(1000);
        expect(entries.size).toBe(0);
    });

    it('keeps replay protection on drivers without row locks', async () => {
        const { service, use, useRepository } = fixture('sqljs');
        await service.restoreBalanceUseForRefund({ channelId: 'store' }, 'order', 'refund-a');
        await service.restoreBalanceUseForRefund({ channelId: 'store' }, 'order', 'refund-a');
        expect(use.refundedAmount).toBe(300);
        expect(useRepository.findOne.mock.calls[0][0]).not.toHaveProperty('lock');
    });
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
            translations: {
                prepareLocalizedColumns: () => Promise.resolve({ values: {}, prepared: [] }),
                recordPreparedFields: () => Promise.resolve(undefined),
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

    it.each([0, 1, 30, 180, 365])('accepts an attribution window of %i days', attributionWindowDays => {
        expect(() =>
            (service as any).validateProgramInput(programInput(attributionWindowDays)),
        ).not.toThrow();
    });

    it.each([-1, 0.5, 366, NaN, Infinity])('rejects an invalid attribution window: %s', days => {
        expect(() => (service as any).validateProgramInput(programInput(days))).toThrow(
            '邀请归因有效期必须是0至365的整数，0表示永久有效',
        );
    });

    it('defaults new store programs to permanent attribution and preserves existing settings', async () => {
        const existing = { id: 'config-1', attributionWindowDays: 30 };
        const findOne = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
        const save = vi.fn().mockImplementation(config => Promise.resolve(config));
        const configService = new ReferralService(
            { getRepository: () => ({ findOne, save }) } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { signingSecret: 'test-storefront-visitor-hash-secret' } as any,
        );
        const ctx = { channelId: 'channel-1', channel: { defaultCurrencyCode: 'CNY' } };

        expect(await (configService as any).getOrCreateConfig(ctx)).toMatchObject({
            attributionWindowDays: 0,
        });
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ attributionWindowDays: 0 }));
        expect(await (configService as any).getOrCreateConfig(ctx)).toBe(existing);
        expect(save).toHaveBeenCalledTimes(1);
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

describe('external registration referral attribution', () => {
    function fixture(
        existingCustomer: object | null = null,
        enabled = true,
        inviter: object | null = { id: 'inviter' },
    ) {
        const ctx = { channelId: 'store-1' };
        const tx = { channelId: 'store-1', transaction: true };
        const query = {
            where: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue(existingCustomer),
        };
        const bindRelationship = vi.fn().mockResolvedValue(undefined);
        const create = vi.fn().mockResolvedValue({ id: 'new-user' });
        const service = Object.assign(Object.create(ReferralService.prototype), {
            connection: {
                withTransaction: vi.fn((_ctx, work) => work(tx)),
                getRepository: vi.fn(() => ({ createQueryBuilder: () => query })),
            },
            customerService: { findOneByUserId: vi.fn().mockResolvedValue({ id: 'new-customer' }) },
            getConfig: vi.fn().mockResolvedValue({ enabled }),
            findAccountByCode: vi.fn().mockResolvedValue(inviter),
            bindRelationship,
        }) as ReferralService;
        return { ctx, tx, service, create, bindRelationship, query };
    }
    it('creates and binds a new customer using the same transaction and current store', async () => {
        const { service, ctx, tx, create, bindRelationship } = fixture();
        await service.registerExternalCustomer(ctx as never, 'new@gmail.com', 'ABC123', 'LINK', create);
        expect(create).toHaveBeenCalledWith(tx);
        expect(bindRelationship).toHaveBeenCalledWith(tx, { id: 'inviter' }, { id: 'new-customer' }, 'LINK');
    });
    it.each([true, false])(
        'never attributes existing accounts or disabled programs (existing=%s)',
        async existing => {
            const { service, ctx, create, bindRelationship } = fixture(
                existing ? { id: 'existing' } : null,
                existing,
            );
            await service.registerExternalCustomer(ctx as never, 'buyer@gmail.com', 'ABC123', 'CODE', create);
            expect(create).toHaveBeenCalledOnce();
            expect(bindRelationship).not.toHaveBeenCalled();
        },
    );
    it('rejects an invalid code before creating an account and propagates binding errors for rollback', async () => {
        const invalid = fixture(null, true, null);
        await expect(
            invalid.service.registerExternalCustomer(
                invalid.ctx as never,
                'new@gmail.com',
                'BAD',
                'CODE',
                invalid.create,
            ),
        ).rejects.toThrow('STOREFRONT_GOOGLE_INVITE_INVALID');
        expect(invalid.create).not.toHaveBeenCalled();
        const failure = fixture();
        failure.bindRelationship.mockRejectedValue(new Error('storage unavailable'));
        await expect(
            failure.service.registerExternalCustomer(
                failure.ctx as never,
                'new@gmail.com',
                'ABC123',
                'CODE',
                failure.create,
            ),
        ).rejects.toThrow('storage unavailable');
    });
});
