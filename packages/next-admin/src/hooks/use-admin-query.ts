import { skipToken, useApolloClient, useLazyQuery, useQuery } from '@apollo/client/react';
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getAdminQueryScope } from '../apollo';
import { TabPageContext } from '../layouts/tab-page-context';
import {
    canonicalValue,
    getQueryRuntime,
    queryPolicy,
    resourceIdentity,
} from '../runtime/admin-query-runtime';
import { PageRuntimeContext } from '../runtime/page-runtime-context';
import { normalizeOperationFailure } from '../utils/operation-failure';
import { usePageActivity } from './use-page-activity';

function waitForQuery(observable: any) {
    if (!observable.getCurrentResult().loading) return observable.refetch();
    return new Promise((resolve, reject) => {
        const subscription = observable.subscribe({
            next: (result: any) => {
                if (result.loading) return;
                queueMicrotask(() => subscription.unsubscribe());
                if (result.error) reject(result.error);
                else resolve(result);
            },
            error: (error: unknown) => {
                queueMicrotask(() => subscription.unsubscribe());
                reject(error);
            },
        });
    });
}

/** Apollo-compatible adapter used by every business page and installed extension. */
export const useAdminQuery: typeof useQuery = function useAdminQueryImpl(document: any, options: any = {}) {
    if (options === skipToken) options = { skip: true };
    const active = usePageActivity();
    const policy = queryPolicy(document, options.variables);
    const polling = useManagedPolling(options.pollInterval ?? policy.pollInterval);
    const result = (useQuery as any)(document, {
        ...options,
        skip: options.skip || options.fetchPolicy === 'standby' || !active,
        context: { ...options.context, adminManagedRead: true },
        fetchPolicy: options.fetchPolicy === 'no-cache' ? 'no-cache' : 'cache-first',
        nextFetchPolicy: options.fetchPolicy === 'no-cache' ? 'no-cache' : 'cache-first',
        notifyOnNetworkStatusChange: true,
        pollInterval: !options.skip && active ? polling.interval : 0,
        skipPollAttempt: () => !active || Boolean(options.skipPollAttempt?.()),
    });
    return { ...useManagedResult(document, options, result, active), ...polling.methods };
} as typeof useQuery;

export const useAdminLazyQuery: typeof useLazyQuery = function useAdminLazyQueryImpl(
    document: any,
    options: any = {},
) {
    const active = usePageActivity();
    const polling = useManagedPolling(options.pollInterval ?? 0);
    const [execute, result] = (useLazyQuery as any)(document, {
        ...options,
        notifyOnNetworkStatusChange: true,
        context: { ...options.context, adminManagedRead: true },
        pollInterval: active ? polling.interval : 0,
        skipPollAttempt: () => !active,
    });
    const managedExecute = useCallback(
        (execution: any = {}) =>
            execute({
                ...execution,
                context: { ...options.context, ...execution.context, adminManagedRead: true },
            }),
        [execute, options.context],
    );
    const context = { ...result.observable.options.context };
    delete context.adminManagedRead;
    return [
        managedExecute,
        {
            ...useManagedResult(
                document,
                { ...options, context, variables: result.variables, skip: !result.called },
                result,
                active,
            ),
            ...polling.methods,
        },
    ];
} as typeof useLazyQuery;

function useManagedPolling(defaultInterval: number) {
    const [requested, setRequested] = useState<number | undefined>();
    const startPolling = useCallback((interval: number) => setRequested(interval), []);
    const stopPolling = useCallback(() => setRequested(0), []);
    return { interval: requested ?? defaultInterval, methods: { startPolling, stopPolling } };
}

