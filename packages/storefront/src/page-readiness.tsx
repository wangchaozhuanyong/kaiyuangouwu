import {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { BrandLoadingIndicator } from './brand-loading';

export const PAGE_DATA_TIMEOUT_MS = 10_000;
export const PAGE_MEDIA_TIMEOUT_MS = 3_000;
export const PAGE_LOADING_DELAY_MS = 200;

type ReadinessPresentation = 'query' | 'page' | 'local';
type ReadinessPhase = 'preparing' | 'ready' | 'error';
const ReadinessContext = createContext<
    ((token: object, pending: boolean, presentation: ReadinessPresentation) => void) | null
>(null);

interface PageLoadingState {
    phase: ReadinessPhase;
    initial: boolean;
    language: 'zh' | 'en';
    online: boolean;
    failure: 'offline' | 'request' | 'timeout';
    retry: () => void;
    onBack: () => void;
}
const PageLoadingContext = createContext<PageLoadingState | null>(null);

/** Route modules and their required queries declare state; DOM visibility is never a data signal. */
export function usePageReadiness(pending: boolean, presentation: ReadinessPresentation = 'query'): void {
    const register = useContext(ReadinessContext);
    const token = useRef({});
    useLayoutEffect(() => {
        register?.(token.current, pending, presentation);
        return () => register?.(token.current, false, presentation);
    }, [pending, presentation, register]);
}

/** Empty page regions share the boundary deadline instead of animating underneath its error. */
export function usePageLoadingState(): PageLoadingState | null {
    return useContext(PageLoadingContext);
}

export function PageReadinessError({ state, inline = false }: { state: PageLoadingState; inline?: boolean }) {
    return (
        <div className={`page-readiness-error${inline ? ' page-readiness-inline-error' : ''}`} role="alert">
            <p>
                {state.language === 'zh'
                    ? state.online
                        ? state.failure === 'request'
                            ? '页面暂时无法加载，请重试'
                            : '页面加载超时，请重试'
                        : '当前网络不可用，请恢复网络后重试'
                    : state.online
                      ? state.failure === 'request'
                          ? 'This page could not be loaded. Try again.'
                          : 'The page took too long to load. Try again.'
                      : 'You are offline. Reconnect and try again.'}
            </p>
            <div className="page-readiness-error-actions">
                <button type="button" onClick={state.retry}>
                    {state.language === 'zh' ? '重新尝试' : 'Try again'}
                </button>
                <button type="button" onClick={state.onBack}>
                    {state.language === 'zh' ? '返回' : 'Back'}
                </button>
            </div>
        </div>
    );
}

interface PageReadinessProps {
    navigationKey?: string;
    requestKey?: string;
    /** Stable host/channel identity, not route, currency, language or a query request key. */
    initialScopeKey?: string;
    initialError?: boolean;
    children: ReactNode;
    pending: boolean;
    navigationPreparing?: boolean;
    online: boolean;
    language: 'zh' | 'en';
    onRetry: () => void;
    onBack: () => void;
}

/** Initial empty pages may fill the viewport; existing content remains usable on later reads. */
export function PageReadinessBoundary({
    children,
    pending,
    navigationPreparing = false,
    online,
    language,
    onRetry,
    onBack,
    navigationKey = '',
    requestKey = navigationKey,
    initialScopeKey,
    initialError = false,
}: PageReadinessProps) {
    const tokens = useRef(new Map<object, ReadinessPresentation>());
    const [required, setRequired] = useState({ total: 0, page: 0, local: 0 });
    const register = useCallback((token: object, isWaiting: boolean, presentation: ReadinessPresentation) => {
        if (isWaiting) tokens.current.set(token, presentation);
        else tokens.current.delete(token);
        const values = Array.from(tokens.current.values());
        setRequired({
            total: values.length,
            page: values.filter(value => value === 'page').length,
            local: values.filter(value => value === 'local').length,
        });
    }, []);
    const [displayedScope, setDisplayedScope] = useState<string>();
    const failedInitialRead =
        initialError && initialScopeKey !== undefined && displayedScope !== initialScopeKey;
    const waiting = pending || navigationPreparing || required.total > 0 || failedInitialRead;
    const initial =
        initialScopeKey !== undefined &&
        displayedScope !== initialScopeKey &&
        (pending || required.page > 0 || failedInitialRead);
    const [attempt, setAttempt] = useState(0);
    // A -> B -> A is a new read, even when the string scope/request values repeat.
    const cycle = useMemo(() => ({}), [initialScopeKey, requestKey, attempt]);
    const [progressCycle, setProgressCycle] = useState<object>();
    const [timeoutCycle, setTimeoutCycle] = useState<object>();
    const started = useRef<{ cycle: object; at: number } | null>(null);
    const phase: ReadinessPhase = waiting
        ? failedInitialRead || !online || timeoutCycle === cycle
            ? 'error'
            : 'preparing'
        : 'ready';

    useLayoutEffect(() => {
        // Child layout effects register before this check. A loading page must not be marked
        // displayed during the first render, before its registration state has committed.
        const pagePending = Array.from(tokens.current.values()).includes('page');
        if (
            initialScopeKey !== undefined &&
            !initialError &&
            !pending &&
            !navigationPreparing &&
            !pagePending
        ) {
            setDisplayedScope(initialScopeKey);
        }
    }, [initialScopeKey, initialError, pending, navigationPreparing, required.page]);

    useLayoutEffect(() => {
        if (!waiting) {
            started.current = null;
            setProgressCycle(undefined);
            setTimeoutCycle(undefined);
            if (!tokens.current.size) document.dispatchEvent(new Event('storefront:page-ready'));
            return;
        }
        if (!started.current || started.current.cycle !== cycle) {
            started.current = { cycle, at: performance.now() };
        }
        const elapsed = performance.now() - started.current.at;
        const indicator = window.setTimeout(
            () => setProgressCycle(cycle),
            Math.max(0, PAGE_LOADING_DELAY_MS - elapsed),
        );
        const deadline = window.setTimeout(
            () => setTimeoutCycle(cycle),
            Math.max(0, PAGE_DATA_TIMEOUT_MS - elapsed),
        );
        return () => {
            clearTimeout(indicator);
            clearTimeout(deadline);
        };
    }, [waiting, cycle]);

    const retry = useCallback(() => {
        onRetry();
        setAttempt(value => value + 1);
    }, [onRetry]);
    const loadingState: PageLoadingState = {
        phase,
        initial,
        language,
        online,
        retry,
        onBack,
        failure: !online ? 'offline' : failedInitialRead ? 'request' : 'timeout',
    };
    const navigationLabel = language === 'zh' ? '正在打开商品' : 'Opening product';
    const loadingLabel = language === 'zh' ? '页面正在加载' : 'Page loading';
    const showProgress = progressCycle === cycle;
    const inlineLoadingRegions = required.page + required.local > 0;
    return (
        <ReadinessContext.Provider value={register}>
            <PageLoadingContext.Provider value={loadingState}>
                <div
                    className="page-readiness"
                    data-page-readiness={phase}
                    aria-busy={phase === 'preparing' || undefined}
                >
                    <div className="page-readiness-stage" hidden={initial} inert={initial || undefined}>
                        {children}
                    </div>
                    {initial && (
                        <main className="page-readiness-initial" aria-busy={phase === 'preparing'}>
                            {phase === 'preparing' && showProgress && (
                                <div role="status" aria-live="polite" aria-label={loadingLabel}>
                                    <BrandLoadingIndicator language={language} />
                                </div>
                            )}
                            {phase === 'error' && (
                                <>
                                    <BrandLoadingIndicator language={language} pending={false} />
                                    <PageReadinessError state={loadingState} />
                                </>
                            )}
                        </main>
                    )}
                    {!initial && phase === 'preparing' && (showProgress || navigationPreparing) && (
                        <div
                            className={navigationPreparing ? 'page-readiness-navigation' : 'visually-hidden'}
                            role="status"
                            aria-live="polite"
                            aria-label={navigationPreparing ? navigationLabel : loadingLabel}
                        >
                            {navigationPreparing && (
                                <BrandLoadingIndicator language={language} compact label={navigationLabel} />
                            )}
                        </div>
                    )}
                    {!initial && !inlineLoadingRegions && phase === 'error' && (
                        <div className="page-readiness-overlay" aria-busy="false">
                            <PageReadinessError state={loadingState} />
                        </div>
                    )}
                </div>
            </PageLoadingContext.Provider>
        </ReadinessContext.Provider>
    );
}
