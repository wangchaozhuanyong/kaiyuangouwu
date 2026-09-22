import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { AdministratorService, RequestContext, TransactionalConnection } from '@vendure/core';

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

    async findVisible(ctx: RequestContext): Promise<AdministratorPermissionAudit[]> {
        if (!ctx.activeUserId) return [];
        const profile = await this.connection
            .getRepository(ctx, AdministratorAccessProfile)
            .findOne({ where: { userId: ctx.activeUserId } });
        if (!profile || profile.scope !== 'PLATFORM' || !['OWNER', 'ADMIN'].includes(profile.authority)) {
            return [];
        }
        return this.connection.getRepository(ctx, AdministratorPermissionAudit).find({
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
