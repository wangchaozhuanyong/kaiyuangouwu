import { useCallback, useEffect } from 'react';

export const BEFORE_APP_NAVIGATION_EVENT = 'vendure:before-app-navigation';

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
    const confirmNavigation = useCallback(() => !active || window.confirm(message), [active, message]);

    useEffect(() => {
        if (!active) return;

        const shouldGuardTarget = (target: string) => {
            const nextUrl = new URL(target, window.location.href);
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
            if (target && shouldGuardTarget(target) && !window.confirm(message)) event.preventDefault();
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        document.addEventListener('click', handleDocumentClick, true);
        window.addEventListener(BEFORE_APP_NAVIGATION_EVENT, handleAppNavigation);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            document.removeEventListener('click', handleDocumentClick, true);
            window.removeEventListener(BEFORE_APP_NAVIGATION_EVENT, handleAppNavigation);
        };
    }, [active, message]);

    return confirmNavigation;
}
