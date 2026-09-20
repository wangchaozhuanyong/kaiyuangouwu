import { Injectable } from '@nestjs/common';
import { Permission } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Administrator,
    AdministratorService,
    Channel,
    ForbiddenError,
    idsAreEqual,
    RequestContext,
    Role,
    RoleService,
    SessionService,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

import { AdministratorPermissionAuditService } from './administrator-permission-audit.service';
import {
    AdministratorAccessAuthority,
    AdministratorAccessProfile,
    AdministratorAccessScope,
} from './entities/administrator-access-profile.entity';
import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import { PermissionPolicyRegistry } from './permission-policy';

export interface CreateManagedAdministratorInput {
    firstName: string;
    lastName: string;
    emailAddress: string;
    password: string;
    roleIds: ID[];
    scope: AdministratorAccessScope;
    authority: AdministratorAccessAuthority;
    channelId?: ID | null;
}

export interface UpdateManagedAdministratorInput {
    id: ID;
    firstName?: string;
    lastName?: string;
    emailAddress?: string;
    password?: string;
    roleIds?: ID[];
    authority?: AdministratorAccessAuthority;
}

export interface ManagedRoleInput {
    id?: ID;
    code: string;
    description: string;
    permissions?: Permission[];
    templateCode?: string | null;
    scope: AdministratorAccessScope;
    channelId?: ID | null;
}

const authorityRank: Record<AdministratorAccessAuthority, number> = {
    OWNER: 4,
    ADMIN: 3,
    MANAGER: 2,
    STAFF: 1,
};

