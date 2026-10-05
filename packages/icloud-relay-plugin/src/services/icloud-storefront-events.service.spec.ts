import { DataSource, PrimaryGeneratedColumn } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IcloudMailOutbox } from '../entities/icloud-mail-outbox.entity';

import { IcloudMailBridge } from './icloud-mail-bridge';
import { IcloudStorefrontEventsService } from './icloud-storefront-events.service';

// Vendure normally installs this ID metadata during application bootstrap.
PrimaryGeneratedColumn()(IcloudMailOutbox.prototype, 'id');
afterEach(() => vi.restoreAllMocks());

describe('committed storefront notifications', () => {
    it('uses real SQL.js transactions: rollback emits nothing, commit is independent of webhook delivery', async () => {
        const db = await new DataSource({
            type: 'sqljs',
            entities: [IcloudMailOutbox],
            synchronize: true,
        }).initialize();
        vi.spyOn(IcloudMailBridge.prototype, 'start').mockImplementation(() => undefined);
        const publish = vi.spyOn(IcloudMailBridge.prototype, 'publish').mockImplementation(() => undefined);
        const service = new IcloudStorefrontEventsService(
            { rawConnection: db } as never,
            { dbConnectionOptions: { type: 'sqljs' } } as never,
        );
        service.onApplicationBootstrap();
        const insert = (eventId: string) =>
            new IcloudMailOutbox({ eventId, primaryAccountId: '1', virtualEmailId: '2', deliveredAt: null });
        try {
            await expect(
                db.transaction(async manager => {
                    await manager.save(insert('rolled-back'));
                    expect(publish).not.toHaveBeenCalled();
                    throw new Error('rollback');
                }),
            ).rejects.toThrow('rollback');
            expect(await db.getRepository(IcloudMailOutbox).count()).toBe(0);
            expect(publish).not.toHaveBeenCalled();
            await db.transaction(async manager => {
                await manager.save(insert('committed'));
                expect(publish).not.toHaveBeenCalled();
            });
            expect(publish).toHaveBeenCalledOnce();
            expect(publish.mock.calls[0][0]).toMatchObject({
                kind: 'mail',
                eventId: 'committed',
                primaryAccountId: '1',
                virtualEmailId: '2',
            });
            expect((await db.getRepository(IcloudMailOutbox).find())[0].deliveredAt).toBeNull();

            publish.mockClear();
            await db.transaction(async manager => {
                await manager.save(insert('outer'));
                await manager.transaction(async nested => {
                    await nested.save(insert('savepoint'));
                });
                expect(publish).not.toHaveBeenCalled();
            });
            expect(publish.mock.calls.map(([event]) => event.eventId)).toEqual(['outer', 'savepoint']);
        } finally {
            await service.onModuleDestroy();
            await db.destroy();
        }
    });
});
