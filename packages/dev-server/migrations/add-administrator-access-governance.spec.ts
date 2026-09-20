/* eslint-disable @typescript-eslint/require-await -- QueryRunner mocks preserve async database APIs. */
import { QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddAdministratorAccessGovernance1789408800000 } from './1789408800000-add-administrator-access-governance';

function runner(
    databaseType: 'mysql' | 'postgres' | 'sqlite',
    ownerCount = 1,
    unmappedRows: Array<Record<string, unknown>> = [],
) {
    const tables: Table[] = [];
    const query = vi.fn(async (sql: string) => {
        if (sql.includes('COUNT(*)')) return [{ count: 0 }];
        if (sql.includes('NOT EXISTS')) return unmappedRows;
        if (sql.includes('__super_admin_role__') || (sql.includes('INNER JOIN') && sql.includes('role'))) {
            return Array.from({ length: ownerCount }, (_, index) => ({
                administratorId: index + 1,
                userId: index + 10,
            }));
        }
        if (sql.includes('store_administrator_access')) return [];
        return [];
    });
    const queryRunner = {
        connection: {
            options: { type: databaseType },
            driver: { escape: (name: string) => `"${name}"` },
        },
        hasTable: vi.fn(async (name: string) => name === 'store_administrator_access'),
        createTable: vi.fn(async (table: Table) => tables.push(table)),
        query,
    } as unknown as QueryRunner;
    return { query, queryRunner, tables };
}

describe('administrator access and governance migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)('creates portable access tables on %s', async type => {
        const { queryRunner, tables } = runner(type);
        await new AddAdministratorAccessGovernance1789408800000().up(queryRunner);

        expect(tables.map(table => table.name)).toEqual([
            'administrator_access_profile',
            'administrator_permission_audit',
            'store_governance_change_request',
        ]);
        expect(tables[0].indices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'IDX_administrator_access_profile_owner_slot',
                    isUnique: true,
                }),
                expect.objectContaining({
                    name: 'IDX_administrator_access_profile_store_primary_slot',
                    isUnique: true,
                }),
            ]),
        );
        expect(tables[2].findColumnByName('encryptedPayload')?.type).toBe('text');
    });

    it('stops backfill when the database contains multiple SuperAdmin accounts', async () => {
        const { queryRunner } = runner('mysql', 2);
        await expect(new AddAdministratorAccessGovernance1789408800000().up(queryRunner)).rejects.toThrow(
            'exactly one active SuperAdmin',
        );
    });

    it('stops when an unmapped account has no Channel-bound role', async () => {
        const { queryRunner } = runner('mysql', 1, [
            {
                administratorId: 8,
                userId: 18,
                roleCode: 'ambiguous',
                permissions: '["ReadProduct"]',
                channelId: null,
            },
        ]);
        await expect(new AddAdministratorAccessGovernance1789408800000().up(queryRunner)).rejects.toThrow(
            'no Channel-bound role',
        );
    });

    it('stops when a single-store role contains a platform-only permission', async () => {
        const { queryRunner } = runner('postgres', 1, [
            {
                administratorId: 9,
                userId: 19,
                roleCode: 'unsafe-store-role',
                permissions: '["ReadProduct","CreateAdministrator"]',
                channelId: 2,
            },
        ]);
        await expect(new AddAdministratorAccessGovernance1789408800000().up(queryRunner)).rejects.toThrow(
            'platform-only permission CreateAdministrator',
        );
    });
});
