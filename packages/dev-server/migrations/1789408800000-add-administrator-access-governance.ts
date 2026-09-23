import { storeAdministratorPermissions } from '@vendure/store-management-plugin';
import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';

const REVIEWED_STORE_ADMINISTRATOR_PERMISSIONS = [
    'Authenticated',
    ...storeAdministratorPermissions.map(String),
];

export class AddAdministratorAccessGovernance1789408800000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        const mysql = databaseType === 'mysql' || databaseType === 'mariadb';
        const sqlite = ['sqlite', 'better-sqlite3', 'sqljs'].includes(databaseType);
        const idType = databaseType === 'postgres' || sqlite ? 'integer' : 'int';
        const dateType: TableColumnOptions['type'] =
            databaseType === 'postgres' ? 'timestamp without time zone' : 'datetime';
        const now = mysql ? 'CURRENT_TIMESTAMP(6)' : sqlite ? "datetime('now')" : 'CURRENT_TIMESTAMP';
        const booleanType: TableColumnOptions['type'] = mysql ? 'tinyint' : 'boolean';
        const timestamp = (name: 'createdAt' | 'updatedAt'): TableColumnOptions => ({
            name,
            type: dateType,
            ...(mysql ? { precision: 6 } : {}),
            default: now,
            ...(mysql && name === 'updatedAt' ? { onUpdate: 'CURRENT_TIMESTAMP(6)' } : {}),
        });
        const id = (): TableColumnOptions => ({
            name: 'id',
            type: idType,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
        });

        if (!(await queryRunner.hasTable('administrator_access_profile'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'administrator_access_profile',
                    columns: [
                        id(),
                        timestamp('createdAt'),
                        timestamp('updatedAt'),
                        { name: 'administratorId', type: idType },
                        { name: 'userId', type: idType },
                        { name: 'scope', type: 'varchar', length: '16' },
                        { name: 'authority', type: 'varchar', length: '16' },
                        { name: 'status', type: 'varchar', length: '16', default: "'ACTIVE'" },
                        { name: 'channelId', type: idType, isNullable: true },
                        { name: 'createdByAdministratorId', type: idType, isNullable: true },
                        {
                            name: 'mustChangePassword',
                            type: booleanType,
                            default: databaseType === 'postgres' ? true : 1,
                        },
                        { name: 'platformOwnerSlot', type: 'varchar', length: '32', isNullable: true },
                        { name: 'storePrimarySlot', type: 'varchar', length: '128', isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_administrator_access_profile_administrator',
                            columnNames: ['administratorId'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_administrator_access_profile_user',
                            columnNames: ['userId'],
                            isUnique: true,
                        },
                        { name: 'IDX_administrator_access_profile_channel', columnNames: ['channelId'] },
                        {
                            name: 'IDX_administrator_access_profile_owner_slot',
                            columnNames: ['platformOwnerSlot'],
                            isUnique: true,
                        },
                        {
                            name: 'IDX_administrator_access_profile_store_primary_slot',
                            columnNames: ['storePrimarySlot'],
                            isUnique: true,
                        },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_administrator_access_profile_administrator',
                            columnNames: ['administratorId'],
                            referencedTableName: 'administrator',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                        {
                            name: 'FK_administrator_access_profile_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'RESTRICT',
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('administrator_permission_audit'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'administrator_permission_audit',
                    columns: [
                        id(),
                        timestamp('createdAt'),
                        timestamp('updatedAt'),
                        { name: 'actorAdministratorId', type: idType, isNullable: true },
                        { name: 'targetAdministratorId', type: idType, isNullable: true },
                        { name: 'targetRoleId', type: idType, isNullable: true },
                        { name: 'channelId', type: idType, isNullable: true },
                        { name: 'action', type: 'varchar', length: '64' },
                        { name: 'result', type: 'varchar', length: '16' },
                        { name: 'beforeSummary', type: 'text', isNullable: true },
                        { name: 'afterSummary', type: 'text', isNullable: true },
                        { name: 'failureReason', type: 'varchar', length: '500', isNullable: true },
                    ],
                    indices: [
                        { name: 'IDX_administrator_permission_audit_created', columnNames: ['createdAt'] },
                        {
                            name: 'IDX_administrator_permission_audit_channel',
                            columnNames: ['channelId', 'createdAt'],
                        },
                    ],
                }),
                true,
            );
        }

        if (!(await queryRunner.hasTable('store_governance_change_request'))) {
            await queryRunner.createTable(
                new Table({
                    name: 'store_governance_change_request',
                    columns: [
                        id(),
                        timestamp('createdAt'),
                        timestamp('updatedAt'),
                        { name: 'channelId', type: idType },
                        { name: 'requestType', type: 'varchar', length: '32' },
                        { name: 'version', type: 'int' },
                        { name: 'status', type: 'varchar', length: '16', default: "'PENDING'" },
                        { name: 'submittedByUserId', type: idType },
                        { name: 'reviewedByUserId', type: idType, isNullable: true },
                        { name: 'encryptedPayload', type: 'text' },
                        { name: 'maskedSummary', type: 'text' },
                        { name: 'reviewReason', type: 'varchar', length: '500', isNullable: true },
                        { name: 'submittedAt', type: dateType },
                        { name: 'reviewedAt', type: dateType, isNullable: true },
                    ],
                    indices: [
                        {
                            name: 'IDX_store_governance_request_version',
                            columnNames: ['channelId', 'requestType', 'version'],
                            isUnique: true,
                        },
                        { name: 'IDX_store_governance_request_status', columnNames: ['status', 'createdAt'] },
                    ],
                    foreignKeys: [
                        {
                            name: 'FK_store_governance_request_channel',
                            columnNames: ['channelId'],
                            referencedTableName: 'channel',
                            referencedColumnNames: ['id'],
                            onDelete: 'CASCADE',
                        },
                    ],
                }),
                true,
            );
        }

        await this.backfillKnownAccessProfiles(queryRunner);
    }

    async down(): Promise<void> {
        // Access, approval, and audit records are intentionally retained on code rollback.
    }

    private async backfillKnownAccessProfiles(queryRunner: QueryRunner): Promise<void> {
        const escape = (name: string) => queryRunner.connection.driver.escape(name);
        const profiles = escape('administrator_access_profile');
        const administrators = escape('administrator');
        const roles = escape('role');
        const userRoles = escape('user_roles_role');
        const roleChannels = escape('role_channels_channel');
        const legacy = escape('store_administrator_access');
        const profileColumns = [
            'createdAt',
            'updatedAt',
            'administratorId',
            'userId',
            'scope',
            'authority',
            'status',
            'channelId',
            'createdByAdministratorId',
            'mustChangePassword',
            'platformOwnerSlot',
            'storePrimarySlot',
        ]
            .map(escape)
            .join(', ');
        const profileInsert = `INSERT INTO ${profiles} (${profileColumns})`;
        const auditColumns = [
            'createdAt',
            'updatedAt',
            'actorAdministratorId',
            'targetAdministratorId',
            'targetRoleId',
            'channelId',
            'action',
            'result',
            'beforeSummary',
            'afterSummary',
            'failureReason',
        ]
            .map(escape)
            .join(', ');
        const parameter = (index: number) =>
            queryRunner.connection.options.type === 'postgres' ? `$${index}` : '?';
        const owners = (await queryRunner.query(
            `SELECT a.${escape('id')} AS administratorId, a.${escape('userId')} AS userId
             FROM ${administrators} a
             INNER JOIN ${userRoles} ur ON ur.${escape('userId')} = a.${escape('userId')}
             INNER JOIN ${roles} r ON r.${escape('id')} = ur.${escape('roleId')}
             WHERE a.${escape('deletedAt')} IS NULL AND r.${escape('code')} = ${parameter(1)}`,
            ['__super_admin_role__'],
        )) as Array<{ administratorId: number | string; userId: number | string }>;
        if (owners.length !== 1) {
            throw new Error(
                `Administrator access migration requires exactly one active SuperAdmin; found ${owners.length}`,
            );
        }
        const existingProfiles = (await queryRunner.query(
            `SELECT ${escape('administratorId')} AS administratorId,
                    ${escape('userId')} AS userId,
                    ${escape('scope')} AS scope,
                    ${escape('authority')} AS authority,
                    ${escape('status')} AS status,
                    ${escape('channelId')} AS channelId,
                    ${escape('platformOwnerSlot')} AS platformOwnerSlot,
                    ${escape('storePrimarySlot')} AS storePrimarySlot
             FROM ${profiles}`,
        )) as Array<{
            administratorId: number | string;
            userId: number | string;
            scope: string;
            authority: string;
            status: string;
            channelId: number | string | null;
            platformOwnerSlot: string | null;
            storePrimarySlot: string | null;
        }>;
        const profilesByAdministrator = new Map(
            existingProfiles.map(profile => [String(profile.administratorId), profile]),
        );
        const ownerProfile = profilesByAdministrator.get(String(owners[0].administratorId));
        if (ownerProfile) {
            if (
                String(ownerProfile.userId) !== String(owners[0].userId) ||
                ownerProfile.scope !== 'PLATFORM' ||
                ownerProfile.authority !== 'OWNER' ||
                ownerProfile.status !== 'ACTIVE' ||
                ownerProfile.channelId != null ||
                ownerProfile.platformOwnerSlot !== 'PLATFORM_OWNER' ||
                ownerProfile.storePrimarySlot != null
            ) {
                throw new Error('Existing platform owner access profile is incompatible with migration');
            }
        } else {
            if (existingProfiles.some(profile => profile.platformOwnerSlot === 'PLATFORM_OWNER')) {
                throw new Error('Existing platform owner slot belongs to a different administrator');
            }
            await queryRunner.query(
                [
                    profileInsert,
                    `VALUES (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${parameter(1)}, ${parameter(2)},`,
                    `'PLATFORM', 'OWNER', 'ACTIVE', NULL, ${parameter(3)}, ${parameter(4)},`,
                    `'PLATFORM_OWNER', NULL)`,
                ].join(' '),
                [owners[0].administratorId, owners[0].userId, owners[0].administratorId, false],
            );
        }

        const storeAccounts = (await queryRunner.hasTable('store_administrator_access'))
            ? ((await queryRunner.query(
                  `SELECT a.${escape('id')} AS administratorId, a.${escape('userId')} AS userId, s.${escape('mustChangePassword')} AS mustChangePassword
                   FROM ${legacy} s
                   INNER JOIN ${administrators} a ON a.${escape('id')} = s.${escape('administratorId')}
                   WHERE a.${escape('deletedAt')} IS NULL`,
              )) as Array<{
                  administratorId: number | string;
                  userId: number | string;
                  mustChangePassword: boolean | number;
              }>)
            : [];
        const occupiedChannels = new Set(
            existingProfiles
                .filter(profile => profile.storePrimarySlot != null)
                .map(profile => String(profile.storePrimarySlot)),
        );
        for (const account of storeAccounts) {
            if (String(account.administratorId) === String(owners[0].administratorId)) {
                throw new Error('Platform owner cannot also be backfilled as a store administrator');
            }
            const channels = (await queryRunner.query(
                `SELECT DISTINCT rc.${escape('channelId')} AS channelId
                 FROM ${userRoles} ur
                 INNER JOIN ${roleChannels} rc ON rc.${escape('roleId')} = ur.${escape('roleId')}
                 WHERE ur.${escape('userId')} = ${parameter(1)}`,
                [account.userId],
            )) as Array<{ channelId: number | string }>;
            if (channels.length !== 1) {
                throw new Error(
                    `Store administrator ${String(account.administratorId)} must resolve to exactly one Channel; found ${channels.length}`,
                );
            }
            const channelId = String(channels[0].channelId);
            const channelRows = (await queryRunner.query(
                `SELECT ${escape('code')} AS code FROM ${escape('channel')} WHERE ${escape('id')} = ${parameter(1)}`,
                [channels[0].channelId],
            )) as Array<{ code: string }>;
            if (channelRows.length !== 1 || channelRows[0].code === '__default_channel__') {
                throw new Error(
                    `Store administrator ${String(account.administratorId)} must belong to an operating store Channel`,
                );
            }
            const accountRoles = (await queryRunner.query(
                `SELECT r.${escape('id')} AS roleId, r.${escape('code')} AS roleCode, r.${escape('permissions')} AS permissions
                 FROM ${userRoles} ur
                 INNER JOIN ${roles} r ON r.${escape('id')} = ur.${escape('roleId')}
                 WHERE ur.${escape('userId')} = ${parameter(1)}`,
                [account.userId],
            )) as Array<{
                roleId: number | string;
                roleCode: string;
                permissions: string | string[] | null;
            }>;
            for (const role of accountRoles) {
                if (role.roleCode === `${channelRows[0].code}-store-admin`) {
                    const currentPermissions = parsePermissions(role.permissions);
                    if (!samePermissions(currentPermissions, REVIEWED_STORE_ADMINISTRATOR_PERMISSIONS)) {
                        await queryRunner.query(
                            `UPDATE ${roles} SET ${escape('permissions')} = ${parameter(1)} WHERE ${escape('id')} = ${parameter(2)}`,
                            [JSON.stringify(REVIEWED_STORE_ADMINISTRATOR_PERMISSIONS), role.roleId],
                        );
                        await queryRunner.query(
                            [
                                `INSERT INTO ${escape('administrator_permission_audit')} (${auditColumns})`,
                                `VALUES (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${parameter(1)}, ${parameter(2)},`,
                                `${parameter(3)}, ${parameter(4)}, 'MIGRATION_STORE_PRIMARY_ROLE_NORMALIZED',`,
                                `'SUCCESS', ${parameter(5)}, ${parameter(6)}, NULL)`,
                            ].join(' '),
                            [
                                owners[0].administratorId,
                                account.administratorId,
                                role.roleId,
                                channels[0].channelId,
                                JSON.stringify({
                                    roleCode: role.roleCode,
                                    permissions: currentPermissions,
                                }),
                                JSON.stringify({
                                    roleCode: role.roleCode,
                                    permissions: REVIEWED_STORE_ADMINISTRATOR_PERMISSIONS,
                                }),
                            ],
                        );
                    }
                    continue;
                }
                for (const permission of parsePermissions(role.permissions)) {
                    if (isPlatformOnlyPermission(permission)) {
                        throw new Error(
                            `Store administrator ${String(account.administratorId)} has platform-only permission ${permission}`,
                        );
                    }
                }
            }
            const existingProfile = profilesByAdministrator.get(String(account.administratorId));
            if (existingProfile) {
                if (
                    String(existingProfile.userId) !== String(account.userId) ||
                    existingProfile.scope !== 'STORE' ||
                    existingProfile.authority !== 'ADMIN' ||
                    existingProfile.status !== 'ACTIVE' ||
                    String(existingProfile.channelId) !== channelId ||
                    existingProfile.platformOwnerSlot != null ||
                    String(existingProfile.storePrimarySlot) !== channelId
                ) {
                    throw new Error(
                        `Existing store administrator ${String(account.administratorId)} access profile is incompatible with migration`,
                    );
                }
                occupiedChannels.add(channelId);
                continue;
            }
            if (occupiedChannels.has(channelId)) {
                throw new Error(`Channel ${channelId} has more than one legacy primary store administrator`);
            }
            occupiedChannels.add(channelId);
            await queryRunner.query(
                [
                    profileInsert,
                    `VALUES (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${parameter(1)}, ${parameter(2)},`,
                    `'STORE', 'ADMIN', 'ACTIVE', ${parameter(3)}, NULL, ${parameter(4)}, NULL,`,
                    `${parameter(5)})`,
                ].join(' '),
                [
                    account.administratorId,
                    account.userId,
                    channels[0].channelId,
                    account.mustChangePassword,
                    channelId,
                ],
            );
        }

        const unmappedRows = (await queryRunner.query(
            `SELECT a.${escape('id')} AS administratorId,
                    a.${escape('userId')} AS userId,
                    r.${escape('code')} AS roleCode,
                    r.${escape('permissions')} AS permissions,
                    rc.${escape('channelId')} AS channelId
             FROM ${administrators} a
             LEFT JOIN ${userRoles} ur ON ur.${escape('userId')} = a.${escape('userId')}
             LEFT JOIN ${roles} r ON r.${escape('id')} = ur.${escape('roleId')}
             LEFT JOIN ${roleChannels} rc ON rc.${escape('roleId')} = r.${escape('id')}
             WHERE a.${escape('deletedAt')} IS NULL
               AND NOT EXISTS (SELECT 1 FROM ${profiles} p WHERE p.${escape('administratorId')} = a.${escape('id')})`,
        )) as Array<{
            administratorId: number | string;
            userId: number | string;
            roleCode: string | null;
            permissions: string | string[] | null;
            channelId: number | string | null;
        }>;
        const unmapped = new Map<
            string,
            {
                administratorId: number | string;
                userId: number | string;
                channels: Set<string>;
                permissions: Set<string>;
                roleCodes: Set<string>;
                platformRoleChannels: Set<string>;
            }
        >();
        for (const row of unmappedRows) {
            const key = String(row.administratorId);
            const candidate = unmapped.get(key) ?? {
                administratorId: row.administratorId,
                userId: row.userId,
                channels: new Set<string>(),
                permissions: new Set<string>(),
                roleCodes: new Set<string>(),
                platformRoleChannels: new Set<string>(),
            };
            if (row.channelId != null) candidate.channels.add(String(row.channelId));
            if (row.roleCode != null) candidate.roleCodes.add(row.roleCode);
            if (row.roleCode === 'platform-administrator' && row.channelId != null) {
                candidate.platformRoleChannels.add(String(row.channelId));
            }
            for (const permission of parsePermissions(row.permissions)) candidate.permissions.add(permission);
            unmapped.set(key, candidate);
        }
        for (const account of unmapped.values()) {
            if (account.roleCodes.has('platform-administrator')) {
                if (
                    [...account.roleCodes].some(
                        code => code !== 'platform-administrator' && code !== '__customer_role__',
                    ) ||
                    [...account.permissions].some(isOwnerOnlyPermission)
                ) {
                    throw new Error(
                        `Platform administrator ${String(account.administratorId)} has an incompatible role or owner-only permission`,
                    );
                }
                const channels = (await queryRunner.query(
                    `SELECT ${escape('id')} AS id FROM ${escape('channel')}`,
                )) as Array<{ id: number | string }>;
                if (
                    channels.length === 0 ||
                    channels.some(channel => !account.platformRoleChannels.has(String(channel.id)))
                ) {
                    throw new Error(
                        `Platform administrator ${String(account.administratorId)} role does not cover all Channels`,
                    );
                }
                const platformRoleRows = (await queryRunner.query(
                    `SELECT ${escape('id')} AS id, ${escape('permissions')} AS permissions
                     FROM ${roles} WHERE ${escape('code')} = ${parameter(1)}`,
                    ['platform-administrator'],
                )) as Array<{
                    id: number | string;
                    permissions: string | string[] | null;
                }>;
                if (platformRoleRows.length !== 1) {
                    throw new Error(
                        `Platform administrator ${String(account.administratorId)} must resolve to exactly one fixed role`,
                    );
                }
                const stagedPermissions = parsePermissions(platformRoleRows[0].permissions);
                const completedPermissions = [
                    ...new Set([...stagedPermissions, ...PLATFORM_ADMINISTRATOR_BOOTSTRAP_PERMISSIONS]),
                ];
                if (completedPermissions.length !== stagedPermissions.length) {
                    await queryRunner.query(
                        `UPDATE ${roles} SET ${escape('permissions')} = ${parameter(1)} WHERE ${escape('id')} = ${parameter(2)}`,
                        [JSON.stringify(completedPermissions), platformRoleRows[0].id],
                    );
                }
                // The service validates the complete fixed-role policy when this account first accesses Admin.
                // Do not persist a suspended profile that would bypass that validation and lock the account out.
                continue;
            }
            if (account.channels.size === 0) {
                throw new Error(
                    `Administrator ${String(account.administratorId)} has no Channel-bound role and requires explicit mapping`,
                );
            }
            const scope = account.channels.size === 1 ? 'STORE' : 'PLATFORM';
            const channelId = scope === 'STORE' ? [...account.channels][0] : null;
            let status = 'SUSPENDED';
            if (scope === 'STORE') {
                const invalid = [...account.permissions].find(isPlatformOnlyPermission);
                if (invalid) {
                    throw new Error(
                        `Administrator ${String(account.administratorId)} has platform-only permission ${invalid} in a store role`,
                    );
                }
                const channelRows = (await queryRunner.query(
                    `SELECT ${escape('code')} AS code FROM ${escape('channel')} WHERE ${escape('id')} = ${parameter(1)}`,
                    [channelId],
                )) as Array<{ code: string }>;
                if (channelRows.length !== 1 || channelRows[0].code === '__default_channel__') {
                    throw new Error(
                        `Administrator ${String(account.administratorId)} must belong to an operating store Channel`,
                    );
                }
                status = 'ACTIVE';
            }
            await queryRunner.query(
                [
                    profileInsert,
                    `VALUES (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${parameter(1)}, ${parameter(2)},`,
                    `${parameter(3)}, 'STAFF', ${parameter(4)}, ${parameter(5)}, ${parameter(6)},`,
                    `${parameter(7)}, NULL, NULL)`,
                ].join(' '),
                [
                    account.administratorId,
                    account.userId,
                    scope,
                    status,
                    channelId,
                    owners[0].administratorId,
                    status !== 'ACTIVE',
                ],
            );
            await queryRunner.query(
                [
                    `INSERT INTO ${escape('administrator_permission_audit')} (${auditColumns})`,
                    `VALUES (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${parameter(1)}, ${parameter(2)},`,
                    `NULL, ${parameter(3)}, ${parameter(4)}, 'SUCCESS',`,
                    `NULL, ${parameter(5)}, NULL)`,
                ].join(' '),
                [
                    owners[0].administratorId,
                    account.administratorId,
                    channelId,
                    status === 'ACTIVE'
                        ? 'MIGRATION_STORE_STAFF_ACTIVATED'
                        : 'MIGRATION_MAPPING_REVIEW_REQUIRED',
                    JSON.stringify({
                        scope,
                        authority: 'STAFF',
                        status,
                        channelIds: [...account.channels],
                    }),
                ],
            );
        }
    }
}

const PLATFORM_ADMINISTRATOR_BOOTSTRAP_PERMISSIONS = [
    'ManagePlatformTeam',
    'ManageStoreLifecycle',
    'ReviewStoreGovernance',
    'SensitiveStoreFinance',
] as const;

function parsePermissions(value: string | string[] | null): string[] {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
        // Some legacy drivers return simple-array values instead of simple-json.
    }
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function isPlatformOnlyPermission(permission: string): boolean {
    return (
        permission === 'SuperAdmin' ||
        permission === 'ManagePlatformTeam' ||
        permission === 'ReviewStoreGovernance' ||
        /(?:ApiKey|System|GlobalSettings|Administrator|Role|Seller|Settings|TaxCategory|TaxRate)$/u.test(
            permission,
        ) ||
        /^(?:Create|Update|Delete)(?:Channel|PaymentMethod)$/u.test(permission)
    );
}

function isOwnerOnlyPermission(permission: string): boolean {
    return (
        permission === 'SuperAdmin' ||
        permission === 'Owner' ||
        permission === 'Public' ||
        permission === 'UpdateGlobalSettings' ||
        /(?:ApiKey|IcloudRelay|ImageGeneration|Settings|System)$/u.test(permission)
    );
}

function samePermissions(actual: string[], expected: string[]): boolean {
    if (actual.length !== expected.length) return false;
    const actualSet = new Set(actual);
    return actualSet.size === expected.length && expected.every(permission => actualSet.has(permission));
}
