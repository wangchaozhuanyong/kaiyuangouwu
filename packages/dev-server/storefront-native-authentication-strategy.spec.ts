import { NativeAuthenticationStrategy, RequestContext, User, UserService } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    STOREFRONT_ACCOUNT_NOT_FOUND,
    STOREFRONT_INVALID_PASSWORD,
    StorefrontNativeAuthenticationStrategy,
} from './storefront-native-authentication-strategy';

const credentials = { username: 'customer@example.com', password: 'test-password' };
const ctx = {} as RequestContext;

afterEach(() => {
    vi.restoreAllMocks();
});

function strategyWithAccount(account?: User) {
    const strategy = new StorefrontNativeAuthenticationStrategy();
    const getUserByEmailAddress = vi.fn().mockResolvedValue(account);
    Object.assign(strategy, {
        storefrontUserService: { getUserByEmailAddress } as Pick<UserService, 'getUserByEmailAddress'>,
    });
    return { strategy, getUserByEmailAddress };
}

describe('StorefrontNativeAuthenticationStrategy', () => {
    it('returns the authenticated user without running a second lookup', async () => {
        const user = { id: 'customer-user-1' } as User;
        vi.spyOn(NativeAuthenticationStrategy.prototype, 'authenticate').mockResolvedValue(user);
        const { strategy, getUserByEmailAddress } = strategyWithAccount();

        await expect(strategy.authenticate(ctx, credentials)).resolves.toBe(user);
        expect(getUserByEmailAddress).not.toHaveBeenCalled();
    });

    it('reports an unknown account separately from a wrong password', async () => {
        const account = { id: 'customer-user-1' } as User;
        vi.spyOn(NativeAuthenticationStrategy.prototype, 'authenticate').mockResolvedValue(false);

        const missingAccount = strategyWithAccount();
        await expect(missingAccount.strategy.authenticate(ctx, credentials)).resolves.toBe(
            STOREFRONT_ACCOUNT_NOT_FOUND,
        );

        const existingAccount = strategyWithAccount(account);
        await expect(existingAccount.strategy.authenticate(ctx, credentials)).resolves.toBe(
            STOREFRONT_INVALID_PASSWORD,
        );
    });
});
