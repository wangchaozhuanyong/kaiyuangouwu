import { ExternalAuthenticationService, SettingsStoreService } from '@vendure/core';
import { storefrontAuthSettingKeys } from '@vendure/storefront-content-plugin';
import { OAuth2Client } from 'google-auth-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    STOREFRONT_GOOGLE_AUTH_INVALID,
    STOREFRONT_GOOGLE_AUTH_UNAVAILABLE,
    StorefrontGoogleAuthenticationStrategy,
} from './storefront-google-authentication-strategy';

const clientId = '123456789-test.apps.googleusercontent.com';
const ctx = { channelId: 'channel-1' };

function setup(options?: { enabled?: boolean; googleClientId?: string | null }) {
    const externalAuthenticationService = {
        findCustomerUser: vi.fn(),
        createCustomerAndUser: vi.fn(),
    };
    const settingsStore = {
        getMany: vi.fn().mockResolvedValue({
            [storefrontAuthSettingKeys.googleOverrideEnabled]: false,
            [storefrontAuthSettingKeys.platformGoogleEnabled]: options?.enabled ?? true,
            [storefrontAuthSettingKeys.platformGoogleClientId]: options?.googleClientId ?? clientId,
        }),
    };
    const injector = {
        get(token: unknown) {
            if (token === ExternalAuthenticationService) return externalAuthenticationService;
            if (token === SettingsStoreService) return settingsStore;
            throw new Error('Unexpected dependency');
        },
    };
    const strategy = new StorefrontGoogleAuthenticationStrategy();
    strategy.init(injector as never);
    return { strategy, externalAuthenticationService, settingsStore };
}

afterEach(() => vi.restoreAllMocks());

describe('StorefrontGoogleAuthenticationStrategy', () => {
    it('fails closed when inherited Google authentication is not enabled', async () => {
        const { strategy, externalAuthenticationService } = setup({ enabled: false });
        const verify = vi.spyOn(OAuth2Client.prototype, 'verifyIdToken');

        await expect(strategy.authenticate(ctx as never, { credential: 'token' })).resolves.toBe(
            STOREFRONT_GOOGLE_AUTH_UNAVAILABLE,
        );
        expect(verify).not.toHaveBeenCalled();
        expect(externalAuthenticationService.findCustomerUser).not.toHaveBeenCalled();
    });

    it('accepts an inherited platform client ID and reuses the linked customer', async () => {
        const { strategy, externalAuthenticationService } = setup();
        const user = { id: 'user-1' };
        const verify = vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
            getPayload: () => ({
                sub: 'google-user-1',
                email: 'buyer@gmail.com',
                email_verified: true,
                given_name: 'Buyer',
                family_name: 'One',
            }),
        } as never);
        externalAuthenticationService.findCustomerUser.mockResolvedValue(user);

        await expect(strategy.authenticate(ctx as never, { credential: 'signed-token' })).resolves.toBe(user);
        expect(verify).toHaveBeenCalledWith({
            idToken: 'signed-token',
            audience: clientId,
        });
        expect(externalAuthenticationService.findCustomerUser).toHaveBeenCalledWith(
            ctx,
            'google',
            'google-user-1',
        );
        expect(externalAuthenticationService.createCustomerAndUser).not.toHaveBeenCalled();
    });

    it('creates or safely links a customer from verified Google identity claims', async () => {
        const { strategy, externalAuthenticationService } = setup();
        const created = { id: 'user-2' };
        vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
            getPayload: () => ({
                sub: 'google-user-2',
                email: 'new@gmail.com',
                email_verified: true,
                given_name: 'New',
                family_name: 'Customer',
            }),
        } as never);
        externalAuthenticationService.findCustomerUser.mockResolvedValue(undefined);
        externalAuthenticationService.createCustomerAndUser.mockResolvedValue(created);

        await expect(strategy.authenticate(ctx as never, { credential: 'signed-token' })).resolves.toBe(
            created,
        );
        expect(externalAuthenticationService.createCustomerAndUser).toHaveBeenCalledWith(ctx, {
            strategy: 'google',
            externalIdentifier: 'google-user-2',
            verified: true,
            emailAddress: 'new@gmail.com',
            firstName: 'New',
            lastName: 'Customer',
        });
    });

    it('rejects an unverified email claim without touching customer records', async () => {
        const { strategy, externalAuthenticationService } = setup();
        vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
            getPayload: () => ({
                sub: 'google-user-3',
                email: 'unverified@gmail.com',
                email_verified: false,
            }),
        } as never);

        await expect(strategy.authenticate(ctx as never, { credential: 'signed-token' })).resolves.toBe(
            STOREFRONT_GOOGLE_AUTH_INVALID,
        );
        expect(externalAuthenticationService.findCustomerUser).not.toHaveBeenCalled();
        expect(externalAuthenticationService.createCustomerAndUser).not.toHaveBeenCalled();
    });
});
