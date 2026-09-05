import { QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddCouponCampaignArchive1788652860000 } from './1788652860000-add-coupon-campaign-archive';

const tableName = 'store_coupon_campaign_config';
const indexName = 'IDX_store_coupon_campaign_config_channel_archived_created';

describe('coupon campaign archive migration', () => {
    it.each([
        ['mysql', 'datetime'],
        ['postgres', 'timestamp without time zone'],
    ] as const)(
        'adds a nullable archive timestamp and lookup index on %s',
        async (databaseType, dateType) => {
            const before = campaignTable();
            const afterColumn = campaignTable({ archived: true });
            const addColumn = vi.fn().mockResolvedValue(undefined);
            const createIndex = vi.fn().mockResolvedValue(undefined);
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn().mockResolvedValue(true),
                getTable: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(afterColumn),
                addColumn,
                createIndex,
            } as unknown as QueryRunner;

            await new AddCouponCampaignArchive1788652860000().up(queryRunner);

            const column = addColumn.mock.calls[0][1] as TableColumn;
            expect(column).toMatchObject({ name: 'archivedAt', type: dateType, isNullable: true });
            const index = createIndex.mock.calls[0][1] as TableIndex;
            expect(index).toMatchObject({
                name: indexName,
                columnNames: ['channelId', 'archivedAt', 'createdAt'],
            });
        },
    );

    it('is idempotent and reverses only the archive schema it owns', async () => {
        const complete = campaignTable({ archived: true, indexed: true });
        const addColumn = vi.fn();
        const createIndex = vi.fn();
        const dropIndex = vi.fn().mockResolvedValue(undefined);
        const dropColumn = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'sqlite' } },
            hasTable: vi.fn().mockResolvedValue(true),
            getTable: vi.fn().mockResolvedValue(complete),
            addColumn,
            createIndex,
            dropIndex,
            dropColumn,
        } as unknown as QueryRunner;
        const migration = new AddCouponCampaignArchive1788652860000();

        await migration.up(queryRunner);
        expect(addColumn).not.toHaveBeenCalled();
        expect(createIndex).not.toHaveBeenCalled();

        await migration.down(queryRunner);
        expect(dropIndex).toHaveBeenCalledWith(tableName, indexName);
        expect(dropColumn).toHaveBeenCalledWith(tableName, 'archivedAt');
    });
});

function campaignTable({ archived = false, indexed = false } = {}) {
    return new Table({
        name: tableName,
        columns: [
            { name: 'channelId', type: 'varchar' },
            { name: 'createdAt', type: 'datetime' },
            ...(archived ? [{ name: 'archivedAt', type: 'datetime', isNullable: true }] : []),
        ],
        indices: indexed ? [{ name: indexName, columnNames: ['channelId', 'archivedAt', 'createdAt'] }] : [],
    });
}
