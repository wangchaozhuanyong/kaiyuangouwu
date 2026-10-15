import { NetworkStatus } from '@apollo/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAdminQueryScope } from '../apollo';
import { GET_ASSET_CATEGORY_INDEX } from '../graphql/catalog.graphql';
import { assetCategoryForAsset, type AssetCategory } from '../utils/asset-categories';
import { normalizeOperationFailure } from '../utils/operation-failure';
import { useAdminQuery } from './use-admin-query';
import { usePageActivity } from './use-page-activity';

interface IndexAsset {
    id: string;
    name: string;
    tags: Array<{ id: string; value: string }>;
}
interface IndexData {
    assets: { items: IndexAsset[]; totalItems: number };
}
const indexOptions = {
    skip: 0,
    take: 100,
    sort: { id: 'ASC' },
    filter: { type: { eq: 'IMAGE' } },
};

export function useAssetCategoryIndex(enabled: boolean, category: AssetCategory) {
    const active = usePageActivity();
    const scope = getAdminQueryScope();
    const identity = `${scope}:${category}`;
    const query = useAdminQuery<IndexData>(GET_ASSET_CATEGORY_INDEX, {
        variables: { options: indexOptions },
        skip: !enabled,
        fetchPolicy: 'cache-first',
    });
    const [pageFailure, setPageFailure] = useState<{ scope: string; error: unknown } | null>(null);
    const [cycle, setCycle] = useState(0);
    const [readScope, setReadScope] = useState(scope);
    const pending = useRef<{ controller: AbortController; scope: string } | null>(null);
    // This is a derived query filter, never another copy of asset records or a persistent cache.
    // Keep it only for this scope/category while Apollo refreshes the metadata pages.
    const [committed, setCommitted] = useState<{ identity: string; ids: string[] } | null>(null);
    const { refetch, fetchMore, loading: queryLoading } = query;
    // Clear a failed continuation only after a fresh first-page read has actually started.
    // Clearing in page preparation could let fetchMore race ahead of the managed refetch.
    if (pageFailure && query.networkStatus === NetworkStatus.refetch) {
        setPageFailure(null);
    }
    const index = query.data?.assets;
    const complete = Boolean(index && index.items.length === index.totalItems);
    const error = query.error ?? (pageFailure?.scope === scope ? pageFailure.error : undefined);
    const failureCode = error ? normalizeOperationFailure(error).code : undefined;
    const forbidden = failureCode === 'PERMISSION_DENIED' || failureCode === 'SESSION_EXPIRED';
    const matchingIds = useMemo(
        () =>
            complete && index && readScope === scope
                ? index.items
                      .filter(asset => category === 'ALL' || assetCategoryForAsset(asset) === category)
                      .map(asset => asset.id)
                : null,
        [complete, index, category, readScope, scope],
    );

    // The committed filter is derived from the completed Apollo result. Update only when
    // its identity or contents change; the render guard also blocks stale IDs immediately.
    if (committed && (forbidden || readScope !== scope)) {
        setCommitted(null);
    } else if (
        enabled &&
        !forbidden &&
        matchingIds &&
        !queryLoading &&
        !error &&
        (committed?.identity !== identity ||
            committed.ids.length !== matchingIds.length ||
            committed.ids.some((id, index) => id !== matchingIds[index]))
    ) {
        setCommitted({ identity, ids: matchingIds });
    }

    // Apollo can still expose the previous Observable's data just after clearStore.
    // A changed scope must complete its own managed read before admitting any IDs.
    useEffect(() => {
        if (!enabled || !active || readScope === scope) return;
        let cancelled = false;
        void refetch()
            .then(() => {
                if (!cancelled && getAdminQueryScope() === scope) setReadScope(scope);
            })
            .catch(readError => {
                if (!cancelled && getAdminQueryScope() === scope) setPageFailure({ scope, error: readError });
            });
        return () => {
            cancelled = true;
        };
    }, [enabled, active, scope, readScope, refetch]);

    useEffect(() => {
        return () => {
            pending.current?.controller.abort();
            pending.current = null;
        };
    }, [enabled, active, scope]);

    useEffect(() => {
        if (
            !enabled ||
            !active ||
            readScope !== scope ||
            queryLoading ||
            error ||
            !index ||
            complete ||
            pending.current
        )
            return;
        const request = { controller: new AbortController(), scope };
        let invalidPage: Error | undefined;
        pending.current = request;
        void fetchMore({
            variables: { options: { ...indexOptions, skip: index.items.length } },
            context: { fetchOptions: { signal: request.controller.signal } },
            updateQuery: (previous, { fetchMoreResult }) => {
                if (request.controller.signal.aborted || getAdminQueryScope() !== scope) return previous;
                const next = fetchMoreResult.assets;
                const items = [
                    ...new Map(
                        [...previous.assets.items, ...next.items].map(asset => [asset.id, asset]),
                    ).values(),
                ];
                if (
                    (items.length === previous.assets.items.length && items.length < next.totalItems) ||
                    items.length > next.totalItems
                ) {
                    invalidPage = new Error('素材列表已变化，无法完成分类，请重试');
                    return previous;
                }
                return { ...fetchMoreResult, assets: { ...next, items } };
            },
        })
            .then(() => {
                if (invalidPage && !request.controller.signal.aborted && getAdminQueryScope() === scope) {
                    setPageFailure({ scope, error: invalidPage });
                }
            })
            .catch(readError => {
                if (!request.controller.signal.aborted && getAdminQueryScope() === scope) {
                    setPageFailure({ scope, error: readError });
                }
            })
            .finally(() => {
                if (pending.current === request) pending.current = null;
                if (!request.controller.signal.aborted) setCycle(value => value + 1);
            });
    }, [enabled, active, scope, readScope, index, complete, queryLoading, fetchMore, error, cycle]);

    const retry = useCallback(async () => {
        pending.current?.controller.abort();
        pending.current = null;
        setPageFailure(null);
        const result = await refetch();
        if (getAdminQueryScope() === scope) setReadScope(scope);
        setCycle(value => value + 1);
        return result;
    }, [refetch, scope]);
    const current = !forbidden && readScope === scope && committed?.identity === identity ? committed : null;
    return {
        ids: current?.ids ?? [],
        ready: Boolean(current),
        loading: enabled && !error && (!complete || queryLoading || !current),
        error,
        retry,
    };
}
