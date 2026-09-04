import 'reflect-metadata';

import { Channel, Permission } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { storeDomainPermission } from './constants';
import { StoreDomain } from './entities/store-domain.entity';
import { StoreDomainService } from './store-domain.service';

function requestUrl(input: string | URL | Request): string {
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.href;
    return input;
}

function createService() {
    const repository = { find: vi.fn().mockResolvedValue([]) };
    const connection = { getRepository: vi.fn().mockReturnValue(repository) };
    const service = new StoreDomainService(connection as any, {} as any, {} as any, {
        cnameTarget: 'stores.example.com',
        routingMode: 'require-domain',
        trustProxyHeaders: false,
        bypassHosts: [],
        resolveTxt: vi.fn(),
        cloudflare: null,
    });
    return { repository, service };
}

function channelAdministrator(channelId: string) {
    return {
        channelId,
        userHasPermissions: vi.fn((permissions: Permission[]) =>
            permissions.includes(Permission.ReadChannel),
        ),
    };
}

describe('StoreDomainService channel isolation', () => {
    it('lets a channel administrator read only the active channel domains', async () => {
        const { repository, service } = createService();
        const ctx = channelAdministrator('store-a');

        await service.findAll(ctx as any, 'store-a');

        expect(repository.find).toHaveBeenCalledWith(
            expect.objectContaining({ where: { channelId: 'store-a' } }),
        );
        await expect(service.findAll(ctx as any, 'store-b')).rejects.toThrow('无权管理该店铺的域名');
    });

    it('allows a super administrator to inspect another channel', async () => {
        const { repository, service } = createService();
        const ctx = {
            channelId: 'default',
            userHasPermissions: vi.fn((permissions: Permission[]) =>
                permissions.includes(Permission.SuperAdmin),
            ),
        };

        await service.findAll(ctx as any, 'store-c');

        expect(repository.find).toHaveBeenCalledWith(
            expect.objectContaining({ where: { channelId: 'store-c' } }),
        );
    });

    it('allows a least-privilege store administrator to read only the active Channel domains', async () => {
        const { repository, service } = createService();
        const ctx = {
            channelId: 'store-a',
            userHasPermissions: vi.fn((permissions: Permission[]) =>
                permissions.includes(storeDomainPermission.Read),
            ),
        };

        await service.findAll(ctx as any, 'store-a');

        expect(repository.find).toHaveBeenCalledWith(
            expect.objectContaining({ where: { channelId: 'store-a' } }),
        );
        await expect(service.findAll(ctx as any, 'store-b')).rejects.toThrow('无权管理该店铺的域名');
    });
});
describe('StoreDomainService atomic transfer', () => {
    function setupTransfer() {
        const sourceChannel = { id: 'source', code: 'primary-store' };
        const targetChannel = { id: 'target', code: 'meiyijia' };
        const transferred = Object.assign(new StoreDomain(), {
            id: 'domain-1',
            updatedAt: new Date('2026-09-04T01:00:00.000Z'),
            domain: 'damatong.net',
            channel: sourceChannel,
            channelId: sourceChannel.id,
            isPrimary: true,
            primaryChannelId: sourceChannel.id,
            status: 'ACTIVE',
            verificationToken: 'preserved-token',
            verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
            lastVerificationError: null,
        });
        const sourceReplacement = Object.assign(new StoreDomain(), {
            id: 'domain-2',
            domain: 'moyaoai.com',
            channelId: sourceChannel.id,
            isPrimary: false,
            primaryChannelId: null,
            status: 'ACTIVE',
        });
        const targetPrimary = Object.assign(new StoreDomain(), {
            id: 'domain-3',
            domain: 'old.meiyijia.example',
            channelId: targetChannel.id,
            isPrimary: true,
            primaryChannelId: targetChannel.id,
            status: 'ACTIVE',
        });
        const domainRepository = {
            findOne: vi.fn().mockResolvedValue(transferred),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
            save: vi.fn((value: StoreDomain) => Promise.resolve(value)),
            find: vi.fn(({ where }: { where: { channelId: string } }) =>
                Promise.resolve(where.channelId === sourceChannel.id ? [sourceReplacement] : [targetPrimary]),
            ),
        };
        const channelRepository = {
            findOne: vi.fn().mockResolvedValue(targetChannel),
        };
        const connection = {
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === StoreDomain) return domainRepository;
                if (entity === Channel) return channelRepository;
                throw new Error('Unexpected repository');
            }),
        };
        const cacheService = {
            delete: vi.fn().mockResolvedValue(undefined),
            invalidateTags: vi.fn().mockResolvedValue(undefined),
        };
        const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
        const service = new StoreDomainService(connection as any, cacheService as any, eventBus as any, {
            cnameTarget: 'stores.example.com',
            routingMode: 'require-domain',
            trustProxyHeaders: false,
            bypassHosts: [],
            resolveTxt: vi.fn(),
            cloudflare: null,
        });
        const ctx = {
            userHasPermissions: vi.fn((permissions: Permission[]) =>
                permissions.includes(Permission.SuperAdmin),
            ),
        };
        return {
            cacheService,
            ctx,
            domainRepository,
            eventBus,
            service,
            sourceReplacement,
            targetChannel,
            transferred,
        };
    }

    it('moves a verified domain, updates both primary slots, and invalidates routing caches', async () => {
        const state = setupTransfer();

        const result = await state.service.transfer(state.ctx as any, {
            id: state.transferred.id,
            targetChannelId: state.targetChannel.id,
            expectedUpdatedAt: state.transferred.updatedAt,
        });

        expect(result).toMatchObject({
            domain: 'damatong.net',
            channelId: 'target',
            isPrimary: true,
            primaryChannelId: 'target',
            status: 'ACTIVE',
            verificationToken: 'preserved-token',
        });
        expect(state.domainRepository.update).toHaveBeenCalledWith(
            { channelId: 'target' },
            { isPrimary: false, primaryChannelId: null },
        );
        expect(state.sourceReplacement).toMatchObject({ isPrimary: true, primaryChannelId: 'source' });
        expect(state.cacheService.delete).toHaveBeenCalledWith('StoreDomainRoute:damatong.net');
        expect(state.cacheService.invalidateTags).toHaveBeenCalledWith(['StoreDomainChannel:source']);
        expect(state.cacheService.invalidateTags).toHaveBeenCalledWith(['StoreDomainChannel:target']);
        expect(state.eventBus.publish).toHaveBeenCalledOnce();
    });

    it('rejects a stale transfer request before changing primary domains', async () => {
        const state = setupTransfer();

        await expect(
            state.service.transfer(state.ctx as any, {
                id: state.transferred.id,
                targetChannelId: state.targetChannel.id,
                expectedUpdatedAt: new Date('2026-09-04T00:59:59.000Z'),
            }),
        ).rejects.toThrow(/CONCURRENT_MODIFICATION/u);
        expect(state.domainRepository.update).not.toHaveBeenCalled();
    });

    it('does not allow a channel administrator to transfer a domain', async () => {
        const state = setupTransfer();

        await expect(
            state.service.transfer({ userHasPermissions: vi.fn().mockReturnValue(false) } as any, {
                id: state.transferred.id,
                targetChannelId: state.targetChannel.id,
                expectedUpdatedAt: state.transferred.updatedAt,
            }),
        ).rejects.toThrow('只有超级管理员');
    });
});

