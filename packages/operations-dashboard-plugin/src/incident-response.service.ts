import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    assertOrderSalesChannel,
    Order,
    Payment,
    Permission,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { createHash, randomUUID } from 'node:crypto';
import { FindOptionsWhere, In, IsNull, LessThanOrEqual, Not } from 'typeorm';

import { AdminNotificationConfigService } from './admin-notification-config.service';
import { DepartmentCode, isDepartmentCode, NotificationSeverity } from './department-notification-router';
import { AdminIncidentAction } from './entities/admin-incident-action.entity';
import { AdminIncidentEvidence, IncidentEvidenceEventType } from './entities/admin-incident-evidence.entity';
import { AdminNotificationDelivery, IncidentStatus } from './entities/admin-notification-delivery.entity';
import { sanitizeIncidentEvidence, sanitizePayload } from './notification-payload';
import { TelegramNotificationWorkerService } from './telegram-notification-worker.service';

const RECOVERY_VALIDATION_MINUTES: Record<'P0' | 'P1', number> = { P0: 60, P1: 240 };
const REVIEW_MINUTES: Record<'P0' | 'P1', number> = { P0: 72 * 60, P1: 7 * 24 * 60 };
const INCIDENT_STATUSES: IncidentStatus[] = [
    'OPEN',
    'ACKNOWLEDGED',
    'RECOVERY_PENDING',
    'REVIEW_PENDING',
    'ACTION_PENDING',
    'CLOSED',
];

export interface IncidentListOptions {
    skip?: number | null;
    take?: number | null;
    status?: string | null;
    severity?: string | null;
}

export interface IncidentCorrectiveActionInput {
    title: string;
    ownerDepartmentCode: string;
    dueAt: string | Date;
}

interface IncidentMutationResult {
    incident: AdminNotificationDelivery;
    dispatch: boolean;
}

