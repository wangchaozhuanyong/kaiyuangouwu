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
import { offlineLoadError } from './loading-state';

export const PAGE_DATA_TIMEOUT_MS = 10_000;
export const PAGE_MEDIA_TIMEOUT_MS = 3_000;
export const PAGE_LOADING_DELAY_MS = 200;

type ReadinessPresentation = 'query' | 'page' | 'local' | 'optional';
type ReadinessPhase = 'preparing' | 'ready' | 'error';
const ReadinessContext = createContext<
    ((token: object, pending: boolean, presentation: ReadinessPresentation, failed?: boolean) => void) | null
>(null);

interface PageLoadingState {
    phase: ReadinessPhase;
    initial: boolean;
    language: 'zh' | 'en';
    online: boolean;
    failure: 'offline' | 'request' | 'timeout';
    slow: boolean;
    retry: () => void;
    retryRead: (read: () => void) => void;
    restartRead: () => void;
    onBack: () => void;
}
const PageLoadingContext = createContext<{
    page: PageLoadingState;
    navigation: PageLoadingState | null;
} | null>(null);
const PageRouteCommitContext = createContext<(() => void) | null>(null);

/** React owns the visible loading/error UI. Local reads may still be pending. */
export function markStorefrontAppOwned(): void {
    document.documentElement.setAttribute('data-storefront-app-owned', '');
    document.dispatchEvent(new Event('storefront:app-owned'));
}

/** A real route commit completes adoption; a server ready attribute is not a client signal. */
export function usePageRouteCommit(): void {
    const commit = useContext(PageRouteCommitContext);
    useLayoutEffect(() => {
        commit?.();
    }, [commit]);
}

/** Route modules and their required queries declare state; DOM visibility is never a data signal. */
export function usePageReadiness(
    pending: boolean,
    presentation: ReadinessPresentation = 'query',
    readKey?: string,
    failed = false,
): void {
    const register = useContext(ReadinessContext);
    const restartRead = useContext(PageLoadingContext)?.page.restartRead;
    const token = useRef({});
    useLayoutEffect(() => {
        register?.(token.current, pending || failed, presentation, failed);
        return () => register?.(token.current, false, presentation);
    }, [pending, failed, presentation, register]);
    // Local filters can start a different read without changing the visible route.
    useLayoutEffect(() => {
        if (readKey !== undefined) restartRead?.();
    }, [readKey, restartRead]);
}

/** Empty page regions share the boundary deadline instead of animating underneath its error. */
export function usePageLoadingState(read?: { pending: boolean; key?: string }): PageLoadingState | null {
    const context = useContext(PageLoadingContext);
    const owner = read ? context?.page : (context?.navigation ?? context?.page);
    const local = useLoadingCycle(Boolean(read?.pending), undefined, read?.key ?? '');
    if (!owner || !read) return owner ?? null;
    return {
        ...owner,
        phase: read.pending ? (owner.online ? 'preparing' : 'error') : 'ready',
        slow: read.pending && local.expired,
        failure: owner.online ? 'timeout' : 'offline',
        retry: () => {
            owner.retry();
            local.restart();
        },
        restartRead: local.restart,
        retryRead: restart => {
            restart();
            local.restart();
        },
    };
}

