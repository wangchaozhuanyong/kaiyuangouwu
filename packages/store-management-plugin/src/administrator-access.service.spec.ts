import 'reflect-metadata';

import { Permission } from '@vendure/common/lib/generated-types';
import { Channel, Role, User } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { AdministratorAccessService } from './administrator-access.service';
import { AdministratorAccessProfile } from './entities/administrator-access-profile.entity';
import { AdministratorPermissionAudit } from './entities/administrator-permission-audit.entity';
import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';

function service() {
    return new AdministratorAccessService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
    ) as any;
}

function profile(
    id: string,
    scope: 'PLATFORM' | 'STORE',
    authority: 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF',
    channelId: string | null = null,
) {
    return { id, scope, authority, channelId };
}

describe('AdministratorAccessService hierarchy policy', () => {
    it('creates the mailbox integration role only for the platform owner and default channel', async () => {
        const access = service();
        access.current = vi.fn().mockResolvedValue(profile('owner', 'PLATFORM', 'OWNER'));
        access.connection = {
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === Channel)
                    return {
                        findOne: vi.fn().mockResolvedValue({ id: 'default', code: '__default_channel__' }),
                    };
                if (entity === Role) return { findOne: vi.fn().mockResolvedValue(null) };
                throw new Error('Unexpected repository');
            },
        };
        access.roleService = {
            create: vi.fn().mockResolvedValue({
                id: 'mail-role',
                code: 'id-business-mailbox-integration',
                permissions: [],
            }),
        };
        access.audit = { record: vi.fn() };

        await access.createMailboxIntegrationRole({} as any);

        expect(access.roleService.create).toHaveBeenCalledWith(expect.anything(), {
            code: 'id-business-mailbox-integration',
            description: 'ID Business 邮箱互通专用角色',
            channelIds: ['default'],
            permissions: ['CreateIcloudRelay', 'ReadIcloudRelay', 'UpdateIcloudRelay', 'DeleteIcloudRelay'],
        });
        expect(access.audit.record).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ action: 'CREATE_MAILBOX_INTEGRATION_ROLE', targetRoleId: 'mail-role' }),
        );

        access.current.mockResolvedValue(profile('admin', 'PLATFORM', 'ADMIN'));
        await expect(access.createMailboxIntegrationRole({} as any)).rejects.toThrow();
        expect(access.roleService.create).toHaveBeenCalledTimes(1);
    });

    it('refuses to replace an existing mailbox role', async () => {
        const access = service();
        access.current = vi.fn().mockResolvedValue(profile('owner', 'PLATFORM', 'OWNER'));
        access.connection = {
            getRepository: (_ctx: unknown, entity: unknown) => ({
                findOne: vi
                    .fn()
                    .mockResolvedValue(entity === Channel ? { id: 'default' } : { id: 'existing-role' }),
            }),
        };
        access.roleService = { create: vi.fn() };

        await expect(access.createMailboxIntegrationRole({} as any)).rejects.toThrow('已存在');
        expect(access.roleService.create).not.toHaveBeenCalled();
    });

    function initializationService(persisted: unknown) {
        const access = service();
        const builder: any = {};
        for (const method of ['insert', 'into', 'values', 'orIgnore', 'updateEntity'])
            builder[method] = vi.fn(() => builder);
        builder.execute = vi.fn().mockResolvedValue({});
        const repository = {
            manager: { queryRunner: { isTransactionActive: true } },
            createQueryBuilder: vi.fn(() => builder),
            findOne: vi.fn().mockResolvedValue(persisted),
        };
        access.connection = {
            rawConnection: { options: { type: 'mysql' } },
            getRepository: vi.fn(() => repository),
        };
        return { access, builder, repository };
    }

    it('retains the winning profile and suspended state instead of overwriting them during initialization', async () => {
        const persisted = {
            id: 'profile',
            administratorId: 'admin',
            userId: 'user',
            status: 'SUSPENDED',
            authority: 'STAFF',
        };
        const { access, builder } = initializationService(persisted);
        const result = await access.initializeLegacyProfile(
            {},
            { id: 'admin', user: { id: 'user' } },
            { authority: 'OWNER' },
        );
        expect(result).toBe(persisted);
        expect(builder.orIgnore).toHaveBeenCalledOnce();
    });

    it('rejects a slot conflict belonging to another account rather than treating it as successful initialization', async () => {
        const { access } = initializationService(null);
        await expect(
            access.initializeLegacyProfile({}, { id: 'admin', user: { id: 'user' } }, {}),
        ).rejects.toThrow('初始化冲突');
    });

    it('rejects inconsistent administrator ownership on an existing user profile', async () => {
        const { access } = initializationService({ administratorId: 'other-admin', userId: 'user' });
        await expect(
            access.initializeLegacyProfile({}, { id: 'admin', user: { id: 'user' } }, {}),
        ).rejects.toThrow('初始化冲突');
    });

    it('uses a current read after an insert in MySQL transactions to avoid a stale missing-row snapshot', async () => {
        const { access, repository } = initializationService({ administratorId: 'admin', userId: 'user' });
        await access.initializeLegacyProfile({}, { id: 'admin', user: { id: 'user' } }, {});
        expect(repository.findOne.mock.calls[0][0].lock).toEqual({ mode: 'pessimistic_read' });
    });

    it('propagates storage failures and does not return a profile as if the insert succeeded', async () => {
        const { access, builder, repository } = initializationService(null);
        builder.execute.mockRejectedValue(new Error('database unavailable'));
        await expect(
            access.initializeLegacyProfile({}, { id: 'admin', user: { id: 'user' } }, {}),
        ).rejects.toThrow('database unavailable');
        expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('allows the platform owner to create lower platform and store accounts only', () => {
        const access = service();
        const owner = profile('owner', 'PLATFORM', 'OWNER');

        expect(() => access.assertCanCreate(owner, 'PLATFORM', 'ADMIN', null)).not.toThrow();
        expect(() => access.assertCanCreate(owner, 'PLATFORM', 'STAFF', null)).not.toThrow();
        expect(() => access.assertCanCreate(owner, 'STORE', 'MANAGER', 'store-a')).not.toThrow();
        expect(() => access.assertCanCreate(owner, 'PLATFORM', 'OWNER', null)).toThrow('专用转移');
        expect(() => access.assertCanCreate(owner, 'STORE', 'ADMIN', 'store-a')).toThrow('专用转移');
    });

    it('prevents platform administrators and company staff from creating peers or higher accounts', () => {
        const access = service();
        const platformAdmin = profile('platform-admin', 'PLATFORM', 'ADMIN');
        const companyManager = profile('company-manager', 'PLATFORM', 'MANAGER');
        const companyStaff = profile('company-staff', 'PLATFORM', 'STAFF');

        expect(() => access.assertCanCreate(platformAdmin, 'PLATFORM', 'MANAGER', null)).not.toThrow();
        expect(() => access.assertCanCreate(platformAdmin, 'STORE', 'STAFF', 'store-a')).not.toThrow();
        expect(() => access.assertCanCreate(platformAdmin, 'PLATFORM', 'ADMIN', null)).toThrow('同级');
        expect(() => access.assertCanCreate(companyManager, 'STORE', 'STAFF', 'store-a')).toThrow();
        expect(() => access.assertCanCreate(companyStaff, 'PLATFORM', 'STAFF', null)).toThrow();
    });

    it('limits the store primary administrator to lower accounts in the same store', () => {
        const access = service();
        const primary = profile('store-primary', 'STORE', 'ADMIN', 'store-a');
        const storeManager = profile('store-manager', 'STORE', 'MANAGER', 'store-a');
        const storeStaff = profile('store-staff', 'STORE', 'STAFF', 'store-a');

        expect(() => access.assertCanCreate(primary, 'STORE', 'MANAGER', 'store-a')).not.toThrow();
        expect(() => access.assertCanCreate(primary, 'STORE', 'STAFF', 'store-a')).not.toThrow();
        expect(() => access.assertCanCreate(primary, 'STORE', 'STAFF', 'store-b')).toThrow();
        expect(() => access.assertCanCreate(primary, 'PLATFORM', 'STAFF', null)).toThrow();
        expect(() => access.assertCanCreate(storeManager, 'STORE', 'STAFF', 'store-a')).toThrow();
        expect(() => access.assertCanCreate(storeStaff, 'STORE', 'STAFF', 'store-a')).toThrow();
    });

    it('applies downward-only management and store boundaries', () => {
        const access = service();
        const owner = profile('owner', 'PLATFORM', 'OWNER');
        const platformAdmin = profile('platform-admin', 'PLATFORM', 'ADMIN');
        const companyStaff = profile('company-staff', 'PLATFORM', 'STAFF');
        const storePrimary = profile('store-primary', 'STORE', 'ADMIN', 'store-a');
        const storeStaff = profile('store-staff', 'STORE', 'STAFF', 'store-a');
        const otherStoreStaff = profile('other-store-staff', 'STORE', 'STAFF', 'store-b');

        expect(access.canManage(owner, platformAdmin, false)).toBe(true);
        expect(access.canManage(platformAdmin, owner, false)).toBe(false);
        expect(access.canManage(platformAdmin, companyStaff, false)).toBe(true);
        expect(access.canManage(platformAdmin, storePrimary, false)).toBe(true);
        expect(access.canManage(storePrimary, storeStaff, false)).toBe(true);
        expect(access.canManage(storePrimary, otherStoreStaff, false)).toBe(false);
        expect(access.canManage(storeStaff, companyStaff, false)).toBe(false);
    });

    it('requires the dedicated transfer flow for store primary promotion', () => {
        const access = service();
        const owner = profile('owner', 'PLATFORM', 'OWNER');
        const platformAdmin = profile('platform-admin', 'PLATFORM', 'ADMIN');

        expect(() => access.assertCanSetAuthority(owner, 'STORE', 'ADMIN')).toThrow();
        expect(() => access.assertCanSetAuthority(platformAdmin, 'STORE', 'ADMIN')).toThrow();
        expect(() => access.assertCanSetAuthority(owner, 'STORE', 'MANAGER')).not.toThrow();
    });

    it('rejects changing an existing role outside the actor store even if the new input uses their store', async () => {
        const access = service();
        access.connection = {
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === User) return { find: vi.fn().mockResolvedValue([]) };
                if (entity === AdministratorAccessProfile) return { find: vi.fn().mockResolvedValue([]) };
                throw new Error(`Unexpected repository: ${(entity as { name?: string })?.name}`);
            },
        };
        access.policies = {
            assertStoreRolePermissions: vi.fn(),
            assertPlatformRolePermissions: vi.fn(),
        };
        const currentRole = {
            id: 'role-b',
            code: 'other-store-staff',
            channels: [{ id: 'store-b' }],
            permissions: [Permission.ReadProduct],
        } as Role;

        await expect(
            access.assertCanUpdateRole(
                {} as any,
                profile('primary-a', 'STORE', 'ADMIN', 'store-a'),
                currentRole,
                { id: 'role-b', code: 'staff-a', description: '', scope: 'STORE', channelId: 'store-a' },
            ),
        ).rejects.toThrow('所属店铺');
    });

    it('does not let a store primary edit a platform-assigned role in a single-store system', async () => {
        const access = service();
        access.connection = {
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === User) return { find: vi.fn().mockResolvedValue([{ id: 'platform-user' }]) };
                if (entity === AdministratorAccessProfile)
                    return {
                        find: vi
                            .fn()
                            .mockResolvedValue([
                                { userId: 'platform-user', scope: 'PLATFORM', channelId: null },
                            ]),
                    };
                throw new Error(`Unexpected repository: ${(entity as { name?: string })?.name}`);
            },
        };
        access.policies = {
            assertStoreRolePermissions: vi.fn(),
            assertPlatformRolePermissions: vi.fn(),
        };

        await expect(
            access.assertCanUpdateRole(
                {} as any,
                profile('primary-a', 'STORE', 'ADMIN', 'store-a'),
                {
                    id: 'platform-role',
                    code: 'platform-custom',
                    channels: [{ id: 'store-a' }],
                    permissions: [Permission.ReadProduct],
                },
                {
                    id: 'platform-role',
                    code: 'staff-a',
                    description: '',
                    scope: 'STORE',
                    channelId: 'store-a',
                },
            ),
        ).rejects.toThrow('不能下放给店铺');
    });

    it('keeps system-managed roles immutable through the managed role editor', async () => {
        const access = service();
        for (const code of ['__super_admin_role__', 'platform-administrator', 'moyao-store-admin']) {
            await expect(
                access.assertCanUpdateRole(
                    {} as any,
                    profile('owner', 'PLATFORM', 'OWNER'),
                    { code },
                    { id: 'role', code: 'renamed', description: '', scope: 'PLATFORM' },
                ),
            ).rejects.toThrow('系统固定角色');
        }
    });

    it('fails closed when an empty role has no recorded store ownership', async () => {
        const access = service();
        access.connection = {
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === User) return { find: vi.fn().mockResolvedValue([]) };
                if (entity === AdministratorPermissionAudit)
                    return { findOne: vi.fn().mockResolvedValue(null) };
                throw new Error('Unexpected repository');
            },
        };
        access.policies = { assertStoreRolePermissions: vi.fn() };

        await expect(
            access.assertCanUpdateRole(
                {} as any,
                profile('primary', 'STORE', 'ADMIN', 'store-a'),
                {
                    id: 'unclaimed',
                    code: 'custom',
                    channels: [{ id: 'store-a' }],
                    permissions: [Permission.ReadProduct],
                },
                { id: 'unclaimed', code: 'custom', description: '', scope: 'STORE', channelId: 'store-a' },
            ),
        ).rejects.toThrow('未能确认空岗位的店铺归属');
    });

    it('requires company roles to cover every current channel', async () => {
        const access = service();
        access.connection = {
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === Role)
                    return {
                        find: vi.fn().mockResolvedValue([
                            {
                                id: 'single-store-role',
                                code: 'store-job',
                                channels: [{ id: 'store-a' }],
                                permissions: [Permission.ReadProduct],
                            },
                        ]),
                    };
                if (entity === Channel)
                    return { find: vi.fn().mockResolvedValue([{ id: 'default' }, { id: 'store-a' }]) };
                throw new Error('Unexpected repository');
            },
        };
        access.policies = { assertPlatformRolePermissions: vi.fn() };

        await expect(
            access.loadAndValidateRoles({} as any, ['single-store-role'], 'PLATFORM'),
        ).rejects.toThrow('覆盖全部店铺');
    });

    it('cannot assign a platform-owned single-channel role to a store employee', async () => {
        const access = service();
        access.connection = {
            getEntityOrThrow: vi.fn().mockResolvedValue({ id: 'store-a', code: 'store-a' }),
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === Role)
                    return {
                        find: vi.fn().mockResolvedValue([
                            {
                                id: 'platform-role',
                                code: 'platform-role',
                                channels: [{ id: 'store-a' }],
                                permissions: [Permission.ReadProduct],
                            },
                        ]),
                    };
                if (entity === User) return { find: vi.fn().mockResolvedValue([{ id: 'platform-user' }]) };
                if (entity === AdministratorAccessProfile)
                    return {
                        find: vi
                            .fn()
                            .mockResolvedValue([
                                { userId: 'platform-user', scope: 'PLATFORM', channelId: null },
                            ]),
                    };
                throw new Error('Unexpected repository');
            },
        };

        await expect(
            access.loadAndValidateRoles({} as any, ['platform-role'], 'STORE', 'store-a'),
        ).rejects.toThrow('不能下放给店铺');
    });

    it('does not extend a legacy role shared with store accounts to a new store', async () => {
        const access = service();
        const sharedRole = {
            id: 'shared-role',
            code: 'legacy-shared-role',
            channels: [{ id: 'default' }, { id: 'store-a' }],
            permissions: [Permission.ReadProduct],
        } as Role;
        access.connection = {
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === AdministratorAccessProfile) {
                    return {
                        find: vi
                            .fn()
                            .mockImplementation(({ where }: { where: unknown }) =>
                                'status' in (where as object)
                                    ? [{ administrator: { user: { roles: [sharedRole] } } }]
                                    : [{ userId: 'store-user', scope: 'STORE', channelId: 'store-a' }],
                            ),
                    };
                }
                if (entity === User) return { find: vi.fn().mockResolvedValue([{ id: 'store-user' }]) };
                throw new Error('Unexpected repository');
            },
        };
        access.roleService = { assignRoleToChannel: vi.fn() };

        await expect(access.extendPlatformRolesToChannel({} as any, { id: 'store-b' })).rejects.toThrow(
            '不能作为跨店岗位扩展',
        );
        expect(access.roleService.assignRoleToChannel).not.toHaveBeenCalled();
    });

    it('rejects the technical default channel as a store account scope', async () => {
        const access = service();
        access.connection = {
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === Role) return { find: vi.fn().mockResolvedValue([]) };
                throw new Error('Unexpected repository');
            },
            getEntityOrThrow: vi.fn().mockResolvedValue({ id: 'default', code: '__default_channel__' }),
        };

        await expect(access.loadAndValidateRoles({} as any, [], 'STORE', 'default')).rejects.toThrow(
            '默认渠道仅用于平台技术上下文',
        );
    });

    it('automatically assigns the fixed platform administrator role on creation', async () => {
        const access = service();
        access.current = vi.fn().mockResolvedValue({
            ...profile('owner', 'PLATFORM', 'OWNER'),
            administratorId: 'owner-admin',
        });
        access.ensurePlatformAdministratorRole = vi.fn().mockResolvedValue({ id: 'fixed-admin-role' });
        access.loadAndValidateRoles = vi.fn();
        access.administratorService = {
            create: vi.fn().mockResolvedValue({ id: 'new-admin', user: { id: 'new-user' } }),
        };
        access.initialPasswordService = { requirePasswordChange: vi.fn() };
        access.saveProfile = vi.fn().mockResolvedValue({ id: 'new-profile' });
        access.audit = { record: vi.fn() };
        access.requireProfile = vi.fn().mockResolvedValue({ id: 'new-profile' });

        await access.createManagedAdministrator({} as any, {
            firstName: '平台',
            lastName: '管理员',
            emailAddress: 'admin@example.test',
            password: 'temporary-password',
            roleIds: [],
            scope: 'PLATFORM',
            authority: 'ADMIN',
        });

        expect(access.administratorService.create).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ roleIds: ['fixed-admin-role'] }),
        );
        expect(access.loadAndValidateRoles).not.toHaveBeenCalled();
    });

    it('requires replacement company roles when demoting a platform administrator', async () => {
        const access = service();
        access.current = vi.fn().mockResolvedValue(profile('owner', 'PLATFORM', 'OWNER'));
        access.requireByAdministratorId = vi.fn().mockResolvedValue({
            ...profile('admin', 'PLATFORM', 'ADMIN'),
            administratorId: 'admin',
        });

        await expect(
            access.updateManagedAdministrator({} as any, { id: 'admin', authority: 'MANAGER' }),
        ).rejects.toThrow('必须选择新的公司岗位');
    });

    it('rejects transferring either primary identity to the same account', async () => {
        const access = service();
        const owner = { ...profile('owner', 'PLATFORM', 'OWNER'), status: 'ACTIVE' };
        const storePrimary = {
            ...profile('primary', 'STORE', 'ADMIN', 'store-a'),
            storePrimarySlot: 'store-a',
            status: 'ACTIVE',
        };
        access.current = vi.fn().mockResolvedValueOnce(owner).mockResolvedValueOnce(storePrimary);
        access.requireByAdministratorId = vi
            .fn()
            .mockResolvedValueOnce(owner)
            .mockResolvedValueOnce(storePrimary);
        access.connection = {
            getRepository: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(storePrimary) }),
        };

        await expect(access.transferPlatformOwnership({} as any, 'owner')).rejects.toThrow(
            '只能转移给正常的平台账号',
        );
        await expect(access.transferStoreAdministration({} as any, 'store-a', 'primary')).rejects.toThrow(
            '只能转移给同店正常账号',
        );
    });

    it('revokes every session when only the account authority changes', async () => {
        const access = service();
        const targetUser = { id: 'target-user' };
        const target = {
            ...profile('target-profile', 'STORE', 'STAFF', 'store-a'),
            administratorId: 'target-admin',
            administrator: { user: targetUser },
            status: 'ACTIVE',
        };
        access.current = vi.fn().mockResolvedValue(profile('primary', 'STORE', 'ADMIN', 'store-a'));
        access.requireByAdministratorId = vi.fn().mockResolvedValue(target);
        access.administratorService = { update: vi.fn() };
        access.sessionService = { deleteSessionsByUser: vi.fn() };
        access.connection = { getRepository: vi.fn().mockReturnValue({ save: vi.fn() }) };
        access.audit = { record: vi.fn() };
        access.requireProfile = vi.fn().mockResolvedValue(target);

        await access.updateManagedAdministrator({} as any, {
            id: 'target-admin',
            authority: 'MANAGER',
        });

        expect(target.authority).toBe('MANAGER');
        expect(access.sessionService.deleteSessionsByUser).toHaveBeenCalledWith(
            expect.anything(),
            targetUser,
        );
    });

    it('suspends an unmapped legacy administrator instead of granting platform staff scope', async () => {
        const access = service();
        access.administratorService = {
            findOneByUserId: vi.fn().mockResolvedValue({
                id: 'legacy-admin',
                user: {
                    id: 'legacy-user',
                    roles: [{ code: 'legacy-role', channels: [{ id: 'default' }, { id: 'store-a' }] }],
                },
            }),
        };
        access.connection = {
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === StoreAdministratorAccess) return { findOne: vi.fn().mockResolvedValue(null) };
                throw new Error('Unexpected repository');
            },
        };
        access.initializeLegacyProfile = vi
            .fn()
            .mockImplementation((_ctx: unknown, _administrator: unknown, input: unknown) => input);

        await expect(access.inferAndPersistLegacy({} as any, 'legacy-user')).resolves.toMatchObject({
            scope: 'PLATFORM',
            authority: 'STAFF',
            status: 'SUSPENDED',
        });
    });

    it('restores only a validated fixed platform administrator without a SuperAdmin role', async () => {
        const access = service();
        access.administratorService = {
            findOneByUserId: vi.fn().mockResolvedValue({
                id: 'platform-admin',
                user: {
                    id: 'platform-user',
                    roles: [
                        { id: 'fixed-role', code: 'platform-administrator', channels: [] },
                        { id: 'customer-role', code: '__customer_role__', channels: [] },
                    ],
                },
            }),
        };
        access.ensurePlatformAdministratorRole = vi.fn().mockResolvedValue({ id: 'fixed-role' });
        access.initializeLegacyProfile = vi
            .fn()
            .mockImplementation((_ctx: unknown, _administrator: unknown, input: unknown) => input);

        await expect(access.inferAndPersistLegacy({} as any, 'platform-user')).resolves.toMatchObject({
            scope: 'PLATFORM',
            authority: 'ADMIN',
            status: 'ACTIVE',
            platformOwnerSlot: null,
        });
        expect(access.ensurePlatformAdministratorRole).toHaveBeenCalledOnce();
    });

    it('rejects an unvalidated platform administrator role instead of granting access', async () => {
        const access = service();
        access.administratorService = {
            findOneByUserId: vi.fn().mockResolvedValue({
                id: 'platform-admin',
                user: {
                    id: 'platform-user',
                    roles: [{ id: 'wrong-role', code: 'platform-administrator', channels: [] }],
                },
            }),
        };
        access.ensurePlatformAdministratorRole = vi.fn().mockResolvedValue({ id: 'fixed-role' });
        access.initializeLegacyProfile = vi.fn();

        await expect(access.inferAndPersistLegacy({} as any, 'platform-user')).rejects.toThrow(
            '固定角色不匹配',
        );
        expect(access.initializeLegacyProfile).not.toHaveBeenCalled();
    });

    it('refuses a fixed platform role that retains owner-only permissions', async () => {
        const access = service();
        access.connection = {
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === Role) {
                    return {
                        findOne: vi.fn().mockResolvedValue({
                            permissions: [Permission.SuperAdmin],
                            channels: [{ id: 'default' }],
                        }),
                    };
                }
                if (entity === Channel) return { find: vi.fn().mockResolvedValue([{ id: 'default' }]) };
                throw new Error('Unexpected repository');
            },
        };
        access.policies = {
            catalog: vi
                .fn()
                .mockReturnValue([{ code: Permission.ReadProduct, scope: 'STORE', delegable: true }]),
        };

        await expect(access.ensurePlatformAdministratorRole({} as any)).rejects.toThrow('固定角色配置异常');
    });

    it('blocks a legacy store primary role carrying platform-only permissions at runtime', async () => {
        const access = service();
        access.administratorService = {
            findOneByUserId: vi.fn().mockResolvedValue({
                id: 'legacy-admin',
                user: {
                    id: 'legacy-user',
                    roles: [
                        {
                            code: 'store-a-store-admin',
                            channels: [{ id: 'store-a' }],
                            permissions: [Permission.CreateAdministrator, Permission.CreateApiKey],
                        },
                    ],
                },
            }),
        };
        access.connection = {
            getEntityOrThrow: vi.fn().mockResolvedValue({ id: 'store-a', code: 'store-a' }),
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === StoreAdministratorAccess)
                    return { findOne: vi.fn().mockResolvedValue({ mustChangePassword: false }) };
                throw new Error('Unexpected repository');
            },
        };
        access.policies = {
            catalog: vi.fn().mockReturnValue([
                { code: Permission.CreateAdministrator, scope: 'PLATFORM' },
                { code: Permission.CreateApiKey, scope: 'OWNER_ONLY' },
            ]),
        };
        access.initializeLegacyProfile = vi.fn();

        await expect(access.inferAndPersistLegacy({} as any, 'legacy-user')).rejects.toThrow('包含平台权限');
        expect(access.initializeLegacyProfile).not.toHaveBeenCalled();
    });
});
