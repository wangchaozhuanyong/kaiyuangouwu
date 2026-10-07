import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { Collection, Product, RequestContext } from '@vendure/core';
import { EntityMetadata } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ContentTranslationBackfillService } from './content-translation-backfill.service.js';
import { NativeContentTranslationService } from './native-content-translation.service.js';
import { TranslationContentAdapter } from './translation-content-adapter.js';

function collectionFixture(includeVisible: boolean, disappearAfterCount = false) {
    const metadata = {
        name: 'Collection',
        target: Collection,
        relations: [{ propertyName: 'channels' }],
        findColumnWithPropertyName: () => undefined,
    } as unknown as EntityMetadata;
    const visible = new Collection({
        id: 'visible-collection',
        isRoot: false,
        translations: [
            { languageCode: 'zh_Hans', name: '客户分类', slug: 'category', description: '' } as never,
        ],
    });
    const repository = {
        count: vi.fn(({ where }: { where: { isRoot?: boolean } }) =>
            Promise.resolve((includeVisible ? 1 : 0) + (where.isRoot === false ? 0 : 1)),
        ),
        find: vi.fn(({ skip, take }: { skip: number; take: number }) =>
            Promise.resolve(includeVisible && !disappearAfterCount ? [visible].slice(skip, skip + take) : []),
        ),
    };
    const connection = {
        rawConnection: { entityMetadatas: [metadata], getMetadata: () => metadata },
        getRepository: () => repository,
        withTransaction: (transactionContext: unknown, work: (value: unknown) => unknown) =>
            work(transactionContext),
    };
    const native = new NativeContentTranslationService({} as never, connection as never, {} as never);
    const enqueue = vi.spyOn(native, 'translateEntity').mockResolvedValue(false);
    const service = new ContentTranslationBackfillService(
        connection as never,
        native,
        {} as never,
        new TranslationContentAdapter(connection as never),
    );
    return { service, native, repository, enqueue };
}

const ctx = { channelId: 'channel-1', channel: { code: DEFAULT_CHANNEL_CODE } } as RequestContext;

describe('combined historical translation backfill progress', () => {
    it('rejects store-context backfill before scanning any customer content', async () => {
        const { service, repository, enqueue } = collectionFixture(true);
        await expect(
            service.backfill(
                { channelId: 'channel-1', channel: { code: 'store' } } as RequestContext,
                'Collection',
            ),
        ).rejects.toThrow('批量补译请切换到平台管理中心');
        expect(repository.count).not.toHaveBeenCalled();
        expect(repository.find).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    });
    it('terminates when this channel has only an internal root collection', async () => {
        const { service, repository, enqueue } = collectionFixture(false);
        await expect(service.backfill(ctx, 'Collection', 100, 0)).resolves.toMatchObject({
            total: 0,
            scanned: 0,
            nextOffset: 0,
            hasMore: false,
        });
        expect(repository.find).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('uses the same count and scan scope and ends after the visible collection', async () => {
        const { service, repository } = collectionFixture(true);
        await expect(service.backfill(ctx, 'Collection', 100, 0)).resolves.toMatchObject({
            total: 1,
            scanned: 1,
            processed: 1,
            nextOffset: 1,
            hasMore: false,
        });
        const expected = { isRoot: false, channels: { id: 'channel-1' } };
        for (const [options] of repository.count.mock.calls) expect(options.where).toEqual(expected);
        expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({ where: expected }));
    });

    it('does not return a perpetual hasMore page after content disappears', async () => {
        const { service } = collectionFixture(true, true);
        await expect(service.backfill(ctx, 'Collection', 100, 0)).rejects.toThrow('补译扫描未取得进展');
    });

    it('protects the outer scanner even if a nested page reports no progress', async () => {
        const { service, native } = collectionFixture(true);
        vi.spyOn(native, 'backfill').mockResolvedValue({
            total: 1,
            scanned: 0,
            processed: 0,
            queued: 0,
            skipped: 0,
            failed: 0,
            nextOffset: 0,
            hasMore: true,
            errors: [],
            skippedRecords: [],
        });
        await expect(service.backfill(ctx, 'Collection', 100, 0)).rejects.toThrow('补译扫描未取得进展');
    });

    it('accepts an exhausted offset without claiming remaining work', async () => {
        const { service } = collectionFixture(true);
        await expect(service.backfill(ctx, 'Collection', 100, 5)).resolves.toMatchObject({
            total: 1,
            scanned: 0,
            nextOffset: 1,
            hasMore: false,
        });
    });

    it('advances across native types using only their customer-visible counts', async () => {
        const classes = [Product, Collection];
        const metadata = classes.map(target => ({
            name: target.name,
            target,
            relations: [{ propertyName: 'channels' }],
            findColumnWithPropertyName: () => undefined,
        }));
        const repositories = new Map(
            classes.map(target => [
                target,
                {
                    count: vi.fn(({ where }: { where: { isRoot?: boolean } }) =>
                        Promise.resolve(target === Collection && where.isRoot !== false ? 2 : 1),
                    ),
                    find: vi.fn(({ skip, take }: { skip: number; take: number }) =>
                        Promise.resolve(
                            [
                                new target({
                                    id: target.name,
                                    translations: [{ languageCode: 'zh_Hans', name: '客户内容' } as never],
                                }),
                            ].slice(skip, skip + take),
                        ),
                    ),
                },
            ]),
        );
        const connection = {
            rawConnection: {
                entityMetadatas: metadata,
                getMetadata: (target: (typeof classes)[number]) =>
                    metadata.find(item => item.target === target),
            },
            getRepository: (_context: unknown, target: (typeof classes)[number]) => repositories.get(target),
            withTransaction: (transactionContext: unknown, work: (value: unknown) => unknown) =>
                work(transactionContext),
        };
        const native = new NativeContentTranslationService({} as never, connection as never, {} as never);
        vi.spyOn(native, 'translateEntity').mockResolvedValue(false);
        const service = new ContentTranslationBackfillService(
            connection as never,
            native,
            {} as never,
            new TranslationContentAdapter(connection as never),
        );
        await expect(service.backfill(ctx, null, 1, 0)).resolves.toMatchObject({
            total: 2,
            scanned: 1,
            nextOffset: 1,
            hasMore: true,
        });
        await expect(service.backfill(ctx, null, 1, 1)).resolves.toMatchObject({
            total: 2,
            scanned: 1,
            nextOffset: 2,
            hasMore: false,
        });
    });
});
