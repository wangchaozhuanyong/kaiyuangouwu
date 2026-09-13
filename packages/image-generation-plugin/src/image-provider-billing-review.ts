import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';

export type BillingReviewTarget = 'IMAGE_COST_EVENT' | 'LEGACY_PROMPT';
export interface ReviewedSupplierBill {
    supplierScope: string;
    billId: string;
    amountMicrounits: number;
    currency: string;
    billedAt: string | null;
    displayedTime: string;
    timeZone: string | null;
    evidenceHash: string;
}
export interface ImageBillingReview {
    batchId: string;
    channelId: string;
    recordType: BillingReviewTarget;
    recordId: string;
    expectedSnapshotHash: string;
    previousAdjustmentId: string | null;
    sourceHash: string;
    reviewer: string;
    authorizationRef: string;
    reviewedAt: string;
    reason: string;
    reviewStatus: 'APPROVED';
    completeRange: true;
    newCostMicrounits: number | null;
    newCurrency: string | null;
    bills: ReviewedSupplierBill[];
}

const targets = {
    IMAGE_COST_EVENT: {
        table: 'image_generation_cost_event',
        fields: [
            'id',
            'channelId',
            'createdAt',
            'updatedAt',
            'jobIdSnapshot',
            'outputIdSnapshot',
            'attemptNumber',
            'modelCodeSnapshot',
            'credentialCodeSnapshot',
            'outcome',
            'actualCostMicrounits',
            'costCurrency',
            'costSource',
            'callId',
            'providerRequestId',
            'headerRequestId',
            'modelResponseId',
        ],
    },
    LEGACY_PROMPT: {
        table: 'image_prompt_optimization',
        fields: [
            'id',
            'channelId',
            'createdAt',
            'updatedAt',
            'source',
            'optimizerModelId',
            'credentialCodeSnapshot',
            'attemptLedgerVersion',
            'upstreamCallCount',
            'actualCostMicrounits',
            'costCurrency',
            'providerRequestId',
        ],
    },
} as const;

function requireValue(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
function text(value: unknown, max: number) {
    requireValue(
        typeof value === 'string' &&
            value.length > 0 &&
            value.length <= max &&
            value === value.trim() &&
            !/[\u0000-\u001f\u007f]/u.test(value),
        '审定文本字段无效',
    );
}
function hash(value: unknown) {
    requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value), '证据摘要无效');
}
function money(amount: unknown, currency: unknown, nullable: boolean) {
    if (nullable && amount === null && currency === null) return;
    requireValue(
        Number.isSafeInteger(amount) && Number(amount) >= 0 && Number(amount) <= 2_147_483_647,
        '费用必须是非负的整数微单位',
    );
    requireValue(typeof currency === 'string' && /^[A-Z]{3}$/u.test(currency), '费用币种无效');
}
function timestamp(value: unknown) {
    requireValue(
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)),
        '审定或账单时间无效',
    );
}

export function billingEvidenceHash(value: unknown): string {
    const canonical = (item: unknown): unknown => {
        if (item instanceof Date) return item.toISOString();
        if (Array.isArray(item)) return item.map(canonical);
        if (item && typeof item === 'object') {
            return Object.fromEntries(
                Object.entries(item)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, child]) => [key, canonical(child)]),
            );
        }
        return item;
    };
    return createHash('sha256')
        .update(JSON.stringify(canonical(value)))
        .digest('hex');
}
export function billingTargetKey(channelId: string, recordType: BillingReviewTarget, recordId: string) {
    return billingEvidenceHash([channelId, recordType, recordId]);
}
function billKey(bill: ReviewedSupplierBill) {
    // A digest gives case-sensitive identity even on MySQL's default case-insensitive collation.
    return billingEvidenceHash([bill.supplierScope, bill.billId]);
}
export function validateBillingReview(review: ImageBillingReview) {
    requireValue(
        review && Object.prototype.hasOwnProperty.call(targets, review.recordType),
        '费用审定目标类型无效',
    );
    text(review.channelId, 64);
    text(review.recordId, 64);
    text(review.batchId, 128);
    text(review.reviewer, 128);
    text(review.authorizationRef, 500);
    text(review.reason, 500);
    if (review.previousAdjustmentId !== null) text(review.previousAdjustmentId, 64);
    hash(review.expectedSnapshotHash);
    hash(review.sourceHash);
    timestamp(review.reviewedAt);
    requireValue(
        review.reviewStatus === 'APPROVED' && review.completeRange === true,
        '必须先批准账单关联并确认费用范围完整',
    );
    money(review.newCostMicrounits, review.newCurrency, true);
    requireValue(
        review.newCostMicrounits !== null || review.previousAdjustmentId !== null,
        '初次审定不能把未知费用记为已核实',
    );
    requireValue(
        Array.isArray(review.bills) && review.bills.length > 0 && review.bills.length <= 100,
        '必须提供本次审定的供应商账单',
    );
    const keys = new Set<string>();
    let total = 0;
    for (const bill of review.bills) {
        text(bill.supplierScope, 128);
        text(bill.billId, 200);
        hash(bill.evidenceHash);
        if (bill.billedAt !== null) timestamp(bill.billedAt);
        text(bill.displayedTime, 64);
        if (bill.timeZone !== null) text(bill.timeZone, 48);
        money(bill.amountMicrounits, bill.currency, false);
        requireValue(!keys.has(billKey(bill)), '审定中存在重复账单');
        keys.add(billKey(bill));
        total += bill.amountMicrounits;
        if (review.newCurrency) requireValue(bill.currency === review.newCurrency, '不能混合不同币种');
    }
    if (review.newCostMicrounits !== null)
        requireValue(total === review.newCostMicrounits, '账单合计与审定金额不符');
}

