import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { ReferralWalletUsage } from '@vendure/store-management-plugin';
import { In, IsNull, MoreThanOrEqual, Not } from 'typeorm';
import type { UsageTimelineItem } from './image-generation-helpers';

import { ImageGenerationCostEvent } from './entities/image-generation-cost-event.entity';
import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImagePromptOptimization } from './entities/image-prompt-optimization.entity';
import { ImageUsageQuotaBucket } from './entities/image-usage-quota-bucket.entity';
import { ImageUsageQuotaEvent } from './entities/image-usage-quota-event.entity';
import {
    appendWalletTimeline,
    applyUsageDateAndCustomerFilters,
    billingModeZhForAudit,
    groupBy,
    normalizeUsageRecordInput,
    quotaTypeZh,
    sortUsageTimeline,
    usageOutcomeZh,
} from './image-generation-helpers';
import { ImageAiUsageRecordListInput } from './types';
export class ImageGenerationUsageQuery {
    constructor(private readonly connection: TransactionalConnection) {}

    async adminUsageRecords(ctx: RequestContext, input: ImageAiUsageRecordListInput = {}) {
        const options = normalizeUsageRecordInput(input);
        const prefetch = options.skip + options.take;
        let imageItems: ImageGenerationJob[] = [];
        let promptItems: ImagePromptOptimization[] = [];
        let imageTotal = 0;
        let promptTotal = 0;

        if (options.recordType !== 'PROMPT_OPTIMIZATION') {
            const query = this.connection
                .getRepository(ctx, ImageGenerationJob)
                .createQueryBuilder('job')
                .leftJoinAndSelect('job.customer', 'customer')
                .where('job.channelId = :channelId', { channelId: ctx.channelId });
            applyUsageDateAndCustomerFilters(query, 'job', options);
            if (options.modelCode) query.andWhere('job.modelCodeSnapshot = :modelCode', options);
            if (options.credentialCode) {
                query.andWhere('job.providerCredentialCodeSnapshot = :credentialCode', options);
            }
            if (options.state) query.andWhere('job.state = :state', options);
            if (options.billingMode === 'FREE') query.andWhere('job.freeQuantityReserved > 0');
            if (options.billingMode === 'PAID') query.andWhere('job.paidQuantityReserved > 0');
            if (options.billingMode === 'MIXED') {
                query.andWhere('job.freeQuantityReserved > 0').andWhere('job.paidQuantityReserved > 0');
            }
            if (options.billingMode === 'REFUNDED') {
                query.innerJoin('job.outputs', 'refundedOutput', 'refundedOutput.refundedAt IS NOT NULL');
                query.distinct(true);
            }
            if (options.failuresOnly)
                query.andWhere('job.state IN (:...failureStates)', {
                    failureStates: ['FAILED', 'UNKNOWN', 'CANCELLED', 'PARTIAL_SUCCESS'],
                });
            if (options.missingCostOnly) {
                const rawMissing = await this.connection
                    .getRepository(ctx, ImageGenerationCostEvent)
                    .createQueryBuilder('cost')
                    .select('DISTINCT cost.jobIdSnapshot', 'jobId')
                    .where('cost.channelId = :channelId', { channelId: ctx.channelId })
                    .andWhere('cost.actualCostMicrounits IS NULL')
                    .limit(50_000)
                    .getRawMany();
                const missingIds = rawMissing.map(row => String(row.jobId));
                if (missingIds.length) query.andWhere('job.id IN (:...missingIds)', { missingIds });
                else query.andWhere('1 = 0');
            }
            [imageItems, imageTotal] = await query
                .orderBy('job.createdAt', 'DESC')
                .addOrderBy('job.id', 'DESC')
                .take(prefetch)
                .getManyAndCount();
        }

        if (options.recordType !== 'IMAGE_GENERATION') {
            const query = this.connection
                .getRepository(ctx, ImagePromptOptimization)
                .createQueryBuilder('prompt')
                .leftJoinAndSelect('prompt.customer', 'customer')
                .where('prompt.channelId = :channelId', { channelId: ctx.channelId });
            applyUsageDateAndCustomerFilters(query, 'prompt', options);
            if (options.modelCode) query.andWhere('prompt.recommendedModelCode = :modelCode', options);
            if (options.credentialCode) {
                query.andWhere('prompt.credentialCodeSnapshot = :credentialCode', options);
            }
            if (options.billingMode) query.andWhere('prompt.billingMode = :billingMode', options);
            if (options.state === 'PENDING') query.andWhere("prompt.source = 'PENDING'");
            else if (options.state === 'FAILED') query.andWhere('prompt.errorMessage IS NOT NULL');
            else if (options.state === 'SUCCEEDED') {
                query.andWhere("prompt.source <> 'PENDING'").andWhere('prompt.errorMessage IS NULL');
            } else if (options.state) query.andWhere('1 = 0');
            if (options.failuresOnly) query.andWhere('prompt.errorMessage IS NOT NULL');
            if (options.missingCostOnly) {
                query
                    .andWhere('prompt.upstreamCallCount > 0')
                    .andWhere('prompt.actualCostMicrounits IS NULL');
            }
            [promptItems, promptTotal] = await query
                .orderBy('prompt.createdAt', 'DESC')
                .addOrderBy('prompt.id', 'DESC')
                .take(prefetch)
                .getManyAndCount();
        }

        const jobIds = imageItems.map(item => String(item.id));
        const costEvents = jobIds.length
            ? await this.connection.getRepository(ctx, ImageGenerationCostEvent).find({
                  where: { channelId: ctx.channelId, jobIdSnapshot: In(jobIds) },
              })
            : [];
        const refundedOutputs = jobIds.length
            ? await this.connection.getRepository(ctx, ImageGenerationOutput).find({
                  where: { jobId: In(jobIds), refundedAt: Not(IsNull()) },
              })
            : [];
        const costsByJob = groupBy(costEvents, event => event.jobIdSnapshot);
        const refundsByJob = new Map<string, { amount: number; count: number }>();
        for (const output of refundedOutputs) {
            const key = String(output.jobId);
            const current = refundsByJob.get(key) ?? { amount: 0, count: 0 };
            current.amount += output.chargeAmount || 0;
            current.count += 1;
            refundsByJob.set(key, current);
        }
        const items = [
            ...imageItems.map(job =>
                this.imageUsageRecord(
                    job,
                    costsByJob.get(String(job.id)) ?? [],
                    refundsByJob.get(String(job.id)),
                ),
            ),
            ...promptItems.map(prompt => this.promptUsageRecord(prompt)),
        ]
            .sort((left, right) => {
                const created = right.createdAt.getTime() - left.createdAt.getTime();
                return created || String(right.id).localeCompare(String(left.id));
            })
            .slice(options.skip, prefetch);
        return { items, totalItems: imageTotal + promptTotal };
    }

