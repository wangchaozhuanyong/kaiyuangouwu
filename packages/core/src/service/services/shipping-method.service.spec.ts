import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { ensureConfigLoaded } from '../../config/config-helpers';
import { ConfigService } from '../../config/config.service';
import { TransactionWrapper } from '../../connection/transaction-wrapper';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { SettingsStoreEntry } from '../../entity/settings-store-entry/settings-store-entry.entity';
import { ShippingMethodTranslation } from '../../entity/shipping-method/shipping-method-translation.entity';
import { ShippingMethod } from '../../entity/shipping-method/shipping-method.entity';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { ShippingCalculator } from '../helpers/shipping-calculator/shipping-calculator';
import {
    PLATFORM_SHIPPING_TEMPLATES_KEY,
    PLATFORM_SHIPPING_TEMPLATE_INPUTS,
    STORE_SHIPPING_METHODS_KEY,
} from '../helpers/shipping-calculator/shipping-template-settings';

import { ShippingMethodService } from './shipping-method.service';

function fixture({
    platform = false,
    currency = 'MYR',
    owned = ['own'],
    disabled = [],
    source = { own: 'CNY' },
    templates = ['shared'],
}: {
    platform?: boolean;
    currency?: string;
    owned?: string[];
    disabled?: string[];
    source?: Record<string, string>;
    templates?: string[];
} = {}) {
    const ctx = {
        apiType: 'admin',
        channelId: platform ? '1' : '2',
        channel: {
            id: platform ? '1' : '2',
            code: platform ? '__default_channel__' : 'store-b',
            defaultCurrencyCode: currency,
            defaultShippingZone: { id: 'zone-b' },
            pricesIncludeTax: false,
        },
        userHasPermissions: () => true,
    } as any;
    ctx.copy = (updates: any) => ({ ...ctx, ...updates, channelId: updates.channel?.id ?? ctx.channelId });
    const values = new Map<string, any>([
        [PLATFORM_SHIPPING_TEMPLATES_KEY, { freeShippingId: templates[0] }],
        [STORE_SHIPPING_METHODS_KEY, { ownedIds: owned, disabledIds: disabled, sourceCurrencyCodes: source }],
    ]);
    const methods = ['own', 'shared', 'legacy', 'other'].map(id => ({
        id,
        code: id,
        deletedAt: null,
        channels:
            id === 'other'
                ? [{ id: '3', code: 'store-c' }]
                : [
                      { id: '1', code: '__default_channel__' },
                      { id: '2', code: 'store-b', defaultCurrencyCode: currency },
                  ],
        calculator: {
            code: 'physical-subtotal-shipping-calculator',
            args:
                id === 'legacy'
                    ? [
                          { name: 'baseRate', value: '1000' },
                          { name: 'freeAbove', value: '4000' },
                          { name: 'currencyCode', value: 'CNY' },
                      ]
                    : [],
        },
        checker: { code: 'store-shipping-zone-eligibility-checker', args: [] },
        fulfillmentHandlerCode: 'manual-fulfillment',
        translations: [{ languageCode: 'zh_Hans', name: id, description: '' }],
    }));
    const ownershipEntries: any[] = [];
    const legacyQuery = {
        setFindOptions: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
    };
    const repo = {
        createQueryBuilder: vi.fn(() => legacyQuery),
        find: vi
            .fn()
            .mockImplementation(({ where }: any) =>
                where?.key
                    ? ownershipEntries
                    : Array.isArray(where)
                      ? methods.filter(method => where.some(filter => method.id === filter.id))
                      : methods,
            ),
        findOne: vi
            .fn()
            .mockImplementation(({ where }: any) => methods.find(method => method.id === where.id)),
        save: vi.fn().mockImplementation((method: any) => {
            if (!method.id) {
                method.id = methods.some(item => item.id === 'new') ? 'new-2' : 'new';
                methods.push(method);
            }
            return method;
        }),
    };
    const connection = {
        platformStoreGovernanceEnabled: true,
        rawConnection: { options: { type: 'sqlite' } },
        getRepository: vi.fn(() => repo),
        findOneInChannel: vi
            .fn()
            .mockImplementation((_ctx, _type, id, channel) =>
                methods.find(method => method.id === id && method.channels.some(c => c.id === channel)),
            ),
        getEntityOrThrow: vi
            .fn()
            .mockImplementation((_ctx, _type, id) => methods.find(method => method.id === id)),
    };
    const settings = {
        register: vi.fn(),
        get: vi.fn().mockImplementation((_ctx, key) => Promise.resolve(structuredClone(values.get(key)))),
        set: vi.fn().mockImplementation((_ctx, key, value) => {
            values.set(key, structuredClone(value));
            return Promise.resolve({ result: true });
        }),
    };
    const channels = {
        getDefaultChannel: vi.fn().mockResolvedValue({ id: '1' }),
        assignToCurrentChannel: vi.fn().mockImplementation((method: any) => {
            method.channels = [{ id: '1' }, { id: ctx.channelId }];
        }),
        assignToChannels: vi.fn(),
        removeFromChannels: vi.fn(),
    };
    const translatable = {
        create: vi.fn().mockImplementation(({ input, beforeSave }: any) => {
            const method = { ...input };
            beforeSave(method);
            return Promise.resolve(method);
        }),
        update: vi.fn().mockImplementation(({ input }: any) => ({ ...methods[0], ...input })),
    };
    const configArgs = { parseInput: vi.fn((_type, input) => ({ code: input.code, args: input.arguments })) };
    const custom = { updateRelations: vi.fn().mockImplementation((_ctx, _type, _input, method) => method) };
    const events = { publish: vi.fn() };
    const service = new ShippingMethodService(
        connection as any,
        { shippingOptions: { fulfillmentHandlers: [{ code: 'manual-fulfillment' }] } } as any,
        {} as any,
        {
            build: () => ({
                getManyAndCount: () => Promise.resolve([methods.filter(method => method.id !== 'other'), 3]),
            }),
        } as any,
        channels as any,
        configArgs as any,
        translatable as any,
        custom as any,
        events as any,
        { translate: (method: any) => method } as any,
        settings as any,
    );
    return {
        service,
        ctx,
        settings,
        values,
        methods,
        channels,
        repo,
        translatable,
        configArgs,
        ownershipEntries,
    };
}

