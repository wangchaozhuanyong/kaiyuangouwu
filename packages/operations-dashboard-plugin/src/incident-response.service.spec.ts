import 'reflect-metadata';

import { Order, Payment, RequestContext } from '@vendure/core';
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
            withTransaction: (ctxOrWork: unknown, callback?: (transactionContext: unknown) => unknown) =>
                Promise.resolve(
                    callback ? callback(ctxOrWork) : (ctxOrWork as (ctx: unknown) => unknown)(null),
                ),
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

    let historicalTaskSequence = 100;
    async function historicalClosureHarness() {
        const deliveryId = String(++historicalTaskSequence);
        const input = { orderId: '37', deliveryId, receiptId: 'digital-test-closure:37' };
        const ctx = {
            apiType: 'admin',
            activeUserId: 'admin-1',
            channelId: '5',
            userHasPermissions: () => true,
        } as unknown as RequestContext;
        const order = { id: '37', salesChannelId: '5' };
        const payment = {
            state: 'Settled',
            method: 'controlled-test-payment-5',
            metadata: { public: { testPayment: true }, manualReview: { required: false } },
            refunds: [] as object[],
        };
        const task = { id: deliveryId, state: 'CANCELLED', orderId: '37', channelId: '5' };
        const closingEvent = {
            type: 'CANCELLED',
            actorType: 'ADMIN',
            note: `历史测试任务终止；收据 ${input.receiptId}`,
        };
        const manager = { queryRunner: { isTransactionActive: true } };
        const connection = {
            rawConnection: { options: { type: 'sqljs' }, getMetadata: (name: string) => ({ target: name }) },
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === Order) return { manager, findOne: () => Promise.resolve(order) };
                if (entity === Payment) return { find: () => Promise.resolve([payment]) };
                if (entity === 'manual_digital_delivery') return { findOne: () => Promise.resolve(task) };
                if (entity === 'manual_digital_delivery_event')
                    return {
                        findOne: ({ where }: { where: { note: string; actorType: string } }) =>
                            Promise.resolve(
                                where.note === closingEvent.note && where.actorType === closingEvent.actorType
                                    ? closingEvent
                                    : null,
                            ),
                    };
                return database.getRepository(entity as typeof AdminNotificationDelivery);
            },
            withTransaction: (work: (ctx: RequestContext) => unknown) => Promise.resolve(work(ctx)),
        };
        const closure = new IncidentResponseService(connection as never, {} as never, worker as never);
        const incident = await createIncident(database, 'P1');
        incident.sourceType = 'ManualDigitalDelivery';
        incident.sourceId = deliveryId;
        incident.eventType = 'commerce.fulfillment.manual_delivery_failed';
        incident.fingerprint = `${incident.eventType}:${deliveryId}`;
        incident.activeFingerprint = incident.fingerprint;
        incident.title = '人工交付发送失败';
        incident.payload = { channelId: '5', orderId: '37', deliveryId };
        incident.attempts = 7;
        incident.lastError = 'historical send failure';
        incident.deliveryStatus = 'RETRY';
        await database.getRepository(AdminNotificationDelivery).save(incident);
        return { closure, input, ctx, order, payment, task, closingEvent, manager, incident };
    }

    it('terminates a historical test incident truthfully with preserved failure evidence and no notification', async () => {
        const h = await historicalClosureHarness();
        const beforeDispatch = worker.dispatch.mock.calls.length;
        const closed = await h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input);
        expect(closed).toEqual([h.incident.id]);
        const result = await service.incidentDetail(h.incident.id);
        expect(result).toMatchObject({
            incidentStatus: 'CLOSED',
            eventState: 'RESOLVED',
            activeFingerprint: null,
            deliveryStatus: 'SKIPPED',
            attempts: 7,
            lastError: 'historical send failure',
            recoveryObservedAt: null,
            recoveryValidatedAt: null,
        });
        expect(result.title).toBe('人工交付发送失败');
        expect(result.evidence).toHaveLength(1);
        expect(result.evidence[0]).toMatchObject({
            eventType: 'CLOSED',
            integrityValid: true,
            summary: '历史测试任务终止，事故结束；未声明发送成功',
            evidence: { closureKey: h.input.receiptId, outcome: 'TASK_TERMINATED' },
        });
        expect(worker.dispatch.mock.calls.length).toBe(beforeDispatch);
        await expect(h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input)).resolves.toEqual([]);
        expect((await service.incidentDetail(h.incident.id)).evidence).toHaveLength(1);
    });

    it.each(['real', 'unmarked', 'unknown', 'refund'] as const)(
        'protects incidents for %s funding',
        async funding => {
            const h = await historicalClosureHarness();
            if (funding === 'real') h.payment.method = 'real-payment';
            if (funding === 'unmarked') h.payment.metadata.public.testPayment = false;
            if (funding === 'unknown') h.payment.state = 'Pending';
            if (funding === 'refund') h.payment.refunds.push({ state: 'Pending' });
            await expect(h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input)).rejects.toThrow(
                '真实或未知付款',
            );
            expect((await service.incidentDetail(h.incident.id)).incidentStatus).toBe('OPEN');
        },
    );

    it('requires the same closure receipt, immutable store owner and active native transaction', async () => {
        const h = await historicalClosureHarness();
        h.closingEvent.note = '订单取消';
        await expect(h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input)).rejects.toThrow(
            '同一历史测试收据',
        );
        h.closingEvent.note = `历史测试任务终止；收据 ${h.input.receiptId}`;
        h.closingEvent.actorType = 'SYSTEM';
        await expect(h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input)).rejects.toThrow(
            '同一历史测试收据',
        );
        h.closingEvent.actorType = 'ADMIN';
        h.order.salesChannelId = '2';
        await expect(h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input)).rejects.toThrow();
        h.order.salesChannelId = '5';
        h.manager.queryRunner.isTransactionActive = false;
        await expect(h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input)).rejects.toThrow(
            '原订单收尾事务',
        );
        expect((await service.incidentDetail(h.incident.id)).evidence).toHaveLength(0);
    });

    it('rejects mismatched incident ownership and an in-flight claimed notification', async () => {
        const h = await historicalClosureHarness();
        h.incident.payload.channelId = '2';
        await database.getRepository(AdminNotificationDelivery).save(h.incident);
        await expect(h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input)).rejects.toThrow(
            '归属不一致',
        );
        h.incident.payload.channelId = '5';
        h.incident.deliveryStatus = 'CLAIMED';
        await database.getRepository(AdminNotificationDelivery).save(h.incident);
        await expect(h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input)).rejects.toThrow(
            '发送结果未知',
        );
        h.incident.deliveryStatus = 'SENT';
        h.incident.claimedAt = new Date();
        await database.getRepository(AdminNotificationDelivery).save(h.incident);
        await expect(h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input)).rejects.toThrow(
            '发送结果未知',
        );
        expect((await service.incidentDetail(h.incident.id)).incidentStatus).toBe('OPEN');
    });

    it('keeps unfinished corrective actions protected', async () => {
        const h = await historicalClosureHarness();
        await database.getRepository(AdminIncidentAction).save(
            new AdminIncidentAction({
                incidentId: Number(h.incident.id),
                title: '仍需人工核验的历史处理',
                ownerDepartmentCode: 'TECH',
                status: 'OPEN',
                dueAt: new Date(),
                completedAt: null,
                completedByUserId: null,
                completionNote: null,
                escalatedAt: null,
            }),
        );
        await expect(h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input)).rejects.toThrow('整改流程');
        expect((await service.incidentDetail(h.incident.id)).evidence).toHaveLength(0);
    });

    it('requires managed SuperAdmin and a valid nonsecret receipt before accessing history', async () => {
        const h = await historicalClosureHarness();
        await expect(
            h.closure.closeHistoricalTestTaskIncidents(
                { ...h.ctx, userHasPermissions: () => false } as never,
                h.input,
            ),
        ).rejects.toThrow('平台管理员');
        await expect(
            h.closure.closeHistoricalTestTaskIncidents(h.ctx, {
                ...h.input,
                receiptId: 'invalid with spaces',
            }),
        ).rejects.toThrow('收据标识无效');
        expect((await service.incidentDetail(h.incident.id)).incidentStatus).toBe('OPEN');
    });

    it('does not reopen or notify a terminated incident from an earlier scheduler snapshot', async () => {
        const h = await historicalClosureHarness();
        await h.closure.closeHistoricalTestTaskIncidents(h.ctx, h.input);
        const stale = { ...h.incident, incidentStatus: 'RECOVERY_PENDING' } as AdminNotificationDelivery;
        const background = h.closure as unknown as {
            escalateStage(
                incident: AdminNotificationDelivery,
                summary: string,
                evidence: Record<string, unknown>,
                now: Date,
            ): Promise<boolean>;
        };
        await expect(
            background.escalateStage(stale, '恢复验证逾期', { stage: 'RECOVERY_VALIDATION' }, new Date()),
        ).resolves.toBe(false);
        const result = await service.incidentDetail(h.incident.id);
        expect(result.incidentStatus).toBe('CLOSED');
        expect(result.deliveryStatus).toBe('SKIPPED');
        expect(result.evidence).toHaveLength(1);
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
