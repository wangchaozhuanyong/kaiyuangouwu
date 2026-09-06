import {
    PromotionProductRecord,
    StoreCouponKind,
    StoreCouponRecord,
    StoreFlashSaleRecord,
} from '../../graphql/marketing.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime, formatMoney, majorInputToMoney } from '../Sales/sales-utils';

export type SensitiveAction =
    | { kind: 'TOGGLE'; id: string; name: string; enabled: boolean }
    | { kind: 'STOP'; id: string; name: string }
    | { kind: 'REVOKE'; id: string; name: string; affectedCount: number }
    | { kind: 'ARCHIVE'; id: string; name: string; claimedCount: number }
    | { kind: 'DELETE'; id: string; name: string; subject: '优惠券' | '秒杀' };

export type CampaignDetail =
    { type: 'COUPON'; item: StoreCouponRecord } | { type: 'FLASH_SALE'; item: StoreFlashSaleRecord };

export type CouponVisibility = 'CURRENT' | 'ACTIVE' | 'ENDED' | 'ARCHIVED' | 'ALL';

export interface CouponDraft {
    name: string;
    kind: StoreCouponKind;
    minimumSpend: string;
    discountValue: string;
    startsAt: string;
    endsAt: string;
    claimStartsAt: string;
    claimEndsAt: string;
    validityDays: string;
    issueLimit: string;
    stackPolicy: 'EXCLUSIVE' | 'STACKABLE';
    returnOnCancellation: boolean;
    returnOnFullRefund: boolean;
    collectionIds: string[];
    productIds: string[];
}

export interface FlashDraft {
    name: string;
    percentageOff: string;
    startsAt: string;
    endsAt: string;
    productIds: string[];
    variantPrices: Record<string, string>;
}

export const couponKindLabels: Record<StoreCouponKind, string> = {
    ORDER_FIXED: '满减券',
    ORDER_PERCENTAGE: '订单折扣券',
    COLLECTION_PERCENTAGE: '分类折扣券',
    PRODUCT_PERCENTAGE: '单品折扣券',
};

export const ledgerLabels: Record<string, string> = {
    CLAIMED: '已领取',
    LOCKED: '订单锁定',
    RELEASED: '已释放',
    REDEEMED: '已核销',
    RETURNED: '已返还',
    EXPIRED: '已过期',
    REVOKED: '已作废',
    REFUND_SETTLED: '退款完成',
};

export const PAGE_SIZE = 50;

export function newCouponDraft(): CouponDraft {
    const range = defaultDateRange();
    return {
        name: '',
        kind: 'ORDER_FIXED',
        minimumSpend: '0',
        discountValue: '1',
        startsAt: range.start,
        endsAt: range.end,
        claimStartsAt: range.start,
        claimEndsAt: range.end,
        validityDays: '7',
        issueLimit: '100',
        stackPolicy: 'EXCLUSIVE',
        returnOnCancellation: true,
        returnOnFullRefund: true,
        collectionIds: [],
        productIds: [],
    };
}

export function newFlashDraft(): FlashDraft {
    const range = defaultDateRange();
    return {
        name: '',
        percentageOff: '20',
        startsAt: range.start,
        endsAt: range.end,
        productIds: [],
        variantPrices: {},
    };
}

export function defaultDateRange() {
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 86_400_000);
    return { start: localDateTime(start), end: localDateTime(end) };
}

export function defaultReportFilter() {
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 86_400_000);
    return { from: localDate(from), to: localDate(to), campaignId: 'ALL' };
}