describe('shipping template store ownership and switches', () => {
    it('filters disabled private templates from Shop while retaining readable legacy methods', async () => {
        const f = fixture({ disabled: ['own'] });
        const active = await f.service.getActiveShippingMethods({ ...f.ctx, apiType: 'shop' });
        expect(active.map(method => method.id)).toEqual(['shared', 'legacy']);
    });

    it('disabling and re-enabling a private template preserves channel ownership and currency', async () => {
        const f = fixture();
        await f.service.setMyShippingTemplateEnabled(f.ctx, 'own', false);
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY)).toEqual({
            ownedIds: ['own'],
            disabledIds: ['own'],
            sourceCurrencyCodes: { own: 'CNY' },
        });
        expect(f.channels.removeFromChannels).not.toHaveBeenCalled();
        await f.service.setMyShippingTemplateEnabled(f.ctx, 'own', true);
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY).disabledIds).toEqual([]);
    });

    it('uses only the current store channel for a shared template switch', async () => {
        const f = fixture();
        await f.service.setMyShippingTemplateEnabled(f.ctx, 'shared', false);
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY).disabledIds).toEqual(['shared']);
        expect(f.channels.removeFromChannels).toHaveBeenCalledWith(f.ctx, expect.anything(), 'shared', ['2']);
        await f.service.setMyShippingTemplateEnabled(f.ctx, 'shared', true);
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY).disabledIds).toEqual([]);
        expect(f.channels.assignToChannels).toHaveBeenCalledWith(f.ctx, expect.anything(), 'shared', ['2']);
    });

    it('rejects forged other-store IDs even for SuperAdmin in a store context', async () => {
        const f = fixture();
        await expect(f.service.setMyShippingTemplateEnabled(f.ctx, 'other', false)).rejects.toThrow(
            '本店创建',
        );
        expect(f.settings.set).not.toHaveBeenCalled();
        expect(f.channels.removeFromChannels).not.toHaveBeenCalled();
    });

    it('a shared template is not editable by its only assigned store', async () => {
        const f = fixture();
        await expect(f.service.update(f.ctx, { id: 'shared', translations: [] })).rejects.toThrow(
            '平台通用配送模板',
        );
        expect(f.translatable.update).not.toHaveBeenCalled();
    });

    it('does not infer legacy ownership from platform plus one store membership', async () => {
        const f = fixture();
        await expect(f.service.update(f.ctx, { id: 'legacy', translations: [] })).rejects.toThrow(
            '维护归属尚未确认',
        );
        expect((await f.service.getActiveShippingMethods(f.ctx)).some(method => method.id === 'legacy')).toBe(
            true,
        );
    });

    it('keeps the saved source currency when the store changes default currency', async () => {
        const f = fixture({ currency: 'MYR', source: { own: 'CNY' } });
        await f.service.update(f.ctx, {
            id: 'own',
            translations: [],
            calculator: {
                code: 'physical-subtotal-shipping-calculator',
                arguments: [
                    { name: 'baseRate', value: '1000' },
                    { name: 'sourceCurrencyCode', value: 'MYR' },
                ],
            },
        });
        expect(f.configArgs.parseInput).toHaveBeenCalledWith(
            'ShippingCalculator',
            expect.objectContaining({
                arguments: [
                    { name: 'baseRate', value: '1000' },
                    { name: 'estimateMinDays', value: '1' },
                    { name: 'estimateMaxDays', value: '3' },
                    { name: 'sourceCurrencyCode', value: 'CNY' },
                ],
            }),
        );
    });

    it('creation pins the store currency and checker and persists explicit owner IDs', async () => {
        const f = fixture({ currency: 'MYR' });
        await f.service.create(f.ctx, { ...PLATFORM_SHIPPING_TEMPLATE_INPUTS[0].input, code: 'my-delivery' });
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY).sourceCurrencyCodes.new).toBe('MYR');
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY).ownedIds).toContain('new');
        expect(f.configArgs.parseInput).toHaveBeenCalledWith(
            'ShippingCalculator',
            expect.objectContaining({
                code: 'physical-subtotal-shipping-calculator',
                arguments: expect.arrayContaining([{ name: 'sourceCurrencyCode', value: 'MYR' }]),
            }),
        );
    });

    it('management reads never initialize templates or write settings', async () => {
        const f = fixture();
        await f.service.getShippingTemplateManagement(f.ctx);
        expect(f.settings.set).not.toHaveBeenCalled();
        expect(f.translatable.create).not.toHaveBeenCalled();
    });

    it('lists only this store methods and the explicit public whitelist', async () => {
        const f = fixture();
        f.methods[1].channels.push({ id: '3', code: 'store-c' });
        const management = await f.service.getShippingTemplateManagement(f.ctx);
        expect(management.items.map(item => item.method.id)).toEqual(['shared', 'own', 'legacy']);
        expect(management.items.find(item => item.method.id === 'legacy')?.ownedByStore).toBe(false);
        expect(management.missingPlatformTemplates).toBe(0);
        expect(management.items.find(item => item.method.id === 'shared')?.assignedStoreChannels).toEqual([
            { id: '2', code: 'store-b' },
        ]);
    });

    it('blocks a directly submitted disabled method ID, not just eligible listings', async () => {
        const f = fixture({ disabled: ['own'] });
        const test = vi.fn().mockResolvedValue(true);
        f.methods[0].test = test;
        const calculator = new ShippingCalculator(f.service);
        await expect(calculator.getMethodIfEligible(f.ctx, {} as any, 'own')).resolves.toBeUndefined();
        expect(test).not.toHaveBeenCalled();
        await f.service.setMyShippingTemplateEnabled(f.ctx, 'own', true);
        await expect(calculator.getMethodIfEligible(f.ctx, {} as any, 'own')).resolves.toMatchObject({
            id: 'own',
        });
    });

    it('copies public templates into disabled private templates with store currency', async () => {
        const f = fixture({ owned: [] });
        await f.service.copyPlatformShippingTemplate(f.ctx, 'shared', '本店包邮');
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY)).toEqual({
            ownedIds: ['new'],
            disabledIds: ['new'],
            sourceCurrencyCodes: { own: 'CNY', new: 'MYR' },
        });
        expect(f.translatable.create.mock.calls[0][0].input.translations[0].name).toBe('本店包邮');
        expect(f.channels.assignToChannels).not.toHaveBeenCalled();
    });

    it('serializes optional destination and delivery-day defaults when adapting a legacy local method', async () => {
        const f = fixture();
        const created = await f.service.create(f.ctx, {
            code: 'local-adapted',
            fulfillmentHandler: 'manual-fulfillment',
            translations: [],
            checker: {
                code: 'default-shipping-eligibility-checker',
                arguments: [{ name: 'orderMinimum', value: '0' }],
            },
            calculator: { code: 'default-shipping-calculator', arguments: [{ name: 'rate', value: '500' }] },
        });
        expect(created.checker).toEqual({
            code: 'store-shipping-zone-eligibility-checker',
            args: [
                { name: 'allowedCountryCodes', value: '' },
                { name: 'blockedPostalPrefixes', value: '' },
            ],
        });
        expect(created.calculator.args).toEqual(
            expect.arrayContaining([
                { name: 'baseRate', value: '500' },
                { name: 'estimateMinDays', value: '1' },
                { name: 'estimateMaxDays', value: '3' },
                { name: 'sourceCurrencyCode', value: 'MYR' },
            ]),
        );
    });

    it('retains explicit country, postal and delivery-day restrictions during local normalization', async () => {
        const f = fixture();
        const created = await f.service.create(f.ctx, {
            code: 'local-restricted',
            fulfillmentHandler: 'manual-fulfillment',
            translations: [],
            checker: {
                code: 'supported-destination-eligibility-checker',
                arguments: [
                    { name: 'allowedCountryCodes', value: 'GB' },
                    { name: 'blockedPostalPrefixes', value: 'XX' },
                ],
            },
            calculator: {
                code: 'physical-subtotal-shipping-calculator',
                arguments: [
                    { name: 'baseRate', value: '500' },
                    { name: 'freeAbove', value: '0' },
                    { name: 'estimateMinDays', value: '4' },
                    { name: 'estimateMaxDays', value: '8' },
                ],
            },
        });
        expect(created.checker.args).toEqual([
            { name: 'allowedCountryCodes', value: 'GB' },
            { name: 'blockedPostalPrefixes', value: 'XX' },
        ]);
        expect(created.calculator.args).toEqual(
            expect.arrayContaining([
                { name: 'estimateMinDays', value: '4' },
                { name: 'estimateMaxDays', value: '8' },
            ]),
        );
    });

    it('does not report a successful toggle when persistence fails', async () => {
        const f = fixture();
        f.settings.set.mockResolvedValue({ result: false });
        await expect(f.service.setMyShippingTemplateEnabled(f.ctx, 'own', false)).rejects.toThrow('保存失败');
    });

    it('keeps published public versions immutable even for a platform SuperAdmin', async () => {
        const f = fixture({ platform: true });
        await expect(
            f.service.update(f.ctx, {
                id: 'shared',
                calculator: {
                    code: 'default-shipping-calculator',
                    arguments: [{ name: 'rate', value: '9000' }],
                },
                checker: { code: 'default-shipping-eligibility-checker', arguments: [] },
            }),
        ).rejects.toThrow('不可直接修改');
        await expect(f.service.softDelete(f.ctx, 'shared')).rejects.toThrow('不可删除');
        expect(f.translatable.update).not.toHaveBeenCalled();
    });

    it('publishes an immutable new free version without changing any store selection', async () => {
        const f = fixture({ platform: true });
        const before = structuredClone(f.values.get(STORE_SHIPPING_METHODS_KEY));
        await f.service.createPlatformFreeShippingVersion(f.ctx);
        expect(f.values.get(PLATFORM_SHIPPING_TEMPLATES_KEY)).toEqual({
            freeShippingId: 'new',
            versions: [
                { id: 'shared', version: 1 },
                { id: 'new', version: 2 },
            ],
        });
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY)).toEqual(before);
        expect(f.channels.assignToChannels).not.toHaveBeenCalled();
        expect(f.channels.removeFromChannels).not.toHaveBeenCalled();
        expect(f.methods.find(method => method.id === 'shared')?.calculator.args).toEqual([]);
    });

    it('adopts a new public version only on an explicit store action and keeps private ownership', async () => {
        const f = fixture();
        f.values.set(PLATFORM_SHIPPING_TEMPLATES_KEY, {
            freeShippingId: 'legacy',
            versions: [
                { id: 'shared', version: 1 },
                { id: 'legacy', version: 2 },
            ],
        });
        const management = await f.service.getShippingTemplateManagement(f.ctx);
        expect(management.latestPlatformVersion).toBe(2);
        expect(f.settings.set).not.toHaveBeenCalled();
        await f.service.setMyShippingTemplateEnabled(f.ctx, 'legacy', true);
        expect(f.channels.removeFromChannels).toHaveBeenCalledWith(f.ctx, expect.anything(), 'shared', ['2']);
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY)).toEqual({
            ownedIds: ['own'],
            disabledIds: ['shared'],
            sourceCurrencyCodes: { own: 'CNY' },
            adoptedTemplateId: 'legacy',
        });
    });

    it('lets the platform explicitly confirm a single-store legacy owner without changing amounts', async () => {
        const f = fixture({ platform: true });
        const originalAmounts = structuredClone(f.methods[2].calculator.args);
        await f.service.confirmLegacyShippingMethodOwnership(f.ctx, 'legacy', '2', 'CNY');
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY).ownedIds).toContain('legacy');
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY).sourceCurrencyCodes.legacy).toBe('CNY');
        expect(f.methods[2].calculator.args).toEqual([
            ...originalAmounts,
            { name: 'sourceCurrencyCode', value: 'CNY' },
        ]);
        expect(f.settings.set).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: '2' }),
            STORE_SHIPPING_METHODS_KEY,
            expect.anything(),
        );
    });

    it('rejects forged store selection, multi-store claiming, and any existing ownership', async () => {
        const f = fixture({ platform: true });
        await expect(
            f.service.confirmLegacyShippingMethodOwnership(f.ctx, 'legacy', '3', 'CNY'),
        ).rejects.toThrow('唯一关联');
        f.methods[2].channels.push({ id: '3', code: 'store-c' });
        await expect(
            f.service.confirmLegacyShippingMethodOwnership(f.ctx, 'legacy', '2', 'CNY'),
        ).rejects.toThrow('多店共享');
        f.methods[2].channels.pop();
        f.ownershipEntries.push({ scope: 'channel:3', value: { ownedIds: ['legacy'] } });
        await expect(
            f.service.confirmLegacyShippingMethodOwnership(f.ctx, 'legacy', '2', 'CNY'),
        ).rejects.toThrow('已有明确维护归属');
        expect(f.settings.set).not.toHaveBeenCalled();
    });

    it('does not allow a store to confirm legacy ownership even for a SuperAdmin', async () => {
        const f = fixture();
        await expect(
            f.service.confirmLegacyShippingMethodOwnership(f.ctx, 'legacy', '2', 'CNY'),
        ).rejects.toThrow('平台管理中心');
    });

    it('copies associated legacy amounts in their recorded source currency and starts disabled', async () => {
        const f = fixture({ currency: 'MYR' });
        const before = structuredClone(f.methods[2]);
        await f.service.copyLegacyShippingMethod(f.ctx, 'legacy', 'CNY');
        expect(f.methods[2]).toEqual(before);
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY).sourceCurrencyCodes.new).toBe('CNY');
        expect(f.values.get(STORE_SHIPPING_METHODS_KEY).disabledIds).toContain('new');
        expect(f.configArgs.parseInput).toHaveBeenCalledWith(
            'ShippingCalculator',
            expect.objectContaining({
                arguments: [
                    { name: 'baseRate', value: '1000' },
                    { name: 'freeAbove', value: '4000' },
                    { name: 'estimateMinDays', value: '1' },
                    { name: 'estimateMaxDays', value: '3' },
                    { name: 'sourceCurrencyCode', value: 'CNY' },
                ],
            }),
        );
    });

    it('rejects unknown amounts, currency reinterpretation, and copying an unassociated method', async () => {
        const f = fixture();
        await expect(f.service.copyLegacyShippingMethod(f.ctx, 'legacy', 'MYR')).rejects.toThrow('不一致');
        await expect(f.service.copyLegacyShippingMethod(f.ctx, 'other', 'CNY')).rejects.toThrow();
        f.methods[2].calculator.args = [];
        await expect(f.service.copyLegacyShippingMethod(f.ctx, 'legacy', 'CNY')).rejects.toThrow(
            '金额无法确认',
        );
        expect(f.translatable.create).not.toHaveBeenCalled();
    });

    it('rejects platform initialization from a store or Shop API', async () => {
        const f = fixture();
        await expect(f.service.initializePlatformShippingTemplates(f.ctx)).rejects.toThrow('平台管理中心');
        await expect(
            f.service.initializePlatformShippingTemplates({ ...f.ctx, apiType: 'shop' }),
        ).rejects.toThrow('管理后台');
    });

    it('registers only readonly settings with isolated channel state', async () => {
        const f = fixture();
        f.repo.find.mockResolvedValue([]);
        (f.service as any).connection.rawConnection.getRepository = () => f.repo;
        await f.service.initShippingMethods();
        const fields = f.settings.register.mock.calls[0][0].fields;
        expect(fields.every((field: any) => field.readonly)).toBe(true);
        expect(fields[1].scope({ ctx: f.ctx })).toBe('channel:2');
    });

    it('provides just free shipping, without any preset threshold', () => {
        expect(PLATFORM_SHIPPING_TEMPLATE_INPUTS).toHaveLength(1);
        expect(PLATFORM_SHIPPING_TEMPLATE_INPUTS[0].input.translations[0].name).toBe('包邮');
        expect(PLATFORM_SHIPPING_TEMPLATE_INPUTS[0].input.checker.code).toBe(
            'store-shipping-zone-eligibility-checker',
        );
        expect(JSON.stringify(PLATFORM_SHIPPING_TEMPLATE_INPUTS)).not.toContain('200');
    });
});

