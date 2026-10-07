import {
    NativeAuthenticationStrategy,
    RequestContext,
    RequestContextService,
    SettingsStoreService,
    User,
} from '@vendure/core';
import { storefrontAuthSettingKeys } from '@vendure/storefront-content-plugin';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    STOREFRONT_INVALID_CREDENTIALS,
    StorefrontNativeAuthenticationStrategy,
} from './storefront-native-authentication-strategy';

const credentials = { username: 'customer@example.com', password: 'test-password' };
function shopCtx(id: string) {
    return {
        apiType: 'shop',
        channelId: id,
        channel: { id, code: id },
        languageCode: 'zh_Hans',
        currencyCode: 'CNY',
    } as RequestContext;
}
const ctx = shopCtx('channel-1');

async function setup(values: Record<string, unknown> = {}) {
    const settingsStore = { getMany: vi.fn().mockResolvedValue(values) };
    const freshContexts: RequestContext[] = [];
    const requestContextService = {
        create: vi.fn(
            (options: {
                channelOrToken: { id: string };
                apiType: string;
                languageCode: string;
                currencyCode: string;
            }) => {
                const fresh: any = {
                    apiType: options.apiType,
                    channel: options.channelOrToken,
                    channelId: options.channelOrToken.id,
                    languageCode: options.languageCode,
                    currencyCode: options.currencyCode,
                    setReplicationMode: vi.fn((mode: string) => {
                        fresh.replicationMode = mode;
                    }),
                };
                freshContexts.push(fresh);
                return Promise.resolve(fresh);
            },
        ),
    };
    const injector = {
        get(token: unknown) {
            if (token === SettingsStoreService) return settingsStore;
            if (token === RequestContextService) return requestContextService;
            throw new Error('Unexpected dependency');
        },
    };
    vi.spyOn(NativeAuthenticationStrategy.prototype, 'init').mockResolvedValue(undefined);
    const strategy = new StorefrontNativeAuthenticationStrategy();
    await strategy.init(injector as never);
    return { strategy, settingsStore, requestContextService, freshContexts };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('StorefrontNativeAuthenticationStrategy', () => {
    it('returns the authenticated user when the current store enables email/password', async () => {
        const user = { id: 'customer-user-1' } as User;
        const authenticate = vi
            .spyOn(NativeAuthenticationStrategy.prototype, 'authenticate')
            .mockResolvedValue(user);
        const { strategy, settingsStore, requestContextService, freshContexts } = await setup({
            [storefrontAuthSettingKeys.emailPasswordEnabled]: true,
        });

        await expect(strategy.authenticate(ctx, credentials)).resolves.toBe(user);
        expect(settingsStore.getMany).toHaveBeenCalledWith(
            freshContexts[0],
            Object.values(storefrontAuthSettingKeys),
        );
        expect(requestContextService.create).toHaveBeenCalledWith({
            apiType: 'shop',
            channelOrToken: ctx.channel,
            languageCode: ctx.languageCode,
            currencyCode: ctx.currencyCode,
        });
        expect(freshContexts[0]).not.toBe(ctx);
        expect(Reflect.get(freshContexts[0], 'setReplicationMode')).toHaveBeenCalledWith('master');
        expect(authenticate).toHaveBeenCalledWith(ctx, credentials);
    });

    it('uses the same result for every invalid username or password', async () => {
        vi.spyOn(NativeAuthenticationStrategy.prototype, 'authenticate').mockResolvedValue(false);
        const { strategy } = await setup();

        await expect(strategy.authenticate(ctx, credentials)).resolves.toBe(STOREFRONT_INVALID_CREDENTIALS);
    });

    it('rejects email/password authentication before checking credentials when the store disables it', async () => {
        const authenticate = vi.spyOn(NativeAuthenticationStrategy.prototype, 'authenticate');
        const { strategy } = await setup({ [storefrontAuthSettingKeys.emailPasswordEnabled]: false });

        await expect(strategy.authenticate(ctx, credentials)).resolves.toBe(STOREFRONT_INVALID_CREDENTIALS);
        expect(authenticate).not.toHaveBeenCalled();
    });

    it('keeps email/password enabled for stores without a saved setting', async () => {
        const user = { id: 'customer-user-1' } as User;
        vi.spyOn(NativeAuthenticationStrategy.prototype, 'authenticate').mockResolvedValue(user);
        const { strategy } = await setup();

        await expect(strategy.authenticate(ctx, credentials)).resolves.toBe(user);
    });

    it('does not apply the current store setting to Admin authentication', async () => {
        const user = { id: 'administrator-user-1' } as User;
        const authenticate = vi
            .spyOn(NativeAuthenticationStrategy.prototype, 'authenticate')
            .mockResolvedValue(user);
        const { strategy, settingsStore, requestContextService } = await setup({
            [storefrontAuthSettingKeys.emailPasswordEnabled]: false,
        });
        const adminCtx = { apiType: 'admin', channelId: 'channel-1' } as RequestContext;

        await expect(strategy.authenticate(adminCtx, credentials)).resolves.toBe(user);
        expect(settingsStore.getMany).not.toHaveBeenCalled();
        expect(requestContextService.create).not.toHaveBeenCalled();
        expect(authenticate).toHaveBeenCalledWith(adminCtx, credentials);
    });

    it('reads the request channel for every login rather than reusing another store setting', async () => {
        const user = { id: 'customer-user-1' } as User;
        const authenticate = vi
            .spyOn(NativeAuthenticationStrategy.prototype, 'authenticate')
            .mockResolvedValue(user);
        const { strategy, settingsStore, freshContexts } = await setup();
        const otherCtx = shopCtx('channel-2');
        settingsStore.getMany.mockImplementation((requestCtx: RequestContext) =>
            Promise.resolve({
                [storefrontAuthSettingKeys.emailPasswordEnabled]: requestCtx.channelId === otherCtx.channelId,
            }),
        );

        await expect(strategy.authenticate(ctx, credentials)).resolves.toBe(STOREFRONT_INVALID_CREDENTIALS);
        await expect(strategy.authenticate(otherCtx, credentials)).resolves.toBe(user);
        expect(settingsStore.getMany).toHaveBeenNthCalledWith(
            1,
            freshContexts[0],
            Object.values(storefrontAuthSettingKeys),
        );
        expect(settingsStore.getMany).toHaveBeenNthCalledWith(
            2,
            freshContexts[1],
            Object.values(storefrontAuthSettingKeys),
        );
        expect(authenticate).toHaveBeenCalledTimes(1);
        expect(authenticate).toHaveBeenCalledWith(otherCtx, credentials);
    });

    it('uses fresh settings for sequential logins on the same strategy instance', async () => {
        const user = { id: 'customer-user-1' } as User;
        const authenticate = vi
            .spyOn(NativeAuthenticationStrategy.prototype, 'authenticate')
            .mockResolvedValue(user);
        const { strategy, settingsStore, freshContexts } = await setup();
        const nextCtx = shopCtx(String(ctx.channelId));
        const otherCtx = shopCtx('channel-2');
        settingsStore.getMany
            .mockResolvedValueOnce({ [storefrontAuthSettingKeys.emailPasswordEnabled]: false })
            .mockResolvedValueOnce({ [storefrontAuthSettingKeys.emailPasswordEnabled]: true })
            .mockResolvedValueOnce({ [storefrontAuthSettingKeys.emailPasswordEnabled]: false });

        await expect(strategy.authenticate(ctx, credentials)).resolves.toBe(STOREFRONT_INVALID_CREDENTIALS);
        await expect(strategy.authenticate(nextCtx, credentials)).resolves.toBe(user);
        await expect(strategy.authenticate(otherCtx, credentials)).resolves.toBe(
            STOREFRONT_INVALID_CREDENTIALS,
        );
        expect(settingsStore.getMany).toHaveBeenCalledTimes(3);
        for (const [index, requestCtx] of [ctx, nextCtx, otherCtx].entries()) {
            expect(settingsStore.getMany).toHaveBeenNthCalledWith(
                index + 1,
                freshContexts[index],
                Object.values(storefrontAuthSettingKeys),
            );
            expect(freshContexts[index]).not.toBe(requestCtx);
            expect(freshContexts[index].channelId).toBe(requestCtx.channelId);
            expect(Reflect.get(freshContexts[index], 'setReplicationMode')).toHaveBeenCalledWith('master');
        }
        expect(authenticate).toHaveBeenCalledTimes(1);
        expect(authenticate).toHaveBeenCalledWith(nextCtx, credentials);
    });

    it('does not authenticate when the store setting cannot be read', async () => {
        const authenticate = vi.spyOn(NativeAuthenticationStrategy.prototype, 'authenticate');
        const { strategy, settingsStore } = await setup();
        settingsStore.getMany.mockRejectedValue(new Error('Settings unavailable'));

        await expect(strategy.authenticate(ctx, credentials)).rejects.toThrow('Settings unavailable');
        expect(authenticate).not.toHaveBeenCalled();
    });

    it('reads the closed master setting outside the original repeatable-read/slave context', async () => {
        const authenticate = vi.spyOn(NativeAuthenticationStrategy.prototype, 'authenticate');
        const { strategy, settingsStore, freshContexts } = await setup();
        const staleCtx = {
            ...ctx,
            replicationMode: 'slave',
            _transactionManager: { snapshot: 'enabled-before-close' },
        } as unknown as RequestContext;
        settingsStore.getMany.mockImplementation((settingsCtx: any) =>
            Promise.resolve({
                [storefrontAuthSettingKeys.emailPasswordEnabled]:
                    settingsCtx.replicationMode !== 'master' || !!settingsCtx._transactionManager,
            }),
        );
        await expect(strategy.authenticate(staleCtx, credentials)).resolves.toBe(
            STOREFRONT_INVALID_CREDENTIALS,
        );
        expect(freshContexts[0]).not.toBe(staleCtx);
        expect((freshContexts[0] as any)._transactionManager).toBeUndefined();
        expect(settingsStore.getMany).toHaveBeenCalledWith(
            freshContexts[0],
            Object.values(storefrontAuthSettingKeys),
        );
        expect(authenticate).not.toHaveBeenCalled();
    });

    it('fails closed when the fresh settings context cannot be created', async () => {
        const authenticate = vi.spyOn(NativeAuthenticationStrategy.prototype, 'authenticate');
        const { strategy, requestContextService, settingsStore } = await setup();
        requestContextService.create.mockRejectedValue(new Error('Master context unavailable'));
        await expect(strategy.authenticate(ctx, credentials)).rejects.toThrow('Master context unavailable');
        expect(settingsStore.getMany).not.toHaveBeenCalled();
        expect(authenticate).not.toHaveBeenCalled();
    });

    it('keeps password confirmation available when storefront login is disabled', async () => {
        const verifyUserPassword = vi
            .spyOn(NativeAuthenticationStrategy.prototype, 'verifyUserPassword')
            .mockResolvedValue(true);
        const { strategy, settingsStore } = await setup({
            [storefrontAuthSettingKeys.emailPasswordEnabled]: false,
        });

        await expect(strategy.verifyUserPassword(ctx, 'customer-user-1', credentials.password)).resolves.toBe(
            true,
        );
        expect(verifyUserPassword).toHaveBeenCalledWith(ctx, 'customer-user-1', credentials.password);
        expect(settingsStore.getMany).not.toHaveBeenCalled();
    });
});
