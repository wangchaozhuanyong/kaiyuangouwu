import { useEffect, useMemo, useRef, useState } from 'react';
import { STORE_MANAGEMENT_QUERY, type StoreManagementResult } from '../../graphql/management.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { usePageActivity } from '../../hooks/use-page-activity';
import { dataTableSortPolicy } from '../../utils/data-table-sort-policy';
import { mergeQueryLists } from '../../utils/merge-query-lists';
import { normalizeOperationFailure } from '../../utils/operation-failure';
import { selectQueryFields } from '../../utils/select-query-fields';
import { toUserFacingError } from '../../utils/user-facing-error';

type SellerDirectory = Pick<StoreManagementResult, 'sellers'>;
export type StoreSellerOptionsState = 'loading' | 'ready' | 'error' | 'forbidden';
const sellerQuery = selectQueryFields(STORE_MANAGEMENT_QUERY, ['sellers']);
const options = (skip: number) => ({ skip, take: 100, sort: dataTableSortPolicy.newestCreated });

/** The editor owns this optional read, so seller failures cannot take down the store profile page. */
export function useStoreSellerOptions(enabled: boolean) {
    const { hasAnyPermission } = useAdminPermissions();
    const canRead = hasAnyPermission(['ReadSeller']);
    const active = usePageActivity();
    const query = useAdminQuery<SellerDirectory>(sellerQuery, {
        skip: !enabled || !canRead,
        variables: { sellerOptions: options(0) },
    });
    const { data, loading, error, fetchMore, refetch } = query;
    const scope = useMemo(() => ({ enabled, canRead, active }), [enabled, canRead, active]);
    const [supplement, setSupplement] = useState<{ scope: typeof scope; error?: unknown }>();
    const paginationError = supplement?.scope === scope ? supplement.error : undefined;
    const generation = useRef({ loading: false, disposed: false });
    useEffect(() => {
        const current = { loading: false, disposed: false };
        generation.current = current;
        return () => {
            current.disposed = true;
        };
    }, [scope]);
    useEffect(() => {
        const list = data?.sellers;
        const current = generation.current;
        if (
            !enabled ||
            !canRead ||
            !active ||
            loading ||
            error ||
            current.loading ||
            paginationError ||
            !list ||
            list.items.length >= list.totalItems
        )
            return;
        current.loading = true;
        void fetchMore({
            variables: { sellerOptions: options(list.items.length) },
            updateQuery: (previous, { fetchMoreResult }) =>
                mergeQueryLists(previous, fetchMoreResult, ['sellers']),
        })
            .then(result => {
                const next = result.data?.sellers;
                if (
                    !next ||
                    (list.items.length < next.totalItems &&
                        !next.items.some(item => !list.items.some(existing => existing.id === item.id)))
                ) {
                    throw new Error('商家列表未返回后续数据，请重试');
                }
            })
            .catch(readError => {
                if (!current.disposed) setSupplement({ scope, error: readError });
            })
            .finally(() => {
                current.loading = false;
                if (!current.disposed) {
                    setSupplement(value => (value?.scope === scope ? { ...value } : { scope }));
                }
            });
    }, [active, canRead, data, enabled, error, fetchMore, loading, paginationError, scope, supplement]);

    const failure = paginationError ?? error;
    const forbidden =
        !canRead || (failure && normalizeOperationFailure(failure).code === 'PERMISSION_DENIED');
    const missing = enabled && active && !loading && !data?.sellers;
    const complete = Boolean(data?.sellers && data.sellers.items.length >= data.sellers.totalItems);
    const status: StoreSellerOptionsState = forbidden
        ? 'forbidden'
        : failure || missing
          ? 'error'
          : complete
            ? 'ready'
            : 'loading';
    return {
        sellers: forbidden ? [] : (data?.sellers?.items ?? []),
        status,
        error: failure ? toUserFacingError(failure, '商家列表读取失败') : missing ? '未收到商家列表数据' : '',
        retry: () => {
            if (!enabled || !canRead || !active || loading || generation.current.loading) return;
            setSupplement({ scope });
            // Query state owns first-page errors; a retry never replays the profile mutation.
            void refetch().catch(() => undefined);
        },
    };
}
