import { Permission } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { UserInputError } from '../../common/error/errors';
import { API_KEY_AUTH_STRATEGY_NAME } from '../../config/api-key-strategy/api-key-strategy';
import { ApiKey } from '../../entity/api-key/api-key.entity';
import { Channel } from '../../entity/channel/channel.entity';
import { Role } from '../../entity/role/role.entity';
import { User } from '../../entity/user/user.entity';

import { ApiKeyService } from './api-key.service';

function fixture(permissionsByChannel: Record<string, Permission[]>) {
    const channel = new Channel({ id: 1, code: 'channel-a', token: 'synthetic-channel-a' });
    const role = new Role({ id: 30, permissions: [Permission.ReadProduct], channels: [channel] });
    const user = new User({ id: 20, roles: [role] });
    const key = new ApiKey({
        id: 40,
        ownerId: 10,
        userId: user.id,
        user,
        channels: [channel],
        lookupId: 'synthetic-lookup',
        apiKeyHash: 'synthetic-old-hash',
    });
    const ctx = { activeUserId: 11, channelId: 1, apiType: 'admin' } as RequestContext;
    const repository = {
        find: vi.fn().mockImplementation(() => Promise.resolve(user.roles)),
        save: vi.fn().mockImplementation((value: ApiKey) => Promise.resolve(value)),
    };
    const connection = { getEntityOrThrow: vi.fn().mockResolvedValue(key), getRepository: () => repository };
    const grant = vi
        .fn()
        .mockImplementation((_ctx, id: string | number, required: Permission[]) =>
            Promise.resolve(
                required.every(permission => (permissionsByChannel[String(id)] ?? []).includes(permission)),
            ),
        );
    const strategy = {
        generateSecret: vi.fn().mockResolvedValue('synthetic-new-secret'),
        constructApiKey: vi.fn().mockReturnValue('synthetic-new-key'),
        hashingStrategy: { hash: vi.fn().mockResolvedValue('synthetic-new-hash') },
    };
    const sessions = {
        deleteApiKeySession: vi.fn().mockResolvedValue(undefined),
        createNewAuthenticatedSession: vi.fn().mockResolvedValue({}),
    };
    const events = { publish: vi.fn().mockResolvedValue(undefined) };
    const service = new ApiKeyService(
        {} as any,
        { authOptions: { adminApiKeyStrategy: strategy } } as any,
        connection as any,
        {} as any,
        events as any,
        {} as any,
        { userHasAllPermissionsOnChannel: grant } as any,
        sessions as any,
        {} as any,
        {} as any,
        {} as any,
    );
    return { service, ctx, key, user, role, repository, connection, grant, strategy, sessions, events };
}

describe('ApiKeyService.rotate permission ceiling (F-01)', () => {
    it('rejects a caller without the target key permissions before changing any credentials', async () => {
        const x = fixture({ 1: [Permission.UpdateApiKey] });
        await expect(x.service.rotate(x.ctx, x.key.id)).rejects.toBeInstanceOf(UserInputError);
        expect(x.strategy.generateSecret).not.toHaveBeenCalled();
        expect(x.repository.save).not.toHaveBeenCalled();
        expect(x.sessions.deleteApiKeySession).not.toHaveBeenCalled();
        expect(x.sessions.createNewAuthenticatedSession).not.toHaveBeenCalled();
        expect(x.events.publish).not.toHaveBeenCalled();
        expect(x.key.apiKeyHash).toBe('synthetic-old-hash');
    });

    it('does not let ownership bypass a permission that has been revoked', async () => {
        const x = fixture({ 1: [Permission.UpdateApiKey] });
        x.key.ownerId = 11;
        await expect(x.service.rotate(x.ctx, x.key.id)).rejects.toBeInstanceOf(UserInputError);
        expect(x.sessions.createNewAuthenticatedSession).not.toHaveBeenCalled();
    });

    it('checks every channel granted to the target key', async () => {
        const x = fixture({ 1: [Permission.ReadProduct] });
        x.role.channels.push(new Channel({ id: 2, code: 'channel-b', token: 'synthetic-channel-b' }));
        await expect(x.service.rotate(x.ctx, x.key.id)).rejects.toBeInstanceOf(UserInputError);
        expect(x.grant).toHaveBeenCalledWith(x.ctx, 1, [Permission.ReadProduct]);
        expect(x.grant).toHaveBeenCalledWith(x.ctx, 2, [Permission.ReadProduct]);
        expect(x.strategy.generateSecret).not.toHaveBeenCalled();
    });

    it('allows a delegated administrator with every required channel permission to rotate', async () => {
        const x = fixture({ 1: [Permission.ReadProduct], 2: [Permission.ReadProduct] });
        x.role.channels.push(new Channel({ id: 2, code: 'channel-b', token: 'synthetic-channel-b' }));
        await expect(x.service.rotate(x.ctx, x.key.id)).resolves.toEqual({ apiKey: 'synthetic-new-key' });
        expect(x.grant).toHaveBeenCalledTimes(2);
        expect(x.sessions.deleteApiKeySession).toHaveBeenCalledOnce();
        expect(x.sessions.createNewAuthenticatedSession).toHaveBeenCalledWith(
            x.ctx,
            x.user,
            API_KEY_AUTH_STRATEGY_NAME,
            'synthetic-new-hash',
        );
        expect(x.key.apiKeyHash).toBe('synthetic-new-hash');
        expect(x.events.publish).toHaveBeenCalledOnce();
    });

    it('retains the channel and soft-delete boundary when loading the target key', async () => {
        const x = fixture({ 1: [Permission.ReadProduct] });
        x.connection.getEntityOrThrow.mockRejectedValueOnce(new Error('synthetic missing channel key'));
        await expect(x.service.rotate(x.ctx, x.key.id)).rejects.toThrow('synthetic missing channel key');
        expect(x.connection.getEntityOrThrow).toHaveBeenCalledWith(x.ctx, ApiKey, x.key.id, {
            channelId: x.ctx.channelId,
            includeSoftDeleted: false,
            relations: { user: { roles: { channels: true } } },
        });
        expect(x.strategy.generateSecret).not.toHaveBeenCalled();
    });
});