@Injectable()
export class IncidentResponseService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly configService: AdminNotificationConfigService,
        private readonly worker: TelegramNotificationWorkerService,
    ) {}

    async listIncidents(options: IncidentListOptions = {}) {
        const take = Math.min(100, Math.max(1, Math.trunc(options.take ?? 25)));
        const skip = Math.max(0, Math.trunc(options.skip ?? 0));
        const where: FindOptionsWhere<AdminNotificationDelivery> = { mode: 'INCIDENT' };
        if (options.status === 'ACTIVE') {
            where.incidentStatus = Not('CLOSED');
        } else if (INCIDENT_STATUSES.includes(options.status as IncidentStatus)) {
            where.incidentStatus = options.status as IncidentStatus;
        }
        if (['P0', 'P1', 'P2', 'P3'].includes(options.severity ?? '')) {
            where.severity = options.severity as NotificationSeverity;
        }
        const [items, totalItems] = await this.incidentRepository(null).findAndCount({
            where,
            order: { createdAt: 'DESC', id: 'DESC' },
            skip,
            take,
        });
        const incidentIds = items.map(item => Number(item.id));
        const actions = incidentIds.length
            ? await this.actionRepository(null).find({
                  where: { incidentId: In(incidentIds) },
                  order: { dueAt: 'ASC', id: 'ASC' },
              })
            : [];
        return {
            items: items.map(item => ({
                ...item,
                actions: actions.filter(action => action.incidentId === Number(item.id)),
            })),
            totalItems,
        };
    }

    async incidentDetail(id: ID) {
        const incident = await this.incidentRepository(null).findOne({ where: { id, mode: 'INCIDENT' } });
        if (!incident) throw new Error('事故记录不存在');
        const [evidence, actions] = await Promise.all([
            this.evidenceRepository(null).find({
                where: { incidentId: Number(incident.id) },
                order: { occurredAt: 'ASC', id: 'ASC' },
            }),
            this.actionRepository(null).find({
                where: { incidentId: Number(incident.id) },
                order: { dueAt: 'ASC', id: 'ASC' },
            }),
        ]);
        return {
            ...incident,
            evidence: evidence.map(item => ({ ...item, integrityValid: verifyEvidenceHash(item) })),
            actions,
        };
    }

    async appendSystemEvidence(
        ctx: RequestContext | null,
        incident: AdminNotificationDelivery,
        eventType: IncidentEvidenceEventType,
        summary: string,
        evidence: Record<string, unknown>,
        occurredAt = new Date(),
    ) {
        return this.appendEvidence(ctx, incident, eventType, null, summary, evidence, occurredAt);
    }

    /** Internal historical repair only. No recovery claim, notification dispatch, or public mutation. */
    async closeHistoricalTestTaskIncidents(
        ctx: RequestContext,
        input: { orderId: ID; deliveryId: ID; receiptId: string },
    ): Promise<ID[]> {
        const actor = requiredActor(ctx);
        if (ctx.apiType !== 'admin' || !ctx.userHasPermissions([Permission.SuperAdmin])) {
            throw new Error('历史测试事故终止需要已认证平台管理员');
        }
        if (!/^[a-zA-Z0-9:_-]{8,180}$/.test(input.receiptId)) {
            throw new Error('历史测试收据标识无效');
        }
        const orderRepository = this.connection.getRepository(ctx, Order);
        if (!orderRepository.manager.queryRunner?.isTransactionActive) {
            throw new Error('历史测试事故终止必须位于原订单收尾事务内');
        }
        const order = await orderRepository.findOne({ where: { id: input.orderId } });
        if (!order) throw new Error('历史测试订单不存在');
        assertOrderSalesChannel(ctx, order);
        const payments = await this.connection.getRepository(ctx, Payment).find({
            where: { order: { id: input.orderId } },
            relations: { refunds: true },
        });
        if (
            !payments.some(payment => payment.state === 'Settled') ||
            payments.some(
                payment =>
                    !['Settled', 'Authorized'].includes(payment.state) ||
                    payment.method !== `controlled-test-payment-${ctx.channelId}` ||
                    payment.metadata?.public?.testPayment !== true ||
                    payment.metadata?.manualReview?.required ||
                    payment.refunds.length !== 0,
            )
        )
            throw new Error('真实或未知付款不能按历史测试事故终止');
        const deliveryTarget = this.connection.rawConnection.getMetadata('manual_digital_delivery').target;
        const eventTarget = this.connection.rawConnection.getMetadata('manual_digital_delivery_event').target;
        const delivery = await this.connection.getRepository(ctx, deliveryTarget).findOne({
            where: { id: input.deliveryId, orderId: input.orderId, channelId: ctx.channelId },
        });
        const closingEvent = await this.connection.getRepository(ctx, eventTarget).findOne({
            where: {
                deliveryId: input.deliveryId,
                type: 'CANCELLED',
                actorType: 'ADMIN',
                note: `历史测试任务终止；收据 ${input.receiptId}`,
            },
        });
        if (delivery?.state !== 'CANCELLED' || !closingEvent) {
            throw new Error('人工任务尚未按同一历史测试收据终止');
        }
        const fingerprints = [
            `commerce.fulfillment.manual_delivery_failed:${input.deliveryId}`,
            `commerce.fulfillment.manual_delivery_overdue:${input.deliveryId}`,
        ];
        const candidates = await this.incidentRepository(ctx).find({
            where: { mode: 'INCIDENT', fingerprint: In(fingerprints) },
            order: { id: 'ASC' },
        });
        const closed: ID[] = [];
        for (const candidate of candidates) {
            const incident = await this.lockIncident(ctx, candidate.id);
            if (
                incident.sourceType !== 'ManualDigitalDelivery' ||
                String(incident.sourceId) !== String(input.deliveryId) ||
                String(incident.payload?.channelId) !== String(ctx.channelId) ||
                String(incident.payload?.orderId) !== String(input.orderId) ||
                String(incident.payload?.deliveryId) !== String(input.deliveryId) ||
                !fingerprints.includes(incident.fingerprint ?? '')
            )
                throw new Error('历史交付事故归属不一致');
            if (incident.deliveryStatus === 'CLAIMED' || incident.claimedAt || incident.claimedBy) {
                throw new Error('历史事故通知发送结果未知，需要先核对');
            }
            if (incident.incidentStatus === 'CLOSED') continue;
            const actions = await this.actionRepository(ctx).find({
                where: { incidentId: Number(incident.id) },
            });
            if (
                actions.some(action => action.status === 'OPEN') ||
                incident.incidentStatus === 'ACTION_PENDING'
            ) {
                throw new Error('历史事故仍有整改流程，不能自动终结');
            }
            const now = new Date();
            incident.activeFingerprint = null;
            incident.eventState = 'RESOLVED';
            incident.incidentStatus = 'CLOSED';
            incident.resolvedAt = now;
            incident.closedAt = now;
            incident.actionRequired = false;
            incident.slaDueAt = null;
            incident.recoveryValidationDueAt = null;
            incident.reviewDueAt = null;
            // No queued notification should describe termination as successful delivery.
            if (['PENDING', 'RETRY'].includes(incident.deliveryStatus)) incident.deliveryStatus = 'SKIPPED';
            incident.payload = sanitizePayload({
                ...incident.payload,
                historicalTestClosureKey: input.receiptId,
                historicalTestOutcome: 'TASK_TERMINATED',
            });
            await this.incidentRepository(ctx).save(incident);
            await this.appendEvidence(
                ctx,
                incident,
                'CLOSED',
                actor,
                '历史测试任务终止，事故结束；未声明发送成功',
                {
                    orderId: String(input.orderId),
                    deliveryId: String(input.deliveryId),
                    closureKey: input.receiptId,
                    outcome: 'TASK_TERMINATED',
                },
                now,
            );
            closed.push(incident.id);
        }
        return closed;
    }

    async acknowledgeIncident(
        ctx: RequestContext,
        id: ID,
        note: string,
        evidence: Record<string, unknown> = {},
    ) {
        const actorUserId = requiredActor(ctx);
        const acknowledgementNote = requiredText(note, 10, 1000, '确认说明');
        const result = await this.connection.withTransaction(ctx, async txCtx => {
            const incident = await this.lockIncident(txCtx, id);
            if (incident.incidentStatus === 'CLOSED') throw new Error('已关闭事故不能再次确认');
            if (incident.acknowledgedAt) throw new Error('事故已经由负责人确认');
            const now = new Date();
            incident.acknowledgedAt = now;
            incident.acknowledgedByUserId = actorUserId;
            incident.acknowledgementNote = acknowledgementNote;
            if (incident.incidentStatus === 'OPEN') incident.incidentStatus = 'ACKNOWLEDGED';
            await this.incidentRepository(txCtx).save(incident);
            await this.appendEvidence(
                txCtx,
                incident,
                'ACKNOWLEDGED',
                actorUserId,
                '负责人已确认事故并开始处理',
                { note: acknowledgementNote, ...evidence },
                now,
            );
            return this.queueWorkflowUpdate(txCtx, incident, now);
        });
        await this.dispatchIfNeeded(result);
        return this.incidentDetail(result.incident.id);
    }

    async validateRecovery(
        ctx: RequestContext,
        id: ID,
        note: string,
        evidence: Record<string, unknown> = {},
    ) {
        const actorUserId = requiredActor(ctx);
        const validationNote = requiredText(note, 10, 1000, '恢复验证说明');
        const result = await this.connection.withTransaction(ctx, async txCtx => {
            const incident = await this.lockIncident(txCtx, id);
            if (incident.incidentStatus !== 'RECOVERY_PENDING' || !incident.recoveryObservedAt) {
                throw new Error('只有已观测恢复且待验证的事故可以确认恢复');
            }
            const now = new Date();
            incident.recoveryValidatedAt = now;
            incident.recoveryValidatedByUserId = actorUserId;
            incident.recoveryValidationNote = validationNote;
            incident.reviewDueAt = addMinutes(now, REVIEW_MINUTES[highSeverity(incident.severity)]);
            incident.incidentStatus = 'REVIEW_PENDING';
            await this.incidentRepository(txCtx).save(incident);
            await this.appendEvidence(
                txCtx,
                incident,
                'RECOVERY_VALIDATED',
                actorUserId,
                '管理员已验证业务恢复结果',
                { note: validationNote, ...evidence },
                now,
            );
            return this.queueWorkflowUpdate(txCtx, incident, now);
        });
        await this.dispatchIfNeeded(result);
        return this.incidentDetail(result.incident.id);
    }

    async submitReview(
        ctx: RequestContext,
        id: ID,
        input: {
            rootCause: string;
            impactSummary: string;
            correctiveActions: IncidentCorrectiveActionInput[];
        },
    ) {
        const actorUserId = requiredActor(ctx);
        const rootCause = requiredText(input.rootCause, 20, 2000, '根因说明');
        const impactSummary = requiredText(input.impactSummary, 20, 2000, '影响说明');
        const actions = validateActions(input.correctiveActions);
        const result = await this.connection.withTransaction(ctx, async txCtx => {
            const incident = await this.lockIncident(txCtx, id);
            if (incident.incidentStatus !== 'REVIEW_PENDING' || !incident.recoveryValidatedAt) {
                throw new Error('必须先验证恢复结果，才能提交事故复盘');
            }
            const existingActions = await this.actionRepository(txCtx).count({
                where: { incidentId: Number(incident.id) },
            });
            if (existingActions) throw new Error('事故复盘已经生成整改任务');
            const now = new Date();
            const savedActions = await this.actionRepository(txCtx).save(
                actions.map(
                    action =>
                        new AdminIncidentAction({
                            incidentId: Number(incident.id),
                            title: action.title,
                            ownerDepartmentCode: action.ownerDepartmentCode,
                            dueAt: action.dueAt,
                            status: 'OPEN',
                            completedAt: null,
                            completedByUserId: null,
                            completionNote: null,
                            escalatedAt: null,
                        }),
                ),
            );
            incident.rootCause = rootCause;
            incident.impactSummary = impactSummary;
            incident.reviewSubmittedAt = now;
            incident.reviewSubmittedByUserId = actorUserId;
            incident.incidentStatus = 'ACTION_PENDING';
            await this.incidentRepository(txCtx).save(incident);
            await this.appendEvidence(
                txCtx,
                incident,
                'REVIEW_SUBMITTED',
                actorUserId,
                '事故复盘已提交并生成整改任务',
                {
                    rootCause,
                    impactSummary,
                    actions: savedActions.map(action => ({
                        id: action.id,
                        title: action.title,
                        ownerDepartmentCode: action.ownerDepartmentCode,
                        dueAt: action.dueAt.toISOString(),
                    })),
                },
                now,
            );
            return this.queueWorkflowUpdate(txCtx, incident, now);
        });
        await this.dispatchIfNeeded(result);
        return this.incidentDetail(result.incident.id);
    }

    async completeAction(ctx: RequestContext, actionId: ID, note: string) {
        const actorUserId = requiredActor(ctx);
        const completionNote = requiredText(note, 10, 1000, '整改完成说明');
        const result = await this.connection.withTransaction(ctx, async txCtx => {
            const action = await this.lockAction(txCtx, actionId);
            if (action.status !== 'OPEN') throw new Error('整改任务已经完成');
            const incident = await this.lockIncident(txCtx, action.incidentId);
            if (incident.incidentStatus !== 'ACTION_PENDING') throw new Error('事故不在整改阶段');
            const now = new Date();
            action.status = 'COMPLETED';
            action.completedAt = now;
            action.completedByUserId = actorUserId;
            action.completionNote = completionNote;
            await this.actionRepository(txCtx).save(action);
            await this.appendEvidence(
                txCtx,
                incident,
                'ACTION_COMPLETED',
                actorUserId,
                '整改任务已完成',
                { actionId: action.id, title: action.title, note: completionNote },
                now,
            );
            const remaining = await this.actionRepository(txCtx).count({
                where: { incidentId: Number(incident.id), status: 'OPEN' },
            });
            if (remaining === 0) {
                incident.incidentStatus = 'CLOSED';
                incident.closedAt = now;
                await this.appendEvidence(
                    txCtx,
                    incident,
                    'CLOSED',
                    actorUserId,
                    '所有整改任务完成，事故闭环',
                    { finalActionId: action.id },
                    now,
                );
            }
            await this.incidentRepository(txCtx).save(incident);
            return this.queueWorkflowUpdate(txCtx, incident, now);
        });
        await this.dispatchIfNeeded(result);
        return this.incidentDetail(result.incident.id);
    }

    async escalateWorkflowOverdue() {
        const now = new Date();
        const incidentRepository = this.incidentRepository(null);
        const actionRepository = this.actionRepository(null);
        const recovery = await incidentRepository.find({
            where: {
                mode: 'INCIDENT',
                incidentStatus: 'RECOVERY_PENDING',
                recoveryValidationDueAt: LessThanOrEqual(now),
                recoveryEscalatedAt: IsNull(),
            },
            take: 100,
        });
        const reviews = await incidentRepository.find({
            where: {
                mode: 'INCIDENT',
                incidentStatus: 'REVIEW_PENDING',
                reviewDueAt: LessThanOrEqual(now),
                reviewEscalatedAt: IsNull(),
            },
            take: 100,
        });
        const actions = await actionRepository.find({
            where: { status: 'OPEN', dueAt: LessThanOrEqual(now), escalatedAt: IsNull() },
            take: 100,
        });
        let recoveryEscalated = 0;
        let reviewsEscalated = 0;
        let actionsEscalated = 0;
        for (const incident of recovery) {
            const claimed = await incidentRepository.update(
                { id: incident.id, incidentStatus: 'RECOVERY_PENDING', recoveryEscalatedAt: IsNull() },
                { recoveryEscalatedAt: now },
            );
            if (claimed.affected !== 1) continue;
            incident.recoveryEscalatedAt = now;
            try {
                if (await this.escalateStage(incident, '恢复验证逾期', { stage: 'RECOVERY_VALIDATION' }, now))
                    recoveryEscalated += 1;
            } catch (error) {
                await incidentRepository.update(
                    { id: incident.id, recoveryEscalatedAt: now },
                    { recoveryEscalatedAt: null },
                );
                throw error;
            }
        }
        for (const incident of reviews) {
            const claimed = await incidentRepository.update(
                { id: incident.id, incidentStatus: 'REVIEW_PENDING', reviewEscalatedAt: IsNull() },
                { reviewEscalatedAt: now },
            );
            if (claimed.affected !== 1) continue;
            incident.reviewEscalatedAt = now;
            try {
                if (
                    await this.escalateStage(incident, '事故复盘逾期', { stage: 'POST_INCIDENT_REVIEW' }, now)
                )
                    reviewsEscalated += 1;
            } catch (error) {
                await incidentRepository.update(
                    { id: incident.id, reviewEscalatedAt: now },
                    { reviewEscalatedAt: null },
                );
                throw error;
            }
        }
        for (const action of actions) {
            const claimed = await actionRepository.update(
                { id: action.id, status: 'OPEN', escalatedAt: IsNull() },
                { escalatedAt: now },
            );
            if (claimed.affected !== 1) continue;
            action.escalatedAt = now;
            const incident = await incidentRepository.findOne({ where: { id: action.incidentId } });
            if (incident) {
                try {
                    const escalated = await this.escalateStage(
                        incident,
                        '整改任务逾期',
                        { stage: 'CORRECTIVE_ACTION', actionId: action.id, title: action.title },
                        now,
                    );
                    if (escalated) actionsEscalated += 1;
                } catch (error) {
                    await actionRepository.update({ id: action.id, escalatedAt: now }, { escalatedAt: null });
                    throw error;
                }
            }
        }
        return {
            recovery: recoveryEscalated,
            reviews: reviewsEscalated,
            actions: actionsEscalated,
        };
    }

    private async escalateStage(
        incident: AdminNotificationDelivery,
        summary: string,
        evidence: Record<string, unknown>,
        now: Date,
    ) {
        const queued = await this.connection.withTransaction(async txCtx => {
            // A scheduler may have selected this row before historical termination committed.
            // Lock and use the current row instead of saving that stale incident snapshot.
            const current = await this.lockIncident(txCtx, incident.id);
            const requiredStatus =
                evidence.stage === 'RECOVERY_VALIDATION'
                    ? 'RECOVERY_PENDING'
                    : evidence.stage === 'POST_INCIDENT_REVIEW'
                      ? 'REVIEW_PENDING'
                      : 'ACTION_PENDING';
            if (current.incidentStatus !== requiredStatus) return null;
            current.escalationDepartmentCode = 'EXEC';
            current.payload = sanitizePayload({ ...current.payload, workflowEscalation: summary });
            await this.incidentRepository(txCtx).save(current);
            await this.appendSystemEvidence(txCtx, current, 'ESCALATED', summary, evidence, now);
            return this.queueWorkflowUpdate(txCtx, current, now);
        });
        if (!queued) return false;
        await this.dispatchIfNeeded(queued);
        return true;
    }

    private async queueWorkflowUpdate(
        ctx: RequestContext | null,
        incident: AdminNotificationDelivery,
        now: Date,
    ): Promise<IncidentMutationResult> {
        const config = await this.configService.get();
        const dispatch = config.enabled && this.configService.shouldDeliver(config, incident.severity);
        incident.deliveryAction = incident.telegramMessageId ? 'EDIT' : 'SEND';
        incident.deliveryStatus = dispatch ? 'PENDING' : 'SKIPPED';
        incident.availableAt = now;
        incident.claimedAt = null;
        incident.claimedBy = null;
        await this.incidentRepository(ctx).save(incident);
        return { incident, dispatch };
    }

    private async dispatchIfNeeded(result: IncidentMutationResult) {
        if (result.dispatch) await this.worker.dispatch(result.incident.id);
    }

    private async appendEvidence(
        ctx: RequestContext | null,
        incident: AdminNotificationDelivery,
        eventType: IncidentEvidenceEventType,
        actorUserId: string | null,
        summary: string,
        evidence: Record<string, unknown>,
        occurredAt: Date,
    ) {
        if (incident.mode !== 'INCIDENT') return null;
        const eventId = randomUUID();
        const sanitizedEvidence = sanitizeIncidentEvidence(evidence);
        const record = new AdminIncidentEvidence({
            incidentId: Number(incident.id),
            eventId,
            eventType,
            actorType: actorUserId ? 'ADMIN' : 'SYSTEM',
            actorUserId,
            summary: requiredText(summary, 3, 500, '证据摘要'),
            occurredAt,
            evidenceHash: '',
        });
        record.evidence = sanitizedEvidence;
        record.evidenceHash = evidenceHash(record);
        return this.evidenceRepository(ctx).save(record);
    }

    private async lockIncident(ctx: RequestContext, id: ID) {
        const repository = this.incidentRepository(ctx);
        if (!supportsWriteLock(this.connection.rawConnection.options.type)) {
            const fallbackIncident = await repository.findOne({ where: { id, mode: 'INCIDENT' } });
            if (!fallbackIncident) throw new Error('事故记录不存在');
            return fallbackIncident;
        }
        const incident = await repository
            .createQueryBuilder('incident')
            .where('incident.id = :id', { id })
            .andWhere('incident.mode = :mode', { mode: 'INCIDENT' })
            .setLock('pessimistic_write')
            .getOne();
        if (!incident) throw new Error('事故记录不存在');
        return incident;
    }

    private async lockAction(ctx: RequestContext, id: ID) {
        const repository = this.actionRepository(ctx);
        if (!supportsWriteLock(this.connection.rawConnection.options.type)) {
            const fallbackAction = await repository.findOne({ where: { id } });
            if (!fallbackAction) throw new Error('整改任务不存在');
            return fallbackAction;
        }
        const action = await repository
            .createQueryBuilder('action')
            .where('action.id = :id', { id })
            .setLock('pessimistic_write')
            .getOne();
        if (!action) throw new Error('整改任务不存在');
        return action;
    }

    private incidentRepository(ctx: RequestContext | null) {
        return ctx
            ? this.connection.getRepository(ctx, AdminNotificationDelivery)
            : this.connection.rawConnection.getRepository(AdminNotificationDelivery);
    }

    private evidenceRepository(ctx: RequestContext | null) {
        return ctx
            ? this.connection.getRepository(ctx, AdminIncidentEvidence)
            : this.connection.rawConnection.getRepository(AdminIncidentEvidence);
    }

    private actionRepository(ctx: RequestContext | null) {
        return ctx
            ? this.connection.getRepository(ctx, AdminIncidentAction)
            : this.connection.rawConnection.getRepository(AdminIncidentAction);
    }
}

