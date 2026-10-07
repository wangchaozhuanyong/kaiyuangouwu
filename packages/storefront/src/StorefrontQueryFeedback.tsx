import { notifyManager, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { storefrontQueryPresentation } from './loading-state';
import { PAGE_LOADING_DELAY_MS } from './page-readiness';
import { isStorefrontQueryInScope, type StorefrontRefreshScope } from './query-client';
import { isStorefrontClosedError } from './storefront-access';
import { storefrontErrorMessage } from './storefront-errors';

/** One non-modal status for active queries, including plugins, in the current store/language. */
export function StorefrontQueryFeedback({
    scope,
    language,
}: {
    scope: StorefrontRefreshScope;
    language: 'zh' | 'en';
}) {
    const client = useQueryClient();
    const cache = client.getQueryCache();
    const subscribe = useCallback(
        (notify: () => void) => cache.subscribe(notifyManager.batchCalls(notify)),
        [cache],
    );
    const activeQueries = () =>
        cache.getAll().filter(query => query.isActive() && isStorefrontQueryInScope(query.queryKey, scope));
    const snapshot = () =>
        activeQueries()
            .map(query =>
                [
                    query.queryHash,
                    query.state.fetchStatus,
                    query.state.status,
                    query.state.dataUpdatedAt,
                    query.state.errorUpdatedAt,
                ].join(':'),
            )
            .join('|');
    useSyncExternalStore(subscribe, snapshot, snapshot);
    // The closed-store boundary has removed usable content and owns its retry UI.
    // Do not describe its retained configuration cache as content still being shown.
    const queries = activeQueries().filter(
        query => !isStorefrontClosedError(query.state.error, query.queryKey[3] === 'config'),
    );
    // Next-page failure belongs to the pagination footer; do not turn it into a page refresh failure.
    const failed = queries.filter(
        query =>
            query.state.data !== undefined &&
            query.state.status === 'error' &&
            query.state.fetchMeta?.fetchMore === undefined,
    );
    const refreshing = queries.some(
        query =>
            storefrontQueryPresentation({
                data: query.state.data,
                error: query.state.error,
                isFetching: query.state.fetchStatus === 'fetching',
            }).refreshing && query.state.fetchMeta?.fetchMore === undefined,
    );
    const [showProgress, setShowProgress] = useState(false);
    const identity = `${scope.marketCode}:${scope.languageCode}`;
    const failureKey = `${identity}:${failed.map(query => `${query.queryHash}:${query.state.errorUpdatedAt}`).join('|')}`;
    const [dismissed, setDismissed] = useState('');
    useEffect(() => {
        setShowProgress(false);
        if (!refreshing) return;
        const timer = window.setTimeout(() => setShowProgress(true), PAGE_LOADING_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [refreshing, identity]);
    const showError = failed.length > 0 && dismissed !== failureKey;
    const retrying = failed.some(query => query.state.fetchStatus === 'fetching');
    if (!showError && (!refreshing || !showProgress)) return null;
    const isZh = language === 'zh';
    return (
        <aside
            className="storefront-query-feedback"
            data-query-feedback={showError ? 'error' : 'refreshing'}
            aria-label={isZh ? '数据更新状态' : 'Data update status'}
        >
            <span role={showError ? 'alert' : 'status'} aria-live={showError ? 'assertive' : 'polite'}>
                {showError
                    ? isZh
                        ? '更新失败，已保留上次内容。'
                        : 'Update failed. Previous content is still shown.'
                    : isZh
                      ? '正在更新…'
                      : 'Updating…'}
                {showError && <small>{storefrontErrorMessage(failed[0].state.error, language)}</small>}
            </span>
            {showError && (
                <>
                    <button
                        type="button"
                        disabled={retrying}
                        aria-busy={retrying}
                        onClick={() =>
                            void client.refetchQueries(
                                {
                                    predicate: query =>
                                        failed.includes(query) &&
                                        query.isActive() &&
                                        isStorefrontQueryInScope(query.queryKey, scope),
                                },
                                { cancelRefetch: false },
                            )
                        }
                    >
                        <RefreshCw aria-hidden="true" />
                        {isZh ? '重试' : 'Retry'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setDismissed(failureKey)}
                        aria-label={isZh ? '关闭更新提示' : 'Dismiss update notice'}
                    >
                        ×
                    </button>
                </>
            )}
        </aside>
    );
}
