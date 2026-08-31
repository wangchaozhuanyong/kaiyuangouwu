import { QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddDashboardTwoFactorAccounts1787904000000 } from './1787904000000-add-dashboard-two-factor-accounts';

describe('AddDashboardTwoFactorAccounts migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)(
        'creates encrypted administrator-scoped storage on %s',
        async databaseType => {
            let created: Table | undefined;
            const queryRunner = {
                connection: { options: { type: databaseType } },
                hasTable: vi.fn(() => Promise.resolve(false)),
                createTable: vi.fn((table: Table) => {
                    created = table;
                    return Promise.resolve();
                }),
            } as unknown as QueryRunner;

            await new AddDashboardTwoFactorAccounts1787904000000().up(queryRunner);

            expect(created?.name).toBe('dashboard_two_factor_account');
            expect(created?.findColumnByName('encryptedSecret')).toMatchObject({ type: 'text' });
            expect(created?.findColumnByName('secret')).toBeUndefined();
            expect(created?.indices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'IDX_dashboard_two_factor_owner_fingerprint',
                        isUnique: true,
                    }),
                ]),
            );
            expect(created?.foreignKeys).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'FK_dashboard_two_factor_administrator',
                        referencedTableName: 'administrator',
                        onDelete: 'CASCADE',
                    }),
                ]),
            );
        },
    );

    it('does nothing when the table already exists', async () => {
        const createTable = vi.fn();
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            hasTable: vi.fn(() => Promise.resolve(true)),
            createTable,
        } as unknown as QueryRunner;

        await new AddDashboardTwoFactorAccounts1787904000000().up(queryRunner);

        expect(createTable).not.toHaveBeenCalled();
    });
});
