import { describe, expect, it } from 'vitest';

import {
    deriveImageGenerationHealthStatus,
    deriveImageGenerationRecentCallStatus,
} from './image-generation-reliability.service';

describe('deriveImageGenerationHealthStatus', () => {
    const healthy = {
        enabled: true,
        workerStale: false,
        queueStale: false,
    };

    it('keeps disabled channels out of worker alarms', () => {
        expect(deriveImageGenerationHealthStatus({ ...healthy, enabled: false, workerStale: true })).toBe(
            'DISABLED',
        );
    });

    it('reports stale workers as down and stale queues as degraded', () => {
        expect(deriveImageGenerationHealthStatus({ ...healthy, workerStale: true })).toBe('DOWN');
        expect(deriveImageGenerationHealthStatus({ ...healthy, queueStale: true })).toBe('DEGRADED');
    });

    it('keeps recent-call degradation separate from worker readiness', () => {
        expect(deriveImageGenerationHealthStatus(healthy)).toBe('HEALTHY');
        expect(
            deriveImageGenerationRecentCallStatus({
                attempts24h: 4,
                successRate: 0.25,
                unknownRate: 0.5,
            }),
        ).toBe('INSUFFICIENT_DATA');
        expect(
            deriveImageGenerationRecentCallStatus({
                attempts24h: 20,
                successRate: 0.79,
                unknownRate: 0.05,
            }),
        ).toBe('DEGRADED');
        expect(
            deriveImageGenerationRecentCallStatus({
                attempts24h: 20,
                successRate: 0.95,
                unknownRate: 0.1,
            }),
        ).toBe('DEGRADED');
    });
});
