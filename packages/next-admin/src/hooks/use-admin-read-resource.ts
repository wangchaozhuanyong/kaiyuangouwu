import { useApolloClient } from '@apollo/client/react';
import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getAdminQueryScope } from '../apollo';
import { TabPageContext } from '../layouts/tab-page-context';
import { getQueryRuntime } from '../runtime/admin-query-runtime';
import { PageRuntimeContext } from '../runtime/page-runtime-context';
import { useActiveInterval, usePageActivity } from './use-page-activity';

/** Non-GraphQL reads use the same owner, refresh, visibility and cancellation contract. */
export function useAdminReadResource<T>(
    id: string,
    read: (signal: AbortSignal) => Promise<T>,
    pollInterval = 0,
) {
    const client = useApolloClient();
    const runtime = getQueryRuntime(client);
    const context = useContext(PageRuntimeContext);
    const tab = useContext(TabPageContext);
    const page = context?.page ?? tab?.path ?? '@shell';
    const active = usePageActivity();
    const ownerId = useId();
    const key = `${getAdminQueryScope()}|read:${id}`;
    const latest = useRef(read);
    useLayoutEffect(() => {
        latest.current = read;
    }, [read]);
    const controller = useRef<AbortController | null>(null);
    const [stored, setState] = useState<{ key: string; data?: T; error?: unknown; loading: boolean }>({
        key,
        loading: false,
    });
    const state = stored.key === key ? stored : { key, loading: false };
    const fetch = useMemo(
        () => async () => {
            const request = new AbortController();
            controller.current = request;
            setState(previous => ({
                ...(previous.key === key ? previous : {}),
                key,
                error: undefined,
                loading: true,
            }));
            try {
                const data = await latest.current(request.signal);
                if (!request.signal.aborted) setState({ key, data, loading: false });
                return data;
            } catch (error) {
                if (!request.signal.aborted)
                    setState(previous => ({ ...previous, key, error, loading: false }));
                throw error;
            }
        },
        [key],
    );
    useEffect(
        () =>
            runtime.register(
                key,
                ownerId,
                { page, active, fetch, loading: false, hasData: false },
                {
                    staleTime: pollInterval || 30_000,
                    pollInterval,
                    stage: 0,
                },
            ),
        [runtime, key, ownerId, page, fetch, active, pollInterval],
    );
    const previousLoading = useRef(false);
    useEffect(() => {
        runtime.update(
            key,
            ownerId,
            { active, loading: state.loading, error: state.error, hasData: Boolean(state.data) },
            previousLoading.current && !state.loading,
        );
        previousLoading.current = state.loading;
    }, [runtime, key, ownerId, active, state.loading, state.error, state.data]);
    useEffect(() => {
        if (active && runtime.isStale(key)) void runtime.refreshResource(key).catch(() => {});
        return () => controller.current?.abort();
    }, [runtime, key, active]);
    useActiveInterval(() => {
        void runtime.refreshResource(key).catch(() => {});
    }, pollInterval);
    return { ...state, refetch: () => runtime.refreshResource(key) };
}
