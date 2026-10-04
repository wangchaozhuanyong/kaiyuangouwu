import { useApolloClient } from '@apollo/client/react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { getQueryRuntime } from '../runtime/admin-query-runtime';
import {
    RESOURCE_INVALIDATION_EVENT,
    resourceMatchesDomains,
    type ResourceDomain,
} from '../runtime/admin-resource-events';
import { PageRuntimeContext } from '../runtime/page-runtime-context';
import { AdminButton, PAGE_REFRESH_EVENT, type PageRefreshRequest } from './AdminControls';
import { PageErrorBoundary } from './PageErrorBoundary';

export function PageSkeleton() {
    return (
        <div className="admin-page-skeleton" role="status" aria-label="正在加载页面">
            <span className="sr-only">正在加载页面…</span>
            <div className="h-7 w-48 rounded bg-slate-200" />
            <div className="h-10 rounded bg-slate-100" />
            {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="h-10 rounded bg-slate-100" />
            ))}
        </div>
    );
}

export function AdminPageWorkspace({
    page,
    active,
    children,
}: {
    page: string;
    active: boolean;
    children: ReactNode;
}) {
    const client = useApolloClient();
    const runtime = getQueryRuntime(client);
    useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
    const online = useSyncExternalStore(
        listener => {
            window.addEventListener('online', listener);
            window.addEventListener('offline', listener);
            return () => {
                window.removeEventListener('online', listener);
                window.removeEventListener('offline', listener);
            };
        },
        () => navigator.onLine,
        () => true,
    );
    const state = runtime.state(page);
    useEffect(() => {
        if (!active) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const invalidate = (event: Event) => {
            const { domains, reason } = (
                event as CustomEvent<{ domains: ResourceDomain[]; reason: 'write' | 'event' }>
            ).detail;
            runtime.invalidate(key => resourceMatchesDomains(key, domains));
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (navigator.onLine && document.visibilityState !== 'hidden')
                    void runtime.refreshPage(page, reason);
            }, 150);
        };
        window.addEventListener(RESOURCE_INVALIDATION_EVENT, invalidate);
        return () => {
            clearTimeout(timer);
            window.removeEventListener(RESOURCE_INVALIDATION_EVENT, invalidate);
        };
    }, [runtime, page, active]);
    useEffect(() => {
        if (!active) return;
        const refresh = (event: Event) => {
            const request = (event as CustomEvent<PageRefreshRequest>).detail;
            if (request.page !== page) return;
            request.handled = true;
            request.work = runtime.refreshPage(page);
        };
        window.addEventListener(PAGE_REFRESH_EVENT, refresh);
        return () => window.removeEventListener(PAGE_REFRESH_EVENT, refresh);
    }, [runtime, page, active]);
    useEffect(() => {
        if (!active) return;
        const resume = () => {
            if (navigator.onLine && document.visibilityState !== 'hidden')
                void runtime.refreshPage(page, 'reconnect');
        };
        window.addEventListener('online', resume);
        document.addEventListener('visibilitychange', resume);
        return () => {
            window.removeEventListener('online', resume);
            document.removeEventListener('visibilitychange', resume);
        };
    }, [runtime, page, active]);
    const showStatus = !online || state.refreshing || state.failed > 0;
    return (
        <PageRuntimeContext.Provider value={{ page, active }}>
            <div
                className="admin-workspace"
                data-admin-page={page}
                data-refreshing={state.refreshing || undefined}
            >
                {showStatus && (
                    <div
                        className="admin-page-status"
                        data-failed={state.failed > 0 || undefined}
                        role="status"
                        aria-live="polite"
                    >
                        {!online ? (
                            <WifiOff className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                            <RefreshCw
                                className={`h-3.5 w-3.5 shrink-0 ${state.refreshing ? 'animate-spin' : ''}`}
                            />
                        )}
                        <span>
                            {!online
                                ? '网络已断开，已加载的内容仍可查看'
                                : state.refreshing
                                  ? state.hasData
                                      ? '正在更新本页数据…'
                                      : '正在读取本页数据…'
                                  : state.hasData
                                    ? `${state.failed} 项数据更新失败，已保留可用内容`
                                    : '部分数据暂时无法读取'}
                        </span>
                        {online && state.failed > 0 && !state.refreshing && (
                            <AdminButton type="button" refreshPage className="ml-auto shrink-0 text-blue-600">
                                重试本页
                            </AdminButton>
                        )}
                    </div>
                )}
                <div className="admin-workspace-content">
                    <PageErrorBoundary key={page}>{children}</PageErrorBoundary>
                </div>
            </div>
        </PageRuntimeContext.Provider>
    );
}
