import { Permission } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { RequestContext } from '@vendure/core';
import { buildSchema, graphql, print } from 'graphql';
import { describe, expect, it, vi } from 'vitest';

import { AdminCapabilitiesResolver } from './admin-capabilities.resolver';
import { adminCapabilitiesSchema } from './admin-capabilities.schema';
import { AdminCapabilitiesService } from './admin-capabilities.service';

function fixture(
    permissions: string[] = [Permission.SuperAdmin],
    code = 'store-a',
    mode: string | null = 'PHYSICAL_ONLY',
) {
    const channel = {
        id: code === DEFAULT_CHANNEL_CODE ? '1' : '2',
        code,
        customFields: { commerceMode: mode },
        defaultShippingZone: { members: [{ enabled: true }] },
    };
    const ctx = {
        apiType: 'admin',
        activeUserId: '9',
        channel,
        channelId: channel.id,
        userHasPermissions: (wanted: string[]) => wanted.some(p => permissions.includes(p)),
    } as unknown as RequestContext;
    const connection = { getEntityOrThrow: vi.fn().mockResolvedValue(channel) };
    const access = { currentForChannel: vi.fn().mockResolvedValue({ scope: 'PLATFORM' }) };
    const commerce = {
        paymentOptions: vi.fn().mockResolvedValue([{ platformEnabled: true, effectiveEnabled: true }]),
        get: vi.fn().mockResolvedValue({ ready: true, countryCode: 'CN', shippingMethodId: '3' }),
    };
    const wallets = {
        status: vi.fn().mockResolvedValue({ configured: true, activeAddress: 'not-in-snapshot' }),
    };
    const notifications = {
        get: vi.fn().mockResolvedValue({ enabled: true, tokenConfigured: true, chatId: 'not-in-snapshot' }),
    };
    const shipping = {
        getActiveShippingMethods: vi
            .fn()
            .mockResolvedValue([{ id: '3', checker: { code: 'store-shipping-zone-eligibility-checker' } }]),
        getShippingTemplateManagement: vi.fn().mockResolvedValue({ items: [{ platformTemplate: true }] }),
    };
    const service = new AdminCapabilitiesService(
        connection as any,
        access as any,
        commerce as any,
        wallets as any,
        notifications as any,
        shipping as any,
    );
    const image = vi.fn().mockResolvedValue({ enabled: true, configured: true });
    service.registerImageReadiness(image);
    return { service, ctx, connection, access, commerce, wallets, notifications, shipping, image, channel };
}
async function status(f: ReturnType<typeof fixture>, id: string) {
    const capability = (await f.service.current(f.ctx)).capabilities.find(item => item.id === id);
    if (!capability) throw new Error(`Missing capability ${id}`);
    return capability;
}

