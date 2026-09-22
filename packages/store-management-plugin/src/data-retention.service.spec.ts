import { Asset } from '@vendure/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    CUSTOMER_AVATAR_RETENTION_DAYS,
    CUSTOMER_AVATAR_RETENTION_POLICY,
    customerAvatarSubjectHash,
    DataRetentionService,
} from './data-retention.service';
import { DataRetentionRecord } from './entities/data-retention-record.entity';

const ctx = { channelId: 'channel-1', activeUserId: 'admin-1' } as any;

function createService(options: { referenced?: boolean } = {}) {
    const recordQuery: any = {
        where: vi.fn(),
        andWhere: vi.fn(),
        setLock: vi.fn(),
        getOne: vi.fn(),
    };
    for (const method of ['where', 'andWhere', 'setLock']) recordQuery[method].mockReturnValue(recordQuery);
    const retentionRepository = {
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn((record: unknown) => Promise.resolve(record)),
        createQueryBuilder: vi.fn(() => recordQuery),
    };
    const assetRepository = {
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        remove: vi.fn().mockResolvedValue(undefined),
    };
    const referenceQuery: any = {
        innerJoin: vi.fn(),
        where: vi.fn(),
        getExists: vi.fn().mockResolvedValue(options.referenced ?? false),
    };
    referenceQuery.innerJoin.mockReturnValue(referenceQuery);
    referenceQuery.where.mockReturnValue(referenceQuery);
    const ownerRepository = { createQueryBuilder: vi.fn(() => referenceQuery) };
    class ReferencingEntity {}
    const entityMetadatas = options.referenced
        ? [
              {
                  name: 'ReferencingEntity',
                  isJunction: false,
                  target: ReferencingEntity,
                  relations: [
                      {
                          propertyPath: 'featuredAsset',
                          inverseEntityMetadata: { target: Asset },
                      },
                  ],
                  findColumnWithPropertyName: vi.fn().mockReturnValue(undefined),
              },
          ]
        : [];
    const connection = {
        rawConnection: { options: { type: 'mysql' }, entityMetadatas },
        getRepository: vi.fn((_ctx, target) => {
            if (target === DataRetentionRecord) return retentionRepository;
            if (target === Asset) return assetRepository;
            return ownerRepository;
        }),
        withTransaction: vi.fn((_ctx, work) => work(_ctx)),
    };
    const storage = { deleteFile: vi.fn().mockResolvedValue(undefined) };
    return {
        recordQuery,
        retentionRepository,
        assetRepository,
        referenceQuery,
        storage,
        service: new DataRetentionService(
            connection as any,
            { assetOptions: { assetStorageStrategy: storage } } as any,
        ),
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('DataRetentionService', () => {
    it('quarantines replaced avatars for 30 days without deleting them', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-20T00:00:00.000Z'));
        const test = createService();

        const record = await test.service.quarantineAvatar(
            ctx,
            { id: 'asset-1' } as Asset,
            'customer-1',
            'REPLACED',
        );

        expect(record).toMatchObject({
            channelId: 'channel-1',
            resourceType: 'CUSTOMER_AVATAR',
            resourceKey: 'asset-1',
            subjectKeyHash: customerAvatarSubjectHash('customer-1'),
            policyCode: CUSTOMER_AVATAR_RETENTION_POLICY,
            status: 'PENDING',
            legalHold: false,
            attemptCount: 0,
        });
        expect(record.purgeAfter.getTime() - record.quarantinedAt.getTime()).toBe(
            CUSTOMER_AVATAR_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        );
        expect(test.storage.deleteFile).not.toHaveBeenCalled();
        expect(test.assetRepository.remove).not.toHaveBeenCalled();
    });

    it('purges an expired unreferenced avatar and preserves the audit record', async () => {
        const test = createService();
        const record = Object.assign(new DataRetentionRecord(), {
            id: 'retention-1',
            channelId: 'channel-1',
            resourceType: 'CUSTOMER_AVATAR' as const,
            resourceKey: 'asset-1',
            subjectKeyHash: customerAvatarSubjectHash('customer-1'),
            status: 'PENDING' as const,
            legalHold: false,
            nextAttemptAt: new Date(0),
            attemptCount: 0,
        });
        const asset = {
            id: 'asset-1',
            source: 'source.webp',
            preview: 'preview.webp',
            channels: [
                { id: 'channel-1', code: 'shop' },
                { id: 'default', code: '__default_channel__' },
            ],
            tags: [{ value: 'customer-avatar' }, { value: 'customer-avatar-owner:customer-1' }],
        } as any;
        test.retentionRepository.find.mockResolvedValue([record]);
        test.recordQuery.getOne.mockResolvedValue(record);
        test.assetRepository.findOne.mockResolvedValue(asset);

        await expect(test.service.purgeDue(ctx)).resolves.toEqual({
            processed: 1,
            purged: 1,
            blocked: 0,
            failed: 0,
        });
        expect(test.storage.deleteFile.mock.calls).toEqual([['source.webp'], ['preview.webp']]);
        expect(test.assetRepository.remove).toHaveBeenCalledWith(asset);
        expect(record.status).toBe('PURGED');
        expect(record.completedAt).toBeInstanceOf(Date);
    });

    it('blocks deletion while any business entity still references the avatar', async () => {
        const test = createService({ referenced: true });
        const record = Object.assign(new DataRetentionRecord(), {
            id: 'retention-1',
            channelId: 'channel-1',
            resourceType: 'CUSTOMER_AVATAR' as const,
            resourceKey: 'asset-1',
            subjectKeyHash: customerAvatarSubjectHash('customer-1'),
            status: 'PENDING' as const,
            legalHold: false,
            nextAttemptAt: new Date(0),
            attemptCount: 0,
        });
        test.retentionRepository.find.mockResolvedValue([record]);
        test.recordQuery.getOne.mockResolvedValue(record);
        test.assetRepository.findOne.mockResolvedValue({
            id: 'asset-1',
            source: 'source.webp',
            preview: 'preview.webp',
            channels: [{ id: 'channel-1', code: 'shop' }],
            tags: [{ value: 'customer-avatar' }, { value: 'customer-avatar-owner:customer-1' }],
        });

        await expect(test.service.purgeDue(ctx)).resolves.toEqual({
            processed: 1,
            purged: 0,
            blocked: 1,
            failed: 0,
        });
        expect(record.status).toBe('BLOCKED_REFERENCE');
        expect(test.storage.deleteFile).not.toHaveBeenCalled();
        expect(test.assetRepository.remove).not.toHaveBeenCalled();
    });

    it('requires a reason for legal hold and records the acting administrator', async () => {
        const test = createService();
        const record = Object.assign(new DataRetentionRecord(), {
            id: 'retention-1',
            status: 'PENDING' as const,
        });
        test.retentionRepository.findOne.mockResolvedValue(record);

        await expect(test.service.setLegalHold(ctx, record.id, true, '  ')).rejects.toThrow('必须填写原因');
        await expect(test.service.setLegalHold(ctx, record.id, true, '涉及退款争议')).resolves.toBe(record);
        expect(record).toMatchObject({
            legalHold: true,
            legalHoldReason: '涉及退款争议',
            legalHoldChangedByUserId: 'admin-1',
        });
    });

    it('rejects legal-hold changes after a record is restored or purged', async () => {
        const test = createService();
        const record = Object.assign(new DataRetentionRecord(), {
            id: 'retention-1',
            status: 'RESTORED' as const,
        });
        test.retentionRepository.findOne.mockResolvedValue(record);

        await expect(test.service.setLegalHold(ctx, record.id, true, '争议处理')).rejects.toThrow(
            '只有等待清理、引用阻断或清理失败的数据可以设置法律保留',
        );
        expect(test.retentionRepository.save).not.toHaveBeenCalled();
    });
});
