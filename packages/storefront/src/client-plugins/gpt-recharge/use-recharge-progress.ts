import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { StorefrontDisplayError, storefrontErrorCode } from '../../storefront-errors';
import { type StorefrontLanguage } from '../../types';

import {
    newestRechargeTask,
    rechargeTaskFinished,
    type GptRechargeClient,
    type RechargeTask,
} from './contracts';

export function useRechargeProgress(
    client: GptRechargeClient,
    task: RechargeTask | null,
    key: QueryKey,
    language: StorefrontLanguage,
) {
    const cache = useQueryClient();
    const [active, setActive] = useState(
        () => typeof document === 'undefined' || (!document.hidden && navigator.onLine),
    );
    const [connection, setConnection] = useState<'connecting' | 'live' | 'error' | 'denied'>('connecting');
    const [manual, setManual] = useState(false);
    const [streamEpoch, setStreamEpoch] = useState(0);
    useEffect(() => {
        const update = () => setActive(!document.hidden && navigator.onLine);
        document.addEventListener('visibilitychange', update);
        window.addEventListener('online', update);
        window.addEventListener('offline', update);
        return () => {
            document.removeEventListener('visibilitychange', update);
            window.removeEventListener('online', update);
            window.removeEventListener('offline', update);
        };
    }, []);
    const query = useQuery({
        queryKey: key,
        queryFn: async ({ signal }) => {
            if (!task) throw new Error('No recharge task');
            try {
                return await client.task(task.id, task.credential, signal);
            } catch (error) {
                if (['FORBIDDEN', 'UNAUTHORIZED'].includes(storefrontErrorCode(error) ?? '')) {
                    setConnection('denied');
                    throw new StorefrontDisplayError(
                        {
                            zh: '任务查询凭证无法验证，请用原兑换码重新查询。',
                            en: 'Look up the original code again to verify task access.',
                        },
                        language,
                    );
                }
                throw error;
            }
        },
        enabled: state =>
            active &&
            Boolean(task) &&
            connection !== 'denied' &&
            (!state.state.data || !rechargeTaskFinished(state.state.data.status)),
        initialData: task ?? undefined,
        // @ephemeral-sensitive: task snapshots carry per-attempt recharge capabilities.
        gcTime: 0,
        staleTime: 5000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchIntervalInBackground: false,
        refetchInterval: state => {
            if (
                !active ||
                !task ||
                connection === 'live' ||
                connection === 'denied' ||
                (state.state.data && rechargeTaskFinished(state.state.data.status))
            )
                return false;
            if (state.state.data?.status === 'awaiting_review') return 60000;
            return [5000, 15000, 30000][
                Math.min(state.state.dataUpdateCount + state.state.errorUpdateCount, 2)
            ];
        },
        structuralSharing: (before, after) =>
            newestRechargeTask(before as RechargeTask | undefined, after as RechargeTask),
    });
    const current = query.data ?? task;
    const terminal = Boolean(current && rechargeTaskFinished(current.status));
    // The single selected task owns its subscription. Tabs share this observer and cache.
    const scope = JSON.stringify(key);
    useEffect(() => {
        if (!active || !task || terminal) return;
        const abort = new AbortController();
        const queryKey = JSON.parse(scope) as QueryKey;
        setConnection(client.watch ? 'connecting' : 'error');
        if (client.watch)
            void client
                .watch(
                    task.id,
                    task.credential,
                    abort.signal,
                    snapshot => {
                        if (!abort.signal.aborted)
                            cache.setQueryData<RechargeTask>(queryKey, previous =>
                                newestRechargeTask(previous, snapshot),
                            );
                    },
                    state => {
                        if (!abort.signal.aborted) setConnection(state);
                    },
                )
                .catch(() => {
                    if (!abort.signal.aborted) setConnection('error');
                });
        return () => {
            abort.abort();
            void cache.cancelQueries({ queryKey, exact: true });
        };
    }, [active, client, task?.id, task?.credential, terminal, scope, cache, streamEpoch]);
    const refresh = async () => {
        if (manual || query.isFetching || !active || !task) return;
        setManual(true);
        try {
            await query.refetch({ cancelRefetch: false });
        } finally {
            setManual(false);
        }
    };
    return {
        taskQuery: query,
        currentTask: current,
        refreshTask: refresh,
        manual,
        reconnect: () => setStreamEpoch(value => value + 1),
        sync: !active
            ? ('paused' as const)
            : query.isError && connection !== 'live' && connection !== 'denied'
              ? ('error' as const)
              : connection,
    };
}
