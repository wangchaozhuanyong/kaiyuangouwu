// organize-imports-ignore -- Preserve the ESLint type-import groups.
import type { QueryLoadState } from '../../loading-state';
import type { StorefrontLanguage } from '../../types';
import { useEffect, useState } from 'react';

import { BrandLoadingIndicator } from '../../brand-loading';
import { PAGE_LOADING_DELAY_MS } from '../../page-readiness';

export interface CustomerOrdersStatusProps {
    recentOrdersState?: QueryLoadState;
    recentOrdersError?: string;
    onRetryRecentOrders?: () => void;
    language: StorefrontLanguage;
}

/** A history read never replaces the already resolved customer identity. */
export function CustomerOrdersStatus({
    recentOrdersState = 'ready',
    recentOrdersError,
    onRetryRecentOrders,
    language,
}: CustomerOrdersStatusProps) {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        setVisible(false);
        if (recentOrdersState !== 'loading') return;
        const timer = window.setTimeout(() => setVisible(true), PAGE_LOADING_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [recentOrdersState]);
    if (recentOrdersState === 'ready' || (recentOrdersState === 'loading' && !visible)) return null;
    const isZh = language === 'zh';
    return (
        <p className="desktop-account-query-error" role="status">
            {recentOrdersState === 'loading' ? (
                <BrandLoadingIndicator
                    local
                    language={language}
                    label={isZh ? '正在读取订单' : 'Loading orders'}
                />
            ) : (
                <>
                    <span>
                        {recentOrdersError ||
                            (isZh ? '最近订单暂时无法读取' : 'Recent orders are unavailable')}
                    </span>
                    <button type="button" onClick={onRetryRecentOrders}>
                        {isZh ? '重试' : 'Retry'}
                    </button>
                </>
            )}
        </p>
    );
}
