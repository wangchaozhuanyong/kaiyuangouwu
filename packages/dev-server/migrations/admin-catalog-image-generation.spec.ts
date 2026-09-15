/* eslint-disable @typescript-eslint/require-await -- QueryRunner mocks preserve async database APIs. */
import { DataSource, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddAdminCatalogImageGeneration1789358400000 } from './1789358400000-add-admin-catalog-image-generation';

describe('admin catalog image generation migration', () => {
    it('uses MySQL-compatible IDs, foreign keys, nullable owners and indexes', async () => {
        const tables = new Map<string, Table>([
            [
                'image_generation_job',
                ownerTable('image_generation_job', 'FK_image_generation_job_customer', true),
            ],
            ['image_private_asset', ownerTable('image_private_asset', 'FK_image_private_asset_customer')],
            [
                'image_generation_output',
                new Table({ name: 'image_generation_output', columns: [{ name: 'id', type: 'int' }] }),
            ],
        ]);
        const runner = {
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn(async (name: string) => tables.get(name)),
            hasColumn: vi.fn(async (name: string, column: string) =>
                Boolean(tables.get(name)?.findColumnByName(column)),
            ),
            dropForeignKey: vi.fn(async (table: Table, key: TableForeignKey) => {
                table.foreignKeys = table.foreignKeys.filter(item => item.name !== key.name);
            }),
            changeColumn: vi.fn(async (table: Table, old: TableColumn, replacement: TableColumn) => {
                table.columns = table.columns.map(column =>
                    column.name === old.name ? replacement : column,
                );
            }),
            addColumn: vi.fn(async (name: string, column: TableColumn) =>
                tables.get(name)?.columns.push(column),
            ),
            createForeignKey: vi.fn(async (name: string, key: TableForeignKey) =>
                tables.get(name)?.foreignKeys.push(key),
            ),
            createIndex: vi.fn(async (name: string, index: TableIndex) =>
                tables.get(name)?.indices.push(index),
            ),
        } as unknown as QueryRunner;

        await new AddAdminCatalogImageGeneration1789358400000().up(runner);

        const job = tables.get('image_generation_job');
        expect(job).toBeDefined();
        if (!job) throw new Error('image_generation_job fixture is missing');
        expect(job.findColumnByName('customerId')?.isNullable).toBe(true);
        expect(job.findColumnByName('administratorUserId')).toMatchObject({ type: 'int', isNullable: true });
        expect(job.findColumnByName('origin')?.default).toBe("'CUSTOMER_STUDIO'");
        expect(job.indices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'IDX_image_generation_job_admin_idempotency',
                    isUnique: true,
                }),
            ]),
        );
        expect(job.foreignKeys).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'FK_image_generation_job_customer', onDelete: 'CASCADE' }),
                expect.objectContaining({ name: 'FK_image_generation_job_admin', onDelete: 'SET NULL' }),
            ]),
        );
        expect(tables.get('image_generation_output')?.findColumnByName('catalogAssetId')?.type).toBe('int');
    });

    it('keeps customer rows and adds nullable administrator ownership on SQLite', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const runner = dataSource.createQueryRunner();
        try {
            for (const name of ['channel', 'customer', 'user', 'asset']) {
                await runner.createTable(
                    new Table({
                        name,
                        columns: [{ name: 'id', type: 'integer', isPrimary: true }],
                    }),
                );
                await runner.query(`INSERT INTO "${name}" ("id") VALUES (1)`);
            }
            await runner.createTable(
                new Table({
                    name: 'image_generation_job',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'channelId', type: 'integer' },
                        { name: 'customerId', type: 'integer' },
                        { name: 'idempotencyKey', type: 'varchar', length: '64' },
                        { name: 'createdAt', type: 'datetime' },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_image_generation_job_customer',
                            columnNames: ['customerId'],
                            referencedTableName: 'customer',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
            );
            await runner.createTable(
                new Table({
                    name: 'image_private_asset',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true },
                        { name: 'customerId', type: 'integer' },
                        { name: 'createdAt', type: 'datetime' },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_image_private_asset_customer',
                            columnNames: ['customerId'],
                            referencedTableName: 'customer',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
            );
            await runner.createTable(
                new Table({
                    name: 'image_generation_output',
                    columns: [{ name: 'id', type: 'integer', isPrimary: true }],
                }),
            );
            await runner.query(
                `INSERT INTO "image_generation_job" ("id", "channelId", "customerId", "idempotencyKey", "createdAt") VALUES (1, 1, 1, 'customer-old', '2026-09-14')`,
            );
            await runner.query(
                `INSERT INTO "image_private_asset" ("id", "customerId", "createdAt") VALUES (1, 1, '2026-09-14')`,
            );

            const migration = new AddAdminCatalogImageGeneration1789358400000();
            await migration.up(runner);
            await migration.up(runner);

            const jobs = await runner.query(
                `SELECT "customerId", "administratorUserId", "origin" FROM "image_generation_job" WHERE "id" = 1`,
            );
            expect(jobs).toEqual([{ customerId: 1, administratorUserId: null, origin: 'CUSTOMER_STUDIO' }]);
            expect(
                (await runner.getTable('image_generation_job'))?.findColumnByName('customerId')?.isNullable,
            ).toBe(true);
            expect(
                (await runner.getTable('image_private_asset'))?.findColumnByName('customerId')?.isNullable,
            ).toBe(true);
            await expect(
                runner.query(
                    [
                        `INSERT INTO "image_generation_job" `,
                        `("id", "channelId", "customerId", "administratorUserId", "origin", `,
                        `"idempotencyKey", "createdAt") VALUES `,
                        `(2, 1, NULL, 1, 'ADMIN_PRODUCT_IMAGE', 'admin-new', '2026-09-14')`,
                    ].join(''),
                ),
            ).resolves.toBeDefined();
            expect(await runner.hasColumn('image_generation_output', 'catalogAssetId')).toBe(true);
            expect(await runner.hasColumn('image_generation_output', 'usedAt')).toBe(true);
        } finally {
            await runner.release();
            await dataSource.destroy();
        }
    });
});

function ownerTable(name: string, foreignKeyName: string, job = false): Table {
    return new Table({
        name,
        columns: [
            { name: 'id', type: 'int' },
            { name: 'customerId', type: 'int' },
            { name: 'createdAt', type: 'datetime' },
            ...(job
                ? [
                      { name: 'channelId', type: 'int' },
                      { name: 'idempotencyKey', type: 'varchar', length: '64' },
                  ]
                : []),
        ],
        foreignKeys: [
            {
                name: foreignKeyName,
                columnNames: ['customerId'],
                referencedTableName: 'customer',
                referencedColumnNames: ['id'],
                onDelete: 'CASCADE',
            },
        ],
    });
}
