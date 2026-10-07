import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ContentTranslationBackfillService } from './content-translation-backfill.service';
import { TranslationContentAdapter } from './translation-content-adapter';

const channelSchema = new EntitySchema({ name: 'Channel', columns: { id: { type: String, primary: true } } });
const schema = new EntitySchema({
    name: 'SystemAnnouncement',
    columns: {
        id: { type: Number, primary: true },
        ownerChannelId: { type: String, nullable: true },
        targetMode: { type: String },
        titleZh: { type: String },
        titleEn: { type: String },
        contentZh: { type: String },
        contentEn: { type: String },
    },
    relations: { channels: { type: 'many-to-many', target: 'Channel', joinTable: true } },
});
const database = new DataSource({ type: 'sqljs', entities: [channelSchema, schema], synchronize: true });
describe('announcement translation publication ownership', () => {
    let adapter: TranslationContentAdapter;
    beforeAll(async () => {
        await database.initialize();
        await database.getRepository(channelSchema).save({ id: 'store-a' });
        await database.getRepository(schema).save([
            {
                id: 1,
                ownerChannelId: null,
                targetMode: 'ALL',
                channels: [],
                titleZh: '平台',
                titleEn: '',
                contentZh: '平台内容',
                contentEn: '',
            },
            {
                id: 2,
                ownerChannelId: 'store-a',
                targetMode: 'SINGLE',
                channels: [{ id: 'store-a' }],
                titleZh: '本店',
                titleEn: '',
                contentZh: '店铺内容',
                contentEn: '',
            },
        ]);
        adapter = new TranslationContentAdapter({ rawConnection: database } as any);
    });
    afterAll(async () => {
        if (database.isInitialized) await database.destroy();
    });
    it('loads platform notices using global identity and rejects forged store identities', async () => {
        const identity = { entityType: 'SystemAnnouncement', entityId: '1', fieldPath: 'title' };
        expect(await adapter.load(database.manager, { ...identity, channelId: null } as any)).toMatchObject({
            source: '平台',
        });
        expect(
            await adapter.load(database.manager, { ...identity, channelId: 'store-a' } as any),
        ).toBeUndefined();
    });
    it('writes back only through the immutable publication owner', async () => {
        const identity = { entityType: 'SystemAnnouncement', entityId: '2', fieldPath: 'title' };
        expect(await adapter.load(database.manager, { ...identity, channelId: null } as any)).toBeUndefined();
        expect(
            await adapter.load(database.manager, { ...identity, channelId: 'store-b' } as any),
        ).toBeUndefined();
        const snapshot = await adapter.load(database.manager, { ...identity, channelId: 'store-a' } as any);
        await snapshot?.save('Store notice');
        expect((await database.getRepository(schema).findOneByOrFail({ id: 2 })).titleEn).toBe(
            'Store notice',
        );
    });
    it('discovers platform and shop notices with separate owner identities from the platform only', async () => {
        const recorded: any[] = [];
        const recordState = vi.fn((_ctx: any, state: any) => {
            recorded.push(state);
            return Promise.resolve();
        });
        const translations = {
            findStates: vi.fn((_ctx: any, identity: any) =>
                Promise.resolve(recorded.filter(state => state.entityId === identity.entityId)),
            ),
            prepareLocalizedFields: vi.fn((fields: any[]) =>
                Promise.resolve(fields.map(field => ({ ...field, status: 'PENDING' }))),
            ),
            recordState,
        };
        const connection = {
            rawConnection: database,
            getRepository: () => database.getRepository(schema),
            withTransaction: (ctx: any, work: any) => work(ctx),
        };
        const service = new ContentTranslationBackfillService(
            connection as any,
            {} as any,
            translations as any,
            adapter,
        );
        const platform = { channelId: 'default', channel: { code: '__default_channel__' } } as any;
        const result = await service.backfill(platform, 'SystemAnnouncement');
        expect(result).toMatchObject({ total: 2, scanned: 2, queued: 2, failed: 0 });
        const identities = translations.findStates.mock.calls.map((call: any) => call[1]);
        expect(identities).toContainEqual(expect.objectContaining({ entityId: '1', channelId: null }));
        expect(identities).toContainEqual(expect.objectContaining({ entityId: '2', channelId: 'store-a' }));
        await expect(
            service.backfill({ channelId: 'store-a', channel: { code: 'store-a' } } as any),
        ).rejects.toThrow('平台管理中心');
    });
});