describe('StoreDomainService Cloudflare automation', () => {
    it('activates a domain only after ownership, hostname routing, and SSL are all ready', async () => {
        const domain = {
            id: 'domain-1',
            domain: 'shop.example.com',
            channelId: 'store-a',
            channel: { id: 'store-a' },
            status: 'PENDING',
            verificationToken: 'token',
            provisioningMode: 'CLOUDFLARE_SAAS',
            dnsManaged: false,
            providerExternalId: 'hostname-1',
            providerHostnameStatus: 'pending',
            providerSslStatus: 'pending_validation',
            lastProvisionedAt: null,
            lastVerificationError: null,
            verifiedAt: null,
        };
        const repository = {
            findOne: vi.fn().mockResolvedValue(domain),
            save: vi.fn(value => Promise.resolve(value)),
        };
        const connection = {
            getRepository: vi.fn().mockReturnValue(repository),
            rawConnection: { getRepository: vi.fn().mockReturnValue(repository) },
        };
        const cache = { delete: vi.fn().mockResolvedValue(undefined) };
        const eventBus = { publish: vi.fn().mockResolvedValue(undefined) };
        const fetchImpl = vi.fn((input: string | URL | Request) => {
            const url = requestUrl(input);
            if (url.endsWith('/custom_hostnames/fallback_origin')) {
                return Response.json({
                    success: true,
                    result: { origin: 'origin.platform.test', status: 'active' },
                });
            }
            if (url.includes('/custom_hostnames?')) {
                return Response.json({
                    success: true,
                    result: [{ id: 'hostname-1', hostname: 'shop.example.com' }],
                });
            }
            if (url.endsWith('/custom_hostnames/hostname-1')) {
                return Response.json({
                    success: true,
                    result: {
                        id: 'hostname-1',
                        hostname: 'shop.example.com',
                        status: 'active',
                        ssl: { status: 'active' },
                    },
                });
            }
            throw new Error(`Unexpected request ${url}`);
        }) as unknown as typeof fetch;
        const service = new StoreDomainService(connection as any, cache as any, eventBus as any, {
            cnameTarget: 'domains.platform.test',
            routingMode: 'require-domain',
            trustProxyHeaders: false,
            bypassHosts: [],
            resolveTxt: vi.fn().mockResolvedValue([['vendure-domain-verification=token']]),
            cloudflare: {
                apiToken: 'scoped-token',
                saasZoneId: 'saas-zone',
                fallbackOrigin: 'origin.platform.test',
                autoManageDns: false,
                apiBaseUrl: 'https://api.cloudflare.test/client/v4',
                fetch: fetchImpl,
            },
        });
        const ctx = {
            channelId: 'store-a',
            userHasPermissions: vi.fn((permissions: Permission[]) =>
                permissions.includes(Permission.SuperAdmin),
            ),
        };

        const result = await service.verify(ctx as any, 'domain-1');

        expect(result.success).toBe(true);
        expect(result.domain).toMatchObject({
            status: 'ACTIVE',
            providerHostnameStatus: 'active',
            providerSslStatus: 'active',
        });
        expect(repository.save).toHaveBeenCalled();
        expect(cache.delete).toHaveBeenCalledWith('StoreDomainRoute:shop.example.com');
        expect(eventBus.publish).toHaveBeenCalled();
    });
});
