import 'reflect-metadata';
import { Column, DataSource, Entity, JoinTable, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ContentTranslationRecoveryService } from './content-translation-recovery.service.js';
import {
    contentTranslationInternals,
    type ContentTranslationService,
} from './content-translation.service.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { TranslationContentAdapter } from './translation-content-adapter.js';

@Entity()
class Channel {
    @PrimaryGeneratedColumn() id: number;
}

@Entity()
class SystemAnnouncement {
    @PrimaryGeneratedColumn() id: number;
    @Column('varchar') targetMode: string;
    @Column('int', { nullable: true }) ownerChannelId: number | null;
    @ManyToMany(() => Channel) @JoinTable() channels: Channel[];
    @Column('varchar') titleZh: string;
    @Column('varchar') titleEn: string;
    @Column('varchar', { default: '' }) contentZh: string;
    @Column('varchar', { default: '' }) contentEn: string;
}

PrimaryGeneratedColumn()(ContentTranslationState.prototype, 'id');
const hash = contentTranslationInternals.hash;
const ctx = { channelId: '1' } as any;
let db: DataSource;
let connection: any;
let adapter: TranslationContentAdapter;
let service: ContentTranslationRecoveryService;
let cachedTranslations: Mock<ContentTranslationService['cachedTranslations']>;
let translate: ReturnType<typeof vi.fn>;
let sequence: number;

beforeEach(async () => {
    db = await new DataSource({
        type: 'sqljs',
        entities: [Channel, SystemAnnouncement, ContentTranslationState],
        synchronize: true,
    }).initialize();
    await db.getRepository(Channel).save([{ id: 1 }, { id: 2 }]);
    connection = {
        rawConnection: db,
        getRepository: (context: any, entity: any) => (context.manager ?? db.manager).getRepository(entity),
        withTransaction: (context: any, fn: any) => db.transaction(manager => fn({ ...context, manager })),
    };
    adapter = new TranslationContentAdapter(connection);
    cachedTranslations = vi.fn<ContentTranslationService['cachedTranslations']>().mockResolvedValue([]);
    translate = vi.fn();
    service = new ContentTranslationRecoveryService(connection, adapter, {
        cachedTranslations,
        translate,
    } as any);
    sequence = 0;
});

afterEach(async () => {
    vi.restoreAllMocks();
    await db.destroy();
});

async function cancelled(
    targetMode = 'ALL',
    channelIds: number[] = [],
    overrides: Partial<ContentTranslationState> = {},
    titleEn = '',
) {
    const announcement = await db.getRepository(SystemAnnouncement).save({
        targetMode,
        ownerChannelId: null,
        channels: channelIds.map(id => ({ id })),
        titleZh: '商城公告',
        titleEn,
    });
    const state = await db.getRepository(ContentTranslationState).save(
        new ContentTranslationState({
            stateKey: `recovery-${++sequence}`,
            entityType: 'SystemAnnouncement',
            entityId: String(announcement.id),
            fieldPath: 'title',
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
            channelId: null,
            sourceHash: hash(announcement.titleZh),
            translatedHash: hash(announcement.titleEn),
            status: 'CANCELLED',
            lastErrorCode: 'SOURCE_UNAVAILABLE',
            origin: 'AUTO',
            locked: false,
            revision: 4,
            attempts: 3,
            nextAttemptAt: null,
            leaseToken: null,
            leaseUntil: null,
            error: '源内容已删除或不属于此店铺',
            ...overrides,
        }),
    );
    return { announcement, state };
}

const input = (state: ContentTranslationState) => ({
    id: String(state.id),
    revision: state.revision,
    sourceHash: state.sourceHash,
    translatedHash: state.translatedHash,
});

