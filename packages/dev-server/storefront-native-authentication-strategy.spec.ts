import { NativeAuthenticationStrategy, RequestContext, User } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    STOREFRONT_INVALID_CREDENTIALS,
    StorefrontNativeAuthenticationStrategy,
} from './storefront-native-authentication-strategy';

const credentials = { username: 'customer@example.com', password: 'test-password' };
const ctx = {} as RequestContext;

afterEach(() => {
    vi.restoreAllMocks();
});

describe('StorefrontNativeAuthenticationStrategy', () => {
    it('returns the authenticated user', async () => {
        const user = { id: 'customer-user-1' } as User;
        vi.spyOn(NativeAuthenticationStrategy.prototype, 'authenticate').mockResolvedValue(user);
        const strategy = new StorefrontNativeAuthenticationStrategy();

        await expect(strategy.authenticate(ctx, credentials)).resolves.toBe(user);
    });

    it('uses the same result for every invalid username or password', async () => {
        vi.spyOn(NativeAuthenticationStrategy.prototype, 'authenticate').mockResolvedValue(false);
        const strategy = new StorefrontNativeAuthenticationStrategy();

        await expect(strategy.authenticate(ctx, credentials)).resolves.toBe(STOREFRONT_INVALID_CREDENTIALS);
    });
});
