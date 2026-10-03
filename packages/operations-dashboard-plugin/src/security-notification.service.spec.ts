import { AdministratorEvent, ApiKeyEvent, Permission, RoleChangeEvent, RoleEvent } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { SecurityNotificationService } from './security-notification.service';

describe('security operation notification subscriptions', () => {
    it('records the actor and legal changes without copying API key material', async () => {
        const handlers = new Map<unknown, (event: any) => void>();
        const unsubscribe = vi.fn();
        const enqueueOneOff = vi.fn(() => Promise.resolve(undefined));
        const service = new SecurityNotificationService(
            {
                ofType: (type: unknown) => ({
                    subscribe: (handler: (event: any) => void) => {
                        handlers.set(type, handler);
                        return { unsubscribe };
                    },
                }),
            } as never,
            {
                getRepository: () => ({
                    findByIds: () => Promise.resolve([{ permissions: [Permission.SuperAdmin] }]),
                }),
            } as never,
            {} as never,
            { enqueueOneOff } as never,
        );
        service.onApplicationBootstrap();
        const ctx = { activeUserId: 97 };
        const at = new Date('2026-10-02T10:00:00Z');
        handlers.get(AdministratorEvent)?.({ ctx, type: 'created', entity: { id: 11, updatedAt: at } });
        handlers.get(RoleEvent)?.({
            ctx,
            type: 'updated',
            input: { channelIds: [2] },
            entity: { id: 7, updatedAt: at, permissions: [Permission.ReadOrder], channels: [{ id: 2 }] },
        });
        handlers.get(ApiKeyEvent)?.({
            ctx,
            type: 'updated',
            entity: { id: 31, updatedAt: at, key: 'SHOULD_NOT_APPEAR' },
        });
        handlers.get(RoleChangeEvent)?.({
            ctx,
            type: 'assigned',
            admin: { id: 11, updatedAt: at },
            roleIds: [7],
        });
        await vi.waitFor(() => expect(enqueueOneOff).toHaveBeenCalledTimes(4));
        const inputs = enqueueOneOff.mock.calls.map(call => (call as unknown[])[1] as any);
        expect(inputs.every(input => input.payload.actorId === '97')).toBe(true);
        expect(inputs.map(input => input.title)).toContain('授予超级管理员权限');
        expect(inputs.map(input => input.title)).toContain('管理权限或店铺授权变更');
        expect(JSON.stringify(inputs)).not.toMatch(/SHOULD_NOT_APPEAR|攻击/);
        const count = enqueueOneOff.mock.calls.length;
        handlers.get(RoleEvent)?.({ ctx, type: 'updated', input: { description: '仅修改说明' } });
        expect(enqueueOneOff).toHaveBeenCalledTimes(count);
        service.onApplicationShutdown();
        expect(unsubscribe).toHaveBeenCalledTimes(4);
    });
});
