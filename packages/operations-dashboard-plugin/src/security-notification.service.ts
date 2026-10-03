import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import {
    AdministratorEvent,
    ApiKeyEvent,
    EventBus,
    ID,
    Permission,
    RequestContext,
    Role,
    RoleChangeEvent,
    RoleEvent,
    TransactionalConnection,
} from '@vendure/core';
import { createHash } from 'node:crypto';
import { IsNull, Not } from 'typeorm';

import { AdminNotificationService } from './admin-notification.service';
import { AdminNotificationDelivery } from './entities/admin-notification-delivery.entity';
import { NotificationSignalService } from './notification-signal.service';

@Injectable()
export class SecurityNotificationService implements OnApplicationBootstrap, OnApplicationShutdown {
    private subscriptions: Array<{ unsubscribe(): void }> = [];
    constructor(
        private readonly events: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly signals: NotificationSignalService,
        private readonly notifications: AdminNotificationService,
    ) {}
    onApplicationBootstrap() {
        this.subscriptions.push(
            this.events.ofType(AdministratorEvent).subscribe(event => {
                if (event.type !== 'created' && event.type !== 'deleted') return;
                void this.change(
                    event.ctx,
                    'security.admin.changed',
                    String(event.entity.id),
                    event.type === 'created' ? '新增管理员' : '删除管理员',
                    `管理员编号 ${event.entity.id}`,
                    event.entity.updatedAt,
                ).catch(() => undefined);
            }),
            this.events.ofType(RoleEvent).subscribe(event => {
                const input = event.input && typeof event.input === 'object' ? event.input : null;
                if (event.type === 'updated' && !(input && ('permissions' in input || 'channelIds' in input)))
                    return;
                void this.change(
                    event.ctx,
                    'security.admin.changed',
                    `role:${event.entity.id}`,
                    '管理权限或店铺授权变更',
                    `角色编号 ${event.entity.id}；权限数量 ${event.entity.permissions?.length ?? 0}；店铺数量 ${event.entity.channels?.length ?? 0}`,
                    event.entity.updatedAt,
                ).catch(() => undefined);
            }),
            this.events.ofType(RoleChangeEvent).subscribe(event => {
                void this.roleChange(event).catch(() => undefined);
            }),
            this.events.ofType(ApiKeyEvent).subscribe(event => {
                const action = {
                    created: '新增后台接口密钥',
                    updated: '修改后台接口密钥',
                    deleted: '删除后台接口密钥',
                }[event.type];
                void this.change(
                    event.ctx,
                    'security.api_key.changed',
                    String(event.entity.id),
                    action,
                    `接口凭证管理编号 ${event.entity.id}`,
                    event.entity.updatedAt,
                ).catch(() => undefined);
            }),
        );
    }
    onApplicationShutdown() {
        this.subscriptions.forEach(subscription => subscription.unsubscribe());
    }
    private async roleChange(event: RoleChangeEvent) {
        const roles = await this.connection.getRepository(event.ctx, Role).findByIds(event.roleIds);
        const superAdmin = roles.some(role => role.permissions.includes(Permission.SuperAdmin));
        const action =
            event.type === 'assigned'
                ? superAdmin
                    ? '授予超级管理员权限'
                    : '授予管理员角色'
                : '移除管理员角色';
        await this.change(
            event.ctx,
            'security.admin.changed',
            String(event.admin.id),
            action,
            `角色编号 ${event.roleIds.join('、')}`,
            event.admin.updatedAt,
        );
    }
    async change(
        ctx: RequestContext | null,
        eventType: string,
        targetId: string,
        action: string,
        summary: string,
        at = new Date(),
    ) {
        const dedup = createHash('sha256')
            .update(JSON.stringify([eventType, targetId, action, summary, at.toISOString()]))
            .digest('hex');
        return this.notifications.enqueueOneOff(ctx, {
            eventType,
            category: 'SECURITY',
            severity: eventType === 'security.factor.changed' ? 'P1' : 'P2',
            sourceType: 'SecurityAudit',
            sourceId: targetId,
            dedupKey: `security.audit:${dedup}`,
            title: action,
            payload: {
                actorId: ctx?.activeUserId ? String(ctx.activeUserId) : '经验证的账号本人',
                targetId,
                action: summary,
                adminPath: '/settings/administrators',
            },
        });
    }
    /** Identity is a keyed digest from the auth boundary. Never accept passwords, usernames or source IPs here. */
    async failure(
        identityHash: string,
        kind: 'PASSWORD_ACCOUNT' | 'PASSWORD_SOURCE' | 'FACTOR_ACCOUNT',
        targetId?: ID,
    ) {
        const result = await this.signals.count(identityHash);
        const threshold = kind === 'PASSWORD_SOURCE' ? 20 : 5;
        if (result.count < threshold) return;
        const action =
            kind === 'FACTOR_ACCOUNT'
                ? '后台二次验证异常尝试'
                : kind === 'PASSWORD_SOURCE'
                  ? '同来源后台密码异常尝试'
                  : '同账号后台密码异常尝试';
        await this.notifications.upsertIncident(null, {
            eventType: 'security.login.failures',
            category: 'SECURITY',
            severity: 'P1',
            sourceType: 'SecurityWindow',
            sourceId: identityHash,
            fingerprint: `security.window:${identityHash}`,
            title: action,
            payload: {
                targetId: targetId ? `账号编号 ${targetId}` : '受保护的匿名账号或来源',
                failureCount: result.count,
                action: `最近五分钟失败达到 ${threshold} 次，请核对登录记录`,
                adminPath: '/settings/administrators',
            },
        });
    }
    async reconcile() {
        const incidents = await this.connection.rawConnection
            .getRepository(AdminNotificationDelivery)
            .find({ where: { sourceType: 'SecurityWindow', activeFingerprint: Not(IsNull()) } });
        for (const incident of incidents) {
            if (
                incident.sourceId &&
                incident.activeFingerprint &&
                (await this.signals.current(incident.sourceId)) === 0
            ) {
                await this.notifications.resolveIncident(null, incident.activeFingerprint, {
                    action: '最近五分钟未再出现失败尝试，异常窗口已结束；不代表已确认攻击者消失',
                });
            }
        }
        await this.signals.purge();
    }
}
