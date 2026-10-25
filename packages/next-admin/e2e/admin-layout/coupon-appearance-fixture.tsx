import React from 'react';
import type { StoreCouponRecord } from '../../src/graphql/marketing.graphql';
import { CouponAppearanceDialog } from '../../src/pages/Marketing/promotion-actions';
import { CouponList } from '../../src/pages/Marketing/promotion-lists';
import { sampleCoupons } from './coupon-appearance-fixture-data';

const noop = () => undefined;

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
