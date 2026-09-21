import assert from 'node:assert/strict';
import test from 'node:test';

import {
    collectAdministratorAccessPreflight,
    summarizeAdministratorAccess,
} from './administrator-access-preflight.mjs';

const owner = {
    administratorId: 1,
    roleCode: '__super_admin_role__',
    channelId: 1,
    channelCode: '__default_channel__',
};
const primary = {
    administratorId: 2,
    roleCode: 'moyao-ai-store-admin',
    channelId: 2,
    channelCode: 'moyao-ai',
};

test('preflight reports one owner and one unambiguous legacy store primary', () => {
    const report = summarizeAdministratorAccess([owner, primary], [{ administratorId: 2 }]);
    assert.equal(report.mode, 'read-only');
    assert.equal(report.readyForStagedMigration, true);
    assert.deepEqual(report.ownerAdministratorIds, ['1']);
    assert.deepEqual(report.legacyPrimaries, [
        { administratorId: '2', channelIds: ['2'], channelCodes: ['moyao-ai'], valid: true },
    ]);
    assert.deepEqual(report.unmapped, []);
});

test('preflight fails closed on multiple owners, shared store primary, and unmapped staff', () => {
    const report = summarizeAdministratorAccess(
        [
            owner,
            {
                administratorId: 3,
                roleCode: '__super_admin_role__',
                channelId: 1,
                channelCode: '__default_channel__',
            },
            primary,
            {
                administratorId: 2,
                roleCode: 'default-role',
                channelId: 1,
                channelCode: '__default_channel__',
            },
            { administratorId: 4, roleCode: 'store-staff', channelId: 2, channelCode: 'moyao-ai' },
        ],
        [{ administratorId: 2 }],
    );
    assert.equal(report.readyForStagedMigration, false);
    assert.deepEqual(
        report.blockers.map(item => item.code),
        ['OWNER_COUNT', 'LEGACY_PRIMARY_AMBIGUOUS', 'MANUAL_ACCOUNT_MAPPING_REQUIRED'],
    );
    assert.deepEqual(
        report.unmapped.map(item => item.administratorId),
        ['4'],
    );
});

test('preflight accepts only a reviewed migration-compatible staged platform administrator', () => {
    const channels = [{ id: 1 }, { id: 2 }];
    const staged = [
        {
            administratorId: 3,
            roleCode: 'platform-administrator',
            permissions: '["ReadProduct","CreateAdministrator"]',
            channelId: 1,
            channelCode: '__default_channel__',
        },
        {
            administratorId: 3,
            roleCode: 'platform-administrator',
            permissions: '["ReadProduct","CreateAdministrator"]',
            channelId: 2,
            channelCode: 'moyao-ai',
        },
        {
            administratorId: 3,
            roleCode: '__customer_role__',
            permissions: '["Authenticated"]',
            channelId: 1,
            channelCode: '__default_channel__',
        },
    ];
    const report = summarizeAdministratorAccess(
        [owner, primary, ...staged],
        [{ administratorId: 2 }],
        [],
        channels,
    );
    assert.equal(report.readyForStagedMigration, true);
    assert.deepEqual(report.unmapped, []);
    assert.deepEqual(report.stagedPlatformAdministrators, [
        {
            administratorId: '3',
            channelIds: ['1', '2'],
            valid: true,
            requiresRuntimeRoleValidation: true,
        },
    ]);

    for (const invalid of [
        [{ ...staged[0], permissions: '["SuperAdmin"]' }, staged[1], staged[2]],
        [staged[0], staged[2]],
        [...staged, { ...staged[2], roleCode: 'unreviewed-admin' }],
    ]) {
        const blocked = summarizeAdministratorAccess(
            [owner, primary, ...invalid],
            [{ administratorId: 2 }],
            [],
            channels,
        );
        assert.equal(blocked.readyForStagedMigration, false);
        assert.ok(blocked.blockers.some(item => item.code === 'STAGED_PLATFORM_ADMIN_INVALID'));
    }
});

