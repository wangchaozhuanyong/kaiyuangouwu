import * as apollo from '@apollo/client/react';

/** Business unit fixtures mock the public read adapter; real Apollo lifecycle tests live in hooks. */
export function useAdminQuery(document: unknown, options?: unknown) {
    const result = (apollo.useQuery as any)(document, options);
    return result;
}
export function useAdminLazyQuery(...args: any[]) {
    return (apollo.useLazyQuery as any)(...args);
}
export function usePageRefreshPreparation() {}
export function useAdminReadResource() {
    return { data: undefined, loading: false, error: undefined, refetch: async () => undefined };
}

export function useAdminPageRefresh() {
    return async () => [];
}