function validateActions(input: IncidentCorrectiveActionInput[]): Array<{
    title: string;
    ownerDepartmentCode: DepartmentCode;
    dueAt: Date;
}> {
    if (!Array.isArray(input) || input.length < 1 || input.length > 10) {
        throw new Error('事故复盘必须包含 1 至 10 项整改任务');
    }
    const now = Date.now();
    return input.map((action, index) => {
        const title = requiredText(action?.title, 5, 500, `第 ${index + 1} 项整改任务`);
        if (!isDepartmentCode(action?.ownerDepartmentCode)) {
            throw new Error(`第 ${index + 1} 项整改责任部门无效`);
        }
        const dueAt = new Date(action.dueAt);
        if (
            Number.isNaN(dueAt.getTime()) ||
            dueAt.getTime() <= now + 60 * 60_000 ||
            dueAt.getTime() > now + 365 * 24 * 60 * 60_000
        ) {
            throw new Error(`第 ${index + 1} 项整改期限必须在 1 小时至 365 天内`);
        }
        return { title, ownerDepartmentCode: action.ownerDepartmentCode, dueAt };
    });
}

function requiredActor(ctx: RequestContext): string {
    if (ctx.activeUserId == null) throw new Error('需要已认证管理员');
    return String(ctx.activeUserId);
}

