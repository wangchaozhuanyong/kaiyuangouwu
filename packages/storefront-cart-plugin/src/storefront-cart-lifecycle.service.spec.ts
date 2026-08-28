import 'reflect-metadata';

import { Logger } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontCartLifecycleService } from './storefront-cart-lifecycle.service';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('StorefrontCartLifecycleService login merge', () => {
    it('rolls back a failed cart merge without rejecting login', async () => {
        let loginHandler: ((event: any) => Promise<void>) | undefined;
        const eventBus = {
            registerBlockingEventHandler: vi.fn((config: any) => {
                if (config.id === 'storefront-cart-merge-on-login') {
                    loginHandler = config.handler;
                }
            }),
        };
        const mergeError = new Error('cart transaction failed');
        const connection = {
            withTransaction: vi.fn().mockRejectedValue(mergeError),
        };
        const storefrontCartService = {
            mergeAfterLogin: vi.fn(),
        };
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        const service = new StorefrontCartLifecycleService(
            eventBus as any,
            connection as any,
            {} as any,
            storefrontCartService as any,
        );

        service.onApplicationBootstrap();

        expect(loginHandler).toBeDefined();
        if (!loginHandler) {
            throw new Error('Login handler was not registered');
        }
        await expect(
            loginHandler({ ctx: { channelId: 'store-a' }, user: { id: 'user-1' } }),
        ).resolves.toBeUndefined();
        expect(connection.withTransaction).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
            'Cart merge after login failed (cart transaction failed). ' +
                'Login will continue and the cart will be retried on the next interaction.',
            'StorefrontCartLifecycleService',
        );
    });
});
