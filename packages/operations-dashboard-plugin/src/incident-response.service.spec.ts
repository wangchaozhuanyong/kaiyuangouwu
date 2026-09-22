import 'reflect-metadata';

import { CreateDateColumn, DataSource, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AdminIncidentAction } from './entities/admin-incident-action.entity';
import { AdminIncidentEvidence } from './entities/admin-incident-evidence.entity';
import { AdminNotificationDelivery } from './entities/admin-notification-delivery.entity';
import { IncidentResponseService } from './incident-response.service';
import { sanitizeIncidentEvidence } from './notification-payload';

for (const entity of [AdminNotificationDelivery, AdminIncidentEvidence, AdminIncidentAction]) {
    PrimaryGeneratedColumn()(entity.prototype, 'id');
    CreateDateColumn()(entity.prototype, 'createdAt');
    UpdateDateColumn()(entity.prototype, 'updatedAt');
}

describe('IncidentResponseService', () => {
    let database: DataSource;
    let service: IncidentResponseService;
    const worker = { dispatch: vi.fn().mockResolvedValue(true) };

    beforeAll(async () => {
        database = await new DataSource({
            type: 'sqljs',
            entities: [AdminNotificationDelivery, AdminIncidentEvidence, AdminIncidentAction],
            synchronize: true,
        }).initialize();
        const connection = {
            rawConnection: database,
            getRepository: (_ctx: unknown, entity: typeof AdminNotificationDelivery) =>
                database.getRepository(entity),
            withTransaction: (ctx: unknown, callback: (transactionContext: unknown) => unknown) =>
                Promise.resolve(callback(ctx)),
        };
        const config = {
            get: vi.fn().mockResolvedValue({ enabled: false }),
            shouldDeliver: vi.fn().mockReturnValue(false),
        };
        service = new IncidentResponseService(connection as never, config as never, worker as never);
    });

    afterAll(async () => {
        if (database?.isInitialized) await database.destroy();
    });

    it('records the full P0 lifecycle and only closes after all corrective actions finish', async () => {
        const incident = await createIncident(database, 'P0');
        const ctx = { activeUserId: 'admin-1' } as never;
        await service.appendSystemEvidence(
            null,
            incident,
            'CREATED',
            '事故记录已创建',
            { error: 'database unavailable', password: 'never-store' },
            incident.firstOccurredAt,
        );

        const acknowledged = await service.acknowledgeIncident(
            ctx,
            incident.id,
            '已进入数据库故障排查与切换流程',
        );
        expect(acknowledged.incidentStatus).toBe('ACKNOWLEDGED');
        await expect(
            service.acknowledgeIncident(ctx, incident.id, '重复提交的负责人确认说明'),
        ).rejects.toThrow('事故已经由负责人确认');

        const repository = database.getRepository(AdminNotificationDelivery);
        const recovered = await repository.findOneByOrFail({ id: incident.id });
        recovered.incidentStatus = 'RECOVERY_PENDING';
        recovered.eventState = 'RESOLVED';
        recovered.recoveryObservedAt = new Date();
        recovered.recoveryValidationDueAt = new Date(Date.now() + 60 * 60_000);
        await repository.save(recovered);

        const validated = await service.validateRecovery(
            ctx,
            incident.id,
            '连续检查核心下单与查询链路均已恢复',
        );
        expect(validated.incidentStatus).toBe('REVIEW_PENDING');
        expect(validated.reviewDueAt).toBeInstanceOf(Date);

        const reviewed = await service.submitReview(ctx, incident.id, {
            rootCause: '数据库连接池在异常峰值时未按预期释放连接，导致连接耗尽。',
            impactSummary: '后台与客户端的下单查询链路短时不可用，未发现数据丢失。',
            correctiveActions: [
                {
                    title: '增加连接池耗尽预警与自动降载策略',
                    ownerDepartmentCode: 'TECH',
                    dueAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
                },
            ],
        });
        expect(reviewed.incidentStatus).toBe('ACTION_PENDING');
        expect(reviewed.actions).toHaveLength(1);

        const closed = await service.completeAction(
            ctx,
            reviewed.actions[0].id,
            '预警和降载策略已上线至测试环境并通过压力验证',
        );
        expect(closed.incidentStatus).toBe('CLOSED');
        expect(closed.closedAt).toBeInstanceOf(Date);
        expect(closed.evidence.every(item => item.integrityValid)).toBe(true);
        expect(closed.evidence.map(item => item.eventType)).toEqual([
            'CREATED',
            'ACKNOWLEDGED',
            'RECOVERY_VALIDATED',
            'REVIEW_SUBMITTED',
            'ACTION_COMPLETED',
            'CLOSED',
        ]);
        const reviewEvidence = closed.evidence.find(item => item.eventType === 'REVIEW_SUBMITTED');
        expect(reviewEvidence?.evidence).toMatchObject({
            actions: [expect.objectContaining({ ownerDepartmentCode: 'TECH' })],
        });
    });

    it('detects evidence tampering and strips nested secrets', async () => {
        const incident = await createIncident(database, 'P1');
        const evidence = await service.appendSystemEvidence(null, incident, 'CREATED', '事故记录已创建', {
            nested: { apiKey: 'secret', email: 'owner@example.com', result: 'failed' },
            summary: 'owner@example.com observed 10.0.1.25',
        });
        expect(evidence?.evidence).toEqual({
            nested: { email: 'ow***@example.com', result: 'failed' },
            summary: 'ow***@example.com observed 10.0.x.x',
        });
        if (!evidence) throw new Error('evidence was not created');
        evidence.evidenceHash = '0'.repeat(64);
        await database.getRepository(AdminIncidentEvidence).save(evidence);

        const detail = await service.incidentDetail(incident.id);
        expect(detail.evidence[0].integrityValid).toBe(false);
        const active = await service.listIncidents({ status: 'ACTIVE' });
        expect(active.items.map(item => item.id)).toContain(incident.id);
        expect(active.items.every(item => item.incidentStatus !== 'CLOSED')).toBe(true);
    });

    it('rejects lifecycle mutations without an authenticated administrator', async () => {
        await expect(
            service.acknowledgeIncident({ activeUserId: null } as never, '999', '未认证的管理员不能确认事故'),
        ).rejects.toThrow('需要已认证管理员');
    });
});

