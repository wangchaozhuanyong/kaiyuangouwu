import { AUTH_TOKEN_HEADER, readSessionAuthToken } from './helpers';

export class AuthTokenState {
    private token: string | null;
    private generation = 0;
    private requestId = 0;
    private lastRequestId = 0;
    private latestAuthenticationRequestId = 0;

    constructor(private readonly storageKey: string | null) {
        this.token = readSessionAuthToken(storageKey);
    }

    get value(): string | null {
        return this.token;
    }

    get usesCookieAuthentication(): boolean {
        return this.storageKey === null;
    }

    createCapture(authenticates = false): (response: Response) => void {
        const requestId = ++this.requestId;
        const generation = this.generation;
        if (authenticates) this.latestAuthenticationRequestId = requestId;
        return response => {
            const authToken = response.headers.get(AUTH_TOKEN_HEADER)?.trim();
            if (!authToken || generation !== this.generation) return;
            if (authenticates) {
                // A login/verification/reset response owns the new session, even when a
                // later-started guest query returned first. Older auth attempts cannot win.
                if (requestId !== this.latestAuthenticationRequestId) return;
                this.generation++;
            } else if (requestId < this.lastRequestId) {
                return;
            }
            this.lastRequestId = requestId;
            this.token = authToken;
            if (!this.storageKey) return;
            try {
                sessionStorage.setItem(this.storageKey, authToken);
            } catch {
                // The in-memory token still preserves the session for this page lifetime.
            }
        };
    }

    clear(): void {
        // Also invalidates pending responses when there was no in-memory token yet.
        this.generation++;
        this.token = null;
        if (!this.storageKey) return;
        try {
            sessionStorage.removeItem(this.storageKey);
        } catch {
            // Storage can be unavailable in privacy-restricted browser contexts.
        }
    }
}
