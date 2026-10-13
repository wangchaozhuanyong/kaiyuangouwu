import React from 'react';
import type { StoreCouponRecord } from '../../src/graphql/marketing.graphql';
import { CouponAppearanceDialog } from '../../src/pages/Marketing/promotion-actions';
import { CouponList } from '../../src/pages/Marketing/promotion-lists';
import { couponAppearanceOptions } from '../../src/pages/Marketing/promotion-model';

const noop = () => undefined;
const sampleCoupons: StoreCouponRecord[] = couponAppearanceOptions.map((option, index) => ({
    id: `local-coupon-${index}`,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
    name: `${option.label}示例券`,
    couponCode: `LOCAL_COLOR_${index}`,
    kind: 'ORDER_FIXED',
    appearanceTheme: option.value === 'default' ? null : option.value,
    enabled: true,
    startsAt: null,
    endsAt: null,
    minimumSpend: 10_000,
    discountAmount: 5_000,
    discountRate: null,
    collectionIds: [],
    productVariantIds: [],
    usageLimit: 100,
    perCustomerUsageLimit: 1,
    claimStartsAt: null,
    claimEndsAt: null,
    validityDays: 7,
    issueLimit: 100,
    perCustomerClaimLimit: 1,
    stackPolicy: 'EXCLUSIVE',
    returnOnCancellation: true,
    returnOnFullRefund: true,
    archivedAt: null,
    remainingIssueCount: 99,
    claimedCount: 1,
    availableCount: 1,
    lockedCount: 0,
    usedCount: 0,
    returnedCount: 0,
    expiredCount: 0,
    revokedCount: 0,
    redeemedOrderCount: 0,
    refundedOrderCount: 0,
    discountAmountTotal: 0,
    assistedRevenueTotal: 0,
}));

/** Real list and editor, with only local synthetic state and no API writes. */
export function CouponAppearanceFixture() {
    const [coupons, setCoupons] = React.useState(sampleCoupons);
    const [editing, setEditing] = React.useState<StoreCouponRecord | null>(null);
    const [saves, setSaves] = React.useState(0);
    return (
        <div className="space-y-4 p-4">
            <p className="text-sm text-slate-600">真实券面预览组件 · 合成优惠券 · 保存只更新本地样例</p>
            <output className="block text-xs text-slate-500" aria-live="polite">
                本地保存次数：{saves}
            </output>
            <CouponList
                coupons={coupons}
                currencyCode="CNY"
                actionPending={false}
                onCreate={noop}
                onCopy={noop}
                onGrant={noop}
                onView={noop}
                onRename={noop}
                onAppearance={setEditing}
                onSensitive={noop}
            />
            {editing && (
                <CouponAppearanceDialog
                    coupon={editing}
                    pending={false}
                    error=""
                    onClose={() => setEditing(null)}
                    onConfirm={async theme => {
                        setCoupons(current =>
                            current.map(coupon =>
                                coupon.id === editing.id ? { ...coupon, appearanceTheme: theme } : coupon,
                            ),
                        );
                        setSaves(current => current + 1);
                        setEditing(null);
                    }}
                />
            )}
        </div>
    );
}
