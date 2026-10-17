import { storefrontDocumentUrl } from '../storefront-preview-parameters';

import { waitForRequest } from './request-wait';

/** Shared responses hold only through headers; authentication callers include their finalize. */
export function sessionTransport<T>(
    url: string,
    exclusive: boolean,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
): Promise<T> {
    if (typeof window === 'undefined') return operation();
    const key = `vendure-session:${new URL(url, storefrontDocumentUrl()).origin}`;
    const local = () =>
        waitForRequest(import('./session-queue'), signal).then(module =>
            module.localSessionTransport(key, exclusive, signal, operation),
        );
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks?.request) return local();
    let started = false;
    try {
        return locks
            .request(key, { mode: exclusive ? 'exclusive' : 'shared', signal }, async () => {
                started = true;
                signal?.throwIfAborted();
                return operation();
            })
            .catch(error => {
                // Opaque/partition-restricted documents can expose locks but deny acquisition.
                if (!started && ['SecurityError', 'NotSupportedError'].includes(error?.name)) return local();
                throw sessionLockError(error);
            });
    } catch (error) {
        if (
            !started &&
            error instanceof DOMException &&
            ['SecurityError', 'NotSupportedError'].includes(error.name)
        )
            return local();
        return Promise.reject(sessionLockError(error));
    }
}

function sessionLockError(reason: unknown): Error | DOMException {
    return reason instanceof Error || reason instanceof DOMException
        ? reason
        : new Error('Session lock failed', { cause: reason });
}
