const AUTH_SESSION_CHANGE_PREFIX = 'storefront:auth-session-change';

export function authSessionChangeStorageKey(marketCode: string): string {
    return `${AUTH_SESSION_CHANGE_PREFIX}:${marketCode}`;
}

export function publishAuthSessionChange(marketCode: string): void {
    if (typeof window === 'undefined') return;
    try {
        const nonce =
            typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(authSessionChangeStorageKey(marketCode), `${Date.now()}:${nonce}`);
    } catch {
        // Cookie authentication still works when browser storage is unavailable.
    }
}

export function subscribeAuthSessionChanges(marketCode: string, onChange: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const storageKey = authSessionChangeStorageKey(marketCode);
    const listener = (event: StorageEvent) => {
        if (event.key === storageKey && event.newValue) onChange();
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
}
