import { describe, expect, it, vi } from 'vitest';

import { StorefrontActivationService } from './storefront-activation.service';

function createService(
    status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | null,
    sellerId = 'merchant-seller',
    channelId = 'channel-1',
    hasActivePrimaryDomain = false,
) {
    const profileRepository = {
        findOne: vi.fn().mockResolvedValue(status ? { id: 'profile-1', status } : null),
    };
    const domainRepository = {
        exists: vi.fn().mockResolvedValue(hasActivePrimaryDomain),
    };
    const connection = {
        getRepository: vi.fn().mockReturnValueOnce(profileRepository).mockReturnValue(domainRepository),
    };
    const channelService = {
        findOne: vi.fn().mockResolvedValue({ id: channelId, sellerId }),
        getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default', sellerId: 'platform-seller' }),
    };
    return new StorefrontActivationService(connection as any, channelService as any);
}

describe('StorefrontActivationService', () => {
    it.each(['DRAFT', 'SUSPENDED'] as const)('blocks Shop API access for %s stores', async status => {
        await expect(
            createService(status).assertActive({ apiType: 'shop', channelId: 'channel-1' } as any),
        ).rejects.toThrow();
    });

    it('allows active stores', async () => {
        await expect(
            createService('ACTIVE').assertActive({ apiType: 'shop', channelId: 'channel-1' } as any),
        ).resolves.toBeUndefined();
    });

    it('blocks merchant Channels when provisioning left no managed profile', async () => {
        await expect(
            createService(null).assertActive({ apiType: 'shop', channelId: 'default' } as any),
        ).rejects.toThrow();
    });

    it('does not affect Admin API operations', async () => {
        await expect(
            createService('DRAFT').assertActive({ apiType: 'admin', channelId: 'channel-1' } as any),
        ).resolves.toBeUndefined();
    });

    it('blocks platform-owned regional Channels without a managed profile', async () => {
        await expect(
            createService(null, 'platform-seller', 'channel-1', true).assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).rejects.toThrow();
    });

    it('allows verified platform-owned regional drafts for backwards compatibility', async () => {
        await expect(
            createService('DRAFT', 'platform-seller', 'channel-1', true).assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).resolves.toBeUndefined();
    });

    it('blocks platform-owned regional drafts without an active primary domain', async () => {
        await expect(
            createService('DRAFT', 'platform-seller').assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).rejects.toThrow();
    });

    it('blocks suspended platform-owned regional stores even with a verified domain', async () => {
        await expect(
            createService('SUSPENDED', 'platform-seller', 'channel-1', true).assertActive({
                apiType: 'shop',
                channelId: 'channel-1',
            } as any),
        ).rejects.toThrow();
    });

    it('allows only the actual default Channel without a managed profile', async () => {
        await expect(
            createService(null, 'platform-seller', 'default').assertActive({
                apiType: 'shop',
                channelId: 'default',
            } as any),
        ).resolves.toBeUndefined();
    });
});