describe('sanitizeIncidentEvidence', () => {
    it('keeps bounded nested operational evidence without retaining credentials', () => {
        expect(
            sanitizeIncidentEvidence({
                actions: [{ title: '修复连接池', token: 'never-store', sourceIp: '10.0.1.25' }],
            }),
        ).toEqual({ actions: [{ title: '修复连接池', sourceIp: '10.0.x.x' }] });
    });
});

async function createIncident(database: DataSource, severity: 'P0' | 'P1') {
    const now = new Date();
    const incident = new AdminNotificationDelivery({
        eventType: 'system.database.down',
        category: 'SYSTEM',
        ownerDepartmentCode: 'TECH',
        collaboratorDepartmentCodes: ['DATA_FINANCE', 'GOVERNANCE'],
        escalationDepartmentCode: 'EXEC',
        actionRequired: true,
        slaDueAt: new Date(now.getTime() + 60 * 60_000),
        actionHint: '检查数据库与业务链路',
        severity,
        mode: 'INCIDENT',
        eventState: 'FIRING',
        sourceType: 'watchdog',
        sourceId: 'database',
        dedupKey: null,
        fingerprint: `database:${severity}:${now.getTime()}`,
        activeFingerprint: `database:${severity}:${now.getTime()}`,
        title: '数据库连接中断',
        occurrenceCount: 1,
        firstOccurredAt: now,
        lastOccurredAt: now,
        resolvedAt: null,
        escalatedAt: severity === 'P0' ? now : null,
        incidentStatus: 'OPEN',
        acknowledgedAt: null,
        acknowledgedByUserId: null,
        acknowledgementNote: null,
        recoveryObservedAt: null,
        recoveryValidationDueAt: null,
        recoveryValidatedAt: null,
        recoveryValidatedByUserId: null,
        recoveryValidationNote: null,
        recoveryEscalatedAt: null,
        reviewDueAt: null,
        reviewSubmittedAt: null,
        reviewSubmittedByUserId: null,
        rootCause: null,
        impactSummary: null,
        reviewEscalatedAt: null,
        closedAt: null,
        priority: 100,
        silent: false,
        deliveryAction: 'SEND',
        deliveryStatus: 'SKIPPED',
        availableAt: now,
        attempts: 0,
        maxAttempts: 6,
        claimedAt: null,
        claimedBy: null,
        telegramMessageId: null,
        queueJobId: null,
        lastErrorCode: null,
        lastError: null,
        sentAt: null,
    });
    incident.payload = { error: 'database unavailable' };
    return database.getRepository(AdminNotificationDelivery).save(incident);
}
