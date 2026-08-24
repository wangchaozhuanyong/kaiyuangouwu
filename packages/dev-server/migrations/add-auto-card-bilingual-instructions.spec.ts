import { QueryRunner, Table, TableColumn } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddAutoCardBilingualInstructions1787608800000 } from './1787608800000-add-auto-card-bilingual-instructions';

describe('AddAutoCardBilingualInstructions migration', () => {
    it.each(['mysql', 'postgres'] as const)(
        'adds and backfills both instruction columns on %s',
        async type => {
            const table = new Table({
                name: 'auto_card_config',
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'instructions', type: 'text' },
                ],
            });
            const query = vi.fn(() => Promise.resolve(undefined));
            const queryRunner = {
                connection: { options: { type } },
                getTable: vi.fn(() => Promise.resolve(table)),
                addColumn: vi.fn((_table: Table, column: TableColumn) =>
                    Promise.resolve(table.addColumn(column)),
                ),
                query,
            } as unknown as QueryRunner;

            await new AddAutoCardBilingualInstructions1787608800000().up(queryRunner);

            expect(table.findColumnByName('instructionsZh')).toMatchObject({
                type: 'text',
                isNullable: true,
            });
            expect(table.findColumnByName('instructionsEn')).toMatchObject({
                type: 'text',
                isNullable: true,
            });
            expect(query).toHaveBeenCalledTimes(2);
            expect(query.mock.calls[0]?.[0]).toContain(
                type === 'mysql' ? '`instructionsZh`' : '"instructionsZh"',
            );
        },
    );

    it('is idempotent when both columns already exist', async () => {
        const table = new Table({
            name: 'auto_card_config',
            columns: [
                { name: 'id', type: 'int' },
                { name: 'instructions', type: 'text' },
                { name: 'instructionsZh', type: 'text', isNullable: true },
                { name: 'instructionsEn', type: 'text', isNullable: true },
            ],
        });
        const addColumn = vi.fn();
        const query = vi.fn(() => Promise.resolve(undefined));
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn(() => Promise.resolve(table)),
            addColumn,
            query,
        } as unknown as QueryRunner;

        await new AddAutoCardBilingualInstructions1787608800000().up(queryRunner);

        expect(addColumn).not.toHaveBeenCalled();
        expect(query).toHaveBeenCalledTimes(2);
    });
});
