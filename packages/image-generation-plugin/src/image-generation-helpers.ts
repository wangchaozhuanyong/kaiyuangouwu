import type { ID } from '@vendure/common/lib/shared-types';
import { UserInputError } from '@vendure/core';
import type { ReferralWalletUsage } from '@vendure/store-management-plugin';
import { Brackets, type ObjectLiteral, type SelectQueryBuilder } from 'typeorm';
import type { ImageGenerationJob } from './entities/image-generation-job.entity';
import type { ImageGenerationOutput } from './entities/image-generation-output.entity';
import type { PromptOutputLanguage } from './prompt/prompt-rules.service';
import type { CreateImageGenerationInput, ImageAiUsageRecordListInput, ImageReferenceMode } from './types';

export type UsageTimelineItem = {
    at: Date;
    stage: string;
    status: string;
    amount: number | null;
    currencyCode: string | null;
    costMicrounits: number | null;
    message: string | null;
    keyName: string | null;
    keyLast4: string | null;
};

export type NormalizedUsageRecordInput = {
    skip: number;
    take: number;
    recordType: 'PROMPT_OPTIMIZATION' | 'IMAGE_GENERATION' | null;
    from: Date | null;
    to: Date | null;
    customer: string;
    modelCode: string;
    credentialCode: string;
    state: string;
    billingMode: string;
    failuresOnly: boolean;
    missingCostOnly: boolean;
};

export function normalizeUsageRecordInput(input: ImageAiUsageRecordListInput): NormalizedUsageRecordInput {
    const recordType = input.recordType ?? null;
    if (recordType && !['PROMPT_OPTIMIZATION', 'IMAGE_GENERATION'].includes(recordType)) {
        throw new UserInputError('使用记录类型无效');
    }
    const from = optionalAuditDate(input.from, '开始时间');
    const to = optionalAuditDate(input.to, '结束时间');
    if (from && to && from > to) throw new UserInputError('开始时间不能晚于结束时间');
    return {
        skip: Math.min(10_000, Math.max(0, Math.floor(input.skip ?? 0))),
        take: Math.min(100, Math.max(1, Math.floor(input.take ?? 30))),
        recordType,
        from,
        to,
        customer: input.customer?.trim().slice(0, 160) ?? '',
        modelCode: input.modelCode?.trim().slice(0, 48) ?? '',
        credentialCode: input.credentialCode?.trim().slice(0, 64) ?? '',
        state: input.state?.trim().slice(0, 32) ?? '',
        billingMode: input.billingMode?.trim().slice(0, 16) ?? '',
        failuresOnly: input.failuresOnly === true,
        missingCostOnly: input.missingCostOnly === true,
    };
}

export function optionalAuditDate(value: Date | string | null | undefined, label: string): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new UserInputError(`${label}无效`);
    return date;
}

export function applyUsageDateAndCustomerFilters<T extends ObjectLiteral>(
    query: SelectQueryBuilder<T>,
    alias: 'job' | 'prompt',
    options: NormalizedUsageRecordInput,
): void {
    if (options.from) query.andWhere(`${alias}.createdAt >= :from`, { from: options.from });
    if (options.to) query.andWhere(`${alias}.createdAt <= :to`, { to: options.to });
    if (!options.customer) return;
    const customerTerm = `%${options.customer.toLowerCase()}%`;
    query.andWhere(
        new Brackets(where => {
            where
                .where('LOWER(customer.emailAddress) LIKE :customerTerm', { customerTerm })
                .orWhere('LOWER(customer.firstName) LIKE :customerTerm', { customerTerm })
                .orWhere('LOWER(customer.lastName) LIKE :customerTerm', { customerTerm });
            if (/^\d+$/u.test(options.customer)) {
                where.orWhere('customer.id = :customerId', { customerId: options.customer });
            }
        }),
    );
}

export function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
        const key = keyFor(item);
        grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return grouped;
}

export function appendWalletTimeline(timeline: UsageTimelineItem[], wallet: ReferralWalletUsage): void {
    timeline.push({
        at: wallet.reservedAt,
        stage: '余额预冻结',
        status: '已冻结',
        amount: wallet.amount,
        currencyCode: wallet.currencyCode,
        costMicrounits: null,
        message: `余额使用记录 ${String(wallet.id)}`,
        keyName: null,
        keyLast4: null,
    });
    if (!wallet.settledAt) return;
    timeline.push({
        at: wallet.settledAt,
        stage: '余额结算',
        status: wallet.releasedAmount > 0 && wallet.capturedAmount === 0 ? '已退回' : '已结算',
        amount: wallet.capturedAmount,
        currencyCode: wallet.currencyCode,
        costMicrounits: null,
        message: `实扣 ${wallet.capturedAmount} · 退回 ${wallet.releasedAmount}`,
        keyName: null,
        keyLast4: null,
    });
}

export function sortUsageTimeline(items: UsageTimelineItem[]): UsageTimelineItem[] {
    return items.sort((left, right) => left.at.getTime() - right.at.getTime());
}

export function usageOutcomeZh(value: string): string {
    return (
        (
            {
                QUEUED: '排队中',
                RUNNING: '进行中',
                PARTIAL_SUCCESS: '部分成功',
                SUCCEEDED: '成功',
                FAILED: '失败',
                UNKNOWN: '结果待确认',
                CANCELLED: '已取消',
                RETRY: '已重试',
            } as Record<string, string>
        )[value] ?? value
    );
}

