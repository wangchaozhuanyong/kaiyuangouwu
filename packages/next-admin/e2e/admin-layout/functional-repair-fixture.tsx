import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { paymentStateDisplayLabel } from '../../../common/src/system-display-labels';
import { AdminButton, AdminInput } from '../../src/components/AdminControls';
import { AdminField } from '../../src/components/AdminField';
import { FeatureHelpButton, FeatureHelpProvider } from '../../src/components/FeatureHelp';
import '../../src/index.css';
import { getStandaloneAdminPage } from '../../src/navigation/admin-navigation';
import { CouponList, FlashSaleList } from '../../src/pages/Marketing/promotion-lists';
import { CouponLedger } from '../../src/pages/Marketing/promotion-reports';
import { sampleCoupons } from './coupon-appearance-fixture-data';

const noop = () => {};
export default function Fixture() {
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState<'coupons' | 'sales'>('coupons');
    const [campaign, setCampaign] = useState('ALL');
    const [event, setEvent] = useState('ALL');
    const help = getStandaloneAdminPage('/marketing/promotions/ledger')!;
    const sales = [
        {
            id: 'local-sale',
            name: '已有示例秒杀',
            createdAt: '2026-10-25',
            updatedAt: '2026-10-25',
            enabled: true,
            startsAt: null,
            endsAt: null,
            items: [],
        },
    ];
    const listProps = {
        actionPending: false,
        onCreate: noop,
        onRename: noop,
        onView: noop,
        onSensitive: noop,
        onResetFilters: search ? () => setSearch('') : undefined,
    };
    return (
        <main className="space-y-4 bg-slate-50 p-4 text-slate-900">
            <h1>共享功能修复本地验收</h1>
            <p>仅使用本地合成活动与支付状态；无业务接口或写入。</p>
            <p>
                支付流水状态：<strong>{paymentStateDisplayLabel('PendingManual')}</strong>
            </p>
            <div className="flex gap-2">
                <AdminButton
                    onClick={() => {
                        setTab('coupons');
                        setSearch('');
                    }}
                >
                    优惠券
                </AdminButton>
                <AdminButton
                    onClick={() => {
                        setTab('sales');
                        setSearch('');
                    }}
                >
                    秒杀
                </AdminButton>
            </div>
            <AdminField label="搜索营销活动">
                <AdminInput
                    aria-label="搜索营销活动"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </AdminField>
            {tab === 'coupons' ? (
                <CouponList
                    {...listProps}
                    coupons={sampleCoupons.filter(c => c.name.includes(search)).slice(0, 1)}
                    currencyCode="CNY"
                    onCopy={noop}
                    onGrant={noop}
                    onAppearance={noop}
                />
            ) : (
                <FlashSaleList {...listProps} sales={sales.filter(c => c.name.includes(search))} />
            )}
            <h2>
                {help.title} <FeatureHelpButton topic={help.helpTopic} title={help.title} />
            </h2>
            <CouponLedger
                pageSize={20}
                onPageSizeChange={noop}
                coupons={sampleCoupons.slice(0, 1)}
                currencyCode="CNY"
                page={0}
                setPage={noop}
                campaign={campaign}
                setCampaign={setCampaign}
                event={event}
                setEvent={setEvent}
                data={{ items: [], totalItems: 0 }}
                loading={false}
                onRetry={noop}
            />
        </main>
    );
}
createRoot(document.getElementById('root')!).render(
    React.createElement(
        MemoryRouter,
        null,
        React.createElement(FeatureHelpProvider, null, React.createElement(Fixture)),
    ),
);