@Injectable()
export class AdministratorAccessService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly administratorService: AdministratorService,
        private readonly roleService: RoleService,
        private readonly sessionService: SessionService,
        private readonly initialPasswordService: MerchantInitialPasswordService,
        private readonly policies: PermissionPolicyRegistry,
        private readonly audit: AdministratorPermissionAuditService,
    ) {}

    async current(ctx: RequestContext): Promise<AdministratorAccessProfile> {
        if (!ctx.activeUserId) throw new ForbiddenError();
        const existing = await this.findByUserId(ctx, ctx.activeUserId);
        if (existing) return existing;
        return this.inferAndPersistLegacy(ctx, ctx.activeUserId);
    }

    findByUserId(ctx: RequestContext, userId: ID): Promise<AdministratorAccessProfile | null> {
        return this.connection.getRepository(ctx, AdministratorAccessProfile).findOne({
            where: { userId },
            relations: {
                channel: true,
                administrator: { user: { roles: { channels: true } } },
            },
        });
    }

    async registerStorePrimary(
        ctx: RequestContext,
        administrator: Administrator,
        channel: Channel,
    ): Promise<AdministratorAccessProfile> {
        const actor = ctx.activeUserId
            ? await this.administratorService.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        return this.saveProfile(ctx, administrator, {
            scope: 'STORE',
            authority: 'ADMIN',
            channel,
            channelId: channel.id,
            createdByAdministratorId: actor?.id ?? null,
            mustChangePassword: true,
            platformOwnerSlot: null,
            storePrimarySlot: String(channel.id),
        });
    }

    async manageableAdministrators(ctx: RequestContext): Promise<AdministratorAccessProfile[]> {
        const actor = await this.current(ctx);
        const profiles = await this.connection.getRepository(ctx, AdministratorAccessProfile).find({
            relations: {
                channel: true,
                administrator: { user: { roles: { channels: true } } },
            },
            order: { createdAt: 'DESC' },
        });
        return profiles.filter(profile => this.canManage(actor, profile, true));
    }

    async manageableRoles(ctx: RequestContext): Promise<Role[]> {
        const actor = await this.current(ctx);
        const roles = await this.connection.getRepository(ctx, Role).find({
            relations: { channels: true },
            order: { createdAt: 'ASC' },
        });
        return roles.filter(role => {
            if (role.code === '__super_admin_role__' || role.code === '__customer_role__') return false;
            if (actor.scope === 'PLATFORM') {
                return role.permissions.every(permission => {
                    const permissionCode = String(permission);
                    if (permissionCode === String(Permission.Authenticated)) return true;
                    return this.policies
                        .catalog()
                        .some(policy => policy.code === permissionCode && policy.scope !== 'OWNER_ONLY');
                });
            }
            return (
                role.channels.length === 1 &&
                idsAreEqual(role.channels[0].id, actor.channelId) &&
                role.permissions.every(permission => {
                    const permissionCode = String(permission);
                    if (permissionCode === String(Permission.Authenticated)) return true;
                    const policy = this.policies.catalog().find(item => item.code === permissionCode);
                    return policy?.scope === 'STORE';
                })
            );
        });
    }

    async manageableChannels(ctx: RequestContext): Promise<Channel[]> {
        const actor = await this.current(ctx);
        if (actor.scope === 'STORE') {
            return actor.channel ? [actor.channel] : [];
        }
        return this.connection.getRepository(ctx, Channel).find({ order: { code: 'ASC' } });
    }

    async createManagedAdministrator(
        ctx: RequestContext,
        input: CreateManagedAdministratorInput,
    ): Promise<AdministratorAccessProfile> {
        const actor = await this.current(ctx);
        this.assertCanCreate(actor, input.scope, input.authority, input.channelId);
        const roles = await this.loadAndValidateRoles(ctx, input.roleIds, input.scope, input.channelId);
        if (roles.length === 0) throw new UserInputError('请至少选择一个岗位角色');
        const administrator = await this.administratorService.create(ctx, {
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            emailAddress: input.emailAddress.trim(),
            password: input.password,
            roleIds: roles.map(role => role.id),
        });
        await this.initialPasswordService.requirePasswordChange(ctx, administrator);
        const channel =
            input.scope === 'STORE'
                ? await this.connection.getEntityOrThrow(ctx, Channel, input.channelId as ID)
                : null;
        const profile = await this.saveProfile(ctx, administrator, {
            scope: input.scope,
            authority: input.authority,
            channel,
            channelId: channel?.id ?? null,
            createdByAdministratorId: actor.administratorId,
            mustChangePassword: true,
            platformOwnerSlot: null,
            storePrimarySlot:
                input.scope === 'STORE' && input.authority === 'ADMIN' ? String(channel?.id) : null,
        });
        await this.audit.record(ctx, {
            action: 'CREATE_MANAGED_ADMINISTRATOR',
            targetAdministratorId: administrator.id,
            channelId: channel?.id,
            afterSummary: this.profileSummary(profile),
        });
        return this.requireProfile(ctx, profile.id);
    }

    async updateManagedAdministrator(
        ctx: RequestContext,
        input: UpdateManagedAdministratorInput,
    ): Promise<AdministratorAccessProfile> {
        const actor = await this.current(ctx);
        const target = await this.requireByAdministratorId(ctx, input.id);
        this.assertCanManage(actor, target);
        if (input.authority) this.assertCanSetAuthority(actor, target.scope, input.authority);
        if (
            target.authority === 'OWNER' ||
            (target.scope === 'STORE' && target.authority === 'ADMIN' && input.authority !== undefined)
        ) {
            throw new UserInputError('所有者或店铺主管理员层级只能通过专用转移功能变更');
        }
        if (input.roleIds) {
            await this.loadAndValidateRoles(ctx, input.roleIds, target.scope, target.channelId);
        }
        const before = this.profileSummary(target);
        await this.administratorService.update(ctx, {
            id: target.administratorId,
            firstName: input.firstName,
            lastName: input.lastName,
            emailAddress: input.emailAddress,
            password: input.password,
            roleIds: input.roleIds,
        });
        if (input.authority) target.authority = input.authority;
        await this.connection.getRepository(ctx, AdministratorAccessProfile).save(target);
        await this.audit.record(ctx, {
            action: 'UPDATE_MANAGED_ADMINISTRATOR',
            targetAdministratorId: target.administratorId,
            channelId: target.channelId,
            beforeSummary: before,
            afterSummary: this.profileSummary(target),
        });
        return this.requireProfile(ctx, target.id);
    }

    async suspendManagedAdministrator(
        ctx: RequestContext,
        administratorId: ID,
    ): Promise<AdministratorAccessProfile> {
        const actor = await this.current(ctx);
        const target = await this.requireByAdministratorId(ctx, administratorId);
        this.assertCanManage(actor, target);
        if (target.authority === 'OWNER' || (target.scope === 'STORE' && target.authority === 'ADMIN')) {
            throw new UserInputError('必须先转移所有权或店铺主管理员身份才能停用该账号');
        }
        target.status = 'SUSPENDED';
        await this.connection.getRepository(ctx, AdministratorAccessProfile).save(target);
        await this.sessionService.deleteSessionsByUser(ctx, target.administrator.user);
        await this.audit.record(ctx, {
            action: 'SUSPEND_MANAGED_ADMINISTRATOR',
            targetAdministratorId: target.administratorId,
            channelId: target.channelId,
            afterSummary: this.profileSummary(target),
        });
        return target;
    }

    async createManagedRole(ctx: RequestContext, input: ManagedRoleInput): Promise<Role> {
        const actor = await this.current(ctx);
        const { channelIds, permissions } = await this.validateManagedRoleInput(ctx, actor, input);
        const role = await this.roleService.create(ctx, {
            code: input.code.trim(),
            description: input.description.trim(),
            channelIds,
            permissions,
        });
        await this.audit.record(ctx, {
            action: 'CREATE_MANAGED_ROLE',
            targetRoleId: role.id,
            channelId: input.scope === 'STORE' ? input.channelId : null,
            afterSummary: { code: role.code, permissions: role.permissions },
        });
        return role;
    }

    async updateManagedRole(ctx: RequestContext, input: ManagedRoleInput & { id: ID }): Promise<Role> {
        const actor = await this.current(ctx);
        const current = await this.connection.getEntityOrThrow(ctx, Role, input.id, {
            relations: ['channels'],
        });
        if (current.code.endsWith('-store-admin')) {
            throw new UserInputError('店铺主管理员固定角色不允许修改');
        }
        const { channelIds, permissions } = await this.validateManagedRoleInput(ctx, actor, input);
        const before = { code: current.code, permissions: current.permissions };
        const role = await this.roleService.update(ctx, {
            id: input.id,
            code: input.code.trim(),
            description: input.description.trim(),
            channelIds,
            permissions,
        });
        await this.audit.record(ctx, {
            action: 'UPDATE_MANAGED_ROLE',
            targetRoleId: role.id,
            channelId: input.scope === 'STORE' ? input.channelId : null,
            beforeSummary: before,
            afterSummary: { code: role.code, permissions: role.permissions },
        });
        return role;
    }

    async transferPlatformOwnership(
        ctx: RequestContext,
        targetAdministratorId: ID,
    ): Promise<AdministratorAccessProfile> {
        const actor = await this.current(ctx);
        if (actor.scope !== 'PLATFORM' || actor.authority !== 'OWNER') throw new ForbiddenError();
        const target = await this.requireByAdministratorId(ctx, targetAdministratorId);
        if (target.scope !== 'PLATFORM' || target.status !== 'ACTIVE') {
            throw new UserInputError('平台所有权只能转移给正常的平台账号');
        }
        const superRole = await this.roleService.getSuperAdminRole(ctx);
        const actorUser = actor.administrator.user;
        const targetUser = target.administrator.user;
        targetUser.roles = [
            ...targetUser.roles.filter(role => role.code !== '__super_admin_role__'),
            superRole,
        ];
        actorUser.roles = actorUser.roles.filter(role => role.code !== '__super_admin_role__');
        const platformRole = await this.ensurePlatformAdministratorRole(ctx);
        if (!actorUser.roles.some(role => idsAreEqual(role.id, platformRole.id)))
            actorUser.roles.push(platformRole);

        actor.platformOwnerSlot = null;
        actor.authority = 'ADMIN';
        await this.connection.getRepository(ctx, AdministratorAccessProfile).save(actor);
        target.platformOwnerSlot = 'PLATFORM_OWNER';
        target.authority = 'OWNER';
        await this.connection.getRepository(ctx, AdministratorAccessProfile).save(target);
        await this.connection.getRepository(ctx, User).save([targetUser, actorUser]);
        await Promise.all([
            this.sessionService.deleteSessionsByUser(ctx, actorUser),
            this.sessionService.deleteSessionsByUser(ctx, targetUser),
        ]);
        await this.audit.record(ctx, {
            action: 'TRANSFER_PLATFORM_OWNERSHIP',
            targetAdministratorId: target.administratorId,
            afterSummary: { previousOwnerId: actor.administratorId, newOwnerId: target.administratorId },
        });
        return this.requireProfile(ctx, target.id);
    }

    async transferStoreAdministration(
        ctx: RequestContext,
        channelId: ID,
        targetAdministratorId: ID,
    ): Promise<AdministratorAccessProfile> {
        const actor = await this.current(ctx);
        const currentPrimary = await this.connection.getRepository(ctx, AdministratorAccessProfile).findOne({
            where: { storePrimarySlot: String(channelId) },
            relations: { administrator: { user: { roles: { channels: true } } }, channel: true },
        });
        if (!currentPrimary) throw new UserInputError('当前店铺没有可转移的主管理员');
        if (
            actor.authority !== 'OWNER' &&
            !(actor.scope === 'PLATFORM' && actor.authority === 'ADMIN') &&
            !idsAreEqual(actor.id, currentPrimary.id)
        ) {
            throw new ForbiddenError();
        }
        const target = await this.requireByAdministratorId(ctx, targetAdministratorId);
        if (
            target.scope !== 'STORE' ||
            !idsAreEqual(target.channelId, channelId) ||
            target.status !== 'ACTIVE'
        ) {
            throw new UserInputError('店铺主管理员只能转移给同店正常账号');
        }
        const primaryRole = currentPrimary.administrator.user.roles.find(role =>
            role.code.endsWith('-store-admin'),
        );
        if (!primaryRole) throw new UserInputError('店铺主管理员固定角色缺失');
        if (!currentPrimary.channel) throw new UserInputError('店铺主管理员未绑定有效店铺');
        currentPrimary.administrator.user.roles = currentPrimary.administrator.user.roles.filter(
            role => !idsAreEqual(role.id, primaryRole.id),
        );
        if (currentPrimary.administrator.user.roles.length === 0) {
            currentPrimary.administrator.user.roles.push(
                await this.ensureStoreManagerRole(ctx, currentPrimary.channel),
            );
        }
        if (!target.administrator.user.roles.some(role => idsAreEqual(role.id, primaryRole.id))) {
            target.administrator.user.roles.push(primaryRole);
        }
        currentPrimary.storePrimarySlot = null;
        currentPrimary.authority = 'MANAGER';
        await this.connection.getRepository(ctx, AdministratorAccessProfile).save(currentPrimary);
        target.storePrimarySlot = String(channelId);
        target.authority = 'ADMIN';
        await this.connection.getRepository(ctx, AdministratorAccessProfile).save(target);
        await this.connection
            .getRepository(ctx, User)
            .save([currentPrimary.administrator.user, target.administrator.user]);
        await Promise.all([
            this.sessionService.deleteSessionsByUser(ctx, currentPrimary.administrator.user),
            this.sessionService.deleteSessionsByUser(ctx, target.administrator.user),
        ]);
        await this.audit.record(ctx, {
            action: 'TRANSFER_STORE_ADMINISTRATION',
            targetAdministratorId: target.administratorId,
            channelId,
            afterSummary: {
                previousAdministratorId: currentPrimary.administratorId,
                newAdministratorId: target.administratorId,
            },
        });
        return this.requireProfile(ctx, target.id);
    }

    async extendPlatformRolesToChannel(ctx: RequestContext, channel: Channel): Promise<void> {
        const platformProfiles = await this.connection.getRepository(ctx, AdministratorAccessProfile).find({
            where: { scope: 'PLATFORM', status: 'ACTIVE' },
            relations: { administrator: { user: { roles: { channels: true } } } },
        });
        const roles = new Map<string, Role>();
        for (const profile of platformProfiles) {
            for (const role of profile.administrator.user.roles) roles.set(String(role.id), role);
        }
        for (const role of roles.values()) {
            if (!role.channels.some(existing => idsAreEqual(existing.id, channel.id))) {
                await this.roleService.assignRoleToChannel(ctx, role.id, channel.id);
            }
        }
    }

    private async validateManagedRoleInput(
        ctx: RequestContext,
        actor: AdministratorAccessProfile,
        input: ManagedRoleInput,
    ): Promise<{ channelIds: ID[]; permissions: Permission[] }> {
        const template = input.templateCode
            ? this.policies.templates().find(candidate => candidate.code === input.templateCode)
            : undefined;
        const permissions = this.policies.normalizePermissions(
            input.permissions?.length ? input.permissions : (template?.permissions ?? []),
        ) as Permission[];
        if (permissions.length === 0) throw new UserInputError('请至少选择一项权限或岗位模板');
        if (input.scope === 'STORE') {
            if (actor.scope === 'STORE' && !idsAreEqual(actor.channelId, input.channelId))
                throw new ForbiddenError();
            if (!input.channelId) throw new UserInputError('店铺角色必须绑定一个店铺');
            this.policies.assertStoreRolePermissions(permissions);
            return { channelIds: [input.channelId], permissions };
        }
        if (actor.scope !== 'PLATFORM' || authorityRank[actor.authority] < authorityRank.ADMIN) {
            throw new ForbiddenError();
        }
        this.policies.assertPlatformRolePermissions(permissions);
        const channels = await this.connection.getRepository(ctx, Channel).find();
        return { channelIds: channels.map(channel => channel.id), permissions };
    }

    private async loadAndValidateRoles(
        ctx: RequestContext,
        roleIds: ID[],
        scope: AdministratorAccessScope,
        channelId?: ID | null,
    ): Promise<Role[]> {
        const roles = await this.connection.getRepository(ctx, Role).find({
            where: { id: In(roleIds) },
            relations: { channels: true },
        });
        if (roles.length !== new Set(roleIds.map(String)).size) throw new UserInputError('所选角色不存在');
        if (roles.some(role => role.code === '__super_admin_role__')) {
            throw new UserInputError('平台所有者身份只能通过专用转移功能变更');
        }
        for (const role of roles) {
            if (scope === 'STORE') {
                if (role.channels.length !== 1 || !idsAreEqual(role.channels[0].id, channelId)) {
                    throw new UserInputError('店铺账号只能使用所属店铺的角色');
                }
                this.policies.assertStoreRolePermissions(
                    role.permissions.filter(permission => permission !== Permission.Authenticated),
                );
            } else {
                this.policies.assertPlatformRolePermissions(
                    role.permissions.filter(permission => permission !== Permission.Authenticated),
                );
            }
        }
        return roles;
    }

    private assertCanCreate(
        actor: AdministratorAccessProfile,
        scope: AdministratorAccessScope,
        authority: AdministratorAccessAuthority,
        channelId?: ID | null,
    ): void {
        if (authority === 'OWNER') throw new UserInputError('平台所有者只能通过专用转移功能变更');
        if (scope === 'STORE' && authority === 'ADMIN') {
            throw new UserInputError('店铺主管理员只能通过开店流程或专用转移功能设置');
        }
        if (actor.scope === 'STORE') {
            if (
                actor.authority !== 'ADMIN' ||
                scope !== 'STORE' ||
                !idsAreEqual(actor.channelId, channelId)
            ) {
                throw new ForbiddenError();
            }
            return;
        }
        if (actor.authority === 'STAFF' || actor.authority === 'MANAGER') throw new ForbiddenError();
        if (actor.authority === 'ADMIN' && scope === 'PLATFORM' && authority === 'ADMIN') {
            throw new UserInputError('平台管理员不能创建同级平台管理员');
        }
    }

    private assertCanSetAuthority(
        actor: AdministratorAccessProfile,
        scope: AdministratorAccessScope,
        authority: AdministratorAccessAuthority,
    ): void {
        if (authority === 'OWNER' || authorityRank[authority] >= authorityRank[actor.authority]) {
            throw new ForbiddenError();
        }
        if (actor.scope === 'STORE' && scope !== 'STORE') throw new ForbiddenError();
    }

    private assertCanManage(actor: AdministratorAccessProfile, target: AdministratorAccessProfile): void {
        if (!this.canManage(actor, target, false)) throw new ForbiddenError();
    }

    private canManage(
        actor: AdministratorAccessProfile,
        target: AdministratorAccessProfile,
        includeSelf: boolean,
    ): boolean {
        if (!includeSelf && idsAreEqual(actor.id, target.id)) return false;
        if (actor.authority === 'OWNER')
            return target.authority !== 'OWNER' || idsAreEqual(actor.id, target.id);
        if (actor.scope === 'PLATFORM' && actor.authority === 'ADMIN') {
            return (
                target.authority !== 'OWNER' && !(target.scope === 'PLATFORM' && target.authority === 'ADMIN')
            );
        }
        if (actor.scope === 'STORE' && actor.authority === 'ADMIN') {
            return (
                target.scope === 'STORE' &&
                idsAreEqual(actor.channelId, target.channelId) &&
                authorityRank[target.authority] < authorityRank.ADMIN
            );
        }
        return false;
    }

    private async inferAndPersistLegacy(
        ctx: RequestContext,
        userId: ID,
    ): Promise<AdministratorAccessProfile> {
        const administrator = await this.administratorService.findOneByUserId(ctx, userId, [
            'user',
            'user.roles',
            'user.roles.channels',
        ]);
        if (!administrator) throw new ForbiddenError();
        const isOwner = administrator.user.roles.some(role => role.code === '__super_admin_role__');
        if (isOwner) {
            const existingOwner = await this.connection
                .getRepository(ctx, AdministratorAccessProfile)
                .findOne({
                    where: { platformOwnerSlot: 'PLATFORM_OWNER' },
                });
            if (existingOwner && !idsAreEqual(existingOwner.administratorId, administrator.id)) {
                throw new UserInputError('检测到多个超级管理员，必须先完成所有者归并');
            }
            return this.saveProfile(ctx, administrator, {
                scope: 'PLATFORM',
                authority: 'OWNER',
                channel: null,
                channelId: null,
                createdByAdministratorId: administrator.id,
                mustChangePassword: false,
                platformOwnerSlot: 'PLATFORM_OWNER',
                storePrimarySlot: null,
            });
        }
        const legacy = await this.connection.getRepository(ctx, StoreAdministratorAccess).findOne({
            where: { userId },
        });
        const channelIds = [
            ...new Set(
                administrator.user.roles.flatMap(role => role.channels.map(channel => String(channel.id))),
            ),
        ];
        if (legacy && channelIds.length === 1) {
            const channel = await this.connection.getEntityOrThrow(ctx, Channel, channelIds[0]);
            const primary = await this.connection.getRepository(ctx, AdministratorAccessProfile).findOne({
                where: { storePrimarySlot: channelIds[0] },
            });
            return this.saveProfile(ctx, administrator, {
                scope: 'STORE',
                authority: primary ? 'MANAGER' : 'ADMIN',
                channel,
                channelId: channel.id,
                createdByAdministratorId: null,
                mustChangePassword: legacy.mustChangePassword,
                platformOwnerSlot: null,
                storePrimarySlot: primary ? null : channelIds[0],
            });
        }
        return this.saveProfile(ctx, administrator, {
            scope: 'PLATFORM',
            authority: 'STAFF',
            channel: null,
            channelId: null,
            createdByAdministratorId: null,
            mustChangePassword: false,
            platformOwnerSlot: null,
            storePrimarySlot: null,
        });
    }

    private saveProfile(
        ctx: RequestContext,
        administrator: Administrator,
        input: Partial<AdministratorAccessProfile>,
    ): Promise<AdministratorAccessProfile> {
        return this.connection.getRepository(ctx, AdministratorAccessProfile).save(
            new AdministratorAccessProfile({
                administrator,
                administratorId: administrator.id,
                userId: administrator.user.id,
                ...input,
            }),
        );
    }

    private async requireByAdministratorId(
        ctx: RequestContext,
        administratorId: ID,
    ): Promise<AdministratorAccessProfile> {
        const profile = await this.connection.getRepository(ctx, AdministratorAccessProfile).findOne({
            where: { administratorId },
            relations: { channel: true, administrator: { user: { roles: { channels: true } } } },
        });
        if (!profile) throw new UserInputError('目标账号尚未建立权限访问资料');
        return profile;
    }

    private async requireProfile(ctx: RequestContext, id: ID): Promise<AdministratorAccessProfile> {
        const profile = await this.connection.getRepository(ctx, AdministratorAccessProfile).findOne({
            where: { id },
            relations: { channel: true, administrator: { user: { roles: { channels: true } } } },
        });
        if (!profile) throw new UserInputError('权限访问资料不存在');
        return profile;
    }

    private async ensurePlatformAdministratorRole(ctx: RequestContext): Promise<Role> {
        const repository = this.connection.getRepository(ctx, Role);
        const existing = await repository.findOne({
            where: { code: 'platform-administrator' },
            relations: { channels: true },
        });
        if (existing) return existing;
        const permissions = [
            ...this.policies
                .catalog()
                .filter(policy => policy.scope !== 'OWNER_ONLY' && policy.delegable)
                .map(policy => policy.code as Permission),
            Permission.CreateAdministrator,
            Permission.ReadAdministrator,
            Permission.UpdateAdministrator,
            Permission.DeleteAdministrator,
        ];
        const uniquePermissions = [...new Set(permissions)];
        const channels = await this.connection.getRepository(ctx, Channel).find();
        return this.roleService.create(ctx, {
            code: 'platform-administrator',
            description: '平台管理员',
            permissions: uniquePermissions,
            channelIds: channels.map(channel => channel.id),
        });
    }

    private async ensureStoreManagerRole(ctx: RequestContext, channel: Channel): Promise<Role> {
        const code = `${channel.code}-store-manager`;
        const repository = this.connection.getRepository(ctx, Role);
        const existing = await repository.findOne({ where: { code }, relations: { channels: true } });
        if (existing) return existing;
        const template = this.policies.templates().find(candidate => candidate.code === 'STORE_MANAGER');
        if (!template) throw new UserInputError('店铺普通管理员岗位模板缺失');
        return this.roleService.create(ctx, {
            code,
            description: `${channel.code} 店铺普通管理员`,
            permissions: template.permissions as Permission[],
            channelIds: [channel.id],
        });
    }

    private profileSummary(profile: AdministratorAccessProfile): Record<string, unknown> {
        return {
            scope: profile.scope,
            authority: profile.authority,
            channelId: profile.channelId == null ? null : String(profile.channelId),
            status: profile.status,
        };
    }
}