export function PageReadinessError({ state, inline = false }: { state: PageLoadingState; inline?: boolean }) {
    const slow = state.online && state.slow && state.phase === 'preparing';
    return (
        <div
            className={`page-readiness-error${inline ? ' page-readiness-inline-error' : ''}`}
            role={slow ? 'status' : 'alert'}
        >
            <p>
                {slow
                    ? state.language === 'zh'
                        ? '加载较慢，你可以继续等待或重新尝试'
                        : 'Loading is taking longer. You can wait or try again.'
                    : !state.online
                      ? offlineLoadError(state.language)
                      : state.language === 'zh'
                        ? state.failure === 'request'
                            ? '页面暂时无法加载，请重试'
                            : '页面加载超时，请重试'
                        : state.failure === 'request'
                          ? 'This page could not be loaded. Try again.'
                          : 'The page took too long to load. Try again.'}
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
    requireInitialRouteCommit?: boolean;
    children: ReactNode;
    pending: boolean;
    navigationPreparing?: boolean;
    online: boolean;
    language: 'zh' | 'en';
    onRetry: () => void;
    onNavigationRetry?: () => void;
    onBack: () => void;
}

function useLoadingCycle(waiting: boolean, scope: string | undefined, key: string) {
    const [attempt, restart] = useState(0);
    const restartCycle = useCallback(() => restart(value => value + 1), []);
    const cycle = useMemo(() => ({}), [waiting, scope, key, attempt]);
    const [status, setStatus] = useState<{ cycle: object; phase: number }>();
    useLayoutEffect(() => {
        if (!waiting) return;
        const indicator = window.setTimeout(() => setStatus({ cycle, phase: 1 }), PAGE_LOADING_DELAY_MS);
        const deadline = window.setTimeout(() => setStatus({ cycle, phase: 2 }), PAGE_DATA_TIMEOUT_MS);
        return () => {
            clearTimeout(indicator);
            clearTimeout(deadline);
        };
    }, [waiting, cycle]);
    const phase = status?.cycle === cycle ? status.phase : 0;
    return {
        progress: phase > 0,
        expired: phase === 2,
        restart: restartCycle,
    };
}

/** Initial empty pages may fill the viewport; existing content remains usable on later reads. */
export function PageReadinessBoundary({
    children,
    pending,
    navigationPreparing = false,
    online,
    language,
    onRetry,
    onNavigationRetry = onRetry,
    onBack,
    navigationKey,
    requestKey = navigationKey ?? '',
    initialScopeKey,
    initialError = false,
    requireInitialRouteCommit = false,
}: PageReadinessProps) {
    const [initialRouteCommitted, setInitialRouteCommitted] = useState(false);
    const commitRoute = useCallback(() => {
        const root = document.getElementById('root');
        if (root?.dataset.publicRendered === '1') root.dataset.publicAdopted = '1';
        setInitialRouteCommitted(true);
    }, []);
    const tokens = useRef(new Map<object, { presentation: ReadinessPresentation; failed: boolean }>());
    const [required, setRequired] = useState({ total: 0, page: 0, local: 0, errors: 0 });
    const register = useCallback(
        (token: object, isWaiting: boolean, presentation: ReadinessPresentation, failed = false) => {
            const previousToken = tokens.current.get(token);
            if (
                isWaiting
                    ? previousToken?.presentation === presentation && previousToken.failed === failed
                    : !previousToken
            )
                return;
            if (isWaiting) tokens.current.set(token, { presentation, failed });
            else tokens.current.delete(token);
            const next = { total: 0, page: 0, local: 0, errors: 0 };
            for (const value of tokens.current.values()) {
                if (value.presentation === 'optional') continue;
                if (value.failed) next.errors++;
                else next.total++;
                if (value.presentation === 'page' || value.presentation === 'local')
                    next[value.presentation]++;
            }
            setRequired(previous =>
                previous.total === next.total &&
                previous.page === next.page &&
                previous.local === next.local &&
                previous.errors === next.errors
                    ? previous
                    : next,
            );
        },
        [],
    );
    const [displayedScope, setDisplayedScope] = useState<string>();
    const [continueDocumentBrand] = useState(() => {
        if (typeof document === 'undefined') return false;
        const boot = document.getElementById('storefront-boot-loading');
        const root = document.getElementById('root');
        // Carry an already-visible empty-document presentation into React.
        // This is presentation continuity, never a query readiness signal.
        return (
            root?.dataset.publicRendered !== '1' &&
            boot?.dataset.presentation === 'initial' &&
            boot.getAttribute('aria-hidden') !== 'true'
        );
    });
    const failedInitialRead =
        initialError && initialScopeKey !== undefined && displayedScope !== initialScopeKey;
    const waiting = pending || required.total > 0 || failedInitialRead;
    const initial =
        initialScopeKey !== undefined && displayedScope !== initialScopeKey && (pending || failedInitialRead);
    // Visible reads keep their own deadline when a different destination starts.
    const reading = useLoadingCycle(waiting, initialScopeKey, navigationKey ?? requestKey);
    const navigation = useLoadingCycle(navigationPreparing, initialScopeKey, requestKey);
    const phase: ReadinessPhase =
        failedInitialRead || required.errors > 0 || (waiting && !online)
            ? 'error'
            : waiting
              ? 'preparing'
              : 'ready';
    const navigationPhase: ReadinessPhase = navigationPreparing ? (!online ? 'error' : 'preparing') : 'ready';
    const presentedPhase = navigationPreparing && !initial ? navigationPhase : phase;

    useLayoutEffect(() => {
        // A rendered public snapshot is adopted only by its real route commit.
        // Once adopted, coupons, recommendations and other local reads cannot
        // keep the document startup presentation alive.
        if (!requireInitialRouteCommit || initialRouteCommitted) markStorefrontAppOwned();
    }, [requireInitialRouteCommit, initialRouteCommitted]);

    useLayoutEffect(() => {
        // Child layout effects register before this check. A loading page must not be marked
        // displayed during the first render, before its registration state has committed.
        const pagePending = Array.from(tokens.current.values()).some(value => value.presentation === 'page');
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
        if (phase === 'ready' && !navigationPreparing) {
            if (
                (!requireInitialRouteCommit || initialRouteCommitted) &&
                !Array.from(tokens.current.values()).some(value => value.presentation !== 'optional')
            )
                document.dispatchEvent(new Event('storefront:page-ready'));
        }
    }, [phase, navigationPreparing, requestKey, requireInitialRouteCommit, initialRouteCommitted]);

    useLayoutEffect(() => {
        if (phase === 'error' || navigationPhase === 'error')
            document.dispatchEvent(new Event('storefront:page-error'));
    }, [phase, navigationPhase, requestKey]);

    const retryRead = (read: () => void) => {
        read();
        reading.restart();
    };
    const loadingState: PageLoadingState = {
        phase,
        initial,
        language,
        online,
        retry: () => retryRead(onRetry),
        retryRead,
        restartRead: reading.restart,
        onBack,
        failure: !online ? 'offline' : failedInitialRead || required.errors > 0 ? 'request' : 'timeout',
        slow: waiting && reading.expired,
    };
    const navigationLabel = language === 'zh' ? '正在打开页面' : 'Opening page';
    const loadingLabel = language === 'zh' ? '页面正在加载' : 'Page loading';
    const showProgress =
        (navigationPreparing && !initial ? navigation.progress : reading.progress) ||
        (initial && continueDocumentBrand);
    const inlineLoadingRegions = required.page + required.local > 0;
    const feedbackState =
        navigationPreparing && !initial
            ? {
                  ...loadingState,
                  phase: navigationPhase,
                  failure: online ? ('timeout' as const) : ('offline' as const),
                  slow: navigation.expired,
                  restartRead: navigation.restart,
                  retryRead: (read: () => void) => {
                      read();
                      navigation.restart();
                  },
                  retry: () => {
                      onNavigationRetry();
                      navigation.restart();
                  },
              }
            : loadingState;
    return (
        <ReadinessContext.Provider value={register}>
            <PageLoadingContext.Provider
                value={{
                    page: loadingState,
                    navigation: navigationPreparing && !initial ? feedbackState : null,
                }}
            >
                <PageRouteCommitContext.Provider value={commitRoute}>
                    <div
                        className="page-readiness"
                        data-page-readiness={presentedPhase}
                        data-navigation-readiness={navigationPreparing ? navigationPhase : undefined}
                        aria-busy={presentedPhase === 'preparing' || undefined}
                    >
                        <div className="page-readiness-stage" hidden={initial} inert={initial || undefined}>
                            {children}
                        </div>
                        {initial && (
                            <main className="page-readiness-initial" aria-busy={phase === 'preparing'}>
                                {phase === 'preparing' && !loadingState.slow && showProgress && (
                                    <div role="status" aria-live="polite" aria-label={loadingLabel}>
                                        <BrandLoadingIndicator language={language} />
                                    </div>
                                )}
                                {(phase === 'error' || loadingState.slow) && (
                                    <>
                                        <BrandLoadingIndicator language={language} pending={false} />
                                        <PageReadinessError state={loadingState} />
                                    </>
                                )}
                            </main>
                        )}
                        {!initial &&
                            presentedPhase === 'preparing' &&
                            !feedbackState.slow &&
                            showProgress && (
                                <div
                                    className="page-readiness-navigation"
                                    role="status"
                                    aria-live="polite"
                                    aria-label={navigationPreparing ? navigationLabel : loadingLabel}
                                >
                                    <BrandLoadingIndicator
                                        language={language}
                                        compact
                                        label={navigationPreparing ? navigationLabel : loadingLabel}
                                    />
                                </div>
                            )}
                        {!initial &&
                            !inlineLoadingRegions &&
                            (presentedPhase === 'error' || feedbackState.slow) && (
                                <div className="page-readiness-overlay" aria-busy="false">
                                    <PageReadinessError state={feedbackState} />
                                </div>
                            )}
                    </div>
                </PageRouteCommitContext.Provider>
            </PageLoadingContext.Provider>
        </ReadinessContext.Provider>
    );
}
