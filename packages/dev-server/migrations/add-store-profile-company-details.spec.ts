import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddStoreProfileCompanyDetails1790730000000 } from './1790730000000-add-store-profile-company-details';

describe('store profile company details migration', () => {
    it('adds optional registration number and contact address without changing existing data', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'store_profile',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true, isGenerated: true },
                        { name: 'legalEntityName', type: 'varchar', length: '200', isNullable: true },
                    ],
                }),
            );
            await queryRunner.query(`INSERT INTO store_profile (legalEntityName) VALUES (?)`, [
                'Existing Example Company',
            ]);
            const migration = new AddStoreProfileCompanyDetails1790730000000();

            await migration.up(queryRunner);
            await migration.up(queryRunner);

            const table = await queryRunner.getTable('store_profile');
            expect(table?.findColumnByName('legalRegistrationNumber')?.length).toBe('100');
            expect(table?.findColumnByName('legalContactAddress')?.length).toBe('500');
            expect(await queryRunner.query(`SELECT legalEntityName FROM store_profile`)).toEqual([
                { legalEntityName: 'Existing Example Company' },
            ]);

            await migration.down(queryRunner);
            expect(await queryRunner.hasColumn('store_profile', 'legalRegistrationNumber')).toBe(false);
            expect(await queryRunner.hasColumn('store_profile', 'legalContactAddress')).toBe(false);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
