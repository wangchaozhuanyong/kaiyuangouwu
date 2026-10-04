import { useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { getStandaloneAdminPage } from '../navigation/admin-navigation';

const EMPTY_RESET_PARAMETERS: string[] = [];

export function useUrlTab<T extends string>(
    tabs: Record<string, T>,
    defaultKey: string,
    parameter = 'tab',
    resetParameters: string[] = EMPTY_RESET_PARAMETERS,
) {
    const [searchParams, setSearchParams] = useSearchParams();
    const location = useLocation();
    const page = getStandaloneAdminPage(location.pathname);
    const defaultTab = tabs[defaultKey];
    if (!defaultTab) throw new Error(`Unknown default tab: ${defaultKey}`);

    const stockStatus =
        page?.sourcePath === '/catalog/inventory' && page.key === 'all' ? searchParams.get('status') : null;
    const selectedKey =
        stockStatus && ['low-stock', 'out-of-stock'].includes(stockStatus)
            ? stockStatus
            : page && page.tabKey in tabs
              ? page.tabKey
              : (searchParams.get(parameter) ?? defaultKey);
    const activeTab = tabs[selectedKey] ?? defaultTab;

    const setActiveTab = useCallback(
        (nextTab: T) => {
            const nextKey = Object.entries(tabs).find(([, value]) => value === nextTab)?.[0] ?? defaultKey;
            setSearchParams(
                current => {
                    const next = new URLSearchParams(current);
                    if (page?.sourcePath === '/catalog/inventory' && page.key === 'all') {
                        if (nextKey === 'all') next.delete('status');
                        else next.set('status', nextKey);
                        next.delete(parameter);
                        return next;
                    }
                    if (nextKey === defaultKey) next.delete(parameter);
                    else next.set(parameter, nextKey);
                    resetParameters.forEach(resetParameter => next.delete(resetParameter));
                    return next;
                },
                { replace: true },
            );
        },
        [defaultKey, parameter, resetParameters, setSearchParams, tabs, page],
    );

    return [activeTab, setActiveTab] as const;
}
