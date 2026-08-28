import { QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AlignHardenedImageGenerationSchema1787821200000 } from './1787821200000-align-hardened-image-generation-schema';

describe('align hardened image generation schema migration', () => {
    it('removes MySQL defaults without changing data and adds the relation index', async () => {
        const jobTable = new Table({
            name: 'image_generation_job',
            columns: [
                {
                    name: 'providerScopeSnapshot',
                    type: 'varchar',
                    length: '24',
                    default: "'OPENAI'",
                },
                {
                    name: 'providerCredentialFingerprint',
                    type: 'varchar',
                    length: '64',
                    default: "''",
                },
            ],
        });
        const dispatchTable = new Table({
            name: 'image_generation_dispatch',
            columns: [{ name: 'outputId', type: 'int' }],
            indices: [
                {
                    name: 'IDX_image_generation_dispatch_output',
                    columnNames: ['outputId'],
                    isUnique: true,
                },
            ],
        });
        const changedColumns: Array<{ name: string; defaultValue: unknown }> = [];
        const createdIndices: Array<{ name?: string; columnNames: string[]; isUnique: boolean }> = [];
        const query = vi.fn(() => Promise.resolve([]));
        const dropIndex = vi.fn(() => Promise.resolve());
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn((tableName: string) =>
                Promise.resolve(tableName === jobTable.name ? jobTable : dispatchTable),
            ),
            changeColumn: vi.fn((_table: Table, _current: TableColumn, aligned: TableColumn) => {
                changedColumns.push({ name: aligned.name, defaultValue: aligned.default });
                return Promise.resolve();
            }),
            query,
            dropIndex,
            createIndex: vi.fn((_table: Table, index: TableIndex) => {
                createdIndices.push({
                    name: index.name,
                    columnNames: index.columnNames,
                    isUnique: index.isUnique,
                });
                return Promise.resolve();
            }),
        } as unknown as QueryRunner;

        await new AlignHardenedImageGenerationSchema1787821200000().up(queryRunner);

        expect(changedColumns).toEqual([
            { name: 'providerScopeSnapshot', defaultValue: undefined },
            { name: 'providerCredentialFingerprint', defaultValue: undefined },
        ]);
        expect(createdIndices).toEqual([
            {
                name: 'REL_0be31615787ef5ff5fcb63f89e',
                columnNames: ['outputId'],
                isUnique: true,
            },
        ]);
        expect(query).toHaveBeenCalledOnce();
        expect(dropIndex).not.toHaveBeenCalled();
    });

    it('skips non-MySQL databases', async () => {
        const getTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            getTable,
        } as unknown as QueryRunner;

        await new AlignHardenedImageGenerationSchema1787821200000().up(queryRunner);

        expect(getTable).not.toHaveBeenCalled();
    });
});