    async adminUsageRecordDetail(ctx: RequestContext, recordType: string, id: ID) {
        if (recordType === 'IMAGE_GENERATION') return this.imageUsageRecordDetail(ctx, id);
        if (recordType === 'PROMPT_OPTIMIZATION') return this.promptUsageRecordDetail(ctx, id);
        throw new UserInputError('使用记录类型无效');
    }

    async adminCostSummary(ctx: RequestContext, days = 30) {
        const normalizedDays = Math.min(365, Math.max(1, Math.floor(days || 30)));
        const from = new Date(Date.now() - normalizedDays * 24 * 60 * 60_000);
        const events = await this.connection.getRepository(ctx, ImageGenerationCostEvent).find({
            where: { channelId: ctx.channelId, createdAt: MoreThanOrEqual(from) },
            select: {
                modelCodeSnapshot: true,
                providerScopeSnapshot: true,
                saleUnitPriceSnapshot: true,
                saleCurrencyCode: true,
                outcome: true,
                latencyMs: true,
                actualCostMicrounits: true,
                costCurrency: true,
            },
            order: { createdAt: 'DESC' },
            take: 20_000,
        });
        const grouped = new Map<
            string,
            {
                modelCode: string;
                providerScope: string;
                saleCurrencyCode: string;
                costCurrency: string;
                attempts: number;
                successes: number;
                retries: number;
                failures: number;
                unknowns: number;
                missingCostCount: number;
                grossRevenue: number;
                actualCostMicrounits: number;
                latencyTotal: number;
            }
        >();
        for (const event of events) {
            const costCurrency = event.costCurrency ?? 'UNKNOWN';
            const key = [
                event.modelCodeSnapshot,
                event.providerScopeSnapshot,
                event.saleCurrencyCode,
                costCurrency,
            ].join(':');
            const item = grouped.get(key) ?? {
                modelCode: event.modelCodeSnapshot,
                providerScope: event.providerScopeSnapshot,
                saleCurrencyCode: event.saleCurrencyCode,
                costCurrency,
                attempts: 0,
                successes: 0,
                retries: 0,
                failures: 0,
                unknowns: 0,
                missingCostCount: 0,
                grossRevenue: 0,
                actualCostMicrounits: 0,
                latencyTotal: 0,
            };
            item.attempts += 1;
            item.latencyTotal += event.latencyMs;
            if (event.outcome === 'SUCCEEDED') {
                item.successes += 1;
                item.grossRevenue += event.saleUnitPriceSnapshot;
            } else if (event.outcome === 'RETRY') item.retries += 1;
            else if (event.outcome === 'UNKNOWN') item.unknowns += 1;
            else item.failures += 1;
            if (event.actualCostMicrounits == null) item.missingCostCount += 1;
            else item.actualCostMicrounits += event.actualCostMicrounits;
            grouped.set(key, item);
        }
        return {
            from,
            to: new Date(),
            truncated: events.length >= 20_000,
            items: [...grouped.values()].map(item => ({
                ...item,
                actualCost: item.actualCostMicrounits / 1_000_000,
                averageLatencyMs: item.attempts ? Math.round(item.latencyTotal / item.attempts) : 0,
            })),
        };
    }

