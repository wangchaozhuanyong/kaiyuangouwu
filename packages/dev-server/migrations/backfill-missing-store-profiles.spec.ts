import { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { BackfillMissingStoreProfiles1787605200000 } from './1787605200000-backfill-missing-store-profiles';

describe('BackfillMissingStoreProfiles migration', () => {
    it('creates profiles only for channels which do not already have one', async () => {
        let insertedValues: Array<Record<string, unknown>> = [];
        const builder = {
            insert: vi.fn(() => builder),
            into: vi.fn(() => builder),
            values: vi.fn((values: Array<Record<string, unknown>>) => {
                insertedValues = values;
                return builder;
            }),
            execute: vi.fn().mockResolvedValue(undefined),
        };
        const query = vi
            .fn()
            .mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }])
            .mockResolvedValueOnce([{ channelId: 1, sortOrder: 4 }]);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            hasTable: vi.fn().mockResolvedValue(true),
            query,
            manager: { createQueryBuilder: vi.fn(() => builder) },
        } as unknown as QueryRunner;

        await new BackfillMissingStoreProfiles1787605200000().up(queryRunner);

        expect(insertedValues).toEqual([
            expect.objectContaining({ channelId: 2, sortOrder: 5, status: 'DRAFT' }),
            expect.objectContaining({ channelId: 3, sortOrder: 6, status: 'DRAFT' }),
        ]);
        expect(builder.execute).toHaveBeenCalledOnce();
    });
});
