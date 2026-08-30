import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';

import { IMAGE_GENERATION_QUEUE, IMAGE_WORKER_STALE_AFTER_MS } from './constants';
import { ImageGenerationConfig } from './entities/image-generation-config.entity';
import { ImageGenerationCostEvent } from './entities/image-generation-cost-event.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImageGenerationRuntimeStatus } from './entities/image-generation-runtime-status.entity';
import { ImageProviderCredential } from './entities/image-provider-credential.entity';

const RELIABILITY_MINIMUM_SAMPLE = 5;
const RELIABILITY_SUCCESS_RATE_FLOOR = 0.8;
const RELIABILITY_UNKNOWN_RATE_CEILING = 0.1;
const COST_MISSING_RATE_WARNING = 0.2;

@Injectable()
export class ImageGenerationReliabilityService {
    constructor(private readonly connection: TransactionalConnection) {}

    async healthSnapshot() {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
        const [runtime, enabledChannels, queue, costs, credentials] = await Promise.all([
            this.runtime(),
            this.connection.rawConnection
                .getRepository(ImageGenerationConfig)
                .count({ where: { enabled: true } }),
            this.queueSnapshot(),
            this.connection.rawConnection
                .getRepository(ImageGenerationCostEvent)
                .createQueryBuilder('cost')
                .where('cost.createdAt >= :since', { since })
                .orderBy('cost.createdAt', 'DESC')
                .take(10_000)
                .getMany(),
            this.credentials(),
        ]);
        const workerStale = isWorkerStale(runtime?.heartbeatAt);
        const queueStale = Boolean(
            queue.oldestQueuedAt && queue.oldestQueuedAt.getTime() < Date.now() - 2 * 60_000,
        );
        const metrics = summarizeCosts(costs);
        const keyRedundancy = summarizeKeyRedundancy(credentials);
        const status = deriveImageGenerationHealthStatus({
            enabled: enabledChannels > 0,
            workerStale,
            queueStale,
        });
        const recentCallStatus = deriveImageGenerationRecentCallStatus({
            attempts24h: metrics.attempts,
            successRate: metrics.successRate,
            unknownRate: metrics.unknownRate,
        });
        const alerts = imageGenerationHealthAlerts({
            status,
            workerStale,
            queueStale,
            metrics,
            keyRedundancy,
        });
        return {
            status,
            recentCallStatus,
            enabled: enabledChannels > 0,
            workerStatus: runtime?.status ?? 'MISSING',
            workerHeartbeatAt: runtime?.heartbeatAt ?? null,
            workerStale,
            queueStale,
            queuedOutputs: queue.queuedOutputs,
            activeOutputs: queue.activeOutputs,
            oldestQueuedAt: queue.oldestQueuedAt,
            attempts24h: metrics.attempts,
            successes24h: metrics.successes,
            failures24h: metrics.failures,
            unknowns24h: metrics.unknowns,
            successRate: metrics.successRate,
            unknownRate: metrics.unknownRate,
            missingCostCount: metrics.missingCostCount,
            missingCostRate: metrics.missingCostRate,
            failureBuckets: metrics.failureBuckets,
            keyRedundancy,
            alerts,
        };
    }