describe('current administrator capabilities', () => {
    it('exposes a read-only authenticated GraphQL field with serializable bootstrap types', async () => {
        const f = fixture([]);
        const resolver = new AdminCapabilitiesResolver(f.service);
        expect(
            Reflect.getMetadata('__permissions__', Reflect.get(resolver, 'currentAdminCapabilities')),
        ).toEqual([Permission.Authenticated]);
        const schema = buildSchema(
            'enum AdministratorAccessScope { PLATFORM STORE } type Query { placeholder: Boolean }\n' +
                print(adminCapabilitiesSchema),
        );
        const result = await graphql({
            schema,
            source: '{ currentAdminCapabilities { channelId channelCode scope commerceMode capabilities { id state canRead canWrite canConfigure } } }',
            rootValue: { currentAdminCapabilities: () => resolver.currentAdminCapabilities(f.ctx) },
        });
        expect(result.errors).toBeUndefined();
        expect(result.data?.currentAdminCapabilities).toMatchObject({
            channelId: '2',
            channelCode: 'store-a',
            scope: 'STORE',
            commerceMode: 'PHYSICAL_ONLY',
        });
    });

    it('restricts SuperAdmin in an operating store by scope and mode', async () => {
        const f = fixture();
        const snapshot = await f.service.current(f.ctx);
        expect(snapshot).toMatchObject({ scope: 'STORE', channelId: '2', commerceMode: 'PHYSICAL_ONLY' });
        expect(snapshot.capabilities.find(c => c.id === '/settings/system-ops/telegram')).toMatchObject({
            state: 'UNSUPPORTED',
            canRead: false,
            canWrite: false,
            canConfigure: false,
        });
        expect(snapshot.capabilities.find(c => c.id === '/catalog/card-pool/pool')?.state).toBe(
            'UNSUPPORTED',
        );
        expect(snapshot.capabilities.find(c => c.id === '/catalog/inventory/all')?.state).toBe('READY');
        expect(f.notifications.get).not.toHaveBeenCalled();
    });

    it('keeps platform templates available without claiming a store mode', async () => {
        const f = fixture([Permission.SuperAdmin], DEFAULT_CHANNEL_CODE, null);
        expect(await status(f, '/settings/store-profile/shipping')).toMatchObject({
            state: 'READY',
            canConfigure: true,
        });
        expect(await status(f, '/catalog/list')).toMatchObject({
            state: 'READY',
            canRead: true,
            canWrite: false,
            canConfigure: false,
        });
        expect((await f.service.current(f.ctx)).commerceMode).toBeNull();
    });

    it('keeps technical prompt rule releases on the platform independently of store AI configuration', async () => {
        const store = fixture();
        store.image.mockResolvedValue({ enabled: false, configured: false });
        expect(await status(store, '/plugins/ai-settings/skills')).toMatchObject({
            state: 'UNSUPPORTED',
            canRead: false,
            canWrite: false,
            canConfigure: false,
        });
        const platform = fixture([Permission.SuperAdmin], DEFAULT_CHANNEL_CODE);
        expect(await status(platform, '/plugins/ai-settings/skills')).toMatchObject({
            state: 'READY',
            canRead: true,
            canWrite: true,
        });
        expect(platform.image).not.toHaveBeenCalled();
    });

    it('fails closed for missing or unknown modes and reads the latest persisted Channel', async () => {
        const f = fixture();
        f.connection.getEntityOrThrow.mockResolvedValueOnce({
            ...f.channel,
            customFields: { commerceMode: null },
        });
        expect(await status(f, '/catalog/inventory/all')).toMatchObject({
            state: 'UNSUPPORTED',
            canRead: false,
        });
        f.connection.getEntityOrThrow.mockResolvedValueOnce({
            ...f.channel,
            customFields: { commerceMode: 'DIGITAL_ONLY' },
        });
        expect(await status(f, '/catalog/card-pool/pool')).toMatchObject({ state: 'READY', canRead: true });
        expect(f.ctx.channel.customFields.commerceMode).toBe('PHYSICAL_ONLY');
    });

    it('uses any read permission, all profit dependencies, and never gives an empty write list', async () => {
        const f = fixture([Permission.ReadOrder]);
        expect(await status(f, '/sales/orders')).toMatchObject({
            state: 'READY',
            canRead: true,
            canWrite: false,
        });
        expect(await status(f, '/sales/profit')).toMatchObject({ state: 'FORBIDDEN', canRead: false });
        expect(await status(f, '/dashboard')).toMatchObject({
            state: 'READY',
            canRead: true,
            canWrite: false,
            canConfigure: false,
        });
        expect(await status(f, '/settings/team/members')).toMatchObject({
            state: 'FORBIDDEN',
            canConfigure: false,
        });
        expect(f.image).not.toHaveBeenCalled();
    });

    it.each([
        [{ enabled: true, configured: false }, 'NEEDS_CONFIGURATION'],
        [{ enabled: false, configured: true }, 'DISABLED'],
    ] as const)('retains configuration and historical AI reads for %j', async (readiness, state) => {
        const f = fixture();
        f.image.mockResolvedValue(readiness);
        const snapshot = await f.service.current(f.ctx);
        for (const id of [
            '/plugins/ai-settings/config',
            '/plugins/ai-settings/jobs',
            '/plugins/ai-settings/usage',
        ]) {
            expect(snapshot.capabilities.find(c => c.id === id)).toMatchObject({
                state,
                canRead: true,
                canWrite: false,
                canConfigure: id === '/plugins/ai-settings/config',
            });
        }
        expect(f.image).toHaveBeenCalledTimes(1);
    });

    it('keeps unconfigured payment, shipping and USDT settings accessible to permitted users', async () => {
        const f = fixture();
        f.commerce.paymentOptions.mockResolvedValue([]);
        f.commerce.get.mockResolvedValue({ ready: false, countryCode: null, shippingMethodId: null });
        f.shipping.getActiveShippingMethods.mockResolvedValue([]);
        f.wallets.status.mockResolvedValue({ configured: false });
        const snapshot = await f.service.current(f.ctx);
        for (const id of [
            '/settings/store-profile/payment',
            '/settings/store-profile/shipping',
            '/settings/store-profile/usdt',
        ]) {
            expect(snapshot.capabilities.find(c => c.id === id)).toMatchObject({
                state: 'NEEDS_CONFIGURATION',
                canRead: true,
                canWrite: false,
                canConfigure: true,
            });
        }
        expect(f.wallets.status).toHaveBeenCalledTimes(1);
    });

    it('accepts active shared shipping templates but requires a ready region and excludes disabled methods', async () => {
        const f = fixture(['ReadStoreProfile']);
        expect(await status(f, '/settings/store-profile/shipping')).toMatchObject({
            state: 'READY',
            canRead: true,
            canWrite: false,
        });
        expect(f.connection.getEntityOrThrow).toHaveBeenCalledWith(f.ctx, expect.anything(), '2', {
            relations: ['defaultShippingZone', 'defaultShippingZone.members'],
        });
        f.shipping.getActiveShippingMethods.mockResolvedValue([]);
        expect(await status(f, '/settings/store-profile/shipping')).toMatchObject({
            state: 'NEEDS_CONFIGURATION',
            canRead: true,
        });
        f.shipping.getActiveShippingMethods.mockResolvedValue([
            { id: '3', checker: { code: 'store-shipping-zone-eligibility-checker' } },
        ]);
        f.connection.getEntityOrThrow.mockResolvedValue({
            ...f.channel,
            defaultShippingZone: { members: [{ enabled: false }] },
        });
        expect(await status(f, '/settings/store-profile/shipping')).toMatchObject({
            state: 'NEEDS_CONFIGURATION',
            canRead: true,
        });
    });

    it('keeps Telegram setup available without publishing addresses or credentials', async () => {
        const f = fixture([Permission.SuperAdmin], DEFAULT_CHANNEL_CODE);
        f.notifications.get.mockResolvedValue({
            enabled: false,
            tokenConfigured: false,
            chatId: 'not-in-snapshot',
        });
        const snapshot = await f.service.current(f.ctx);
        expect(snapshot.capabilities.find(c => c.id === '/settings/system-ops/telegram')).toMatchObject({
            state: 'NEEDS_CONFIGURATION',
            canConfigure: true,
            canWrite: false,
        });
        expect(JSON.stringify(snapshot)).not.toContain('not-in-snapshot');
    });

    it('rejects the entire snapshot on a configuration read failure and can retry fresh', async () => {
        const f = fixture();
        f.image.mockRejectedValueOnce(new Error('private provider details'));
        await expect(f.service.current(f.ctx)).rejects.toThrow('功能配置读取失败，请重试');
        expect(await status(f, '/plugins/ai-settings/config')).toMatchObject({
            state: 'READY',
            canConfigure: true,
        });
        expect(f.image).toHaveBeenCalledTimes(2);
    });

    it('accepts authenticated administrators without ReadCatalog, but rejects non-admin identity or an invalid Channel binding', async () => {
        const f = fixture([]);
        const resolver = new AdminCapabilitiesResolver(f.service);
        expect(
            (await resolver.currentAdminCapabilities(f.ctx)).capabilities.find(c => c.id === '/profile')
                ?.canRead,
        ).toBe(true);
        f.access.currentForChannel.mockRejectedValue(new Error('channel binding denied'));
        await expect(resolver.currentAdminCapabilities(f.ctx)).rejects.toThrow('channel binding denied');
        await expect(f.service.current({ ...f.ctx, apiType: 'shop' } as any)).rejects.toThrow();
        await expect(f.service.current({ ...f.ctx, activeUserId: undefined } as any)).rejects.toThrow();
    });
});
