import { notifyManager, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useCallback, useState, useSyncExternalStore } from 'react';

import { isStorefrontQueryInScope, type StorefrontRefreshScope } from './query-client';
import { storefrontErrorMessage } from './storefront-errors';

/** Keep routine background reads silent; surface recoverable failures in the current store/language. */
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
    const queries = activeQueries();
    // Next-page failure belongs to the pagination footer; do not turn it into a page refresh failure.
    const failed = queries.filter(
        query =>
            query.state.data !== undefined &&
            query.state.status === 'error' &&
            query.state.fetchMeta?.fetchMore === undefined,
    );
    const identity = `${scope.marketCode}:${scope.languageCode}`;
    const failureKey = `${identity}:${failed.map(query => `${query.queryHash}:${query.state.errorUpdatedAt}`).join('|')}`;
    const [dismissed, setDismissed] = useState('');
    const showError = failed.length > 0 && dismissed !== failureKey;
    const retrying = failed.some(query => query.state.fetchStatus === 'fetching');
    if (!showError) return null;
    const isZh = language === 'zh';
    return (
        <aside
            className="storefront-query-feedback"
            data-query-feedback="error"
            aria-label={isZh ? '数据更新状态' : 'Data update status'}
        >
            <span role="alert" aria-live="assertive">
                {isZh ? '更新失败，已保留上次内容。' : 'Update failed. Previous content is still shown.'}
                <small>{storefrontErrorMessage(failed[0].state.error, language)}</small>
            </span>
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
        </aside>
    );
}
