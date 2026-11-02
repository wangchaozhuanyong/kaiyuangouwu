import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    imageGenerationElapsedSeconds,
    imageGenerationPollDelay,
    imageGenerationProgress,
} from './ai-image-studio-progress';

afterEach(() => {
    vi.useRealTimers();
});

describe('AI image generation progress', () => {
    it('reports progress from settled outputs instead of inventing time-based completion', () => {
        expect(
            imageGenerationProgress({
                quantity: 4,
                outputs: [
                    { state: 'SUCCEEDED' },
                    { state: 'FAILED' },
                    { state: 'RUNNING' },
                    { state: 'QUEUED' },
                ],
            }),
        ).toEqual({ processed: 2, total: 4, percentage: 50, determinate: true });
    });

    it('keeps unsettled work indeterminate and reports elapsed time without a fake percentage', () => {
        expect(
            imageGenerationProgress({
                quantity: 1,
                outputs: [{ state: 'RUNNING' }],
            }),
        ).toEqual({ processed: 0, total: 1, percentage: 0, determinate: false });
        expect(
            imageGenerationElapsedSeconds('2026-08-30T08:00:00.000Z', Date.parse('2026-08-30T08:00:12.900Z')),
        ).toBe(12);
    });

    it('uses fast polling for the first minute and backs off afterward', () => {
        expect(imageGenerationPollDelay(10_000, 69_999)).toBe(2_000);
        expect(imageGenerationPollDelay(10_000, 70_000)).toBe(5_000);
    });
});
