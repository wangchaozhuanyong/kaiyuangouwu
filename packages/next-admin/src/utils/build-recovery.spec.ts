import { describe, expect, it, vi } from 'vitest';

import { isRecoverableBuildError, tryRecoverFromBuildError } from './build-recovery';

function createEnvironment(initialRecoveryAt: string | null = null) {
    let recoveryAt = initialRecoveryAt;
    const reload = vi.fn();
    return {
        environment: {
            now: () => 120_000,
            reload,
            storage: {
                getItem: () => recoveryAt,
                setItem: (_key: string, value: string) => {
                    recoveryAt = value;
                },
            },
        },
        reload,
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

    it('reloads once and suppresses a reload loop during the cooldown', () => {
        const first = createEnvironment();
        expect(
            tryRecoverFromBuildError(new Error('ChunkLoadError: Loading chunk 7 failed'), first.environment),
        ).toBe(true);
        expect(first.reload).toHaveBeenCalledOnce();

        const repeated = createEnvironment('119500');
        expect(
            tryRecoverFromBuildError(
                new Error('ChunkLoadError: Loading chunk 7 failed'),
                repeated.environment,
            ),
        ).toBe(false);
        expect(repeated.reload).not.toHaveBeenCalled();
    });

    it('falls back to the visible error boundary when the cooldown marker cannot be stored', () => {
        const reload = vi.fn();
        const recovered = tryRecoverFromBuildError(new Error('ChunkLoadError'), {
            now: () => 120_000,
            reload,
            storage: {
                getItem: () => null,
                setItem: () => {
                    throw new Error('session storage is blocked');
                },
            },
        });

        expect(recovered).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });
});
