/** An older sign-out must not change or report failure against a newer authentication intent. */
export class SupersededLogoutError extends Error {
    constructor() {
        super('Sign-out belongs to an earlier session');
    }
}
