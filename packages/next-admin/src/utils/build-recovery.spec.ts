import { describe, expect, it, vi } from 'vitest';

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