export function localDate(date: Date) {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function localDateTime(date: Date) {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function dateInput(value: string) {
    return value ? new Date(value).toISOString() : null;
}

export function reportDateStart(value: string) {
    return new Date(`${value}T00:00:00`).toISOString();
}

export function reportDateEnd(value: string) {
    return new Date(new Date(`${value}T00:00:00`).getTime() + 86_400_000).toISOString();
}

export function validReportFilter(value: ReturnType<typeof defaultReportFilter>) {
    const from = Date.parse(value.from);
    const to = Date.parse(value.to);
    return Boolean(
        value.from &&
        value.to &&
        Number.isFinite(from) &&
        Number.isFinite(to) &&
        from <= to &&
        to - from <= 365 * 86_400_000,
    );
}

export function couponDraftError(draft: CouponDraft) {
    if (!draft.name.trim()) return '请填写活动名称';
    if (Number(draft.minimumSpend) < 0) return '最低消费金额不能小于0';
    if (
        draft.kind === 'ORDER_FIXED'
            ? Number(draft.discountValue) <= 0
            : Number(draft.discountValue) <= 0 || Number(draft.discountValue) >= 10
    )
        return draft.kind === 'ORDER_FIXED' ? '减免金额必须大于0' : '折扣必须大于0折并小于10折';
    if (!draft.issueLimit || Number(draft.issueLimit) < 1) return '发放总量必须大于0';
    if (!draft.validityDays || Number(draft.validityDays) < 1) return '有效天数必须大于0';
    if (Date.parse(draft.claimStartsAt) >= Date.parse(draft.claimEndsAt))
        return '领取结束时间必须晚于开始时间';
    if (draft.kind === 'COLLECTION_PERCENTAGE' && !draft.collectionIds.length)
        return '请选择至少一个适用分类';
    if (draft.kind === 'PRODUCT_PERCENTAGE' && !draft.productIds.length) return '请选择至少一个适用商品';
    return '';
}

export function flashDraftError(draft: FlashDraft, products: PromotionProductRecord[], currencyCode: string) {
    if (!draft.name.trim()) return '请填写活动名称';
    if (!draft.productIds.length) return '请选择至少一个秒杀商品';
    if (draft.productIds.length > 50) return '一个秒杀活动最多选择50个商品';
    const rate = Number(draft.percentageOff);
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 100) return '降价比例必须大于0%且小于100%';
    if (Date.parse(draft.startsAt) >= Date.parse(draft.endsAt)) return '结束时间必须晚于开始时间';
    for (const product of products)
        for (const variant of product.variants) {
            const value = draft.variantPrices[variant.id]?.trim();
            if (!value) continue;
            const amount = majorInputToMoney(value, variant.currencyCode || currencyCode);
            if (amount == null || amount >= variant.priceWithTax)
                return `“${product.name} / ${variant.name}”的秒杀价必须低于原价`;
        }
    return '';
}

export function couponIsActive(coupon: StoreCouponRecord) {
    const now = Date.now();
    const start = coupon.claimStartsAt ? Date.parse(coupon.claimStartsAt) : null;
    const end = coupon.claimEndsAt ? Date.parse(coupon.claimEndsAt) : null;
    return coupon.enabled && (!start || start <= now) && (!end || end > now);
}

export function couponRule(coupon: StoreCouponRecord, currencyCode: string) {
    const threshold = coupon.minimumSpend ? `满 ${formatMoney(coupon.minimumSpend, currencyCode)}` : '无门槛';
    return coupon.kind === 'ORDER_FIXED'
        ? `${threshold}减 ${formatMoney(coupon.discountAmount ?? 0, currencyCode)}`
        : `${threshold}享 ${coupon.discountRate ?? '—'} 折`;
}

export function dateRange(start: string | null, end: string | null) {
    return `${start ? formatDateTime(start) : '立即'} 至 ${end ? formatDateTime(end) : '长期'}`;
}

export function formatRate(value: number, total: number) {
    return total ? `${((value / total) * 100).toFixed(1)}%` : '0%';
}

export function sum(items: StoreCouponRecord[], field: keyof StoreCouponRecord) {
    return items.reduce(
        (total, item) => total + (typeof item[field] === 'number' ? (item[field] as number) : 0),
        0,
    );
}

export function errorText(error: unknown) {
    return toUserFacingError(error, '操作失败，请稍后重试');
}

export function sensitiveSuccessMessage(action: SensitiveAction) {
    if (action.kind === 'TOGGLE') return action.enabled ? '秒杀活动已启用' : '秒杀活动已停用';
    if (action.kind === 'STOP') return '优惠券已停止发放，客户已领取券仍可按原规则使用';
    if (action.kind === 'REVOKE') return `未使用优惠券已作废（预计影响 ${action.affectedCount} 张）`;
    if (action.kind === 'ARCHIVE') return '优惠券活动已归档，已领取券、订单和财务流水已保留';
    return `${action.subject}活动已删除`;
}

export function sensitiveCopy(action: SensitiveAction) {
    if (action.kind === 'TOGGLE')
        return {
            title: action.enabled ? '启用秒杀活动' : '停用秒杀活动',
            description: '该操作会立即改变商城展示与结算规则。',
            impact: action.enabled ? '启用后将在活动时间内生效。' : '停用后新订单不再享受秒杀价。',
            confirmLabel: action.enabled ? '确认启用' : '确认停用',
        };
    if (action.kind === 'STOP')
        return {
            title: '停止发放优惠券',
            description: '停止新的领取，但不会伤害客户已有权益。',
            impact: '已领取优惠券仍可在有效期内使用。',
            confirmLabel: '确认停止发放',
        };
    if (action.kind === 'REVOKE')
        return {
            title: '批量作废未使用优惠券',
            description: '这是不可逆的客户权益变更。',
            impact: `预计作废 ${action.affectedCount} 张可用券，已核销券不受影响。`,
            confirmLabel: '确认批量作废',
        };
    if (action.kind === 'ARCHIVE')
        return {
            title: '归档优惠券活动',
            description: '归档会从默认活动列表移除，但不删除业务数据。',
            impact: `已领取 ${action.claimedCount} 张券的客户权益、订单核销和财务流水将继续保留；同时停止新领取。`,
            confirmLabel: '确认归档',
        };
    return {
        title: `删除${action.subject}活动`,
        description: '仅未产生受保护业务数据的活动允许删除。',
        impact: '删除后该活动将不再显示，后端会阻止删除已发放优惠券。',
        confirmLabel: '确认删除',
    };
}