    private imageUsageRecord(
        job: ImageGenerationJob,
        costs: ImageGenerationCostEvent[],
        refundInfo?: { amount: number; count: number },
    ) {
        const knownCost = costs.reduce((sum, event) => sum + (event.actualCostMicrounits ?? 0), 0);
        const costCurrencies = [...new Set(costs.map(event => event.costCurrency).filter(Boolean))];
        const billingMode = refundInfo
            ? 'REFUNDED'
            : job.freeQuantityReserved > 0 && job.paidQuantityReserved > 0
              ? 'MIXED'
              : job.paidQuantityReserved > 0
                ? 'PAID'
                : 'FREE';
        return {
            id: job.id,
            recordType: 'IMAGE_GENERATION',
            createdAt: job.createdAt,
            customer: job.customer,
            channelId: job.channelId,
            modelCode: job.modelCodeSnapshot,
            credentialCode: job.providerCredentialCodeSnapshot,
            credentialName: job.providerCredentialNameSnapshot,
            credentialLast4: job.providerCredentialLast4Snapshot,
            state: job.state,
            billingMode,
            freeQuantity: job.freeQuantityReserved,
            paidQuantity: job.paidQuantityReserved,
            chargedAmount: job.capturedAmount,
            refundedAmount: refundInfo?.amount ?? 0,
            currencyCode: job.currencyCode,
            actualCostMicrounits: costs.some(event => event.actualCostMicrounits != null) ? knownCost : null,
            costCurrency: costCurrencies.length === 1 ? costCurrencies[0] : null,
            missingCost: costs.some(event => event.actualCostMicrounits == null),
            errorMessage: job.errorMessage ?? costs.find(event => event.errorMessage)?.errorMessage ?? null,
        };
    }

    private promptUsageRecord(prompt: ImagePromptOptimization) {
        const state = prompt.source === 'PENDING' ? 'PENDING' : prompt.errorMessage ? 'FAILED' : 'SUCCEEDED';
        return {
            id: prompt.id,
            recordType: 'PROMPT_OPTIMIZATION',
            createdAt: prompt.createdAt,
            customer: prompt.customer,
            channelId: prompt.channelId,
            modelCode: prompt.recommendedModelCode,
            credentialCode: prompt.credentialCodeSnapshot,
            credentialName: prompt.credentialNameSnapshot,
            credentialLast4: prompt.credentialLast4Snapshot,
            state,
            billingMode: prompt.billingMode,
            freeQuantity: prompt.quotaEventId ? 1 : 0,
            paidQuantity: prompt.walletUsageId ? 1 : 0,
            chargedAmount: prompt.chargedAmount,
            refundedAmount: prompt.billingMode === 'REFUNDED' ? prompt.chargedAmount : 0,
            currencyCode: prompt.currencyCode,
            actualCostMicrounits: prompt.actualCostMicrounits,
            costCurrency: prompt.costCurrency,
            missingCost: prompt.upstreamCallCount > 0 && prompt.actualCostMicrounits == null,
            errorMessage: prompt.errorMessage,
        };
    }

