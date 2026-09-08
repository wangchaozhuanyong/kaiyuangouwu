import {
    Building2,
    CircleDollarSign,
    CreditCard,
    Globe2,
    ReceiptText,
    Store,
    Truck,
    WalletCards,
} from 'lucide-react';

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
    return (
        <div className="scrollbar-hidden flex w-max max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
            <TabButton
                active={tab === 'STORES'}
                onClick={() => onTabChange('STORES')}
                icon={<Store className="h-3.5 w-3.5" />}
            >
                店铺实例
            </TabButton>
            <TabButton
                active={tab === 'DOMAINS'}
                onClick={() => onTabChange('DOMAINS')}
                icon={<Globe2 className="h-3.5 w-3.5" />}
            >
                独立域名
            </TabButton>
            <TabButton
                active={tab === 'SELLERS'}
                onClick={() => onTabChange('SELLERS')}
                icon={<Building2 className="h-3.5 w-3.5" />}
            >
                商家主体
            </TabButton>
            <TabButton
                active={tab === 'PAYMENT'}
                onClick={() => onTabChange('PAYMENT')}
                icon={<CreditCard className="h-3.5 w-3.5" />}
            >
                支付
            </TabButton>
            <TabButton
                active={tab === 'SHIPPING'}
                onClick={() => onTabChange('SHIPPING')}
                icon={<Truck className="h-3.5 w-3.5" />}
            >
                配送
            </TabButton>
            {canReadFinance && (
                <TabButton
                    active={tab === 'CURRENCY'}
                    onClick={() => onTabChange('CURRENCY')}
                    icon={<CircleDollarSign className="h-3.5 w-3.5" />}
                >
                    币种与汇率
                </TabButton>
            )}
            {canReadFinance && (
                <TabButton
                    active={tab === 'USDT'}
                    onClick={() => onTabChange('USDT')}
                    icon={<WalletCards className="h-3.5 w-3.5" />}
                >
                    USDT 收款
                </TabButton>
            )}
            {canReadBusinessSettings && (
                <TabButton
                    active={tab === 'BUSINESS'}
                    onClick={() => onTabChange('BUSINESS')}
                    icon={<ReceiptText className="h-3.5 w-3.5" />}
                >
                    业务基础
                </TabButton>
            )}
        </div>
    );
}
