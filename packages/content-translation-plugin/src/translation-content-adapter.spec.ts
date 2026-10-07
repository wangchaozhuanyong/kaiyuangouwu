import { EntityManager, EntityMetadata, IsNull } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { customerContentScopeWhere, TranslationContentAdapter } from './translation-content-adapter.js';

function fixture(entityType: string, entity: Record<string, unknown>, channelOwnership = true) {
    const metadata = {
        name: entityType,
        target: class FixtureEntity {},
        relations: channelOwnership ? [{ propertyName: 'channels' }] : [],
        findColumnWithPropertyName: (name: string) =>
            ['titleZh', 'titleEn', 'contentZh', 'contentEn'].includes(name) ? { length: 120 } : undefined,
    } as unknown as EntityMetadata;
    const repository = {
        findOne: vi.fn().mockResolvedValue(entity),
        update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager = {
        connection: { options: { type: 'sqljs' }, entityMetadatas: [metadata] },
        getRepository: vi.fn(() => repository),
    } as unknown as EntityManager;
    const adapter = new TranslationContentAdapter({} as never);
    return { metadata, repository, manager, adapter };
}

function state(entityType: string, channelId: string | null = null) {
    return { entityType, entityId: 'entity-1', channelId, fieldPath: 'title' } as ContentTranslationState;
}

describe('translation entity scan scope', () => {
    it('excludes internal root collections while retaining their channel restriction', () => {
        const { metadata } = fixture('Collection', {});
        expect(customerContentScopeWhere(metadata, 'channel-1')).toEqual({
            isRoot: false,
            channels: { id: 'channel-1' },
        });
    });

    it('includes shared global audience and only this channels owned single-store announcements', () => {
        const { metadata, adapter } = fixture('SystemAnnouncement', {});
        expect(adapter.scopeWhere(metadata, 'channel-1')).toEqual([
            { ownerChannelId: IsNull(), targetMode: 'ALL' },
            { ownerChannelId: IsNull(), channels: { id: 'channel-1' } },
            { ownerChannelId: 'channel-1', targetMode: 'SINGLE', channels: { id: 'channel-1' } },
        ]);
    });

    it('keeps normal product channel restrictions unchanged', () => {
        const { metadata } = fixture('Product', {});
        expect(customerContentScopeWhere(metadata, 'channel-1')).toEqual({
            channels: { id: 'channel-1' },
        });
    });
});

describe('translation management visibility', () => {
    it.each([
        ['channel-1', 'channel-1', 'SINGLE', ['channel-1'], true],
        ['channel-1', null, 'SINGLE', ['channel-1'], false],
        ['channel-2', null, 'ALL', [], false],
        ['channel-2', 'channel-1', 'SINGLE', ['channel-1'], false],
        ['channel-1', 'channel-1', 'ALL', [], false],
        ['channel-1', 'channel-1', 'MULTIPLE', ['channel-1', 'channel-2'], false],
    ] as const)(
        'keeps announcement owner identity and audience together: %s/%s/%s',
        async (owner, identity, targetMode, audience, allowed) => {
            const { manager, adapter } = fixture('SystemAnnouncement', {
                ownerChannelId: owner,
                targetMode,
                channels: audience.map(id => ({ id })),
                titleZh: '店铺公告',
                titleEn: '',
            });
            await expect(
                adapter.isVisibleInChannel(manager, state('SystemAnnouncement', identity), 'channel-1'),
            ).resolves.toBe(allowed);
            const snapshot = await adapter.load(manager, state('SystemAnnouncement', identity));
            if (allowed) expect(snapshot?.source).toBe('店铺公告');
            else expect(snapshot).toBeUndefined();
        },
    );
    it.each([
        ['ALL', [], true],
        ['SINGLE', [{ id: 'channel-1' }], true],
        ['MULTIPLE', [{ id: 'channel-2' }, { id: 'channel-1' }], true],
        ['SINGLE', [{ id: 'channel-2' }], false],
        ['MULTIPLE', [{ id: 'channel-2' }, { id: 'channel-3' }], false],
    ])(
        'checks announcement audience independently of global identity: %s',
        async (targetMode, channels, visible) => {
            const { manager, adapter } = fixture('SystemAnnouncement', {
                id: 'entity-1',
                targetMode,
                channels,
            });
            await expect(
                adapter.isVisibleInChannel(manager, state('SystemAnnouncement'), 'channel-1'),
            ).resolves.toBe(visible);
        },
    );

    it('rejects an announcement with a fabricated channel-scoped identity', async () => {
        const { manager, adapter } = fixture('SystemAnnouncement', { targetMode: 'ALL', channels: [] });
        await expect(
            adapter.isVisibleInChannel(manager, state('SystemAnnouncement', 'channel-1'), 'channel-1'),
        ).resolves.toBe(false);
        await expect(
            adapter.load(manager, state('SystemAnnouncement', 'channel-1')),
        ).resolves.toBeUndefined();
    });

    it('does not let a null product identity bypass actual channel ownership', async () => {
        const { manager, adapter } = fixture('Product', { channels: [{ id: 'channel-1' }] });
        await expect(adapter.isVisibleInChannel(manager, state('Product'), 'channel-1')).resolves.toBe(false);
        await expect(adapter.load(manager, state('Product'))).resolves.toBeUndefined();
    });

    it('rejects stale product ownership and foreign state identities', async () => {
        const { manager, adapter, repository } = fixture('Product', { channels: [{ id: 'channel-2' }] });
        await expect(
            adapter.isVisibleInChannel(manager, state('Product', 'channel-1'), 'channel-1'),
        ).resolves.toBe(false);
        repository.findOne.mockClear();
        await expect(
            adapter.isVisibleInChannel(manager, state('Product', 'channel-2'), 'channel-1'),
        ).resolves.toBe(false);
        expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('rejects deleted announcements and unregistered entity types', async () => {
        const { manager, adapter } = fixture('SystemAnnouncement', {
            targetMode: 'ALL',
            deletedAt: new Date(),
        });
        await expect(
            adapter.isVisibleInChannel(manager, state('SystemAnnouncement'), 'channel-1'),
        ).resolves.toBe(false);
        await expect(adapter.isVisibleInChannel(manager, state('Unregistered'), 'channel-1')).resolves.toBe(
            false,
        );
    });

    it('retains registered shared country visibility', async () => {
        const { manager, adapter } = fixture('Country', { id: 'entity-1' }, false);
        await expect(adapter.isVisibleInChannel(manager, state('Country'), 'channel-1')).resolves.toBe(true);
    });

    it('requires actual ownership for a channel-column entity, including null identities', async () => {
        const { metadata, manager, adapter } = fixture('StoreProfile', { channelId: 'channel-1' }, false);
        metadata.findColumnWithPropertyName = name => (name === 'channelId' ? ({} as never) : undefined);
        await expect(
            adapter.isVisibleInChannel(manager, state('StoreProfile', 'channel-1'), 'channel-1'),
        ).resolves.toBe(true);
        await expect(adapter.isVisibleInChannel(manager, state('StoreProfile'), 'channel-1')).resolves.toBe(
            false,
        );
        await expect(
            adapter.isVisibleInChannel(manager, state('StoreProfile', 'channel-1'), 'channel-2'),
        ).resolves.toBe(false);
    });

    it.each(['channel-1', 'channel-2'])('checks the content item parent channel: %s', async parentChannel => {
        const { metadata, manager, adapter, repository } = fixture(
            'StorefrontContentItem',
            { blockId: 'block-1' },
            false,
        );
        const parentTarget = class FixtureBlock {};
        metadata.relations = [
            { propertyName: 'block', inverseEntityMetadata: { target: parentTarget } } as never,
        ];
        const parentRepository = {
            findOne: vi.fn().mockResolvedValue({ id: 'block-1', channelId: parentChannel }),
        };
        manager.getRepository = vi.fn(target =>
            target === parentTarget ? parentRepository : repository,
        ) as unknown as EntityManager['getRepository'];
        await expect(
            adapter.isVisibleInChannel(manager, state('StorefrontContentItem', 'channel-1'), 'channel-1'),
        ).resolves.toBe(parentChannel === 'channel-1');
    });
});

describe('global announcement worker snapshots', () => {
    it.each([{ channels: [] }, { channels: [{ id: 'channel-1' }] }])(
        'loads the single global translation for audience %j',
        async ({ channels }) => {
            const { manager, adapter, repository } = fixture('SystemAnnouncement', {
                id: 'entity-1',
                targetMode: channels.length ? 'SINGLE' : 'ALL',
                channels,
                titleZh: '系统公告',
                titleEn: '',
            });
            const snapshot = await adapter.load(manager, state('SystemAnnouncement'));
            expect(snapshot).toMatchObject({
                source: '系统公告',
                target: '',
                format: 'TEXT',
                maxTargetLength: 120,
            });
            expect(repository.update).not.toHaveBeenCalled();
        },
    );
});
