export type QueryLoadState = 'ready' | 'loading' | 'paused' | 'error';

export interface GlobalProgressQueryState {
    data?: unknown;
    fetchStatus: 'fetching' | 'paused' | 'idle';
}

export function shouldShowGlobalProgress(
    isNavigationPending: boolean,
    criticalQueries: readonly GlobalProgressQueryState[],
): boolean {
    if (isNavigationPending) return true;
    return criticalQueries.some(query => query.fetchStatus === 'fetching' && query.data === undefined);
}

export function resolveQueryLoadState({
    hasData,
    isLoading,
    isPaused,
    isError,
}: {
    hasData: boolean;
    isLoading: boolean;
    isPaused: boolean;
    isError: boolean;
}): QueryLoadState {
    if (hasData) return 'ready';
    if (isPaused) return 'paused';
    if (isLoading) return 'loading';
    if (isError) return 'error';
    return 'loading';
}

export function offlineLoadError(language: 'zh' | 'en'): string {
    return language === 'zh'
        ? '当前网络不可用，请恢复网络后重试'
        : 'You are offline. Reconnect and try again.';
}
