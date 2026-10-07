import { createContext, ReactNode, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';

import { BrandLoadingIndicator } from './brand-loading';

export const PAGE_DATA_TIMEOUT_MS = 10_000;
export const PAGE_MEDIA_TIMEOUT_MS = 3_000;
export const PAGE_LOADING_DELAY_MS = 200;

const ReadinessContext = createContext<((token: object, pending: boolean) => void) | null>(null);

/** Route modules and their required queries declare state; DOM visibility is never a data signal. */
export function usePageReadiness(pending: boolean): void {
    const register = useContext(ReadinessContext);
    const token = useRef({});
    useLayoutEffect(() => {
        register?.(token.current, pending);
        return () => register?.(token.current, false);
    }, [pending, register]);
}

interface PageReadinessProps {
    navigationKey?: string;
    requestKey?: string;
    children: ReactNode;
    pending: boolean;
    navigationPreparing?: boolean;
    online: boolean;
    language: 'zh' | 'en';
    onRetry: () => void;
    onBack: () => void;
}

/** One non-blocking, bounded signal. Images retain their own local placeholders. */
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
}: PageReadinessProps) {
    const tokens = useRef(new Set<object>());
    const [required, setRequired] = useState(0);
    const register = useCallback((token: object, isWaiting: boolean) => {
        if (isWaiting) tokens.current.add(token);
        else tokens.current.delete(token);
        setRequired(tokens.current.size);
    }, []);
    const waiting = pending || navigationPreparing || required > 0;
    const [attempt, setAttempt] = useState(0);
    const [showProgress, setShowProgress] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const started = useRef<{ key: string; attempt: number; at: number } | null>(null);
    const phase = waiting ? (!online || timedOut ? 'error' : 'preparing') : 'ready';

    useLayoutEffect(() => {
        if (!waiting) {
            started.current = null;
            setShowProgress(false);
            setTimedOut(false);
            if (!tokens.current.size) document.dispatchEvent(new Event('storefront:page-ready'));
            return;
        }
        if (!started.current || started.current.key !== requestKey || started.current.attempt !== attempt) {
            started.current = { key: requestKey, attempt, at: performance.now() };
            setTimedOut(false);
        }
        const elapsed = performance.now() - started.current.at;
        const indicator = window.setTimeout(
            () => setShowProgress(true),
            Math.max(0, PAGE_LOADING_DELAY_MS - elapsed),
        );
        const deadline = window.setTimeout(
            () => setTimedOut(true),
            Math.max(0, PAGE_DATA_TIMEOUT_MS - elapsed),
        );
        return () => {
            clearTimeout(indicator);
            clearTimeout(deadline);
        };
    }, [waiting, requestKey, attempt]);

    const navigationLabel = language === 'zh' ? '正在打开商品' : 'Opening product';
    return (
        <ReadinessContext.Provider value={register}>
            <div className="page-readiness" data-page-readiness={phase} aria-busy={waiting || undefined}>
                <div className="page-readiness-stage">{children}</div>
                {phase === 'preparing' && (showProgress || navigationPreparing) && (
                    <div
                        className={navigationPreparing ? 'page-readiness-navigation' : 'visually-hidden'}
                        role="status"
                        aria-live="polite"
                        aria-label={
                            navigationPreparing
                                ? navigationLabel
                                : language === 'zh'
                                  ? '页面正在加载'
                                  : 'Page loading'
                        }
                    >
                        {navigationPreparing && (
                            <BrandLoadingIndicator language={language} compact label={navigationLabel} />
                        )}
                    </div>
                )}
                {phase === 'error' && (
                    <div className="page-readiness-overlay" aria-busy="false">
                        <div className="page-readiness-error" role="alert">
                            <p>
                                {language === 'zh'
                                    ? online
                                        ? '页面加载超时，请重试'
                                        : '当前网络不可用，请恢复网络后重试'
                                    : online
                                      ? 'The page took too long to load. Try again.'
                                      : 'You are offline. Reconnect and try again.'}
                            </p>
                            <button
                                type="button"
                                onClick={() => {
                                    onRetry();
                                    setAttempt(value => value + 1);
                                }}
                            >
                                {language === 'zh' ? '重试' : 'Try again'}
                            </button>
                            <button type="button" onClick={onBack}>
                                {language === 'zh' ? '返回' : 'Back'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </ReadinessContext.Provider>
    );
}
