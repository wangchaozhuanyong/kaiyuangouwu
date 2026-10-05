import {
    Building2,
    CircleDollarSign,
    CreditCard,
    Globe2,
    ReceiptText,
    ShieldCheck,
    Store,
    Truck,
    WalletCards,
} from 'lucide-react';
import { AdminField } from '../../components/AdminField';

import { AdminSelect } from '../../components/AdminControls';
import { TabButton } from './settings-ui';
import type { StoreSettingsTab } from './store-settings-state';

export function StoreSettingsNavigation({
    tab,
    onTabChange,
    canReadFinance,
    canReadBusinessSettings,
}: {
    tab: StoreSettingsTab;
    onTabChange: (tab: StoreSettingsTab) => void;
    canReadFinance: boolean;
    canReadBusinessSettings: boolean;
}) {
    const tabs: Array<{ value: StoreSettingsTab; label: string; icon: typeof Store }> = [
        { value: 'STORES', label: '店铺实例', icon: Store },
        { value: 'DOMAINS', label: '独立域名', icon: Globe2 },
        { value: 'SELLERS', label: '商家主体', icon: Building2 },
        { value: 'PAYMENT', label: '支付', icon: CreditCard },
        { value: 'SHIPPING', label: '配送', icon: Truck },
        ...(canReadFinance
            ? [
                  { value: 'CURRENCY' as const, label: '币种与汇率', icon: CircleDollarSign },
                  { value: 'USDT' as const, label: 'USDT 收款', icon: WalletCards },
              ]
            : []),
        ...(canReadBusinessSettings
            ? [{ value: 'BUSINESS' as const, label: '业务基础', icon: ReceiptText }]
            : []),
        { value: 'PERMISSION_AUDITS', label: '权限审计记录', icon: ShieldCheck },
    ];
    return (
        <>
            <AdminField label="设置分类" className="admin-mobile-section-select">
                <AdminSelect
                    aria-label="设置分类"
                    value={tab}
                    onChange={event => onTabChange(event.target.value as StoreSettingsTab)}
                    className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                    {tabs.map(item => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </AdminSelect>
            </AdminField>
            <div className="scrollbar-hidden hidden w-max max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 md:flex">
                {tabs.map(({ value, label, icon: Icon }) => (
                    <TabButton
                        key={value}
                        active={tab === value}
                        onClick={() => onTabChange(value)}
                        icon={<Icon className="h-3.5 w-3.5" />}
                    >
                        {label}
                    </TabButton>
                ))}
            </div>
        </>
    );
}
