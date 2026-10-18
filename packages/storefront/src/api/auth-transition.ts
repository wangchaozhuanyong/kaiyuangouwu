import { SupersededLogoutError } from './logout-error';
import { waitForRequest } from './request-wait';

/** Coordinates writes to the same browser cookie store; it never retries an operation. */
export type ConfirmLogout = () => void;
type Intent = { active: boolean; started: boolean; previous?: Intent };

export class AuthTransition {
    private readonly authenticating = new Set<Promise<unknown>>();
    private logoutBarrier: Promise<void> | undefined;
    private intent: Intent | undefined;
    private unconfirmedLogout = false;

    async authenticate<T>(
        operation: (dispatch: () => void) => Promise<T>,
        unconfirmedMessage: string,
        signal?: AbortSignal,
        deferDispatch = false,
    ): Promise<T> {
        signal?.throwIfAborted();
        const barrier = this.logoutBarrier;
        const intent: Intent = { active: true, started: false, previous: this.intent };
        this.intent = intent;
        let started = false;
        const cancelIntent = () => {
            if (started) return;
            intent.active = false;
            // Cancelled pending intents cannot hide an acknowledged logout or a later owner.
            while (this.intent && !this.intent.active) this.intent = this.intent.previous;
        };
        signal?.addEventListener('abort', cancelIntent, { once: true });
        const request = (async () => {
            if (barrier) await waitForRequest(barrier, signal);
            signal?.throwIfAborted();
            if (this.unconfirmedLogout) throw new Error(unconfirmedMessage);
            const dispatch = () => {
                started = true;
                intent.started = true;
                intent.previous = undefined;
            };
            if (!deferDispatch) dispatch();
            return operation(dispatch);
        })();
        this.authenticating.add(request);
        try {
            return await request;
        } finally {
            signal?.removeEventListener('abort', cancelIntent);
            if (!started) cancelIntent();
            this.authenticating.delete(request);
        }
    }

    private owner(): Intent | undefined {
        let owner = this.intent;
        // Reserved authentication has no session yet; its earlier owner can safely finalize.
        while (owner && (!owner.active || !owner.started)) owner = owner.previous;
        return owner;
    }

    async logout<T>(
        operation: () => Promise<T>,
        finalize?: (result: T) => void,
        coordinate: <R>(execute: () => Promise<R>) => Promise<R> = execute => execute(),
    ): Promise<{ result: T; confirm: ConfirmLogout }> {
        const intent: Intent = { active: true, started: true };
        this.intent = intent;
        const previousLogout = this.logoutBarrier;
        const earlierAuthentications = [...this.authenticating];
        let release!: () => void;
        const barrier = new Promise<void>(resolve => {
            release = resolve;
        });
        this.logoutBarrier = barrier;
        try {
            if (previousLogout) await previousLogout;
            await Promise.allSettled(earlierAuthentications);
            return await coordinate(async () => {
                let result: T;
                try {
                    result = await operation();
                } catch (error) {
                    // Losing the connection does not prove server-side logout has finished.
                    this.unconfirmedLogout = true;
                    if (this.intent !== intent) throw new SupersededLogoutError();
                    throw error;
                }
                const assertCurrent = () => {
                    if (this.owner() !== intent) throw new SupersededLogoutError();
                };
                assertCurrent();
                // Finalize acknowledged logout while still holding the transport lock.
                finalize?.(result);
                return { result, confirm: assertCurrent };
            });
        } finally {
            release();
            if (this.logoutBarrier === barrier) this.logoutBarrier = undefined;
        }
    }
}

// API_URL is fixed for this deployed module. Channels at that endpoint share its cookie store.
// Browser documents have separate module instances; SSR creates one coordinator per AccountApi.
export const browserAuthTransition = new AuthTransition();