function useManagedResult(document: any, options: any, result: any, active: boolean) {
    const client = useApolloClient();
    const runtime = getQueryRuntime(client);
    const tab = useContext(TabPageContext);
    const pageContext = useContext(PageRuntimeContext);
    const page = pageContext?.page ?? tab?.path ?? '@shell';
    const ownerId = useId();
    const scope = getAdminQueryScope();
    const key = resourceIdentity(document, options.variables, options.context, scope);
    const { staleTime, pollInterval, stage } = queryPolicy(document, options.variables);
    const enabled = !options.skip && options.fetchPolicy !== 'standby';
    // Reports may advance a time boundary without changing the user's selected period.
    // Explicit continuity is scoped to the document, session and selected period; other
    // variable changes never inherit another filter's result.
    const continuity = options.context?.adminResource?.continuity;
    const continuityKey =
        continuity === undefined
            ? key
            : resourceIdentity(document, canonicalValue(continuity), undefined, scope);
    const failureCode = result.error ? normalizeOperationFailure(result.error).code : undefined;
    const mustDiscard = failureCode === 'PERMISSION_DENIED' || failureCode === 'SESSION_EXPIRED';
    const [storedSuccessful, setSuccessful] = useState({ key: continuityKey, data: result.data as any });
    let successful = storedSuccessful;
    if (
        successful.key !== continuityKey ||
        (mustDiscard && successful.data !== undefined) ||
        (!mustDiscard && result.data !== undefined && result.data !== successful.data)
    ) {
        successful = { key: continuityKey, data: mustDiscard ? undefined : result.data };
        setSuccessful(successful);
    }
    const data = mustDiscard ? undefined : (result.data ?? successful.data);
    const latest = useRef(result);
    useLayoutEffect(() => {
        latest.current = result;
    }, [result]);
    const wasLoading = useRef({ key, value: result.loading });
    const fetch = useCallback(() => waitForQuery(latest.current.observable), []);
    const hasData = Boolean(data);
    useEffect(() => {
        if (!enabled) return;
        return runtime.register(
            key,
            ownerId,
            {
                page,
                active,
                fetch,
                loading: result.loading,
                hasData,
                error: result.error,
            },
            { staleTime, pollInterval, stage },
        );
    }, [
        runtime,
        key,
        ownerId,
        page,
        enabled,
        fetch,
        active,
        result.loading,
        result.error,
        hasData,
        staleTime,
        pollInterval,
        stage,
    ]);
    useEffect(() => {
        const completed = wasLoading.current.key === key && wasLoading.current.value && !result.loading;
        wasLoading.current = { key, value: result.loading };
        runtime.update(
            key,
            ownerId,
            {
                active,
                loading: result.loading,
                hasData: Boolean(data),
                error: result.error,
            },
            completed && active && Boolean(result.data),
        );
    }, [runtime, key, ownerId, active, result.loading, data, result.data, result.error]);
    useEffect(() => {
        if (enabled && active && !latest.current.loading && runtime.isStale(key)) {
            void runtime.refreshResource(key).catch(() => {
                /* Observable/page feedback owns read errors. */
            });
        }
    }, [runtime, key, enabled, active]);
    const refetch = useMemo(
        () => (variables?: any) => {
            const work = variables ? latest.current.refetch(variables) : runtime.refreshResource(key);
            // Read errors are presented by the Observable/page status. Keep rejection for
            // await callers while allowing ordinary fire-and-forget retry buttons.
            void work.catch(() => {});
            return work;
        },
        [runtime, key],
    );
    return { ...result, data, refetch };
}

export function usePageRefreshPreparation(prepare: () => void) {
    const client = useApolloClient();
    const runtime = getQueryRuntime(client);
    const tab = useContext(TabPageContext);
    const context = useContext(PageRuntimeContext);
    const page = context?.page ?? tab?.path ?? '@shell';
    const latest = useRef(prepare);
    useLayoutEffect(() => {
        latest.current = prepare;
    }, [prepare]);
    useEffect(() => runtime.preparePage(page, () => latest.current()), [runtime, page]);
}

/** Page callbacks and buttons share the same staged refresh, including dependent resources. */
export function useAdminPageRefresh() {
    const client = useApolloClient();
    const runtime = getQueryRuntime(client);
    const context = useContext(PageRuntimeContext);
    const tab = useContext(TabPageContext);
    const page = context?.page ?? tab?.path ?? '@shell';
    return useCallback(() => runtime.refreshPage(page), [runtime, page]);
}
