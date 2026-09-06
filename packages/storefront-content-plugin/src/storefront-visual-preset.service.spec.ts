import { Channel, type RequestContext } from '@vendure/core';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontContentBlock } from './entities/storefront-content-block.entity';
import { StorefrontContentChangedEvent } from './storefront-content-changed.event';
import { StorefrontVisualPresetService } from './storefront-visual-preset.service';
import { STOREFRONT_VISUAL_PRESET_CODE } from './visual-presets';

function setup() {
    const rows = new Map<string, StorefrontContentBlock>();
    const repository = {
        findOne: vi.fn(({ where }) => Promise.resolve(rows.get(String(where.channelId)) ?? null)),
        save: vi.fn((block: StorefrontContentBlock) => {
            block.id ||= `preset-${String(block.channelId)}`;
            rows.set(String(block.channelId), block);
            return Promise.resolve(block);
        }),
    };
    const lock = { setLock: vi.fn(), where: vi.fn(), getOne: vi.fn(() => Promise.resolve({})) };
    lock.setLock.mockReturnValue(lock);
    lock.where.mockReturnValue(lock);
    const connection = {
        getRepository: vi.fn((_ctx, entity) =>
            entity === Channel ? { createQueryBuilder: () => lock } : repository,
        ),
    };
    const eventBus = {
        publish: vi.fn((_event: StorefrontContentChangedEvent) => Promise.resolve(undefined)),
    };
    const service = new StorefrontVisualPresetService(connection as never, eventBus as never);
    const ctx = (id: string) => ({ channelId: id, channel: { id } }) as RequestContext;
    return { service, rows, repository, eventBus, ctx };
}

describe('channel-scoped storefront visual presets', () => {
    it('returns classic for a new store without writing configuration', async () => {
        const { service, ctx, repository } = setup();
        await expect(service.get(ctx('a'))).resolves.toEqual({
            channelId: 'a',
            presetId: 'classic',
            revision: 'default',
        });
        expect(repository.save).not.toHaveBeenCalled();
        expect(repository.findOne).toHaveBeenCalledWith({
            where: { channelId: 'a', code: STOREFRONT_VISUAL_PRESET_CODE },
        });
    });

    it('applies and resets one store without changing another, emitting scoped invalidation', async () => {
        const { service, ctx, rows, eventBus } = setup();
        const saved = await service.update(ctx('a'), {
            channelId: 'a',
            presetId: 'modern-oriental',
            expectedRevision: 'default',
        });
        expect(saved.presetId).toBe('modern-oriental');
        expect((await service.get(ctx('b'))).presetId).toBe('classic');
        expect(rows.get('a')).toMatchObject({ enabled: false, code: STOREFRONT_VISUAL_PRESET_CODE });
        expect(eventBus.publish.mock.calls[0][0]).toMatchObject({ ctx: { channelId: 'a' } });
        const restored = await service.update(ctx('a'), {
            channelId: 'a',
            presetId: 'classic',
            expectedRevision: saved.revision,
        });
        expect(restored.presetId).toBe('classic');
        expect(restored.revision).not.toBe(saved.revision);
        expect(rows.has('b')).toBe(false);
    });

    it('rejects a stale channel, unknown preset and concurrent update before replacing data', async () => {
        const { service, ctx, repository } = setup();
        await expect(
            service.update(ctx('b'), {
                channelId: 'a',
                presetId: 'modern-oriental',
                expectedRevision: 'default',
            }),
        ).rejects.toThrow(/店铺已切换/);
        await expect(
            service.update(ctx('a'), { channelId: 'a', presetId: 'custom-css', expectedRevision: 'default' }),
        ).rejects.toThrow(/已发布/);
        expect(repository.save).not.toHaveBeenCalled();
        await service.update(ctx('a'), {
            channelId: 'a',
            presetId: 'modern-oriental',
            expectedRevision: 'default',
        });
        await expect(
            service.update(ctx('a'), { channelId: 'a', presetId: 'classic', expectedRevision: 'default' }),
        ).rejects.toThrow(/其他管理员/);
        expect((await service.get(ctx('a'))).presetId).toBe('modern-oriental');
        expect(repository.save).toHaveBeenCalledTimes(1);
        expect(repository.findOne).toHaveBeenCalledWith({
            where: { channelId: 'a', code: STOREFRONT_VISUAL_PRESET_CODE },
            lock: { mode: 'pessimistic_write' },
        });
    });

    it('falls back for an unknown saved preset without rewriting the stored record', async () => {
        const { service, ctx, rows, repository } = setup();
        rows.set(
            'a',
            new StorefrontContentBlock({
                id: '1',
                channelId: 'a',
                updatedAt: new Date(),
                settings: { presetId: 'future-preset' },
            }),
        );
        const fallback = await service.get(ctx('a'));
        expect(fallback.presetId).toBe('classic');
        expect(repository.save).not.toHaveBeenCalled();
        await service.update(ctx('a'), {
            channelId: 'a',
            presetId: 'classic',
            expectedRevision: fallback.revision,
        });
        expect(rows.get('a')?.settings?.presetId).toBe('classic');
    });
});
