import { waitForRequest } from './request-wait';

/** All callers load one module; a load failure never bypasses synchronization. */
export async function sessionTransport<T>(
    url: string,
    exclusive: boolean,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
): Promise<T> {
    signal?.throwIfAborted();
    if (typeof window === 'undefined') return operation();
    const runtime = await waitForRequest(import('./session-runtime'), signal);
    signal?.throwIfAborted();
    return runtime.sessionTransport(url, exclusive, signal, operation);
}