describe('precise global-announcement translation recovery', () => {
    it('previews only current-store and ALL announcements with this exact cancellation defect', async () => {
        const all = await cancelled();
        const local = await cancelled('SINGLE', [1]);
        await cancelled('SINGLE', [2]);
        await cancelled('ALL', [], { locked: true });
        await cancelled('ALL', [], { origin: 'MANUAL' });
        await cancelled('ALL', [], { lastErrorCode: 'MANUAL_REVIEW' });
        await cancelled('ALL', [], { status: 'FAILED' });
        await cancelled('ALL', [], { channelId: '1' });
        await cancelled('ALL', [], { entityType: 'Product' });
        const result = await service.preview(ctx, 1, 0);
        expect(result.total).toBe(2);
        expect(result.records).toEqual([
            expect.objectContaining({ id: String(all.state.id), eligible: true, reason: 'READY_TO_RECOVER' }),
        ]);
        expect((await service.preview(ctx, 1, 1)).records[0].id).toBe(String(local.state.id));
        expect((await service.preview(ctx, 1, 2)).records).toEqual([]);
    });

    it('preview does not write states, business content, cache, or call a translation provider', async () => {
        await cancelled();
        const states = await db.getRepository(ContentTranslationState).find();
        const announcements = await db.getRepository(SystemAnnouncement).find();
        const update = vi.spyOn(db.getRepository(ContentTranslationState), 'update');
        await service.preview(ctx);
        expect(await db.getRepository(ContentTranslationState).find()).toEqual(states);
        expect(await db.getRepository(SystemAnnouncement).find()).toEqual(announcements);
        expect(update).not.toHaveBeenCalled();
        expect(cachedTranslations).not.toHaveBeenCalled();
        expect(translate).not.toHaveBeenCalled();
    });

    it('shows changed-source and changed-target candidates as ineligible rather than resetting their hashes', async () => {
        const sourceChanged = await cancelled();
        const targetChanged = await cancelled();
        await db
            .getRepository(SystemAnnouncement)
            .update(sourceChanged.announcement.id, { titleZh: '新公告' });
        await db
            .getRepository(SystemAnnouncement)
            .update(targetChanged.announcement.id, { titleEn: 'Edited' });
        const preview = await service.preview(ctx);
        expect(preview.records.map(record => [record.eligible, record.reason])).toEqual([
            [false, 'CONTENT_CHANGED'],
            [false, 'CONTENT_CHANGED'],
        ]);
        const result = await service.recover(ctx, [input(sourceChanged.state), input(targetChanged.state)]);
        expect(result).toMatchObject({ queued: 0, skipped: 2 });
    });

    it('recovers an untranslated field once and leaves business text untouched', async () => {
        const { announcement, state } = await cancelled();
        const result = await service.recover(ctx, [input(state)]);
        expect(result).toEqual({
            queued: 1,
            skipped: 0,
            records: [{ id: String(state.id), reason: 'QUEUED_FOR_TRANSLATION' }],
        });
        expect(
            await db.getRepository(ContentTranslationState).findOneByOrFail({ id: state.id }),
        ).toMatchObject({
            revision: 5,
            status: 'PENDING',
            attempts: 0,
            sourceHash: state.sourceHash,
            translatedHash: state.translatedHash,
            origin: 'AUTO',
            locked: false,
            error: null,
            lastErrorCode: null,
        });
        expect(
            await db.getRepository(SystemAnnouncement).findOneOrFail({
                where: { id: announcement.id },
                relations: { channels: true },
            }),
        ).toEqual(announcement);
        expect((await service.recover(ctx, [input(state)])).queued).toBe(0);
        expect(translate).not.toHaveBeenCalled();
    });

    it('rejects a revision that changed after preview', async () => {
        const { state } = await cancelled();
        await db.getRepository(ContentTranslationState).update(state.id, { revision: state.revision + 1 });
        expect(await service.recover(ctx, [input(state)])).toEqual({
            queued: 0,
            skipped: 1,
            records: [{ id: String(state.id), reason: 'STATE_CHANGED' }],
        });
    });

    it.each([
        { locked: true },
        { origin: 'MANUAL' as const },
        { status: 'NOTIFY_PENDING' as const },
        { lastErrorCode: 'MANUAL_REVIEW' },
        { channelId: '1' },
        { entityType: 'StorefrontContentBlock' },
    ])('never recovers a protected or unrelated state: %j', async changed => {
        const { state } = await cancelled();
        await db.getRepository(ContentTranslationState).update(state.id, changed);
        expect((await service.recover(ctx, [input(state)])).queued).toBe(0);
        expect(
            await db.getRepository(ContentTranslationState).findOneByOrFail({ id: state.id }),
        ).toMatchObject(changed);
    });

    it('rejects cross-store IDs and a visibility change made after preview', async () => {
        const foreign = await cancelled('SINGLE', [2]);
        const local = await cancelled('SINGLE', [1]);
        await db.getRepository(SystemAnnouncement).save({ ...local.announcement, channels: [{ id: 2 }] });
        const result = await service.recover(ctx, [input(foreign.state), input(local.state)]);
        expect(result).toEqual({
            queued: 0,
            skipped: 2,
            records: [
                { id: String(foreign.state.id), reason: 'OUT_OF_SCOPE' },
                { id: String(local.state.id), reason: 'OUT_OF_SCOPE' },
            ],
        });
    });

    it('rejects a deleted source and an unexpected outstanding lease', async () => {
        const removed = await cancelled();
        const leased = await cancelled('ALL', [], { leaseToken: 'unexpected-lease' });
        await db.getRepository(SystemAnnouncement).delete(removed.announcement.id);
        const result = await service.recover(ctx, [input(removed.state), input(leased.state)]);
        expect(result.records.map(record => record.reason)).toEqual(['SOURCE_UNAVAILABLE', 'ACTIVE_LEASE']);
        expect(result.queued).toBe(0);
    });

    it('reuses a proven current-source cache hit only for notification, with no provider call', async () => {
        const { state } = await cancelled('ALL', [], {}, 'Store announcement');
        cachedTranslations.mockResolvedValue([{ key: 'recovery', text: 'Store announcement' }]);
        const result = await service.recover(ctx, [input(state)]);
        expect(result.records[0].reason).toBe('QUEUED_FOR_NOTIFICATION');
        expect(cachedTranslations).toHaveBeenCalledWith({
            segments: [{ key: 'recovery', text: '商城公告', format: 'TEXT' }],
        });
        expect(
            (await db.getRepository(ContentTranslationState).findOneByOrFail({ id: state.id })).status,
        ).toBe('NOTIFY_PENDING');
        expect(translate).not.toHaveBeenCalled();
    });

    it.each(['absent', 'different', 'unavailable'])(
        'does not mark existing English ready with %s cache proof',
        async mode => {
            const { announcement, state } = await cancelled('ALL', [], {}, 'Old English');
            if (mode === 'different')
                cachedTranslations.mockResolvedValue([{ key: 'recovery', text: 'New English' }]);
            if (mode === 'unavailable') cachedTranslations.mockRejectedValue(new Error('cache unavailable'));
            expect((await service.recover(ctx, [input(state)])).records[0].reason).toBe(
                'QUEUED_FOR_TRANSLATION',
            );
            expect(
                (await db.getRepository(SystemAnnouncement).findOneByOrFail({ id: announcement.id })).titleEn,
            ).toBe('Old English');
        },
    );

    it('CAS rejects a concurrent manual lock even after its earlier state read', async () => {
        const { state } = await cancelled('ALL', [], {}, 'Store announcement');
        cachedTranslations.mockImplementation(async () => {
            await db.getRepository(ContentTranslationState).update(state.id, {
                locked: true,
                origin: 'MANUAL',
                revision: state.revision + 1,
            });
            return [{ key: 'recovery', text: 'Store announcement' }];
        });
        const result = await service.recover(ctx, [input(state)]);
        expect(result).toMatchObject({ queued: 0, skipped: 1 });
        expect(result.records[0].reason).toBe('STATE_CHANGED');
        expect(
            await db.getRepository(ContentTranslationState).findOneByOrFail({ id: state.id }),
        ).toMatchObject({
            locked: true,
            origin: 'MANUAL',
            status: 'CANCELLED',
            revision: 5,
        });
    });

    it('allows a legacy null target hash only while its actual target is empty', async () => {
        const empty = await cancelled('ALL', [], { translatedHash: null });
        const nonempty = await cancelled('ALL', [], { translatedHash: null }, 'Untracked English');
        const result = await service.recover(ctx, [input(empty.state), input(nonempty.state)]);
        expect(result.records.map(record => record.reason)).toEqual([
            'QUEUED_FOR_TRANSLATION',
            'CONTENT_CHANGED',
        ]);
        expect(
            (await db.getRepository(ContentTranslationState).findOneByOrFail({ id: empty.state.id }))
                .translatedHash,
        ).toBe(hash(''));
    });

    it('bounds and validates preview/recovery without writing anything', async () => {
        const { state } = await cancelled();
        for (const [limit, offset] of [
            [0, 0],
            [101, 0],
            [1, -1],
            [1.5, 0],
        ])
            await expect(service.preview(ctx, limit, offset)).rejects.toThrow();
        await expect(service.recover(ctx, [])).rejects.toThrow();
        await expect(
            service.recover(
                ctx,
                Array.from({ length: 101 }, () => input(state)),
            ),
        ).rejects.toThrow();
        await expect(service.recover(ctx, [input(state), input(state)])).rejects.toThrow();
        await expect(service.recover(ctx, [{ ...input(state), revision: 0 }])).rejects.toThrow();
        await expect(service.recover(ctx, [{ ...input(state), sourceHash: 'changed' }])).rejects.toThrow();
        expect(
            (await db.getRepository(ContentTranslationState).findOneByOrFail({ id: state.id })).status,
        ).toBe('CANCELLED');
    });
});
