import { ReactNode, useLayoutEffect, useRef, useState } from 'react';

import {
    decodeImageElement,
    IMAGE_WAIT_EXPIRED_EVENT,
    imageCandidateIdentity,
    isFirstViewportElement,
} from './image-readiness';
export const PAGE_DATA_TIMEOUT_MS = 10_000;
export const PAGE_MEDIA_TIMEOUT_MS = 3_000;
export const PAGE_LOADING_DELAY_MS = 200;

interface PageReadinessProps {
    navigationKey?: string;
    requestKey?: string;
    children: ReactNode;
    pending: boolean;
    online: boolean;
    language: 'zh' | 'en';
    onRetry: () => void;
    onBack: () => void;
}

/**
 * One non-blocking readiness observer for route modules, queries and visible media.
 *
 * The application shell and route skeletons remain visible while the observer works. This keeps
 * navigation progressive: one slow query or image may extend the progress signal, but it cannot
 * blank or disable an otherwise useful page.
 */
export function PageReadinessBoundary(props: PageReadinessProps) {
    const {
        children,
        pending,
        online,
        language,
        onRetry,
        onBack,
        navigationKey = '',
        requestKey = navigationKey,
    } = props;
    const stage = useRef<HTMLDivElement>(null);
    const wake = useRef<() => void>(() => undefined);
    const current = useRef({ pending, online });
    current.current = { pending, online };
    const [status, setStatus] = useState<{
        key: string;
        phase: 'preparing' | 'ready' | 'degraded' | 'error';
    }>({ key: navigationKey, phase: 'preparing' });
    const phase = status.key === navigationKey ? status.phase : 'preparing';
    const requestStarted = useRef(performance.now());
    const finished = useRef<'ready' | 'degraded' | 'error' | null>(null);
    const lastAttempt = useRef(0);
    const lastRequest = useRef(requestKey);
    const [showProgress, setShowProgress] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useLayoutEffect(() => {
        const root = stage.current;
        if (!root) return;
        // Late bootstrap identity changes belong to the same navigation attempt.
        // Keep its terminal error stable until an explicit retry or a new destination.
        if (
            finished.current === 'error' &&
            attempt === lastAttempt.current &&
            requestKey === lastRequest.current
        ) {
            setStatus({ key: navigationKey, phase: 'error' });
            return;
        }
        let stopped = false;
        let frame = 0;
        let deadlineTimer = 0;
        let readyFrames = 0;
        let dataReadyAt: number | null = null;
        if (finished.current || attempt !== lastAttempt.current || requestKey !== lastRequest.current) {
            requestStarted.current = performance.now();
            if (finished.current || attempt !== lastAttempt.current) setShowProgress(false);
        }
        finished.current = null;
        lastAttempt.current = attempt;
        lastRequest.current = requestKey;
        const startedAt = requestStarted.current;
        const decoded = new Map<HTMLImageElement, string>();
        const decoding = new Map<HTMLImageElement, string>();
        const failed = new Map<HTMLImageElement, string>();
        setStatus({ key: navigationKey, phase: 'preparing' });
        const progressTimer = window.setTimeout(
            () => setShowProgress(true),
            Math.max(0, PAGE_LOADING_DELAY_MS - (performance.now() - startedAt)),
        );

        const finish = (next: 'ready' | 'degraded' | 'error') => {
            if (stopped) return;
            stopped = true;
            window.clearTimeout(progressTimer);
            window.cancelAnimationFrame(frame);
            window.clearTimeout(deadlineTimer);
            observer.disconnect();
            finished.current = next;
            setStatus({ key: navigationKey, phase: next });
        };
        const check = () => {
            if (stopped) return;
            window.clearTimeout(deadlineTimer);
            const now = performance.now();
            const queryOrModulePending =
                current.current.pending ||
                Array.from(root.querySelectorAll('[data-page-pending]')).some(
                    node =>
                        node.getAttribute('data-page-pending') !== 'data' ||
                        isFirstViewportElement(node, root),
                );
            if (!current.current.online && queryOrModulePending) {
                finish('error');
                return;
            }
            if (queryOrModulePending) {
                readyFrames = 0;
                dataReadyAt = null;
                if (now - startedAt >= PAGE_DATA_TIMEOUT_MS) finish('error');
                else deadlineTimer = window.setTimeout(schedule, PAGE_DATA_TIMEOUT_MS - (now - startedAt));
                return;
            }
            dataReadyAt ??= now;
            const waiting: HTMLImageElement[] = [];
            for (const image of Array.from(root.querySelectorAll('img'))) {
                // Measure the reserved SafeImage frame while its placeholder remains visible.
                const visual = image.closest('[data-safe-image]') ?? image;
                if (!isFirstViewportElement(visual, root)) continue;
                const identity = imageCandidateIdentity(image);
                if (!image.getAttribute('src') && !image.getAttribute('srcset')) continue;
                if (decoded.get(image) === identity || failed.get(image) === identity) continue;
                if (image.getAttribute('loading') === 'lazy') image.setAttribute('loading', 'eager');
                if (image.complete && image.naturalWidth > 0 && decoding.get(image) !== identity) {
                    decoding.set(image, identity);
                    void decodeImageElement(image)
                        .then(() => {
                            if (!stopped && imageCandidateIdentity(image) === identity)
                                decoded.set(image, identity);
                        })
                        .catch(() => {
                            // SafeImage owns its fallback chain. A replacement candidate gets
                            // a new identity and is checked again rather than marked successful.
                            if (
                                !stopped &&
                                !image.closest('[data-safe-image]') &&
                                imageCandidateIdentity(image) === identity
                            )
                                failed.set(image, identity);
                        })
                        .finally(schedule);
                }
                waiting.push(image);
            }
            if (waiting.length) {
                readyFrames = 0;
                if (now - dataReadyAt >= PAGE_MEDIA_TIMEOUT_MS || !current.current.online) {
                    for (const image of waiting) image.dispatchEvent(new Event(IMAGE_WAIT_EXPIRED_EVENT));
                    finish('degraded');
                } else
                    deadlineTimer = window.setTimeout(schedule, PAGE_MEDIA_TIMEOUT_MS - (now - dataReadyAt));
                return;
            }
            // A second layout frame catches images introduced by the final data commit.
            if (++readyFrames >= 2)
                finish(failed.size || root.querySelector('[data-safe-image=error]') ? 'degraded' : 'ready');
        };
        const tick = () => {
            frame = 0;
            check();
            if (!stopped && readyFrames > 0) schedule();
        };
        function schedule() {
            if (!stopped && !frame) frame = window.requestAnimationFrame(tick);
        }
        const observer = new MutationObserver(schedule);
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                'data-page-pending',
                'data-safe-image',
                'height',
                'loading',
                'sizes',
                'src',
                'srcset',
                'width',
            ],
        });
        const handleError = (event: Event) => {
            if (event.target instanceof HTMLImageElement && !event.target.closest('[data-safe-image]')) {
                failed.set(event.target, imageCandidateIdentity(event.target));
            }
            schedule();
        };
        wake.current = schedule;
        window.addEventListener('resize', schedule);
        root.addEventListener('load', schedule, true);
        root.addEventListener('error', handleError, true);
        schedule();
        return () => {
            stopped = true;
            window.clearTimeout(progressTimer);
            window.cancelAnimationFrame(frame);
            window.clearTimeout(deadlineTimer);
            observer.disconnect();
            window.removeEventListener('resize', schedule);
            root.removeEventListener('load', schedule, true);
            root.removeEventListener('error', handleError, true);
        };
    }, [attempt, navigationKey, requestKey]);

    useLayoutEffect(() => wake.current(), [pending, online]);

    return (
        <div
            className="page-readiness"
            data-page-readiness={phase}
            aria-busy={phase === 'preparing' ? 'true' : undefined}
        >
            <div ref={stage} className="page-readiness-stage">
                {children}
            </div>
            {phase === 'preparing' && showProgress && (
                <div
                    className="page-readiness-progress"
                    role="status"
                    aria-live="polite"
                    aria-label={language === 'zh' ? '页面正在加载' : 'Page loading'}
                >
                    <span aria-hidden="true" />
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
    );
}
