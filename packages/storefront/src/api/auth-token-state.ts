import { AUTH_TOKEN_HEADER, readSessionAuthToken } from './helpers';

// Each browser document owns its module cache; SSR requests never enter this registry.
const browserStates = new Map<string, AuthTokenState>();

export class AuthTokenState {
    #token!: string | null;
    #generation = 0;
    #requestId = 0;
    #lastRequestId = 0;
    #latestAuthenticationRequestId = 0;

    readonly #storageKey: string | null;

    constructor(storageKey: string | null, marketCode?: string) {
        this.#storageKey = storageKey;
        if (typeof window !== 'undefined' && marketCode) {
            const key = storageKey ?? marketCode;
            const state = browserStates.get(key);
            if (state) return state;
            browserStates.set(key, this);
        }
        this.#token = readSessionAuthToken(storageKey);
    }

    get value(): string | null {
        return this.#token;
    }

    get usesCookieAuthentication(): boolean {
        return this.#storageKey === null;
    }

    createCapture(authenticates = false): (response: Response) => void {
        const requestId = ++this.#requestId;
        const generation = this.#generation;
        if (authenticates) this.#latestAuthenticationRequestId = requestId;
        return response => {
            const authToken = response.headers.get(AUTH_TOKEN_HEADER)?.trim();
            if (!authToken || generation !== this.#generation) return;
            if (authenticates) {
                // A login/verification/reset response owns the new session, even when a
                // later-started guest query returned first. Older auth attempts cannot win.
                if (requestId !== this.#latestAuthenticationRequestId) return;
                this.#generation++;
            } else if (requestId < this.#lastRequestId) {
                return;
            }
            this.#lastRequestId = requestId;
            this.#token = authToken;
            if (!this.#storageKey) return;
            try {
                sessionStorage.setItem(this.#storageKey, authToken);
            } catch {
                // The in-memory token still preserves the session for this page lifetime.
            }
        };
    }

    clear(): void {
        // Also invalidates pending responses when there was no in-memory token yet.
        this.#generation++;
        this.#token = null;
        if (!this.#storageKey) return;
        try {
            sessionStorage.removeItem(this.#storageKey);
        } catch {
            // Storage can be unavailable in privacy-restricted browser contexts.
        }
    }
}
