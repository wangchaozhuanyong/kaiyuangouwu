import { storefrontErrorMessage } from './storefront-errors';

export type QueryLoadState = 'ready' | 'loading' | 'paused' | 'error';

export interface StorefrontQuerySnapshot {
    data: unknown;
    error: unknown;
    isPending?: boolean;
    isLoading?: boolean;
    isFetching?: boolean;
    isPaused?: boolean;
    isError?: boolean;
    isPlaceholderData?: boolean;
    isFetchingNextPage?: boolean;
    isFetchNextPageError?: boolean;
}

/** Empty arrays and null are resolved data; fetching and failure do not erase them. */
export function storefrontQueryPresentation(query: StorefrontQuerySnapshot) {
    const hasData = query.data !== undefined;
    return {
        hasData,
        initialLoading: !hasData && !query.isPaused && Boolean(query.isPending || query.isLoading),
        initialError: !hasData && Boolean(query.isError),
        paused: !hasData && Boolean(query.isPaused),
        refreshing: hasData && Boolean(query.isFetching) && !query.isFetchingNextPage,
        loadingMore: Boolean(query.isFetchingNextPage),
        refreshError:
            hasData && Boolean(query.isError) && !query.isFetchNextPageError && !query.isPlaceholderData,
    };
}

/** Full-page failure belongs only to an unresolved query. Background failures have shared feedback. */
export function storefrontInitialQueryError(query: StorefrontQuerySnapshot, language: 'zh' | 'en'): string {
    if (query.data !== undefined) return '';
    if (query.isPaused) return offlineLoadError(language);
    return query.error ? storefrontErrorMessage(query.error, language) : '';
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