    private async imageUsageRecordDetail(ctx: RequestContext, id: ID) {
        const job = await this.connection.getRepository(ctx, ImageGenerationJob).findOne({
            where: { id, channelId: ctx.channelId },
            relations: { customer: true, outputs: true },
        });
        if (!job) throw new UserInputError('找不到该生图使用记录');
        const costs = await this.connection.getRepository(ctx, ImageGenerationCostEvent).find({
            where: { channelId: ctx.channelId, jobIdSnapshot: String(job.id) },
            order: { createdAt: 'ASC', attemptNumber: 'ASC' },
        });
        const wallet = job.walletUsageId
            ? await this.connection.getRepository(ctx, ReferralWalletUsage).findOne({
                  where: { id: job.walletUsageId, channelId: ctx.channelId },
              })
            : null;
        const timeline = await this.quotaTimeline(ctx, [String(job.id), job.idempotencyKey]);
        timeline.push({
            at: job.createdAt,
            stage: '提交任务',
            status: '已提交',
            amount: job.expectedChargeAmount,
            currencyCode: job.currencyCode,
            costMicrounits: null,
            message: `请求 ${job.quantity} 张，预计免费 ${job.freeQuantityReserved} 张、付费 ${job.paidQuantityReserved} 张`,
            keyName: null,
            keyLast4: null,
        });
        if (job.providerCredentialCodeSnapshot) {
            timeline.push({
                at: job.createdAt,
                stage: '选择 Key',
                status: '已选择',
                amount: null,
                currencyCode: null,
                costMicrounits: null,
                message: job.providerSelectionReason ?? '按优先级和权重选择',
                keyName: job.providerCredentialNameSnapshot,
                keyLast4: job.providerCredentialLast4Snapshot,
            });
        }
        if (wallet) appendWalletTimeline(timeline, wallet);
        for (const cost of costs) {
            timeline.push({
                at: cost.createdAt,
                stage: '上游调用',
                status: usageOutcomeZh(cost.outcome),
                amount: null,
                currencyCode: null,
                costMicrounits: cost.actualCostMicrounits,
                message: [
                    `第 ${cost.attemptNumber} 次尝试`,
                    cost.httpStatus ? `HTTP ${cost.httpStatus}` : '',
                    `${cost.latencyMs}ms`,
                    cost.providerRequestId ? `上游请求 ${cost.providerRequestId}` : '',
                    cost.errorMessage ?? '',
                ]
                    .filter(Boolean)
                    .join(' · '),
                keyName: cost.credentialNameSnapshot,
                keyLast4: cost.credentialLast4Snapshot,
            });
        }
        for (const output of job.outputs) {
            const refundMessage = output.refundedAt ? '，已人工退款' : '';
            const outputErrorMessage = output.errorMessage ? `：${output.errorMessage}` : '';
            timeline.push({
                at: output.completedAt ?? output.updatedAt,
                stage: '结果保存',
                status: usageOutcomeZh(output.state),
                amount: output.chargeAmount,
                currencyCode: job.currencyCode,
                costMicrounits: null,
                message:
                    `第 ${output.outputIndex + 1} 张，${billingModeZhForAudit(output.billingMode)}` +
                    `${refundMessage}${outputErrorMessage}`,
                keyName: null,
                keyLast4: null,
            });
        }
        if (job.completedAt) {
            timeline.push({
                at: job.completedAt,
                stage: '任务结算',
                status: usageOutcomeZh(job.state),
                amount: job.capturedAmount,
                currencyCode: job.currencyCode,
                costMicrounits: null,
                message: `实扣 ${job.capturedAmount}，释放或退回 ${job.releasedAmount}`,
                keyName: null,
                keyLast4: null,
            });
        }
        return {
            record: this.imageUsageRecord(job, costs),
            inputPrompt: job.originalPrompt,
            outputPrompt: job.finalPrompt,
            totalTokens: null,
            providerRequestIds: [...new Set(costs.map(cost => cost.providerRequestId).filter(Boolean))],
            outputs: job.outputs.map(output => ({
                id: output.id,
                state: output.state,
                billingMode: output.billingMode,
                chargeAmount: output.chargeAmount,
                providerRequestId: output.providerRequestId,
                errorMessage: output.errorMessage,
                refundedAt: output.refundedAt,
            })),
            timeline: sortUsageTimeline(timeline),
        };
    }

