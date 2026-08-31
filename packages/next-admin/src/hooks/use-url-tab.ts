import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useUrlTab<T extends string>(
  tabs: Record<string, T>,
  defaultKey: string,
  parameter = 'tab',
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultTab = tabs[defaultKey];
  if (!defaultTab) throw new Error(`Unknown default tab: ${defaultKey}`);

  const selectedKey = searchParams.get(parameter) ?? defaultKey;
  const activeTab = tabs[selectedKey] ?? defaultTab;

  const setActiveTab = useCallback((nextTab: T) => {
    const nextKey = Object.entries(tabs).find(([, value]) => value === nextTab)?.[0] ?? defaultKey;
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (nextKey === defaultKey) next.delete(parameter);
      else next.set(parameter, nextKey);
      return next;
    }, { replace: true });
  }, [defaultKey, parameter, setSearchParams, tabs]);

  return [activeTab, setActiveTab] as const;
}
