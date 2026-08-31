import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const EMPTY_RESET_PARAMETERS: string[] = [];

export function useUrlTab<T extends string>(
    tabs: Record<string, T>,
    defaultKey: string,
    parameter = 'tab',
    resetParameters: string[] = EMPTY_RESET_PARAMETERS,
) {
    const [searchParams, setSearchParams] = useSearchParams();
    const defaultTab = tabs[defaultKey];
    if (!defaultTab) throw new Error(`Unknown default tab: ${defaultKey}`);

    const selectedKey = searchParams.get(parameter) ?? defaultKey;
    const activeTab = tabs[selectedKey] ?? defaultTab;

    const setActiveTab = useCallback(
        (nextTab: T) => {
            const nextKey = Object.entries(tabs).find(([, value]) => value === nextTab)?.[0] ?? defaultKey;
            setSearchParams(
                current => {
                    const next = new URLSearchParams(current);
                    if (nextKey === defaultKey) next.delete(parameter);
                    else next.set(parameter, nextKey);
                    resetParameters.forEach(resetParameter => next.delete(resetParameter));
                    return next;
                },
                { replace: true },
            );
        },
        [defaultKey, parameter, resetParameters, setSearchParams, tabs],
    );

    return [activeTab, setActiveTab] as const;
}
