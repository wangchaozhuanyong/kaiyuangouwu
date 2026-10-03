import { useCallback, useContext, useEffect } from 'react';

import { TabPageContext } from '../layouts/tab-page-context';

export const BEFORE_APP_NAVIGATION_EVENT = 'vendure:before-app-navigation';
const BEFORE_APP_TABS_CLOSE_EVENT = 'vendure:before-app-tabs-close';

export function requestAppTabsClose(paths: string[]): boolean {
    return window.dispatchEvent(
        new CustomEvent(BEFORE_APP_TABS_CLOSE_EVENT, { cancelable: true, detail: { paths } }),
    );
}

export function requestAppNavigation(target: string): boolean {
    return window.dispatchEvent(
        new CustomEvent(BEFORE_APP_NAVIGATION_EVENT, {
            cancelable: true,
            detail: { target },
        }),
    );
}

/**
 * 防止复杂编辑页在刷新、点击导航或 AppShell 跳转时直接丢失未保存内容。
 */
export function useUnsavedChangesWarning(active: boolean, message: string) {
    const tabPage = useContext(TabPageContext);
    const tabPath = tabPage?.path;
    const basename = tabPage?.basename;
    const confirmNavigation = useCallback(() => !active || window.confirm(message), [active, message]);

    useEffect(() => {
        if (!active) return;

        const shouldGuardTarget = (target: string) => {
            const nextUrl = new URL(target, window.location.href);
            if (tabPath) {
                // Switching retained pages does not discard edits. Logout and
                // leaving the admin application still require confirmation.
                const appPath =
                    basename && basename !== '/' && nextUrl.pathname.startsWith(`${basename}/`)
                        ? nextUrl.pathname.slice(basename.length)
                        : nextUrl.pathname;
                return nextUrl.origin !== window.location.origin || appPath === '/login';
            }
            return nextUrl.origin === window.location.origin && nextUrl.pathname !== window.location.pathname;
        };
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        const handleDocumentClick = (event: MouseEvent) => {
            if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
            )
                return;
            const target =
                event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
            if (!target || target.target === '_blank' || !shouldGuardTarget(target.href)) return;
            if (!window.confirm(message)) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        };
        const handleAppNavigation = (event: Event) => {
            const navigationEvent = event as CustomEvent<{ target?: string }>;
            const target = navigationEvent.detail?.target;
            if (target && shouldGuardTarget(target) && !window.confirm(message)) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        };
        const handleTabsClose = (event: Event) => {
            const paths = (event as CustomEvent<{ paths: string[] }>).detail.paths;
            if (tabPath && paths.includes(tabPath) && !window.confirm(message)) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        document.addEventListener('click', handleDocumentClick, true);
        window.addEventListener(BEFORE_APP_NAVIGATION_EVENT, handleAppNavigation);
        window.addEventListener(BEFORE_APP_TABS_CLOSE_EVENT, handleTabsClose);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            document.removeEventListener('click', handleDocumentClick, true);
            window.removeEventListener(BEFORE_APP_NAVIGATION_EVENT, handleAppNavigation);
            window.removeEventListener(BEFORE_APP_TABS_CLOSE_EVENT, handleTabsClose);
        };
    }, [active, message, tabPath, basename]);

    return confirmNavigation;
}
