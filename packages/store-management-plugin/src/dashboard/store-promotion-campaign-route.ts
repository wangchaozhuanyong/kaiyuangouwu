import {
    StoreCouponKind,
    StoreCouponLedgerRecord,
    StoreCouponRecord,
} from './store-promotion-campaign.graphql';

export const couponViews = ['campaigns', 'report', 'ledger'] as const;
export type CouponView = (typeof couponViews)[number];

export const couponStatusFilters = ['ALL', 'ACTIVE', 'SCHEDULED', 'EXHAUSTED', 'STOPPED'] as const;
export type CouponStatusFilter = (typeof couponStatusFilters)[number];
export type CouponIssuanceStatus = Exclude<CouponStatusFilter, 'ALL'>;

export const couponKindFilters = [
    'ALL',
    'ORDER_FIXED',
    'ORDER_PERCENTAGE',
    'COLLECTION_PERCENTAGE',
    'PRODUCT_PERCENTAGE',
] as const satisfies ReadonlyArray<'ALL' | StoreCouponKind>;
export type CouponKindFilter = (typeof couponKindFilters)[number];

export const couponLedgerEvents = [
    'ALL',
    'CLAIMED',
    'LOCKED',
    'RELEASED',
    'REDEEMED',
    'RETURNED',
    'EXPIRED',
    'REVOKED',
    'REFUND_SETTLED',
] as const satisfies ReadonlyArray<'ALL' | StoreCouponLedgerRecord['eventType']>;
export type CouponLedgerEventFilter = (typeof couponLedgerEvents)[number];

export interface CouponRouteSearch {
    view: CouponView;
    q: string;
    kind: CouponKindFilter;
    status: CouponStatusFilter;
    campaignId: string;
    eventType: CouponLedgerEventFilter;
    from: string;
    to: string;
    page: number;
}

export function normalizeCouponRouteSearch(
    search: Record<string, unknown>,
    now: Date = new Date(),
): CouponRouteSearch {
    const defaultDates = defaultReportDates(now);
    return {
        view: includes(couponViews, search.view) ? search.view : 'campaigns',
        q: typeof search.q === 'string' ? search.q.slice(0, 120) : '',
        kind: includes(couponKindFilters, search.kind) ? search.kind : 'ALL',
        status: includes(couponStatusFilters, search.status) ? search.status : 'ALL',
        campaignId:
            typeof search.campaignId === 'string' && search.campaignId.trim() ? search.campaignId : 'ALL',
        eventType: includes(couponLedgerEvents, search.eventType) ? search.eventType : 'ALL',
        from: validDateSearch(search.from, defaultDates.from),
        to: validDateSearch(search.to, defaultDates.to),
        page: positiveInteger(search.page),
    };
}

export function couponIssuanceStatus(
    coupon: Pick<StoreCouponRecord, 'enabled' | 'claimStartsAt' | 'claimEndsAt' | 'remainingIssueCount'>,
    now: number = Date.now(),
): CouponIssuanceStatus {
    if (!coupon.enabled) return 'STOPPED';
    if (coupon.remainingIssueCount === 0) return 'EXHAUSTED';
    if (coupon.claimEndsAt && Date.parse(coupon.claimEndsAt) <= now) return 'STOPPED';
    if (coupon.claimStartsAt && Date.parse(coupon.claimStartsAt) > now) return 'SCHEDULED';
    return 'ACTIVE';
}

function defaultReportDates(now: Date): { from: string; to: string } {
    const to = new Date(now);
    const from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1_000);
    return { from: toLocalDate(from), to: toLocalDate(to) };
}

function toLocalDate(value: Date): string {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
}

function validDateSearch(value: unknown, fallback: string): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
    return Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) ? value : fallback;
}

function positiveInteger(value: unknown): number {
    const parsed =
        typeof value === 'number'
            ? value
            : typeof value === 'string'
              ? Number.parseInt(value, 10)
              : Number.NaN;
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(100_000, Math.max(1, Math.floor(parsed)));
}

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
    return typeof value === 'string' && values.includes(value);
}
