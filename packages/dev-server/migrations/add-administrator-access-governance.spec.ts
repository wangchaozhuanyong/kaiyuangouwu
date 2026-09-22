/* eslint-disable @typescript-eslint/require-await -- QueryRunner mocks preserve async database APIs. */
import { QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddAdministratorAccessGovernance1789408800000 } from './1789408800000-add-administrator-access-governance';

function runner(
    databaseType: 'mysql' | 'postgres' | 'sqlite',
    ownerCount = 1,
    unmappedRows: Array<Record<string, unknown>> = [],
    storeAccounts: Array<Record<string, unknown>> = [],
    storeRoleRows: Array<Record<string, unknown>> = [],
    channelCode = '__default_channel__',
) {
    const tables: Table[] = [];
    const query = vi.fn(async (sql: string) => {
        if (sql.includes('COUNT(*)')) return [{ count: 0 }];
        if (sql.includes('NOT EXISTS')) return unmappedRows;
        if (sql.includes('SELECT DISTINCT') && sql.includes('role_channels_channel')) {
            return [{ channelId: 1 }];
        }
        if (sql.includes('FROM "channel" WHERE')) return [{ code: channelCode }];
        if (
            sql.includes('SELECT "id" AS id, "permissions" AS permissions') &&
            sql.includes('FROM "role" WHERE')
        ) {
            return [{ id: 4, permissions: '["ReadProduct","CreateAdministrator"]' }];
        }
        if (sql.includes('SELECT "id" AS id FROM "channel"')) {
            return [{ id: 1 }, { id: 2 }, { id: 3 }];
        }
        if (sql.includes('FROM "store_administrator_access" s')) return storeAccounts;
        if (sql.includes('AS roleCode') && sql.includes('FROM "user_roles_role" ur')) {
            return storeRoleRows;
        }
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

    it('leaves a reviewed fixed platform administrator for strict runtime role validation', async () => {
        const { queryRunner, query } = runner('mysql', 1, [
            ...[1, 2, 3].map(channelId => ({
                administratorId: 8,
                userId: 18,
                roleCode: 'platform-administrator',
                permissions: '["ReadProduct","CreateAdministrator"]',
                channelId,
            })),
            {
                administratorId: 8,
                userId: 18,
                roleCode: '__customer_role__',
                permissions: '["Authenticated"]',
                channelId: 1,
            },
        ]);
        await new AddAdministratorAccessGovernance1789408800000().up(queryRunner);
        expect(
            query.mock.calls.filter(([sql]) =>
                String(sql).includes('INSERT INTO "administrator_access_profile"'),
            ),
        ).toHaveLength(1);
        expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE "role" SET "permissions"'), [
            JSON.stringify([
                'ReadProduct',
                'CreateAdministrator',
                'ManagePlatformTeam',
                'ManageStoreLifecycle',
                'ReviewStoreGovernance',
                'SensitiveStoreFinance',
            ]),
            4,
        ]);
    });

    it('rejects a staged platform administrator with owner-only permission or missing Channel', async () => {
        const ownerPermission = runner('mysql', 1, [
            {
                administratorId: 8,
                userId: 18,
                roleCode: 'platform-administrator',
                permissions: '["SuperAdmin"]',
                channelId: 1,
            },
        ]);
        await expect(
            new AddAdministratorAccessGovernance1789408800000().up(ownerPermission.queryRunner),
        ).rejects.toThrow('owner-only permission');

        const missingChannel = runner('mysql', 1, [
            {
                administratorId: 8,
                userId: 18,
                roleCode: 'platform-administrator',
                permissions: '["ReadProduct"]',
                channelId: 1,
            },
        ]);
        await expect(
            new AddAdministratorAccessGovernance1789408800000().up(missingChannel.queryRunner),
        ).rejects.toThrow('does not cover all Channels');
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

    it('backfills a safe single-store staff account as active without forcing a password change', async () => {
        const { queryRunner, query } = runner(
            'mysql',
            1,
            [
                {
                    administratorId: 9,
                    userId: 19,
                    roleCode: 'production-media-publisher',
                    permissions: '["ReadAsset","CreateAsset","UpdateAsset"]',
                    channelId: 2,
                },
            ],
            [],
            [],
            '美宜佳',
        );

        await new AddAdministratorAccessGovernance1789408800000().up(queryRunner);

        expect(query).toHaveBeenCalledWith(expect.stringContaining("'STAFF', ?, ?, ?"), [
            9,
            19,
            'STORE',
            'ACTIVE',
            '2',
            1,
            false,
        ]);
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO "administrator_permission_audit"'),
            expect.arrayContaining([1, 9, '2', 'MIGRATION_STORE_STAFF_ACTIVATED']),
        );
    });

    it('does not promote a legacy administrator on the technical default Channel to store primary', async () => {
        const { queryRunner } = runner(
            'mysql',
            1,
            [],
            [{ administratorId: 7, userId: 17, mustChangePassword: true }],
        );
        await expect(new AddAdministratorAccessGovernance1789408800000().up(queryRunner)).rejects.toThrow(
            'must belong to an operating store Channel',
        );
    });

    it('does not map the platform owner into a store primary slot', async () => {
        const { queryRunner } = runner(
            'mysql',
            1,
            [],
            [{ administratorId: 1, userId: 10, mustChangePassword: false }],
        );
        await expect(new AddAdministratorAccessGovernance1789408800000().up(queryRunner)).rejects.toThrow(
            'Platform owner cannot also be backfilled',
        );
    });

    it('allows only the fixed store primary role to retain core team-management permissions', async () => {
        const account = [{ administratorId: 7, userId: 17, mustChangePassword: true }];
        const accepted = runner(
            'mysql',
            1,
            [],
            account,
            [{ roleCode: 'store-a-store-admin', permissions: 'CreateAdministrator,ReadProduct' }],
            'store-a',
        );
        await expect(
            new AddAdministratorAccessGovernance1789408800000().up(accepted.queryRunner),
        ).resolves.toBeUndefined();

        const rejected = runner(
            'mysql',
            1,
            [],
            account,
            [{ roleCode: 'store-a-store-admin', permissions: 'CreateAdministrator,CreateApiKey' }],
            'store-a',
        );
        await expect(
            new AddAdministratorAccessGovernance1789408800000().up(rejected.queryRunner),
        ).rejects.toThrow('platform-only permission CreateApiKey');
    });
});