async function readTarget(
    manager: EntityManager,
    channelId: string,
    recordType: BillingReviewTarget,
    recordId: string,
    lock: boolean,
) {
    requireValue(Object.prototype.hasOwnProperty.call(targets, recordType), '费用审定目标类型无效');
    const spec = targets[recordType];
    const escape = (name: string) => manager.connection.driver.escape(name);
    const query = manager
        .createQueryBuilder()
        .select(spec.fields.map(field => `target.${escape(field)}`))
        .from(spec.table, 'target')
        .where(`target.${escape('id')} = :recordId`, { recordId })
        .andWhere(`target.${escape('channelId')} = :channelId`, { channelId });
    if (lock) query.setLock('pessimistic_write');
    const target = await query.getRawOne<Record<string, any>>();
    requireValue(
        target && String(target.channelId) === channelId && String(target.id) === recordId,
        '目标不存在或不属于指定频道',
    );
    if (recordType === 'LEGACY_PROMPT') {
        requireValue(
            target.attemptLedgerVersion === null &&
                target.source !== 'PENDING' &&
                target.upstreamCallCount > 0,
            '只允许审定已结束且有历史调用的旧提示词记录',
        );
    }
    return target;
}

export async function inspectImageBillingTarget(
    source: DataSource,
    channelId: string,
    recordType: BillingReviewTarget,
    recordId: string,
) {
    const target = await readTarget(source.manager, channelId, recordType, recordId, false);
    const key = billingTargetKey(channelId, recordType, recordId);
    const latest = await source.manager
        .createQueryBuilder()
        .select('*')
        .from('image_provider_cost_adjustment', 'adjustment')
        .where('adjustment.targetKey = :key', { key })
        .orderBy('adjustment.id', 'DESC')
        .getRawOne();
    return {
        target,
        snapshotHash: billingEvidenceHash(target),
        previousAdjustmentId: latest ? String(latest.id) : null,
    };
}

