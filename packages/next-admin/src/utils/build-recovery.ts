const BUILD_RECOVERY_STORAGE_KEY = 'vendure-admin-build-recovery-at';
const BUILD_RECOVERY_COOLDOWN_MS = 60_000;
const BUILD_RECOVERY_QUERY_KEY = '__vendure_admin_build';

interface BuildRecoveryStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

interface BuildRecoveryEnvironment {
    currentUrl(): string;
    now(): number;
    replace(url: string): void;
    storage: BuildRecoveryStorage;
}

function browserEnvironment(): BuildRecoveryEnvironment {
    return {
        currentUrl: () => window.location.href,
        now: () => Date.now(),
        replace: url => window.location.replace(url),
        storage: window.sessionStorage,
    };
}

function errorDetails(error: unknown) {
    if (error instanceof Error) return `${error.message}\n${error.stack ?? ''}`;
    return typeof error === 'string' ? error : '';
}

export function isRecoverableBuildError(error: unknown) {
    const details = errorDetails(error);
    if (!details) return false;

    if (
        /failed to fetch dynamically imported module|importing a module script failed|chunkloaderror|loading chunk .* failed/iu.test(
            details,
        )
    ) {
        return true;
    }

    return (
        /cannot read properties of undefined \(reading ['"]lastIndexOf['"]\)/iu.test(details) &&
        /data-vendor|@apollo\/client/iu.test(details)
    );
}

export function buildRecoveryUrl(currentUrl: string, recoveryAt: number) {
    const url = new URL(currentUrl);
    url.searchParams.set(BUILD_RECOVERY_QUERY_KEY, String(recoveryAt));
    return url.toString();
}

export function loadLatestBuild(environment: BuildRecoveryEnvironment = browserEnvironment()) {
    environment.replace(buildRecoveryUrl(environment.currentUrl(), environment.now()));
}

export function tryRecoverFromBuildError(
    error: unknown,
    environment: BuildRecoveryEnvironment = browserEnvironment(),
) {
    if (!isRecoverableBuildError(error)) return false;

    const now = environment.now();
    try {
        const storedRecoveryAt = Number(environment.storage.getItem(BUILD_RECOVERY_STORAGE_KEY));
        if (
            Number.isFinite(storedRecoveryAt) &&
            storedRecoveryAt > 0 &&
            now >= storedRecoveryAt &&
            now - storedRecoveryAt < BUILD_RECOVERY_COOLDOWN_MS
        ) {
            return false;
        }
        environment.storage.setItem(BUILD_RECOVERY_STORAGE_KEY, String(now));
    } catch {
        // 无法写入会话级冷却标记时不自动刷新，避免形成刷新循环。
        return false;
    }

    environment.replace(buildRecoveryUrl(environment.currentUrl(), now));
    return true;
}

export function registerBuildPreloadRecovery(target: Window = window) {
    const handlePreloadError = (event: Event) => {
        const preloadError = event as Event & { payload?: unknown };
        if (tryRecoverFromBuildError(preloadError.payload ?? 'Failed to fetch dynamically imported module')) {
            event.preventDefault();
        }
    };

    target.addEventListener('vite:preloadError', handlePreloadError);
    return () => target.removeEventListener('vite:preloadError', handlePreloadError);
}
