import { Injectable } from '@nestjs/common';
import {
    Channel,
    EventBus,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { AdminNotificationRequestedEvent } from '@vendure/operations-dashboard-plugin';
import { createHash } from 'node:crypto';

import { FraudRiskAppeal } from './entities/fraud-risk-appeal.entity';
import { FraudRiskCase } from './entities/fraud-risk-case.entity';
import { GovernanceApprovalRequest } from './entities/governance-approval-request.entity';
import { GovernanceAuditEntry } from './entities/governance-audit-entry.entity';
import { GovernanceReportSnapshot } from './entities/governance-report-snapshot.entity';
import { GovernedConfigNamespace, GovernedConfigVersion } from './entities/governed-config-version.entity';

const APPROVAL_TTL_DAYS = 7;
const MAX_AUDIT_PAGE = 200;

export interface SubmitGovernedConfigInput {
    namespace: GovernedConfigNamespace;
    payloadJson: string;
    reason: string;
    idempotencyKey: string;
}

export interface ReviewGovernanceApprovalInput {
    id: string | number;
    decision: 'APPROVE' | 'REJECT';
    reason: string;
    idempotencyKey: string;
}

export interface GovernanceAuditInput {
    eventType: string;
    resourceType: string;
    resourceId: string | number;
    actorType: 'SYSTEM' | 'ADMIN' | 'CUSTOMER';
    actorUserId?: string | number | null;
    actorLabel: string;
    reason: string;
    payload?: unknown;
    idempotencyKey: string;
}

@Injectable()
export class GovernanceService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly contexts: RequestContextService,
        private readonly eventBus: EventBus,
    ) {}

    listApprovals(ctx: RequestContext, status?: string) {
        return this.connection.getRepository(ctx, GovernanceApprovalRequest).find({
            where: status
                ? { channelId: ctx.channelId, status: status as never }
                : { channelId: ctx.channelId },
            relations: { configVersion: true },
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }

    listConfigVersions(ctx: RequestContext, namespace?: GovernedConfigNamespace) {
        return this.connection.getRepository(ctx, GovernedConfigVersion).find({
            where: namespace ? { channelId: ctx.channelId, namespace } : { channelId: ctx.channelId },
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }

    listAudit(ctx: RequestContext, skip = 0, take = 50) {
        const safeTake = Math.min(Math.max(take, 1), MAX_AUDIT_PAGE);
        return this.connection
            .getRepository(ctx, GovernanceAuditEntry)
            .findAndCount({
                where: { channelId: ctx.channelId },
                order: { sequence: 'DESC' },
                skip: Math.max(skip, 0),
                take: safeTake,
            })
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    listReports(ctx: RequestContext) {
        return this.connection.getRepository(ctx, GovernanceReportSnapshot).find({
            where: { channelId: ctx.channelId },
            order: { businessDate: 'DESC' },
            take: 60,
        });
    }

    async activeConfig<T extends object>(
        ctx: RequestContext,
        namespace: GovernedConfigNamespace,
    ): Promise<{ version: number; payloadHash: string; value: T } | null> {
        const version = await this.connection.getRepository(ctx, GovernedConfigVersion).findOne({
            where: { channelId: ctx.channelId, namespace, status: 'ACTIVE' },
            order: { version: 'DESC' },
        });
        if (!version) return null;
        return {
            version: version.version,
            payloadHash: version.payloadHash,
            value: JSON.parse(version.payloadJson) as T,
        };
    }

    async submitConfig(ctx: RequestContext, input: SubmitGovernedConfigInput) {
        const userId = requiredActor(ctx);
        const namespace = normalizeNamespace(input.namespace);
        const reason = requiredText(input.reason, 500, '申请原因');
        const idempotencyKey = normalizeKey(input.idempotencyKey);
        const payload = parseAndValidateConfig(namespace, input.payloadJson);
        const payloadJson = stableJson(payload);
        const payloadHash = sha256(payloadJson);
        const approvalRepository = this.connection.getRepository(ctx, GovernanceApprovalRequest);
        const existing = await approvalRepository.findOne({
            where: { channelId: ctx.channelId, idempotencyKey },
            relations: { configVersion: true },
        });
        if (existing) {
            if (
                existing.configVersion.namespace !== namespace ||
                existing.configVersion.payloadHash !== payloadHash
            ) {
                throw new UserInputError('同一幂等键不能提交不同的治理配置');
            }
            return existing;
        }

        const versionRepository = this.connection.getRepository(ctx, GovernedConfigVersion);
        const latest = await versionRepository.findOne({
            where: { channelId: ctx.channelId, namespace },
            order: { version: 'DESC' },
        });
        const configVersion = await versionRepository.save(
            new GovernedConfigVersion({
                channelId: ctx.channelId,
                namespace,
                version: (latest?.version ?? 0) + 1,
                status: 'DRAFT',
                payloadJson,
                payloadHash,
                createdByUserId: userId,
                activatedAt: null,
                retiredAt: null,
            }),
        );
        const approval = await approvalRepository.save(
            new GovernanceApprovalRequest({
                channelId: ctx.channelId,
                configVersionId: configVersion.id,
                configVersion,
                status: 'PENDING',
                requestedByUserId: userId,
                requestReason: reason,
                expiresAt: new Date(Date.now() + APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1_000),
                reviewedByUserId: null,
                reviewReason: null,
                reviewedAt: null,
                idempotencyKey,
            }),
        );
        await this.appendAudit(ctx, {
            eventType: 'CONFIG_APPROVAL_REQUESTED',
            resourceType: 'GovernedConfigVersion',
            resourceId: configVersion.id,
            actorType: 'ADMIN',
            actorUserId: userId,
            actorLabel: userId,
            reason,
            payload: { namespace, version: configVersion.version, payloadHash },
            idempotencyKey: derivedIdempotencyKey('governance-submit', idempotencyKey),
        });
        return approval;
    }

    async reviewApproval(ctx: RequestContext, input: ReviewGovernanceApprovalInput) {
        const reviewerId = requiredActor(ctx);
        const reason = requiredText(input.reason, 500, '审核原因');
        const eventKey = normalizeKey(input.idempotencyKey);
        const repository = this.connection.getRepository(ctx, GovernanceApprovalRequest);
        const approval = await repository.findOne({
            where: { id: input.id, channelId: ctx.channelId },
            relations: { configVersion: true },
        });
        if (!approval) throw new UserInputError('治理审批不存在或不属于当前店铺');
        if (approval.status !== 'PENDING') return approval;
        if (approval.expiresAt.getTime() <= Date.now()) {
            approval.status = 'EXPIRED';
            approval.configVersion.status = 'REJECTED';
            await this.connection
                .getRepository(ctx, GovernedConfigVersion)
                .save(approval.configVersion, { reload: false });
            await repository.save(approval, { reload: false });
            await this.appendAudit(ctx, {
                eventType: 'CONFIG_APPROVAL_EXPIRED',
                resourceType: 'GovernedConfigVersion',
                resourceId: approval.configVersion.id,
                actorType: 'SYSTEM',
                actorLabel: 'Governance approval guard',
                reason: 'Approval window expired before review completed',
                payload: {
                    namespace: approval.configVersion.namespace,
                    version: approval.configVersion.version,
                    expiresAt: approval.expiresAt.toISOString(),
                },
                idempotencyKey: derivedIdempotencyKey(
                    'governance-expired',
                    `${String(approval.id)}:${approval.expiresAt.toISOString()}`,
                ),
            });
            return approval;
        }
        if (approval.requestedByUserId === reviewerId) {
            throw new UserInputError('提交人与审核人必须是不同管理员');
        }
        approval.reviewedByUserId = reviewerId;
        approval.reviewReason = reason;
        approval.reviewedAt = new Date();
        const versionRepository = this.connection.getRepository(ctx, GovernedConfigVersion);
        if (input.decision === 'APPROVE') {
            await versionRepository
                .createQueryBuilder()
                .update(GovernedConfigVersion)
                .set({ status: 'RETIRED', retiredAt: approval.reviewedAt })
                .where('channelId = :channelId AND namespace = :namespace AND status = :status', {
                    channelId: ctx.channelId,
                    namespace: approval.configVersion.namespace,
                    status: 'ACTIVE',
                })
                .execute();
            approval.status = 'APPROVED';
            approval.configVersion.status = 'ACTIVE';
            approval.configVersion.activatedAt = approval.reviewedAt;
        } else {
            approval.status = 'REJECTED';
            approval.configVersion.status = 'REJECTED';
        }
        await versionRepository.save(approval.configVersion, { reload: false });
        await repository.save(approval, { reload: false });
        await this.appendAudit(ctx, {
            eventType: input.decision === 'APPROVE' ? 'CONFIG_APPROVED' : 'CONFIG_REJECTED',
            resourceType: 'GovernedConfigVersion',
            resourceId: approval.configVersion.id,
            actorType: 'ADMIN',
            actorUserId: reviewerId,
            actorLabel: reviewerId,
            reason,
            payload: {
                namespace: approval.configVersion.namespace,
                version: approval.configVersion.version,
                payloadHash: approval.configVersion.payloadHash,
            },
            idempotencyKey: derivedIdempotencyKey('governance-review', eventKey),
        });
        return approval;
    }

    async appendAudit(ctx: RequestContext, input: GovernanceAuditInput): Promise<GovernanceAuditEntry> {
        const repository = this.connection.getRepository(ctx, GovernanceAuditEntry);
        const idempotencyKey = normalizeKey(input.idempotencyKey);
        const existing = await repository.findOneBy({ channelId: ctx.channelId, idempotencyKey });
        if (existing) return existing;
        const payloadJson = stableJson(input.payload ?? {});
        const payloadHash = sha256(payloadJson);
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const previous = await repository.findOne({
                where: { channelId: ctx.channelId },
                order: { sequence: 'DESC' },
            });
            const sequence = (previous?.sequence ?? 0) + 1;
            const normalized = {
                channelId: String(ctx.channelId),
                sequence,
                eventType: requiredText(input.eventType, 80, '审计事件'),
                resourceType: requiredText(input.resourceType, 80, '资源类型'),
                resourceId: requiredText(String(input.resourceId), 160, '资源编号'),
                actorType: input.actorType,
                actorUserId: input.actorUserId == null ? null : String(input.actorUserId),
                actorLabel: requiredText(input.actorLabel, 160, '操作人'),
                reason: requiredText(input.reason, 500, '操作原因'),
                payloadHash,
                previousHash: previous?.entryHash ?? null,
            };
            const entryHash = sha256(stableJson(normalized));
            try {
                return await repository.save(
                    new GovernanceAuditEntry({
                        ...normalized,
                        payloadJson,
                        entryHash,
                        idempotencyKey,
                    }),
                );
            } catch (error) {
                const concurrent = await repository.findOneBy({ channelId: ctx.channelId, idempotencyKey });
                if (concurrent) return concurrent;
                if (attempt === 2) throw error;
            }
        }
        throw new Error('无法写入治理审计链');
    }

    async verifyAuditChain(
        ctx: RequestContext,
    ): Promise<{ valid: boolean; checkedEntries: number; brokenAt: number | null }> {
        const entries = await this.connection.getRepository(ctx, GovernanceAuditEntry).find({
            where: { channelId: ctx.channelId },
            order: { sequence: 'ASC' },
        });
        let previousHash: string | null = null;
        for (const entry of entries) {
            const expected = sha256(
                stableJson({
                    channelId: String(entry.channelId),
                    sequence: entry.sequence,
                    eventType: entry.eventType,
                    resourceType: entry.resourceType,
                    resourceId: entry.resourceId,
                    actorType: entry.actorType,
                    actorUserId: entry.actorUserId,
                    actorLabel: entry.actorLabel,
                    reason: entry.reason,
                    payloadHash: entry.payloadHash,
                    previousHash,
                }),
            );
            if (
                entry.previousHash !== previousHash ||
                entry.payloadHash !== sha256(entry.payloadJson) ||
                entry.entryHash !== expected
            ) {
                return { valid: false, checkedEntries: entries.length, brokenAt: entry.sequence };
            }
            previousHash = entry.entryHash;
        }
        return { valid: true, checkedEntries: entries.length, brokenAt: null };
    }

    async generateDueReports(now = new Date()): Promise<{ generated: number; anomalies: number }> {
        const channels = await this.connection.rawConnection.getRepository(Channel).find();
        let generated = 0;
        let anomalies = 0;
        for (const channel of channels) {
            const ctx = await this.contexts.create({ apiType: 'admin', channelOrToken: channel });
            await this.expireDueApprovals(ctx, now);
            const schedule = await this.activeConfig<{ enabled?: boolean; hourUtc?: number }>(
                ctx,
                'REPORT_SCHEDULE',
            );
            if (schedule?.value.enabled === false) continue;
            const hourUtc = clampInteger(schedule?.value.hourUtc, 0, 23, 0);
            if (now.getUTCHours() < hourUtc) continue;
            const businessDate = now.toISOString().slice(0, 10);
            const exists = await this.connection.getRepository(ctx, GovernanceReportSnapshot).findOneBy({
                channelId: ctx.channelId,
                businessDate,
            });
            if (exists) continue;
            const report = await this.generateReport(ctx, businessDate, now);
            generated += 1;
            anomalies += report.anomalyCount;
        }
        return { generated, anomalies };
    }

    async generateReport(ctx: RequestContext, businessDate: string, now = new Date()) {
        const reportRepository = this.connection.getRepository(ctx, GovernanceReportSnapshot);
        const existing = await reportRepository.findOneBy({ channelId: ctx.channelId, businessDate });
        if (existing) return existing;
        const start = new Date(`${businessDate}T00:00:00.000Z`);
        const end = new Date(Math.min(now.getTime(), start.getTime() + 24 * 60 * 60 * 1_000 - 1));
        const approvalRepository = this.connection.getRepository(ctx, GovernanceApprovalRequest);
        const caseRepository = this.connection.getRepository(ctx, FraudRiskCase);
        const appealRepository = this.connection.getRepository(ctx, FraudRiskAppeal);
        const [pendingApprovals, expiredApprovals, openCases, overdueCases, pendingAppeals, auditIntegrity] =
            await Promise.all([
                approvalRepository.countBy({ channelId: ctx.channelId, status: 'PENDING' }),
                approvalRepository
                    .createQueryBuilder('approval')
                    .where(
                        'approval.channelId = :channelId AND approval.status = :status AND approval.updatedAt >= :since AND approval.updatedAt <= :now',
                        {
                            channelId: ctx.channelId,
                            status: 'EXPIRED',
                            since: new Date(now.getTime() - 24 * 60 * 60 * 1_000),
                            now,
                        },
                    )
                    .getCount(),
                caseRepository
                    .createQueryBuilder('risk')
                    .where('risk.channelId = :channelId AND risk.status IN (:...statuses)', {
                        channelId: ctx.channelId,
                        statuses: ['OPEN', 'IN_REVIEW', 'APPEALED'],
                    })
                    .getCount(),
                caseRepository
                    .createQueryBuilder('risk')
                    .where(
                        'risk.channelId = :channelId AND risk.status IN (:...statuses) AND risk.dueAt <= :now',
                        {
                            channelId: ctx.channelId,
                            statuses: ['OPEN', 'IN_REVIEW', 'APPEALED'],
                            now,
                        },
                    )
                    .getCount(),
                appealRepository.countBy({ channelId: ctx.channelId, status: 'PENDING' }),
                this.verifyAuditChain(ctx),
            ]);
        const metrics = { pendingApprovals, expiredApprovals, openCases, overdueCases, pendingAppeals };
        const anomalyCount = expiredApprovals + overdueCases + (auditIntegrity.valid ? 0 : 1);
        const metricsJson = stableJson({ ...metrics, auditIntegrity });
        let snapshot: GovernanceReportSnapshot;
        try {
            snapshot = await reportRepository.save(
                new GovernanceReportSnapshot({
                    channelId: ctx.channelId,
                    businessDate,
                    windowStartedAt: start,
                    windowEndedAt: end,
                    metricsJson,
                    digest: sha256(metricsJson),
                    auditIntegrityValid: auditIntegrity.valid,
                    anomalyCount,
                }),
            );
        } catch (error) {
            const concurrent = await reportRepository.findOneBy({ channelId: ctx.channelId, businessDate });
            if (!concurrent) throw error;
            return concurrent;
        }
        await this.appendAudit(ctx, {
            eventType: 'GOVERNANCE_REPORT_GENERATED',
            resourceType: 'GovernanceReportSnapshot',
            resourceId: snapshot.id,
            actorType: 'SYSTEM',
            actorLabel: 'Governance report scheduler',
            reason: 'Daily governance control snapshot generated',
            payload: {
                businessDate,
                digest: snapshot.digest,
                anomalyCount,
                auditIntegrityValid: snapshot.auditIntegrityValid,
            },
            idempotencyKey: derivedIdempotencyKey(
                'governance-report',
                `${String(ctx.channelId)}:${businessDate}`,
            ),
        });
        const fingerprint = `governance.control-health:${String(ctx.channelId)}`;
        await this.eventBus.publish(
            new AdminNotificationRequestedEvent(ctx, {
                eventType: anomalyCount ? 'governance.control.anomaly' : 'governance.control.recovered',
                category: 'GOVERNANCE',
                severity: auditIntegrity.valid ? (overdueCases ? 'P1' : 'P2') : 'P0',
                sourceType: 'GovernanceControl',
                sourceId: String(ctx.channelId),
                title: anomalyCount ? '治理控制存在待处理异常' : '治理控制检查已恢复',
                fingerprint,
                mode: anomalyCount ? 'INCIDENT_FIRING' : 'INCIDENT_RESOLVED',
                payload: {
                    summary: anomalyCount
                        ? `过期审批 ${expiredApprovals}，逾期风险案件 ${overdueCases}，审计链完整=${auditIntegrity.valid}`
                        : '审批、风险复核和审计链检查正常',
                    businessDate,
                    ...metrics,
                    auditIntegrity,
                },
            }),
        );
        return snapshot;
    }

    private async expireDueApprovals(ctx: RequestContext, now: Date): Promise<number> {
        const approvalRepository = this.connection.getRepository(ctx, GovernanceApprovalRequest);
        const due = await approvalRepository
            .createQueryBuilder('approval')
            .leftJoinAndSelect('approval.configVersion', 'configVersion')
            .where(
                'approval.channelId = :channelId AND approval.status = :status AND approval.expiresAt <= :now',
                { channelId: ctx.channelId, status: 'PENDING', now },
            )
            .take(200)
            .getMany();
        for (const approval of due) {
            approval.status = 'EXPIRED';
            approval.configVersion.status = 'REJECTED';
            await this.connection
                .getRepository(ctx, GovernedConfigVersion)
                .save(approval.configVersion, { reload: false });
            await approvalRepository.save(approval, { reload: false });
            await this.appendAudit(ctx, {
                eventType: 'CONFIG_APPROVAL_EXPIRED',
                resourceType: 'GovernedConfigVersion',
                resourceId: approval.configVersion.id,
                actorType: 'SYSTEM',
                actorLabel: 'Governance approval scheduler',
                reason: 'Approval window expired before a second administrator completed review',
                payload: {
                    namespace: approval.configVersion.namespace,
                    version: approval.configVersion.version,
                    expiresAt: approval.expiresAt.toISOString(),
                },
                idempotencyKey: derivedIdempotencyKey(
                    'governance-expired',
                    `${String(approval.id)}:${approval.expiresAt.toISOString()}`,
                ),
            });
        }
        return due.length;
    }
}

export function parseAndValidateConfig(namespace: GovernedConfigNamespace, payloadJson: string): object {
    let value: unknown;
    try {
        value = JSON.parse(payloadJson);
    } catch {
        throw new UserInputError('治理配置必须是有效 JSON');
    }
    if (!value || Array.isArray(value) || typeof value !== 'object') {
        throw new UserInputError('治理配置必须是 JSON 对象');
    }
    const input = value as Record<string, unknown>;
    if (namespace === 'FRAUD_RULES') {
        const fraudRuleFields = [
            'enabled',
            'highValueThreshold',
            'velocityOrderCount',
            'failedPaymentCount',
            'reviewScore',
            'holdScore',
        ];
        rejectUnknownKeys(input, fraudRuleFields);
        const reviewScore = integerValue(input.reviewScore, 1, 100, 40);
        const holdScore = integerValue(input.holdScore, 1, 100, 60);
        if (holdScore < reviewScore) {
            throw new UserInputError('拦截阈值不能低于人工复核阈值');
        }
        return {
            enabled: booleanValue(input.enabled, true),
            highValueThreshold: integerValue(input.highValueThreshold, 1, 1_000_000_000, 100_000),
            velocityOrderCount: integerValue(input.velocityOrderCount, 2, 100, 3),
            failedPaymentCount: integerValue(input.failedPaymentCount, 1, 100, 2),
            reviewScore,
            holdScore,
        };
    }
    const reportScheduleFields = ['enabled', 'hourUtc'];
    rejectUnknownKeys(input, reportScheduleFields);
    return {
        enabled: booleanValue(input.enabled, true),
        hourUtc: integerValue(input.hourUtc, 0, 23, 0),
    };
}

export function stableJson(value: unknown): string {
    return JSON.stringify(sortValue(value));
}

export function derivedIdempotencyKey(prefix: string, source: string): string {
    const normalizedPrefix = prefix.replace(/[^a-zA-Z0-9:_-]/gu, '-').slice(0, 30);
    return `${normalizedPrefix}:${sha256(source).slice(0, 64)}`;
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortValue);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, sortValue(item)]),
    );
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function normalizeNamespace(value: string): GovernedConfigNamespace {
    if (value !== 'FRAUD_RULES' && value !== 'REPORT_SCHEDULE') {
        throw new UserInputError('不支持的治理配置命名空间');
    }
    return value;
}