export function billingModeZhForAudit(value: string): string {
    return (
        (
            {
                FREE: '免费额度',
                PAID: '付费',
                MIXED: '免费+付费',
                PENDING: '待结算',
                RELEASED: '已释放',
                REFUNDED: '已退款',
            } as Record<string, string>
        )[value] ?? value
    );
}

export function quotaTypeZh(value: string): string {
    return (
        (
            {
                PROMPT_MINUTE: '提示词每分钟额度',
                PROMPT_DAILY_FREE: '提示词每日免费额度',
                IMAGE_DAILY_FREE: '每日免费生图额度',
                IMAGE_DAILY_SAFETY: '每日生图安全上限',
            } as Record<string, string>
        )[value] ?? value
    );
}

export function uniqueReferenceAssetIds(input: CreateImageGenerationInput): ID[] {
    const unique = new Map<string, ID>();
    for (const id of [...(input.referenceAssetIds ?? []), input.referenceAssetId]) {
        if (id === null || id === undefined || !String(id).trim()) continue;
        if (!unique.has(String(id))) unique.set(String(id), id);
    }
    return [...unique.values()];
}

export function storedReferenceAssetIds(job: ImageGenerationJob): string[] {
    const snapshotIds = job.promptSpec?.referenceAssetIds;
    if (Array.isArray(snapshotIds)) {
        const ids = snapshotIds.map(String).filter(Boolean);
        if (ids.length) return ids;
    }
    return job.referenceAssetId ? [String(job.referenceAssetId)] : [];
}

export function storedReferenceInstruction(job: ImageGenerationJob): string {
    const value = job.promptSpec?.referenceInstruction;
    return typeof value === 'string' ? value : '';
}

export function publicOutputError(output: ImageGenerationOutput): string | null {
    if (!output.errorMessage) return null;
    if (output.failureCode === 'UNKNOWN_RESULT' && output.state === 'FAILED') {
        return '生成结果在 15 分钟内无法确认，已自动退回本张费用';
    }
    return (
        (
            {
                QUEUE_DISPATCH: '任务暂时无法进入队列，本张费用已退回，请稍后重试',
                CREDENTIAL_UNAVAILABLE: '当前生图服务暂不可用，本张费用已退回，请稍后重试',
                UPSTREAM_AUTH: '当前生图服务暂不可用，本张费用已退回，请稍后重试',
                UPSTREAM_RATE_LIMIT: '生图服务繁忙，系统将稍后重试',
                UPSTREAM_TIMEOUT: '生成结果暂时无法确认，系统正在核对，请勿重复提交',
                UPSTREAM_NETWORK: '生成结果暂时无法确认，系统正在核对，请勿重复提交',
                UPSTREAM_HTTP: '生成结果暂时无法确认，系统正在核对，请勿重复提交',
                UPSTREAM_INVALID_RESPONSE: '生图服务返回异常，本张费用已退回，请稍后重试',
                LOCAL_IMAGE_PROCESSING: '图片处理失败，本张费用已退回，请稍后重试',
                IMAGE_TOO_LARGE: '生成图片超过平台大小限制，本张费用已退回',
                IMAGE_RESOLUTION_MISMATCH: '生成图片尺寸不符合所选规格，本张费用已退回',
                STORAGE: '图片保存失败，本张费用已退回，请稍后重试',
                SETTLEMENT: '图片已生成，系统正在恢复结算',
                UNKNOWN_RESULT: '生成结果暂时无法确认，系统正在核对，请勿重复提交',
            } as Record<string, string>
        )[output.failureCode ?? ''] ?? '图片生成未成功，本张费用已释放，请稍后重试'
    );
}

export function normalizeReferenceMode(value?: ImageReferenceMode | null): ImageReferenceMode {
    return value && ['STYLE', 'COMPOSITION', 'IDENTITY', 'PRODUCT', 'EDIT'].includes(value) ? value : 'NONE';
}

export function referenceModeInstruction(
    mode: ImageReferenceMode,
    language: PromptOutputLanguage = 'en',
): string {
    const instructionsEn: Record<ImageReferenceMode, string> = {
        NONE: '',
        STYLE: 'Use the reference only for visual style; do not copy its identity, text, logo, or unrelated objects.',
        COMPOSITION:
            'Preserve the reference composition and spatial layout while following the requested subject and content.',
        IDENTITY:
            'Preserve the consenting adult subject identity and facial features; change only what the user requested.',
        PRODUCT:
            'Preserve the product shape, proportions, materials, colors, labels, and brand details unless explicitly changed.',
        EDIT: 'Edit only the requested regions and preserve all unrequested details from the reference.',
    };
    const instructionsZh: Record<ImageReferenceMode, string> = {
        NONE: '',
        STYLE: '仅参考视觉风格，不复制其人物身份、文字、Logo 或无关物体。',
        COMPOSITION: '保留参考图的构图和空间布局，同时遵循用户要求的主体与内容。',
        IDENTITY: '保留已同意使用的成年人物身份和面部特征，只修改用户明确要求的内容。',
        PRODUCT: '除非用户明确要求改变，否则保留商品外形、比例、材质、颜色、标签和品牌细节。',
        EDIT: '只编辑用户指定的区域，保留参考图中所有未要求修改的细节。',
    };
    return (language === 'zh' ? instructionsZh : instructionsEn)[mode];
}

export function supportsGenerationLock(driverType: unknown): boolean {
    return new Set([
        'aurora-mysql',
        'aurora-postgres',
        'cockroachdb',
        'mariadb',
        'mssql',
        'mysql',
        'oracle',
        'postgres',
    ]).has(String(driverType));
}
