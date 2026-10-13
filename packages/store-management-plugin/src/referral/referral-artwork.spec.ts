import { DEFAULT_ARTWORK_POSTER_DESIGN } from '@vendure/common/lib/referral-poster-design';
import { Asset, RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { ReferralPosterTemplate } from '../entities/referral-poster-template.entity';
import { ReferralProgramConfig } from '../entities/referral-program-config.entity';

import { normalizeReferralPosterInput, SaveReferralPosterTemplateInput } from './referral-input';
import { referralPosterCopy, referralPosterPresets } from './referral-poster-presets';
import { ReferralPosterView } from './referral-poster-view';
import { ReferralService } from './referral.service';

const ctx = {
    channelId: 'store-1',
    currencyCode: 'CNY',
    languageCode: 'zh_Hans',
    channel: { defaultCurrencyCode: 'CNY', customFields: {} },
} as RequestContext;

function input(overrides: Partial<SaveReferralPosterTemplateInput> = {}): SaveReferralPosterTemplateInput {
    return {
        name: 'Uploaded artwork',
        enabled: false,
        position: 0,
        layoutVariant: 'ARTWORK_QR',
        design: structuredClone(DEFAULT_ARTWORK_POSTER_DESIGN),
        posterBackgroundAssetId: 'image-1',
        headlineZh: '一起发现好物',
        headlineEn: 'Discover good things together',
        foregroundColor: '#152C49',
        accentColor: '#2565AE',
        overlayOpacity: 0,
        ...overrides,
    };
}

function fixture() {
    const records: ReferralPosterTemplate[] = [];
    const assets = [
        { id: 'image-1', channelId: 'store-1', mimeType: 'image/png', width: 1080, height: 1920 },
    ];
    const config = {
        id: 'config-1',
        channelId: 'store-1',
        updatedAt: new Date('2026-10-13T00:00:00Z'),
        posterTemplates: [],
        defaultPosterTemplate: '',
        currencyCode: 'CNY',
        minimumOrderAmount: 0,
        rewardRateBps: 0,
        enabled: true,
    } as unknown as ReferralProgramConfig;
    const repository = {
        create: (value: Partial<ReferralPosterTemplate>) => value,
        save: vi.fn((value: ReferralPosterTemplate) => {
            const index = records.findIndex(record => record.id === value.id);
            const saved = { ...value, id: value.id ?? `poster-${records.length + 1}` };
            if (index < 0) records.push(saved);
            else records[index] = saved;
            return Promise.resolve(saved);
        }),
        findOne: vi.fn(({ where }: { where: { id: string; channelId: string } }) =>
            Promise.resolve(
                records.find(record => record.id === where.id && record.channelId === where.channelId) ??
                    null,
            ),
        ),
        find: vi.fn(({ where }: { where: { channelId: string; enabled?: boolean } }) =>
            Promise.resolve(
                records.filter(
                    record =>
                        record.channelId === where.channelId &&
                        (where.enabled === undefined || record.enabled === where.enabled),
                ),
            ),
        ),
    };
    const connection = {
        rawConnection: { hasMetadata: () => false },
        getRepository: (_ctx: RequestContext, entity: unknown) => {
            if (entity === ReferralPosterTemplate) return repository;
            if (entity === ReferralProgramConfig) return { save: () => Promise.resolve(config) };
            if (entity !== Asset) throw new Error('Unexpected repository');
            let channelId: string;
            let id: string;
            const query = {
                innerJoin: (
                    _relation: string,
                    _alias: string,
                    _clause: string,
                    params: { channelId: string },
                ) => {
                    channelId = params.channelId;
                    return query;
                },
                where: (_clause: string, params: { id: string }) => {
                    id = params.id;
                    return query;
                },
                getOne: () =>
                    Promise.resolve(assets.find(asset => asset.id === id && asset.channelId === channelId)),
            };
            return { createQueryBuilder: () => query };
        },
    };
    const posters = new ReferralPosterView(
        connection as never,
        {
            entityOptions: { entityIdStrategy: { primaryKeyType: 'uuid', encodeId: (id: string) => id } },
        } as never,
    );
    const translations = {
        prepareLocalizedColumns: vi.fn(() => Promise.resolve({ values: {}, prepared: [] })),
        recordPreparedFields: vi.fn(() => Promise.resolve()),
    };
    const service = Object.assign(Object.create(ReferralService.prototype), {
        connection,
        posters,
        translations,
        getOrCreateConfig: () => Promise.resolve(config),
        lockConfigOrThrow: () => Promise.resolve(config),
        eventBus: { publish: vi.fn() },
    }) as ReferralService;
    return { service, posters, records, assets, config, translations, repository };
}

describe('uploaded referral artwork persistence and isolation', () => {
    it('creates and reads the design, preserves it when an update omits it, and rejects stale edits', async () => {
        const { service, posters, config, translations, records } = fixture();
        const created = await service.createPosterTemplate(ctx, input());
        expect(created).toMatchObject({
            design: DEFAULT_ARTWORK_POSTER_DESIGN,
            enabled: false,
            titleZh: '',
            rewardTextZh: '',
        });
        expect(translations.prepareLocalizedColumns).toHaveBeenCalledWith(
            ['headline', 'rewardText'],
            expect.anything(),
        );
        const version = config.updatedAt;
        const { enabled: _enabled, design: _design, ...edit } = input();
        await service.updatePosterTemplate(ctx, {
            ...edit,
            id: created.id,
            expectedUpdatedAt: version,
            name: 'Renamed',
        });
        expect((await posters.configView(ctx, config, true)).posterTemplateConfigs[0]).toMatchObject({
            name: 'Renamed',
            design: DEFAULT_ARTWORK_POSTER_DESIGN,
        });
        await expect(
            service.updatePosterTemplate(ctx, {
                ...edit,
                id: created.id,
                expectedUpdatedAt: version,
                name: 'Stale',
            }),
        ).rejects.toThrow('CONCURRENT_MODIFICATION');
        expect(records[0].name).toBe('Renamed');
    });

    it('does not resolve another store asset or template', async () => {
        const { service, posters, config, assets } = fixture();
        assets[0].channelId = 'store-2';
        await expect(service.createPosterTemplate(ctx, input())).rejects.toThrow('不属于当前店铺');
        assets[0].channelId = 'store-1';
        const created = await service.createPosterTemplate(ctx, input());
        const { enabled: _enabled, ...edit } = input();
        await expect(
            service.updatePosterTemplate({ ...ctx, channelId: 'store-2' } as RequestContext, {
                ...edit,
                id: created.id,
                expectedUpdatedAt: config.updatedAt,
            }),
        ).rejects.toThrow('找不到该邀请海报模板');
        expect(
            (await posters.configView({ ...ctx, channelId: 'store-2' } as RequestContext, config, true))
                .posterTemplateConfigs,
        ).toEqual([]);
    });

    it('validates uploaded image ratio without cropping and accepts proportional exports', async () => {
        const { service, assets, repository } = fixture();
        assets[0].width = 1000;
        await expect(service.createPosterTemplate(ctx, input())).rejects.toThrow('宽高比');
        expect(repository.save).not.toHaveBeenCalled();
        assets[0].width = 720;
        assets[0].height = 1280;
        await expect(service.createPosterTemplate(ctx, input())).resolves.toMatchObject({
            posterBackgroundAssetId: 'image-1',
        });
    });

    it('preserves an unused legacy share image when switching to artwork and still validates its ownership and type', async () => {
        const { service, assets, config, records } = fixture();
        const shareAsset = {
            id: 'share-image',
            channelId: 'store-1',
            mimeType: 'image/png',
            width: 800,
            height: 600,
        };
        assets.push(shareAsset);
        const created = await service.createPosterTemplate(
            ctx,
            input({
                ...referralPosterCopy,
                layoutVariant: 'STANDARD_CENTER',
                design: undefined,
                shareBackgroundAssetId: shareAsset.id,
            }),
        );
        const { enabled: _enabled, ...artwork } = input();
        await service.updatePosterTemplate(ctx, {
            ...artwork,
            id: created.id,
            expectedUpdatedAt: config.updatedAt,
        });
        expect(records[0]).toMatchObject({
            layoutVariant: 'ARTWORK_QR',
            design: DEFAULT_ARTWORK_POSTER_DESIGN,
            posterBackgroundAssetId: 'image-1',
            shareBackgroundAssetId: shareAsset.id,
        });
        shareAsset.channelId = 'store-2';
        await expect(
            service.updatePosterTemplate(ctx, {
                ...artwork,
                id: created.id,
                expectedUpdatedAt: config.updatedAt,
            }),
        ).rejects.toThrow('不属于当前店铺');
        shareAsset.channelId = 'store-1';
        shareAsset.mimeType = 'application/pdf';
        await expect(
            service.updatePosterTemplate(ctx, {
                ...artwork,
                id: created.id,
                expectedUpdatedAt: config.updatedAt,
            }),
        ).rejects.toThrow('必须是图片');
    });

    it('requires an artwork image and validates its MIME type', async () => {
        const { service, assets } = fixture();
        await expect(
            service.createPosterTemplate(ctx, input({ posterBackgroundAssetId: null })),
        ).rejects.toThrow('请上传');
        assets[0].mimeType = 'application/pdf';
        await expect(service.createPosterTemplate(ctx, input())).rejects.toThrow('必须是图片');
    });

    it('only uses actual copy fields for English artwork availability', async () => {
        const { service, posters, config, records } = fixture();
        await service.createPosterTemplate(
            ctx,
            input({ enabled: true, titleZh: '不会叠加的标题', titleEn: '' }),
        );
        const english = { ...ctx, languageCode: 'en' } as RequestContext;
        expect((await posters.configView(english, config, false)).posterTemplateConfigs).toHaveLength(1);
        records[0].headlineEn = '';
        expect((await posters.configView(english, config, false)).posterTemplateConfigs).toEqual([]);
        expect((await posters.configView(english, config, true)).posterTemplateConfigs).toHaveLength(1);
    });
});

describe('referral artwork input compatibility', () => {
    it.each(referralPosterPresets)(
        'preserves the $id system palette when creating a local copy and editing without design',
        async preset => {
            const { service, posters, config } = fixture();
            const draft = input({
                ...referralPosterCopy,
                layoutVariant: 'STANDARD_CENTER',
                design: preset.design,
                foregroundColor: preset.foregroundColor,
                accentColor: preset.accentColor,
            });
            const created = await service.createPosterTemplate(ctx, draft);
            expect(created.design).toEqual(preset.design);
            const { enabled: _enabled, design: _design, ...edit } = draft;
            await service.updatePosterTemplate(ctx, {
                ...edit,
                id: created.id,
                expectedUpdatedAt: config.updatedAt,
                name: '本店副本',
            });
            expect((await posters.configView(ctx, config, true)).posterTemplateConfigs[0].design).toEqual(
                preset.design,
            );
        },
    );

    it('keeps only supported palette keys and rejects unsafe colors or mismatched design versions', () => {
        const standard = input({ ...referralPosterCopy, layoutVariant: 'STANDARD_CENTER' });
        expect(
            normalizeReferralPosterInput({
                ...standard,
                design: {
                    ...referralPosterPresets[0].design,
                    arbitraryCss: 'url(https://example.invalid)',
                },
            }).design,
        ).toEqual(referralPosterPresets[0].design);
        for (const value of ['red', '#fff', 'url(https://example.invalid)', 42, null]) {
            expect(() =>
                normalizeReferralPosterInput({ ...standard, design: { version: 2, background: value } }),
            ).toThrow('#RRGGBB');
        }
        expect(() => normalizeReferralPosterInput(standard)).toThrow('标准海报配色版本');
        expect(() =>
            normalizeReferralPosterInput(input({ design: referralPosterPresets[0].design })),
        ).toThrow('海报设计版本');
    });

    it('requires headline copy but not legacy overlays and keeps standard templates unchanged', () => {
        expect(normalizeReferralPosterInput(input()).titleZh).toBe('');
        expect(() => normalizeReferralPosterInput(input({ headlineZh: '' }))).toThrow('中文主标题');
        const legacy = normalizeReferralPosterInput(
            input({ ...referralPosterCopy, layoutVariant: 'STANDARD_CENTER', design: undefined }),
        );
        expect(legacy).toMatchObject({ titleZh: referralPosterCopy.titleZh, design: null });
        expect(() =>
            normalizeReferralPosterInput(input({ layoutVariant: 'STANDARD_CENTER', design: undefined })),
        ).toThrow('中文小标题');
    });

    it.each([
        ['outside canvas', { qr: { ...DEFAULT_ARTWORK_POSTER_DESIGN.qr, centerX: 1 } }],
        ['too small', { qr: { ...DEFAULT_ARTWORK_POSTER_DESIGN.qr, diameter: 359 } }],
        ['unknown style', { qr: { ...DEFAULT_ARTWORK_POSTER_DESIGN.qr, style: 'unknown' } }],
        ['invalid canvas', { canvas: { width: 0, height: 1920 } }],
        ['unknown version', { version: 4 }],
    ])('rejects %s before persistence', (_label, overrides) => {
        expect(() =>
            normalizeReferralPosterInput(
                input({ design: { ...DEFAULT_ARTWORK_POSTER_DESIGN, ...overrides } }),
            ),
        ).toThrow();
    });

    it('rejects null design for artwork and strips unsupported JSON keys', () => {
        expect(() => normalizeReferralPosterInput(input({ design: null }))).toThrow('海报设计规格');
        expect(
            normalizeReferralPosterInput(
                input({ design: { ...DEFAULT_ARTWORK_POSTER_DESIGN, extra: 'discard' } }),
            ).design,
        ).toEqual(DEFAULT_ARTWORK_POSTER_DESIGN);
    });
});
