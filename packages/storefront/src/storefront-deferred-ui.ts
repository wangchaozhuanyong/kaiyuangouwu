// organize-imports-ignore
import type { RouteName } from './storefront-router';
import { useEffect, useState } from 'react';

// Capture raw entry references before lazy routes attach their styles. No API/bootstrap imports here.
export const initialStorefrontAssetReferences: readonly string[] =
    typeof document === 'undefined'
        ? []
        : Array.from(
              document.querySelectorAll<HTMLLinkElement | HTMLScriptElement>(
                  'link[rel="stylesheet"][href], script[type="module"][src]',
              ),
              element => element.getAttribute('href') ?? element.getAttribute('src') ?? '',
          );

const deferredUpdateRoutes = new Set<RouteName>([
    'purchase',
    'checkout',
    'payment',
    'addresses',
    'account-security',
    'reviews',
    'support',
    'image-studio',
    'two-factor',
    'mail-query',
    'login',
    'register',
    'verify-account',
    'forgot-password',
    'reset-password',
]);
export function shouldShowStorefrontUpdatePrompt(route: RouteName): boolean {
    return !deferredUpdateRoutes.has(route);
}

/** Optional UI starts only after readiness and an online idle period; mounted UI stays available. */
export function useDeferredStorefrontUi(enabled: boolean, ownerKey: string): boolean {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (!enabled || ready) return;
        let disposed = false;
        let suspended = false;
        let pageReady =
            document.readyState === 'complete' ||
            Boolean(document.querySelector('[data-page-readiness="ready"]'));
        let idle: number | undefined;
        let fallback: number | undefined;
        let taskVersion = 0;
        const cancelIdle = () => {
            taskVersion++;
            if (idle !== undefined) window.cancelIdleCallback(idle);
            if (fallback !== undefined) window.clearTimeout(fallback);
            idle = undefined;
            fallback = undefined;
        };
        const finish = (version: number) => {
            if (version !== taskVersion) return;
            idle = undefined;
            fallback = undefined;
            if (
                !disposed &&
                !suspended &&
                navigator.onLine !== false &&
                document.visibilityState !== 'hidden'
            )
                setReady(true);
        };
        const schedule = () => {
            if (
                disposed ||
                suspended ||
                !pageReady ||
                navigator.onLine === false ||
                document.visibilityState === 'hidden' ||
                idle !== undefined ||
                fallback !== undefined
            )
                return;
            const version = taskVersion;
            if (typeof window.requestIdleCallback === 'function')
                idle = window.requestIdleCallback(() => finish(version), { timeout: 1500 });
            else fallback = window.setTimeout(() => finish(version), 250);
        };
        const onReady = () => {
            pageReady = true;
            schedule();
        };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') cancelIdle();
            else schedule();
        };
        const onConnection = () => {
            if (navigator.onLine === false) cancelIdle();
            else schedule();
        };
        const onPageHide = () => {
            suspended = true;
            cancelIdle();
        };
        const onPageShow = () => {
            suspended = false;
            pageReady = pageReady || document.readyState === 'complete';
            schedule();
        };
        const dispose = () => {
            disposed = true;
            cancelIdle();
            document.removeEventListener('storefront:page-ready', onReady);
            window.removeEventListener('load', onReady);
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('pageshow', onPageShow);
            window.removeEventListener('online', onConnection);
            window.removeEventListener('offline', onConnection);
            document.removeEventListener('visibilitychange', onVisibility);
        };
        document.addEventListener('storefront:page-ready', onReady);
        window.addEventListener('load', onReady);
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('pageshow', onPageShow);
        window.addEventListener('online', onConnection);
        window.addEventListener('offline', onConnection);
        document.addEventListener('visibilitychange', onVisibility);
        schedule();
        return dispose;
    }, [enabled, ownerKey, ready]);
    return enabled && ready;
}