    private async promptUsageRecordDetail(ctx: RequestContext, id: ID) {
        const prompt = await this.connection.getRepository(ctx, ImagePromptOptimization).findOne({
            where: { id, channelId: ctx.channelId },
            relations: { customer: true },
        });
        if (!prompt) throw new UserInputError('找不到该提示词使用记录');
        const wallet = prompt.walletUsageId
            ? await this.connection.getRepository(ctx, ReferralWalletUsage).findOne({
                  where: { id: prompt.walletUsageId, channelId: ctx.channelId },
              })
            : null;
        const timeline = await this.quotaTimeline(ctx, [String(prompt.id), prompt.idempotencyKey ?? '']);
        timeline.push({
            at: prompt.createdAt,
            stage: '提交优化',
            status: '已提交',
            amount: prompt.billingMode === 'PAID' ? prompt.chargedAmount : 0,
            currencyCode: prompt.currencyCode,
            costMicrounits: null,
            message: billingModeZhForAudit(prompt.billingMode),
            keyName: null,
            keyLast4: null,
        });
        if (prompt.credentialCodeSnapshot) {
            timeline.push({
                at: prompt.createdAt,
                stage: '选择 Key',
                status: '已选择',
                amount: null,
                currencyCode: null,
                costMicrounits: null,
                message: prompt.credentialSelectionReason ?? '按优先级和权重选择',
                keyName: prompt.credentialNameSnapshot,
                keyLast4: prompt.credentialLast4Snapshot,
            });
        }
        if (wallet) appendWalletTimeline(timeline, wallet);
        timeline.push({
            at: prompt.updatedAt,
            stage: '上游优化',
            status: prompt.errorMessage ? '已回退本地规则' : '成功',
            amount: prompt.chargedAmount,
            currencyCode: prompt.currencyCode,
            costMicrounits: prompt.actualCostMicrounits,
            message: [
                `调用 ${prompt.upstreamCallCount} 次`,
                `${prompt.latencyMs}ms`,
                prompt.providerRequestId ? `上游请求 ${prompt.providerRequestId}` : '',
                prompt.errorMessage ?? '',
            ]
                .filter(Boolean)
                .join(' · '),
            keyName: prompt.credentialNameSnapshot || null,
            keyLast4: prompt.credentialLast4Snapshot || null,
        });
        return {
            record: this.promptUsageRecord(prompt),
            inputPrompt: prompt.inputPrompt,
            outputPrompt: prompt.optimizedPrompt,
            totalTokens: prompt.totalTokens,
            providerRequestIds: prompt.providerRequestId ? [prompt.providerRequestId] : [],
            outputs: [],
            timeline: sortUsageTimeline(timeline),
        };
    }

    private async quotaTimeline(ctx: RequestContext, resourceIds: string[]) {
        const ids = [...new Set(resourceIds.filter(Boolean))];
        if (!ids.length) return [];
        const events = await this.connection.getRepository(ctx, ImageUsageQuotaEvent).find({
            where: { resourceId: In(ids) },
            order: { createdAt: 'ASC' },
        });
        const bucketIds = [...new Set(events.map(event => event.bucketId))];
        const buckets = bucketIds.length
            ? await this.connection.getRepository(ctx, ImageUsageQuotaBucket).find({
                  where: { id: In(bucketIds), channelId: ctx.channelId },
              })
            : [];
        const bucketById = new Map(buckets.map(bucket => [String(bucket.id), bucket]));
        const timeline: UsageTimelineItem[] = [];
        for (const event of events) {
            const bucket = bucketById.get(String(event.bucketId));
            if (!bucket) continue;
            timeline.push({
                at: event.createdAt,
                stage: '额度预占',
                status: '已预占',
                amount: event.amount,
                currencyCode: null,
                costMicrounits: null,
                message: `${quotaTypeZh(bucket.quotaType)} · 窗口 ${bucket.windowKey}`,
                keyName: null,
                keyLast4: null,
            });
            if (event.consumedAt && event.consumedAmount > 0) {
                timeline.push({
                    at: event.consumedAt,
                    stage: '额度消耗',
                    status: '已消耗',
                    amount: event.consumedAmount,
                    currencyCode: null,
                    costMicrounits: null,
                    message: quotaTypeZh(bucket.quotaType),
                    keyName: null,
                    keyLast4: null,
                });
            }
            if (event.releasedAt && event.releasedAmount > 0) {
                timeline.push({
                    at: event.releasedAt,
                    stage: '额度释放',
                    status: '已退回',
                    amount: event.releasedAmount,
                    currencyCode: null,
                    costMicrounits: null,
                    message: quotaTypeZh(bucket.quotaType),
                    keyName: null,
                    keyLast4: null,
                });
            }
        }
        return timeline;
    }
}
