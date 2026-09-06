import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    buildRecoveryUrl,
    isRecoverableBuildError,
    loadLatestBuild,
    tryRecoverFromBuildError,
} from './build-recovery';

function createEnvironment(initialRecoveryAt: string | null = null) {
    let recoveryAt = initialRecoveryAt;
    const replace = vi.fn();
    return {
        environment: {
            currentUrl: () => 'https://console.damatong.net/dashboard/plugins/ai-settings?tab=tasks#models',
            now: () => 120_000,
            replace,
            storage: {
                getItem: () => recoveryAt,
                setItem: (_key: string, value: string) => {
                    recoveryAt = value;
                },
            },
        },
        replace,
    };
}

describe('build recovery', () => {
    afterEach(() => vi.unstubAllGlobals());

    function blockBrowserStorage() {
        const replace = vi.fn();
        const storage = vi.fn(() => {
            throw new Error('SecurityError: session storage access is blocked');
        });
        vi.stubGlobal('window', {
            location: { href: 'https://console.example.test/dashboard/catalog?tab=products#list', replace },
            get sessionStorage() {
                return storage();
            },
        });
        return { replace, storage };
    }

    it('leaves the error boundary available when the browser rejects storage access', () => {
        const { replace, storage } = blockBrowserStorage();
        expect(tryRecoverFromBuildError(new Error('ChunkLoadError'))).toBe(false);
        expect(storage).toHaveBeenCalledOnce();
        expect(replace).not.toHaveBeenCalled();
    });

    it('does not read browser storage for an unrelated error', () => {
        const { storage } = blockBrowserStorage();
        expect(tryRecoverFromBuildError(new Error('GraphQL request failed'))).toBe(false);
        expect(storage).not.toHaveBeenCalled();
    });

    it('keeps the manual reload action usable when browser storage is blocked', () => {
        const { replace, storage } = blockBrowserStorage();
        loadLatestBuild();
        expect(storage).not.toHaveBeenCalled();
        const url = new URL(replace.mock.calls[0][0]);
        expect(url.pathname).toBe('/dashboard/catalog');
        expect(url.searchParams.get('tab')).toBe('products');
        expect(Number(url.searchParams.get('__vendure_admin_build'))).toBeGreaterThan(0);
        expect(url.hash).toBe('#list');
    });

    it('recognizes stale chunks and the observed Apollo transform failure', () => {
        expect(isRecoverableBuildError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
        expect(
            isRecoverableBuildError(
                new Error(
                    "Cannot read properties of undefined (reading 'lastIndexOf')\n" +
                        'at /dashboard/assets/data-vendor-example.js',
                ),
            ),
        ).toBe(true);
        expect(isRecoverableBuildError(new Error('GraphQL request failed'))).toBe(false);
    });

    it('adds a cache-busting build marker while preserving the current route', () => {
        expect(
            buildRecoveryUrl(
                'https://console.damatong.net/dashboard/plugins/ai-settings?tab=tasks#models',
                120_000,
            ),
        ).toBe(
            'https://console.damatong.net/dashboard/plugins/ai-settings?tab=tasks&__vendure_admin_build=120000#models',
        );
    });

    it('loads the latest build once and suppresses an automatic recovery loop during the cooldown', () => {
        const first = createEnvironment();
        expect(
            tryRecoverFromBuildError(new Error('ChunkLoadError: Loading chunk 7 failed'), first.environment),
        ).toBe(true);
        expect(first.replace).toHaveBeenCalledWith(
            'https://console.damatong.net/dashboard/plugins/ai-settings?tab=tasks&__vendure_admin_build=120000#models',
        );

        const repeated = createEnvironment('119500');
        expect(
            tryRecoverFromBuildError(
                new Error('ChunkLoadError: Loading chunk 7 failed'),
                repeated.environment,
            ),
        ).toBe(false);
        expect(repeated.replace).not.toHaveBeenCalled();
    });

    it('falls back to the visible error boundary when the cooldown marker cannot be stored', () => {
        const replace = vi.fn();
        const recovered = tryRecoverFromBuildError(new Error('ChunkLoadError'), {
            currentUrl: () => 'https://console.damatong.net/dashboard/',
            now: () => 120_000,
            replace,
            storage: {
                getItem: () => null,
                setItem: () => {
                    throw new Error('session storage is blocked');
                },
            },
        });

        expect(recovered).toBe(false);
        expect(replace).not.toHaveBeenCalled();
    });

    it('lets the visible recovery action bypass a stale URL without depending on storage', () => {
        const manual = createEnvironment('119500');

        loadLatestBuild(manual.environment);

        expect(manual.replace).toHaveBeenCalledWith(
            'https://console.damatong.net/dashboard/plugins/ai-settings?tab=tasks&__vendure_admin_build=120000#models',
        );
    });
});
