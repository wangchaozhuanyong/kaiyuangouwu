import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import {
    AdministratorService,
    ForbiddenError,
    idsAreEqual,
    Permission,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

import { AdministratorAccessProfile } from './entities/administrator-access-profile.entity';
import { AdministratorPermissionAudit } from './entities/administrator-permission-audit.entity';

export interface AdministratorPermissionAuditInput {
    action: string;
    targetAdministratorId?: ID | null;
    targetRoleId?: ID | null;
    channelId?: ID | null;
    result?: 'SUCCESS' | 'FAILED';
    beforeSummary?: Record<string, unknown> | null;
    afterSummary?: Record<string, unknown> | null;
    failureReason?: string | null;
}

@Injectable()
export class AdministratorPermissionAuditService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly administratorService: AdministratorService,
    ) {}

    async record(ctx: RequestContext, input: AdministratorPermissionAuditInput): Promise<void> {
        const actor = ctx.activeUserId
            ? await this.administratorService.findOneByUserId(ctx, ctx.activeUserId)
            : undefined;
        const entry = new AdministratorPermissionAudit({
            actorAdministratorId: actor?.id ?? null,
            targetAdministratorId: input.targetAdministratorId ?? null,
            targetRoleId: input.targetRoleId ?? null,
            channelId: input.channelId ?? null,
            action: input.action,
            result: input.result ?? 'SUCCESS',
            failureReason: input.failureReason?.slice(0, 500) ?? null,
        });
        entry.beforeSummary = sanitizeSummary(input.beforeSummary);
        entry.afterSummary = sanitizeSummary(input.afterSummary);
        await this.connection.getRepository(ctx, AdministratorPermissionAudit).save(entry);
    }

    async findVisible(ctx: RequestContext, channelId?: ID): Promise<AdministratorPermissionAudit[]> {
        if (!ctx.activeUserId) return [];
        const isPlatform = ctx.channel.code === DEFAULT_CHANNEL_CODE;
        if (!isPlatform && channelId != null && !idsAreEqual(channelId, ctx.channelId)) {
            throw new ForbiddenError();
        }
        const profile = await this.connection
            .getRepository(ctx, AdministratorAccessProfile)
            .findOne({ where: { userId: ctx.activeUserId } });
        if (!profile || profile.status === 'SUSPENDED') return [];
        if (isPlatform && (profile.scope !== 'PLATFORM' || !['OWNER', 'ADMIN'].includes(profile.authority))) {
            return [];
        }
        if (!isPlatform && profile.scope === 'STORE' && !idsAreEqual(profile.channelId, ctx.channelId)) {
            throw new ForbiddenError();
        }
        const permissions = isPlatform
            ? [Permission.SuperAdmin, 'ManagePlatformTeam' as Permission]
            : [Permission.SuperAdmin, 'ManageStoreTeam' as Permission, 'ManagePlatformTeam' as Permission];
        if (!permissions.some(permission => ctx.userHasPermissions([permission]))) {
            return [];
        }
        return this.connection.getRepository(ctx, AdministratorPermissionAudit).find({
            where: isPlatform
                ? channelId == null
                    ? undefined
                    : { channelId }
                : { channelId: ctx.channelId },
            order: { createdAt: 'DESC' },
            take: 200,
        });
    }
}

function sanitizeSummary(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    if (!value) return null;
    const secretPattern = /password|secret|token|key|credential|cookie|address|account/i;
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, secretPattern.test(key) ? '[REDACTED]' : item]),
    );
}
