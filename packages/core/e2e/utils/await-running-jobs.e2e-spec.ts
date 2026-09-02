import { SimpleGraphQLClient } from '@vendure/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { awaitRunningJobs } from './await-running-jobs';

describe('awaitRunningJobs', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('allows the empty-queue confirmation window to finish after the running-job timeout', async () => {
        vi.useFakeTimers();
        const adminClient = createAdminClient([1, 1, 1, 1, 0]);

        const completion = expect(awaitRunningJobs(adminClient, 100, 50, 25)).resolves.toBeUndefined();
        await vi.advanceTimersByTimeAsync(200);

        await completion;
    });

    it('still times out when a job remains unsettled', async () => {
        vi.useFakeTimers();
        const adminClient = createAdminClient([1]);

        const completion = expect(awaitRunningJobs(adminClient, 100, 50, 25)).rejects.toThrow(
            'awaitRunningJobs timed out after 100ms with 1 job(s) still running',
        );
        await vi.advanceTimersByTimeAsync(200);

        await completion;
    });
});

function createAdminClient(runningJobCounts: number[]): SimpleGraphQLClient {
    let queryIndex = 0;
    return {
        query: vi.fn(() => {
            const totalItems = runningJobCounts[Math.min(queryIndex, runningJobCounts.length - 1)];
            queryIndex++;
            return Promise.resolve({ jobs: { totalItems } });
        }),
    } as unknown as SimpleGraphQLClient;
}
