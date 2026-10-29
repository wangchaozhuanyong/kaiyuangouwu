import { LazyForgotPasswordPage, LazyLoginPage, LazyRegisterPage } from './lazy-auth-pages';

/** Prepare code only; no authentication request, credential or Google SDK is started. */
export async function preloadAuthOverlay(): Promise<void> {
    try {
        await Promise.all([
            import('./auth-overlay'),
            LazyLoginPage.preload?.(),
            LazyRegisterPage.preload?.(),
            LazyForgotPasswordPage.preload?.(),
        ]);
    } catch {
        // The actual lazy render owns the visible resource error and recovery.
    }
}