function requiredText(value: unknown, minimum: number, maximum: number, label: string): string {
    const normalized =
        typeof value === 'string'
            ? value
                  .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
                  .replace(/\s+/gu, ' ')
                  .trim()
            : '';
    if (normalized.length < minimum || normalized.length > maximum) {
        throw new Error(`${label}必须为 ${minimum} 至 ${maximum} 个字符`);
    }
    return normalized;
}

function highSeverity(value: NotificationSeverity): 'P0' | 'P1' {
    if (value !== 'P0' && value !== 'P1') throw new Error('该事故不需要高优先级恢复复盘');
    return value;
}

function addMinutes(value: Date, minutes: number): Date {
    return new Date(value.getTime() + minutes * 60_000);
}

function supportsWriteLock(type: unknown): boolean {
    return ['mysql', 'mariadb', 'postgres', 'aurora-postgres'].includes(String(type));
}

function evidenceHash(record: AdminIncidentEvidence): string {
    return createHash('sha256')
        .update(
            canonicalJson({
                incidentId: record.incidentId,
                eventId: record.eventId,
                eventType: record.eventType,
                actorType: record.actorType,
                actorUserId: record.actorUserId,
                summary: record.summary,
                evidence: record.evidence,
                occurredAt: record.occurredAt.toISOString(),
            }),
        )
        .digest('hex');
}

function verifyEvidenceHash(record: AdminIncidentEvidence): boolean {
    return /^[0-9a-f]{64}$/u.test(record.evidenceHash) && evidenceHash(record) === record.evidenceHash;
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

export const incidentWorkflowPolicy = {
    recoveryValidationMinutes: RECOVERY_VALIDATION_MINUTES,
    reviewMinutes: REVIEW_MINUTES,
};