function requiredActor(ctx: RequestContext): string {
    if (!ctx.activeUserId) throw new UserInputError('缺少已认证的操作人');
    return String(ctx.activeUserId);
}

function requiredText(value: string, max: number, label: string): string {
    const normalized = value?.normalize('NFKC').trim();
    if (!normalized) throw new UserInputError(`${label}不能为空`);
    if (normalized.length > max) throw new UserInputError(`${label}不能超过 ${max} 个字符`);
    return normalized;
}

function normalizeKey(value: string): string {
    const key = requiredText(value, 96, '幂等键');
    if (!/^[a-zA-Z0-9:_-]{8,96}$/u.test(key)) throw new UserInputError('幂等键格式无效');
    return key;
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: string[]): void {
    const unknown = Object.keys(input).filter(key => !allowed.includes(key));
    if (unknown.length) throw new UserInputError(`治理配置包含不支持字段：${unknown.join('、')}`);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
    if (value == null) return fallback;
    if (typeof value !== 'boolean') throw new UserInputError('治理配置布尔字段格式无效');
    return value;
}

function integerValue(value: unknown, min: number, max: number, fallback: number): number {
    if (value == null) return fallback;
    if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
        throw new UserInputError(`治理配置整数必须在 ${min}-${max} 范围内`);
    }
    return Number(value);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
    return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
        ? Number(value)
        : fallback;
}