    async adminSummary(ctx: RequestContext) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
        const [runtime, queue, costs, credentials] = await Promise.all([
            this.runtime(),
            this.queueSnapshot(ctx),
            this.connection
                .getRepository(ctx, ImageGenerationCostEvent)
                .createQueryBuilder('cost')
                .where('cost.channelId = :channelId', { channelId: ctx.channelId })
                .andWhere('cost.createdAt >= :since', { since })
                .orderBy('cost.createdAt', 'DESC')
                .take(10_000)
                .getMany(),
            this.credentials(),
        ]);
        const metrics = summarizeCosts(costs);
        const keyRedundancy = summarizeKeyRedundancy(credentials);
        const workerStale = isWorkerStale(runtime?.heartbeatAt);
        return {
            workerStatus: runtime?.status ?? 'MISSING',
            workerHeartbeatAt: runtime?.heartbeatAt ?? null,
            workerStale,
            lastReconcileAt: runtime?.lastReconcileAt ?? null,
            oldestQueuedAt: queue.oldestQueuedAt,
            queuedOutputs: queue.queuedOutputs,
            activeOutputs: queue.activeOutputs,
            attempts24h: metrics.attempts,
            successes24h: metrics.successes,
            failures24h: metrics.failures,
            unknowns24h: metrics.unknowns,
            successRate: metrics.successRate,
            unknownRate: metrics.unknownRate,
            missingCostCount: metrics.missingCostCount,
            missingCostRate: metrics.missingCostRate,
            failureBuckets: metrics.failureBuckets,
            keyRedundancy,
        };
    }

    private credentials(): Promise<ImageProviderCredential[]> {
        return this.connection.rawConnection
            .getRepository(ImageProviderCredential)
            .createQueryBuilder('credential')
            .where('credential.archivedAt IS NULL')
            .andWhere("credential.purpose IN ('IMAGE', 'BOTH')")
            .getMany();
    }

    private runtime(): Promise<ImageGenerationRuntimeStatus | null> {
        return this.connection.rawConnection.getRepository(ImageGenerationRuntimeStatus).findOne({
            where: { queueName: IMAGE_GENERATION_QUEUE },
        });
    }

    private async queueSnapshot(ctx?: RequestContext) {
        const repository = ctx
            ? this.connection.getRepository(ctx, ImageGenerationOutput)
            : this.connection.rawConnection.getRepository(ImageGenerationOutput);
        const base = repository.createQueryBuilder('output');
        if (ctx) {
            base.innerJoin('output.job', 'job').where('job.channelId = :channelId', {
                channelId: ctx.channelId,
            });
        }
        const [queuedOutputs, activeOutputs, oldest] = await Promise.all([
            base.clone().andWhere('output.state = :queued', { queued: 'QUEUED' }).getCount(),
            base
                .clone()
                .andWhere('output.state IN (:...active)', { active: ['RUNNING', 'UNKNOWN'] })
                .getCount(),
            base
                .clone()
                .andWhere('output.state = :queued', { queued: 'QUEUED' })
                .orderBy('output.createdAt', 'ASC')
                .select(['output.createdAt'])
                .getOne(),
        ]);
        return { queuedOutputs, activeOutputs, oldestQueuedAt: oldest?.createdAt ?? null };
    }
}

function isWorkerStale(heartbeatAt?: Date | null): boolean {
    return !heartbeatAt || heartbeatAt.getTime() < Date.now() - IMAGE_WORKER_STALE_AFTER_MS;
}

export interface ReliabilityMetrics {
    attempts: number;
    successes: number;
    failures: number;
    unknowns: number;
    successRate: number;
    unknownRate: number;
    missingCostCount: number;
    missingCostRate: number;
    failureBuckets: Array<{ code: string; count: number }>;
}

export interface KeyRedundancy {
    scope: string;
    healthyKeyCount: number;
    warning: string | null;
}

function summarizeCosts(costs: ImageGenerationCostEvent[]): ReliabilityMetrics {
    const successes = costs.filter(cost => cost.outcome === 'SUCCEEDED').length;
    const unknowns = costs.filter(cost => cost.outcome === 'UNKNOWN').length;
    const failures = costs.filter(cost => cost.outcome === 'FAILED').length;
    const missingCostCount = costs.filter(cost => cost.actualCostMicrounits == null).length;
    const failureCounts = new Map<string, number>();
    for (const cost of costs) {
        if (!cost.failureCode) continue;
        failureCounts.set(cost.failureCode, (failureCounts.get(cost.failureCode) ?? 0) + 1);
    }
    return {
        attempts: costs.length,
        successes,
        failures,
        unknowns,
        successRate: costs.length ? successes / costs.length : 0,
        unknownRate: costs.length ? unknowns / costs.length : 0,
        missingCostCount,
        missingCostRate: costs.length ? missingCostCount / costs.length : 0,
        failureBuckets: [...failureCounts.entries()]
            .sort((left, right) => right[1] - left[1])
            .map(([code, count]) => ({ code, count })),
    };
}