/** Trusted operator entry point. No public mutation; defaults to validating without writing. */
export async function applyImageBillingReview(source: DataSource, review: ImageBillingReview, apply = false) {
    validateBillingReview(review);
    if (apply)
        requireValue(['mysql', 'mariadb'].includes(source.options.type), '费用写入需要支持行锁的数据库');
    const key = billingTargetKey(review.channelId, review.recordType, review.recordId);
    const bills = [...review.bills].sort((a, b) => billKey(a).localeCompare(billKey(b)));
    const entryHash = billingEvidenceHash({ ...review, bills });
    return source.transaction(async manager => {
        // Lock the business target before testing idempotency or appending a correction.
        const target = await readTarget(manager, review.channelId, review.recordType, review.recordId, apply);
        const history = await manager
            .createQueryBuilder()
            .select('*')
            .from('image_provider_cost_adjustment', 'adjustment')
            .where('adjustment.targetKey = :key', { key })
            .orderBy('adjustment.id', 'DESC')
            .getRawMany();
        const existing = history.find(item => item.batchId === review.batchId);
        if (existing) {
            requireValue(existing.entryHash === entryHash, '同一批次内容已改变，拒绝覆盖');
            const superseded = existing.id !== history[0].id;
            if (!superseded)
                requireValue(
                    target.actualCostMicrounits === existing.newCostMicrounits &&
                        target.costCurrency === existing.newCurrency,
                    '已审定费用被外部更改，需追加更正',
                );
            return {
                status: 'ALREADY_APPLIED',
                adjustmentId: String(existing.id),
                targetKey: key,
                superseded,
            };
        }
        requireValue(
            (history[0] ? String(history[0].id) : null) === review.previousAdjustmentId,
            '审定版本已变化，请重新核对',
        );
        requireValue(
            billingEvidenceHash(target) === review.expectedSnapshotHash,
            '旧值或目标证据已变化，拒绝覆盖',
        );
        const links = await manager
            .createQueryBuilder()
            .select('*')
            .from('image_provider_billing_link', 'link')
            .where('link.billKey IN (:...keys) OR link.targetKey = :key', { keys: bills.map(billKey), key })
            .getRawMany();
        for (const link of links) requireValue(link.targetKey === key, '供应商账单已归属其他业务记录');
        if (history.length) {
            requireValue(
                links.length === bills.length &&
                    links.every(link => bills.some(bill => billKey(bill) === link.billKey)),
                '更正必须保留原账单归属；不能增删或重新分配账单',
            );
        } else requireValue(links.length === 0, '目标存在未关联的账单归属，需人工排查');
        if (!apply) return { status: 'DRY_RUN', adjustmentId: null, targetKey: key };

        const now = new Date();
        const matchingStatus = review.newCostMicrounits === null ? 'COST_REVERTED' : 'CROSS_MATCH_REVIEWED';
        await insertAuditRow(manager, 'image_provider_cost_adjustment', {
            createdAt: now,
            updatedAt: now,
            channelId: review.channelId,
            targetKey: key,
            recordType: review.recordType,
            recordIdSnapshot: review.recordId,
            batchId: review.batchId,
            reviewer: review.reviewer,
            authorizationRef: review.authorizationRef,
            reason: review.reason,
            reviewedAt: new Date(review.reviewedAt),
            oldValueHash: review.expectedSnapshotHash,
            sourceHash: review.sourceHash,
            entryHash,
            previousAdjustmentId: review.previousAdjustmentId,
            oldCostMicrounits: target.actualCostMicrounits,
            oldCurrency: target.costCurrency,
            newCostMicrounits: review.newCostMicrounits,
            newCurrency: review.newCurrency,
            supplierBills: JSON.stringify(bills),
            matchingStatus,
        });
        const adjustment = await manager
            .createQueryBuilder()
            .select('adjustment.id', 'id')
            .from('image_provider_cost_adjustment', 'adjustment')
            .where('adjustment.targetKey = :key AND adjustment.batchId = :batch', {
                key,
                batch: review.batchId,
            })
            .getRawOne();
        requireValue(adjustment, '审定记录未保存');
        if (!history.length) {
            for (const bill of bills)
                await insertAuditRow(manager, 'image_provider_billing_link', {
                    createdAt: now,
                    updatedAt: now,
                    billKey: billKey(bill),
                    targetKey: key,
                    supplierScope: bill.supplierScope,
                    billId: bill.billId,
                    adjustmentIdSnapshot: String(adjustment.id),
                });
        }
        // Do not alter original timestamps, request IDs, provider evidence, customer money, quotas or outcomes.
        const updated = await manager
            .createQueryBuilder()
            .update(targets[review.recordType].table)
            .set({
                actualCostMicrounits: review.newCostMicrounits,
                costCurrency: review.newCurrency,
                updatedAt: () => manager.connection.driver.escape('updatedAt'),
            })
            .where('id = :id AND channelId = :channelId', {
                id: review.recordId,
                channelId: review.channelId,
            })
            .execute();
        requireValue(updated.affected === 1, '费用目标更新数量异常');
        return { status: 'APPLIED', adjustmentId: String(adjustment.id), targetKey: key };
    });
}

// Do not pass pre-serialized JSON through EntityManager.insert: a registered simple-json entity
// would serialize it again, while the standalone operator connection has no entity metadata.
async function insertAuditRow(manager: EntityManager, table: string, values: Record<string, unknown>) {
    const escape = (name: string) => manager.connection.driver.escape(name);
    const columns = Object.keys(values);
    await manager.query(
        `INSERT INTO ${escape(table)} (${columns.map(escape).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        columns.map(column => values[column]),
    );
}