describe('shipping template management with real channel membership SQL', () => {
    const idColumn = { type: Number, primary: true } as const;
    const entities = [
        new EntitySchema<Channel>({
            name: 'Channel',
            target: Channel,
            columns: {
                id: idColumn,
                code: { type: String },
                defaultCurrencyCode: { type: String },
            },
            relations: {
                shippingMethods: {
                    type: 'many-to-many',
                    target: 'ShippingMethod',
                    inverseSide: 'channels',
                },
            },
        }),
        new EntitySchema<ShippingMethod>({
            name: 'ShippingMethod',
            target: ShippingMethod,
            columns: {
                id: idColumn,
                code: { type: String },
                deletedAt: { type: Date, nullable: true },
                checker: { type: 'simple-json' },
                calculator: { type: 'simple-json' },
                fulfillmentHandlerCode: { type: String },
            },
            relations: {
                channels: {
                    type: 'many-to-many',
                    target: 'Channel',
                    inverseSide: 'shippingMethods',
                    joinTable: true,
                },
                translations: {
                    type: 'one-to-many',
                    target: 'ShippingMethodTranslation',
                    inverseSide: 'base',
                    eager: true,
                },
            },
        }),
        new EntitySchema<ShippingMethodTranslation>({
            name: 'ShippingMethodTranslation',
            target: ShippingMethodTranslation,
            columns: {
                id: idColumn,
                languageCode: { type: String },
                name: { type: String },
                description: { type: String },
            },
            relations: {
                base: { type: 'many-to-one', target: 'ShippingMethod', inverseSide: 'translations' },
            },
        }),
        new EntitySchema<SettingsStoreEntry>({
            name: 'SettingsStoreEntry',
            target: SettingsStoreEntry,
            columns: {
                id: idColumn,
                key: { type: String },
                scope: { type: String },
                value: { type: 'simple-json' },
            },
        }),
    ];
    let db: DataSource;
    let service: ShippingMethodService;
    let settings: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
    const applyAccessControl = vi.fn();
    const statements: string[] = [];

    const context = (channel: Channel, superAdmin = false, apiType: 'admin' | 'shop' = 'admin') =>
        new RequestContext({
            apiType,
            channel,
            languageCode: LanguageCode.zh_Hans,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
            session: {
                user: {
                    channelPermissions: [
                        {
                            id: channel.id,
                            permissions: [
                                Permission.ReadShippingMethod,
                                ...(superAdmin ? [Permission.SuperAdmin] : []),
                            ],
                        },
                    ],
                },
            } as any,
        });
    const ids = (management: Awaited<ReturnType<ShippingMethodService['getShippingTemplateManagement']>>) =>
        management.items.map(item => Number(item.method.id)).sort((a, b) => a - b);
    const databaseSnapshot = async () =>
        JSON.stringify({
            methods: (
                await db.getRepository(ShippingMethod).find({ relations: ['channels'], order: { id: 'ASC' } })
            ).map(method => ({
                id: method.id,
                code: method.code,
                deletedAt: method.deletedAt,
                calculator: method.calculator,
                checker: method.checker,
                fulfillmentHandlerCode: method.fulfillmentHandlerCode,
                channels: method.channels.map(channel => channel.id).sort(),
                translations: method.translations.map(translation => ({
                    languageCode: translation.languageCode,
                    name: translation.name,
                    description: translation.description,
                })),
            })),
            settings: await db.getRepository(SettingsStoreEntry).find({ order: { id: 'ASC' } }),
        });

    beforeEach(async () => {
        statements.length = 0;
        applyAccessControl.mockReset();
        await ensureConfigLoaded();
        db = await new DataSource({
            type: 'sqljs',
            entities,
            synchronize: true,
            logging: ['query'],
            logger: {
                logQuery: query => statements.push(query),
                logQueryError: () => undefined,
                logQuerySlow: () => undefined,
                logSchemaBuild: () => undefined,
                logMigration: () => undefined,
                log: () => undefined,
            },
        }).initialize();
        await db.getRepository(Channel).save([
            { id: 1, code: '__default_channel__', defaultCurrencyCode: CurrencyCode.MYR },
            { id: 2, code: 'store-a', defaultCurrencyCode: CurrencyCode.MYR },
            { id: 3, code: 'store-b', defaultCurrencyCode: CurrencyCode.CNY },
        ]);
        const memberships = new Map([
            [10, [1]],
            [11, [1, 2, 3]],
            [12, [2]],
            [13, [3]],
            [14, [2, 3]],
            [15, [2]],
            [16, [2]],
            [17, []],
            [18, [2]],
        ]);
        for (const [id, channelIds] of memberships) {
            await db.getRepository(ShippingMethod).save({
                id,
                code: `shipping-${id}`,
                deletedAt: id === 16 ? new Date('2026-01-01T00:00:00Z') : null,
                checker: { code: 'store-shipping-zone-eligibility-checker', args: [] },
                calculator: {
                    code: 'default-shipping-calculator',
                    args: [{ name: 'rate', value: id === 12 ? '0' : '5000' }],
                },
                fulfillmentHandlerCode: 'manual-fulfillment',
                channels: channelIds.map(channelId => ({ id: channelId })),
            });
            await db.getRepository(ShippingMethodTranslation).save({
                id,
                languageCode: 'zh_Hans',
                name: `配送 ${id}`,
                description: `原说明 ${id}`,
                base: { id },
            });
        }
        await db.getRepository(SettingsStoreEntry).save([
            { id: 1, key: PLATFORM_SHIPPING_TEMPLATES_KEY, scope: '', value: { freeShippingId: '11' } },
            { id: 2, key: STORE_SHIPPING_METHODS_KEY, scope: 'channel:1', value: {} },
            {
                id: 3,
                key: STORE_SHIPPING_METHODS_KEY,
                scope: 'channel:2',
                value: {
                    ownedIds: ['15', '18'],
                    disabledIds: ['18'],
                    sourceCurrencyCodes: { '15': 'MYR', '18': 'MYR' },
                },
            },
            { id: 4, key: STORE_SHIPPING_METHODS_KEY, scope: 'channel:3', value: {} },
        ]);
        const config = {
            authOptions: {
                entityAccessControlStrategy: { platformStoreGovernance: true, applyAccessControl },
            },
            customFields: {},
            apiOptions: { adminListQueryLimit: 100, shopListQueryLimit: 100 },
        } as unknown as ConfigService;
        const connection = new TransactionalConnection(db, new TransactionWrapper(), config);
        settings = {
            get: vi.fn(async (ctx, key: string) => {
                const entry = await db.getRepository(SettingsStoreEntry).findOneBy({
                    key,
                    scope: key === PLATFORM_SHIPPING_TEMPLATES_KEY ? '' : `channel:${ctx.channelId}`,
                });
                return entry?.value;
            }),
            set: vi.fn(() => {
                throw new Error('management reads must not write settings');
            }),
        };
        service = new ShippingMethodService(
            connection,
            config,
            {} as any,
            new ListQueryBuilder(connection, config),
            { getDefaultChannel: () => db.getRepository(Channel).findOneByOrFail({ id: 1 }) } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { translate: (method: ShippingMethod) => method } as any,
            settings as any,
        );
    });

    afterEach(async () => {
        if (db?.isInitialized) await db.destroy();
    });

    it('exposes operating-store unclaimed originals to the platform SuperAdmin without changing stored rules', async () => {
        const before = await databaseSnapshot();
        const platform = await db.getRepository(Channel).findOneByOrFail({ id: 1 });
        const management = await service.getShippingTemplateManagement(context(platform, true));
        expect(ids(management)).toEqual([10, 11, 12, 13, 14]);
        expect(management.items.find(item => Number(item.method.id) === 12)?.assignedStoreChannels).toEqual([
            { id: 2, code: 'store-a' },
        ]);
        expect(management.items.find(item => Number(item.method.id) === 14)?.assignedStoreChannels).toEqual([
            { id: 2, code: 'store-a' },
            { id: 3, code: 'store-b' },
        ]);
        expect(statements.some(query => query.includes('lqb__channel') && query.includes('INNER JOIN'))).toBe(
            true,
        );
        expect(statements.some(query => query.includes('legacyOperatingChannel'))).toBe(true);
        expect(await databaseSnapshot()).toBe(before);
        expect(settings.set).not.toHaveBeenCalled();
    });

    it('does not expand the platform list for an ordinary administrator with existing read permission', async () => {
        const platform = await db.getRepository(Channel).findOneByOrFail({ id: 1 });
        expect(ids(await service.getShippingTemplateManagement(context(platform)))).toEqual([10, 11]);
        expect(statements.some(query => query.includes('legacyOperatingChannel'))).toBe(false);
    });

    it.each([false, true])('keeps operating-store membership even when SuperAdmin=%s', async superAdmin => {
        const store = await db.getRepository(Channel).findOneByOrFail({ id: 2 });
        const management = await service.getShippingTemplateManagement(context(store, superAdmin));
        expect(ids(management)).toEqual([11, 12, 14, 15, 18]);
        expect(management.items.find(item => Number(item.method.id) === 11)?.assignedStoreChannels).toEqual([
            { id: 2, code: 'store-a' },
        ]);
        expect(management.items.find(item => Number(item.method.id) === 18)?.enabled).toBe(false);
        expect(management.items.find(item => Number(item.method.id) === 15)?.ownedByStore).toBe(true);
        expect(statements.some(query => query.includes('legacyOperatingChannel'))).toBe(false);
    });

    it('keeps the other operating-store membership separate', async () => {
        const store = await db.getRepository(Channel).findOneByOrFail({ id: 3 });
        expect(ids(await service.getShippingTemplateManagement(context(store)))).toEqual([11, 13, 14]);
        expect(statements.some(query => query.includes('legacyOperatingChannel'))).toBe(false);
    });

    it('retains the configured row access hook on the extra platform query', async () => {
        applyAccessControl.mockImplementation((query, entity) => {
            if (entity === ShippingMethod) {
                query.andWhere(`${query.alias}.id <> :blockedMethodId`, { blockedMethodId: 12 });
            }
        });
        const platform = await db.getRepository(Channel).findOneByOrFail({ id: 1 });
        expect(ids(await service.getShippingTemplateManagement(context(platform, true)))).toEqual([
            10, 11, 13, 14,
        ]);
        expect(applyAccessControl.mock.calls.some(([query]) => query.alias === 'legacyShippingMethod')).toBe(
            true,
        );
    });

    it('rejects Shop API access even for a platform SuperAdmin', async () => {
        const platform = await db.getRepository(Channel).findOneByOrFail({ id: 1 });
        await expect(service.getShippingTemplateManagement(context(platform, true, 'shop'))).rejects.toThrow(
            '管理后台',
        );
    });
});
