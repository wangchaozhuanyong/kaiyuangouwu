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
            CREATE TABLE role (id INTEGER, code TEXT);
            CREATE TABLE user_roles_role (userId INTEGER, roleId INTEGER);
            CREATE TABLE role_channels_channel (roleId INTEGER, channelId INTEGER);
            CREATE TABLE channel (id INTEGER, code TEXT);
            CREATE TABLE store_administrator_access (administratorId INTEGER);
            INSERT INTO administrator VALUES (1, 11, NULL), (2, 22, NULL);
            INSERT INTO role VALUES (101, '__super_admin_role__'), (102, 'moyao-ai-store-admin');
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
    } finally {
        database.close();
    }
});