test('preflight detects inconsistent existing ownership slots', () => {
    const report = summarizeAdministratorAccess(
        [owner, primary],
        [{ administratorId: 2 }],
        [
            {
                administratorId: 1,
                scope: 'PLATFORM',
                authority: 'OWNER',
                channelId: null,
                platformOwnerSlot: 'PLATFORM_OWNER',
                storePrimarySlot: null,
            },
            {
                administratorId: 2,
                scope: 'STORE',
                authority: 'ADMIN',
                channelId: 2,
                platformOwnerSlot: null,
                storePrimarySlot: null,
            },
        ],
    );
    assert.equal(report.readyForStagedMigration, false);
    assert.ok(
        report.blockers.some(
            item => item.code === 'PROFILE_SCOPE_OR_SLOT_INVALID' && item.administratorId === '2',
        ),
    );
});

test('collector uses only SELECT queries and refuses missing account schema', async () => {
    const statements = [];
    const adapter = {
        tableExists: async table => table !== 'administrator_access_profile',
        query: async sql => {
            statements.push(sql);
            if (sql === 'SELECT id FROM `channel`') return [{ id: 1 }, { id: 2 }];
            return sql.includes('store_administrator_access') ? [{ administratorId: 2 }] : [owner, primary];
        },
    };
    const report = await collectAdministratorAccessPreflight(adapter);
    assert.equal(report.readyForStagedMigration, true);
    assert.ok(statements.every(sql => /^SELECT\b/u.test(sql.trim())));
    await assert.rejects(
        collectAdministratorAccessPreflight({ tableExists: async () => false }),
        /Missing required table: administrator/u,
    );
});

test('collector reads the legacy account schema from an in-memory database', async () => {
    const { default: initialize } = await import('sql.js');
    const SQL = await initialize();
    const database = new SQL.Database();
    try {
        database.run(`
            CREATE TABLE administrator (id INTEGER, userId INTEGER, deletedAt TEXT);
            CREATE TABLE role (id INTEGER, code TEXT, permissions TEXT);
            CREATE TABLE user_roles_role (userId INTEGER, roleId INTEGER);
            CREATE TABLE role_channels_channel (roleId INTEGER, channelId INTEGER);
            CREATE TABLE channel (id INTEGER, code TEXT);
            CREATE TABLE store_administrator_access (administratorId INTEGER);
            INSERT INTO administrator VALUES (1, 11, NULL), (2, 22, NULL);
            INSERT INTO role VALUES (101, '__super_admin_role__', '["SuperAdmin"]'), (102, 'moyao-ai-store-admin', '["ReadProduct"]');
            INSERT INTO user_roles_role VALUES (11, 101), (22, 102);
            INSERT INTO role_channels_channel VALUES (101, 1), (102, 2);
            INSERT INTO channel VALUES (1, '__default_channel__'), (2, 'moyao-ai');
            INSERT INTO store_administrator_access VALUES (2);
        `);
        const adapter = {
            tableExists: async table =>
                database.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${table}'`)
                    .length > 0,
            query: async sql => {
                const [result] = database.exec(sql);
                return (
                    result?.values.map(values =>
                        Object.fromEntries(result.columns.map((key, i) => [key, values[i]])),
                    ) ?? []
                );
            },
        };
        const report = await collectAdministratorAccessPreflight(adapter);
        assert.equal(report.readyForStagedMigration, true);
        assert.deepEqual(report.ownerAdministratorIds, ['1']);

        database.run(`
            INSERT INTO administrator VALUES (3, 33, NULL);
            INSERT INTO role VALUES (103, 'platform-administrator', '["ReadProduct","CreateAdministrator"]');
            INSERT INTO user_roles_role VALUES (33, 103);
            INSERT INTO role_channels_channel VALUES (103, 1), (103, 2);
        `);
        const stagedReport = await collectAdministratorAccessPreflight(adapter);
        assert.equal(stagedReport.readyForStagedMigration, true);
        assert.deepEqual(
            stagedReport.stagedPlatformAdministrators.map(row => row.administratorId),
            ['3'],
        );
    } finally {
        database.close();
    }
});
