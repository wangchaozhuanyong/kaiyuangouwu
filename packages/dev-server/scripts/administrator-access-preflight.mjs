#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStoreIsolationAdapter, safeReadOnlyAuditFailure } from './store-isolation-data-preflight.mjs';

const REQUIRED_TABLES = ['administrator', 'user_roles_role', 'role', 'role_channels_channel', 'channel'];

function parsePermissions(value) {
    if (Array.isArray(value)) return value.map(String);
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
        // Older databases can store a comma-separated simple-array value.
    }
    return String(value)
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function isOwnerOnlyPermission(permission) {
    return (
        ['SuperAdmin', 'Owner', 'Public', 'UpdateGlobalSettings'].includes(permission) ||
        /(?:ApiKey|IcloudRelay|ImageGeneration|Settings|System)$/u.test(permission)
    );
}

function isPlatformOnlyPermission(permission) {
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

export function summarizeAdministratorAccess(rows, legacyRows = [], profileRows = [], channelRows = []) {
    const accounts = new Map();
    for (const row of rows) {
        const id = String(row.administratorId);
        const account = accounts.get(id) ?? {
            administratorId: id,
            roles: new Set(),
            channels: new Map(),
            platformRoleChannels: new Set(),
            permissions: new Set(),
        };
        if (row.roleCode != null) account.roles.add(String(row.roleCode));
        if (row.channelId != null) {
            account.channels.set(String(row.channelId), String(row.channelCode ?? ''));
            if (row.roleCode === 'platform-administrator') {
                account.platformRoleChannels.add(String(row.channelId));
            }
        }
        for (const permission of parsePermissions(row.permissions)) account.permissions.add(permission);
        accounts.set(id, account);
    }
    const profiles = new Map(profileRows.map(row => [String(row.administratorId), row]));
    const owners = [...accounts.values()].filter(account => account.roles.has('__super_admin_role__'));
    const blockers = [];
    if (owners.length !== 1) blockers.push({ code: 'OWNER_COUNT', count: owners.length });
    const existingOwnerSlots = profileRows.filter(row => row.platformOwnerSlot === 'PLATFORM_OWNER');
    if (profileRows.length > 0 && existingOwnerSlots.length !== 1) {
        blockers.push({ code: 'PROFILE_OWNER_SLOT_COUNT', count: existingOwnerSlots.length });
    }
    const primarySlots = new Set();
    for (const row of profileRows) {
        const id = String(row.administratorId);
        const owner = owners.some(account => account.administratorId === id);
        const channelId = row.channelId == null ? null : String(row.channelId);
        const expectedOwner = row.scope === 'PLATFORM' && row.authority === 'OWNER' && owner;
        const expectedPrimary = row.scope === 'STORE' && row.authority === 'ADMIN' && channelId != null;
        const invalid =
            !accounts.has(id) ||
            (row.scope === 'PLATFORM' && channelId != null) ||
            (row.scope === 'STORE' && channelId == null) ||
            (row.authority === 'OWNER' && !expectedOwner) ||
            (row.platformOwnerSlot != null &&
                (!expectedOwner || row.platformOwnerSlot !== 'PLATFORM_OWNER')) ||
            (expectedOwner && row.platformOwnerSlot !== 'PLATFORM_OWNER') ||
            (row.storePrimarySlot != null &&
                (!expectedPrimary || String(row.storePrimarySlot) !== channelId)) ||
            (expectedPrimary && String(row.storePrimarySlot) !== channelId) ||
            (row.storePrimarySlot != null && primarySlots.has(String(row.storePrimarySlot)));
        if (invalid) blockers.push({ code: 'PROFILE_SCOPE_OR_SLOT_INVALID', administratorId: id });
        if (row.storePrimarySlot != null) primarySlots.add(String(row.storePrimarySlot));
    }

    const occupiedStoreChannels = new Set();
    const legacyPrimaries = legacyRows.map(row => {
        const id = String(row.administratorId);
        const account = accounts.get(id);
        const channels = account ? [...account.channels.entries()] : [];
        const channelIds = channels.map(([channelId]) => channelId);
        const channelCodes = channels.map(([, code]) => code);
        const existingProfile = profiles.get(id);
        const invalid =
            !account ||
            channelIds.length !== 1 ||
            !channelCodes[0] ||
            channelCodes[0] === '__default_channel__' ||
            owners.some(owner => owner.administratorId === id) ||
            (existingProfile != null &&
                (existingProfile.scope !== 'STORE' ||
                    existingProfile.authority !== 'ADMIN' ||
                    String(existingProfile.channelId) !== channelIds[0])) ||
            occupiedStoreChannels.has(channelIds[0]);
        if (invalid) blockers.push({ code: 'LEGACY_PRIMARY_AMBIGUOUS', administratorId: id });
        else occupiedStoreChannels.add(channelIds[0]);
        return { administratorId: id, channelIds, channelCodes, valid: !invalid };
    });

    const knownPrimaryIds = new Set(legacyRows.map(row => String(row.administratorId)));
    const allChannelIds = new Set(channelRows.map(row => String(row.id)));
    const stagedPlatformAdministrators = [...accounts.values()]
        .filter(
            account =>
                account.roles.has('platform-administrator') &&
                !profiles.has(account.administratorId) &&
                !knownPrimaryIds.has(account.administratorId),
        )
        .map(account => {
            const valid =
                !account.roles.has('__super_admin_role__') &&
                [...account.roles].every(
                    code => code === 'platform-administrator' || code === '__customer_role__',
                ) &&
                ![...account.permissions].some(isOwnerOnlyPermission) &&
                allChannelIds.size > 0 &&
                [...allChannelIds].every(id => account.platformRoleChannels.has(id));
            if (!valid) {
                blockers.push({
                    code: 'STAGED_PLATFORM_ADMIN_INVALID',
                    administratorId: account.administratorId,
                });
            }
            return {
                administratorId: account.administratorId,
                channelIds: [...account.platformRoleChannels].sort(),
                valid,
                requiresRuntimeRoleValidation: true,
            };
        })
        .sort((a, b) => a.administratorId.localeCompare(b.administratorId));
    const stagedIds = new Set(stagedPlatformAdministrators.map(row => row.administratorId));
    const stagedStoreStaff = [...accounts.values()]
        .filter(
            account =>
                !profiles.has(account.administratorId) &&
                !owners.some(owner => owner.administratorId === account.administratorId) &&
                !knownPrimaryIds.has(account.administratorId) &&
                !stagedIds.has(account.administratorId) &&
                account.channels.size === 1,
        )
        .map(account => {
            const [[channelId, channelCode]] = account.channels.entries();
            const valid =
                Boolean(channelCode) &&
                channelCode !== '__default_channel__' &&
                ![...account.permissions].some(isPlatformOnlyPermission);
            return {
                administratorId: account.administratorId,
                roleCodes: [...account.roles].sort(),
                channelId,
                channelCode,
                valid,
            };
        })
        .sort((a, b) => a.administratorId.localeCompare(b.administratorId));
    const stagedStoreStaffIds = new Set(
        stagedStoreStaff.filter(row => row.valid).map(row => row.administratorId),
    );
    const unmapped = [...accounts.values()]
        .filter(
            account =>
                !profiles.has(account.administratorId) &&
                !owners.some(owner => owner.administratorId === account.administratorId) &&
                !knownPrimaryIds.has(account.administratorId) &&
                !stagedIds.has(account.administratorId) &&
                !stagedStoreStaffIds.has(account.administratorId),
        )
        .map(account => ({
            administratorId: account.administratorId,
            roleCodes: [...account.roles].sort(),
            channelIds: [...account.channels.keys()].sort(),
            channelCodes: [...account.channels.values()].sort(),
        }))
        .sort((a, b) => a.administratorId.localeCompare(b.administratorId));
    if (unmapped.length > 0)
        blockers.push({ code: 'MANUAL_ACCOUNT_MAPPING_REQUIRED', count: unmapped.length });

    return {
        mode: 'read-only',
        readyForStagedMigration: blockers.length === 0,
        activeAdministratorCount: accounts.size,
        ownerAdministratorIds: owners.map(owner => owner.administratorId).sort(),
        existingProfileCount: profiles.size,
        legacyPrimaries,
        stagedPlatformAdministrators,
        stagedStoreStaff,
        unmapped,
        blockers,
    };
}

export async function collectAdministratorAccessPreflight(adapter) {
    for (const table of REQUIRED_TABLES) {
        if (!(await adapter.tableExists(table))) throw new Error(`Missing required table: ${table}`);
    }
    const rows = await adapter.query(
        `SELECT a.id AS administratorId, r.code AS roleCode, r.permissions AS permissions,
                rc.channelId AS channelId, c.code AS channelCode
         FROM \`administrator\` a
         LEFT JOIN \`user_roles_role\` ur ON ur.userId = a.userId
         LEFT JOIN \`role\` r ON r.id = ur.roleId
         LEFT JOIN \`role_channels_channel\` rc ON rc.roleId = r.id
         LEFT JOIN \`channel\` c ON c.id = rc.channelId
         WHERE a.deletedAt IS NULL
         ORDER BY a.id ASC`,
    );
    const legacyRows = (await adapter.tableExists('store_administrator_access'))
        ? await adapter.query('SELECT administratorId FROM store_administrator_access')
        : [];
    const profileRows = (await adapter.tableExists('administrator_access_profile'))
        ? await adapter.query(
              'SELECT administratorId, scope, authority, channelId, platformOwnerSlot, storePrimarySlot FROM administrator_access_profile',
          )
        : [];
    const channelRows = await adapter.query('SELECT id FROM `channel`');
    return summarizeAdministratorAccess(rows, legacyRows, profileRows, channelRows);
}

async function main() {
    // Production operations invoke this transported script with Node's --env-file.
    // Avoid resolving dotenv relative to the temporary transport directory.
    const adapter = await createStoreIsolationAdapter(process.env);
    try {
        process.stdout.write(
            `${JSON.stringify(await collectAdministratorAccessPreflight(adapter), null, 2)}\n`,
        );
    } finally {
        await adapter.close();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        process.stderr.write(`${safeReadOnlyAuditFailure(error)}\n`);
        process.exitCode = 1;
    });
}