function summarizeKeyRedundancy(credentials: ImageProviderCredential[]): KeyRedundancy[] {
    return ['OPENAI', 'GEMINI'].map(scope => {
        const healthyKeyCount = credentials.filter(
            credential =>
                credential.scope === scope &&
                credential.enabled &&
                credential.healthStatus === 'HEALTHY' &&
                (credential.cooldownUntil?.getTime() ?? 0) <= Date.now(),
        ).length;
        return {
            scope,
            healthyKeyCount,
            warning:
                healthyKeyCount === 0
                    ? '没有可路由的健康 Key'
                    : healthyKeyCount === 1
                      ? '单 Key、无故障切换'
                      : null,
        };
    });
}

export function deriveImageGenerationHealthStatus(input: {
    enabled: boolean;
    workerStale: boolean;
    queueStale: boolean;
}): 'DISABLED' | 'DOWN' | 'DEGRADED' | 'HEALTHY' {
    if (!input.enabled) return 'DISABLED';
    if (input.workerStale) return 'DOWN';
    if (input.queueStale) return 'DEGRADED';
    return 'HEALTHY';
}

export function deriveImageGenerationRecentCallStatus(input: {
    attempts24h: number;
    successRate: number;
    unknownRate: number;
}): 'INSUFFICIENT_DATA' | 'DEGRADED' | 'HEALTHY' {
    if (input.attempts24h < RELIABILITY_MINIMUM_SAMPLE) return 'INSUFFICIENT_DATA';
    return input.successRate < RELIABILITY_SUCCESS_RATE_FLOOR ||
        input.unknownRate >= RELIABILITY_UNKNOWN_RATE_CEILING
        ? 'DEGRADED'
        : 'HEALTHY';
}

function imageGenerationHealthAlerts(input: {
    status: 'DISABLED' | 'DOWN' | 'DEGRADED' | 'HEALTHY';
    workerStale: boolean;
    queueStale: boolean;
    metrics: ReliabilityMetrics;
    keyRedundancy: KeyRedundancy[];
}) {
    const alerts: Array<{ code: string; severity: 'CRITICAL' | 'WARNING'; message: string }> = [];
    if (input.workerStale && input.status !== 'DISABLED') {
        alerts.push({ code: 'WORKER_STALE', severity: 'CRITICAL', message: 'AI Worker 心跳已超时' });
    }
    if (input.queueStale) {
        alerts.push({ code: 'QUEUE_STALE', severity: 'CRITICAL', message: 'AI 生图队列等待超过 2 分钟' });
    }
    if (
        input.metrics.attempts >= RELIABILITY_MINIMUM_SAMPLE &&
        input.metrics.successRate < RELIABILITY_SUCCESS_RATE_FLOOR
    ) {
        alerts.push({
            code: 'SUCCESS_RATE_LOW',
            severity: 'CRITICAL',
            message: 'AI 生图 24 小时成功率低于 80%',
        });
    }
    if (
        input.metrics.attempts >= RELIABILITY_MINIMUM_SAMPLE &&
        input.metrics.unknownRate >= RELIABILITY_UNKNOWN_RATE_CEILING
    ) {
        alerts.push({
            code: 'UNKNOWN_RATE_HIGH',
            severity: 'CRITICAL',
            message: 'AI 生图 24 小时 UNKNOWN 率达到 10%',
        });
    }
    if (
        input.metrics.attempts >= RELIABILITY_MINIMUM_SAMPLE &&
        input.metrics.missingCostRate >= COST_MISSING_RATE_WARNING
    ) {
        alerts.push({
            code: 'COST_TELEMETRY_MISSING',
            severity: 'WARNING',
            message: 'AI 生图 24 小时缺失成本比例达到 20%',
        });
    }
    for (const key of input.keyRedundancy) {
        if (!key.warning) continue;
        alerts.push({
            code: key.healthyKeyCount === 0 ? `${key.scope}_KEY_MISSING` : `${key.scope}_SINGLE_KEY`,
            severity: key.healthyKeyCount === 0 ? 'CRITICAL' : 'WARNING',
            message: `${key.scope}：${key.warning}`,
        });
    }
    return alerts;
}
