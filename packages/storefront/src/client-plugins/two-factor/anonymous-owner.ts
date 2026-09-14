const ANONYMOUS_OWNER_STORAGE_KEY = 'storefront-two-factor-anonymous-owner:v1';
const ANONYMOUS_OWNER_PATTERN = /^anonymous-[a-zA-Z0-9-]{36}$/;

/**
 * Returns a stable, non-secret namespace for the current browser when no
 * customer session exists. The identifier is only used to scope local vault
 * storage; it is never sent to the Shop API.
 */
export function getAnonymousTwoFactorOwnerId(): string {
    try {
        const stored = window.localStorage.getItem(ANONYMOUS_OWNER_STORAGE_KEY);
        if (stored && ANONYMOUS_OWNER_PATTERN.test(stored)) return stored;

        const generated = `anonymous-${globalThis.crypto?.randomUUID?.() ?? fallbackUuid()}`;
        window.localStorage.setItem(ANONYMOUS_OWNER_STORAGE_KEY, generated);
        return generated;
    } catch {
        return `anonymous-${globalThis.crypto?.randomUUID?.() ?? fallbackUuid()}`;
    }
}

function fallbackUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
        const random = Math.random() * 16;
        const value = character === 'x' ? random : (random % 4) + 8;
        return Math.floor(value).toString(16);
    });
}
