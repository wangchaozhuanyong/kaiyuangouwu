import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ID } from '@vendure/common/lib/shared-types';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import {
    AdminNotificationConfigService,
    UpdateAdminNotificationConfigInput,
} from './admin-notification-config.service';
import { AdminNotificationService } from './admin-notification.service';
import {
    departmentCodes,
    DepartmentNotificationRouter,
    NotificationSeverity,
} from './department-notification-router';
import { type NotificationDeliveryStatus } from './entities/admin-notification-delivery.entity';
import { departmentName } from './telegram-notification-formatter';

@Resolver()
export class AdminNotificationResolver {
    constructor(
        private readonly configService: AdminNotificationConfigService,
        private readonly notifications: AdminNotificationService,
    ) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    telegramNotificationConfig() {
        return this.configService.get();
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    telegramNotificationStatus() {
        return this.notifications.status();
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    telegramNotificationConfigAudits(@Args('take') take?: number) {
        return this.configService.listAudits(take);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    telegramNotificationDeliveries(
        @Args('skip') skip?: number,
        @Args('take') take?: number,
        @Args('status') status?: string,
    ) {
        return this.notifications.listDeliveries({
            skip,
            take,
            status: deliveryStatus(status),
        });
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async telegramDepartmentRouting() {
        const config = await this.configService.get();
        const defaults = this.notifications.definitions();
        const router = new DepartmentNotificationRouter();
        return {
            departments: departmentCodes.map(code => ({
                code,
                nameZh: departmentName(code, 'zh'),
                nameEn: departmentName(code, 'en'),
            })),
            routes: defaults.map(definition => {
                const override = config.routeOverrides.find(item => item.eventType === definition.eventType);
                const route = router.route(definition.eventType, definition.severity, config.routeOverrides);
                return {
                    eventType: definition.eventType,
                    severity: definition.severity,
                    owner: route.owner,
                    collaborators: route.collaborators,
                    escalation: route.escalation,
                    actionRequired: route.actionRequired,
                    slaMinutes:
                        definition.severity === 'P1' && override?.slaMinutes === undefined
                            ? config.p1EscalationMinutes
                            : route.slaMinutes,
                    actionHint: route.actionHint,
                    overridden: Boolean(override),
                    defaultOwner: definition.owner,
                    defaultCollaborators: definition.collaborators,
                    defaultEscalation: definition.escalation,
                    defaultActionRequired: definition.actionRequired,
                    defaultSlaMinutes:
                        definition.severity === 'P1' ? config.p1EscalationMinutes : definition.slaMinutes,
                };
            }),
        };
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    updateTelegramNotificationConfig(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateAdminNotificationConfigInput,
    ) {
        return this.configService.update(input, ctx.activeUserId);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    testTelegramConnection() {
        return this.configService.testConnection();
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    sendTelegramNotificationTest(@Args('kind') kind: string) {
        return this.notifications.sendTest(kind);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    retryTelegramNotificationDelivery(@Args('id') id: ID) {
        return this.notifications.retryDelivery(id);
    }
}

function deliveryStatus(value: string | undefined): NotificationDeliveryStatus | null {
    const statuses: NotificationDeliveryStatus[] = ['PENDING', 'CLAIMED', 'RETRY', 'SENT', 'DEAD', 'SKIPPED'];
    return statuses.includes(value as NotificationDeliveryStatus)
        ? (value as NotificationDeliveryStatus)
        : null;
}

export function notificationSeverity(value: string): NotificationSeverity {
    if (!['P0', 'P1', 'P2', 'P3'].includes(value)) throw new Error('通知等级无效');
    return value as NotificationSeverity;
}
