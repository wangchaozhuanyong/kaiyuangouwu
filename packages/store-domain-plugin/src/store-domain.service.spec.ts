import 'reflect-metadata';

import { Permission } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { StoreDomainService } from './store-domain.service';

function createService() {
    const repository = { find: vi.fn().mockResolvedValue([]) };
    const connection = { getRepository: vi.fn().mockReturnValue(repository) };
    const service = new StoreDomainService(
        connection as any,
        {} as any,
        {} as any,
        {
            cnameTarget: 'stores.example.com',
            routingMode: 'require-domain',
            trustProxyHeaders: false,
            bypassHosts: [],
            resolveTxt: vi.fn(),
        },
    );
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
        await expect(service.findAll(ctx as any, 'store-b')).rejects.toThrow(
            '无权管理该店铺的域名',
        );
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
});
