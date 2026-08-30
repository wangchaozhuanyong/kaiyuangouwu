interface GenerationProgressInput {
    quantity: number;
    outputs: ReadonlyArray<{ state: string }>;
}

export interface ImageGenerationProgress {
    processed: number;
    total: number;
    percentage: number;
}

export interface ImageGenerationPollingController {
    stop(): void;
    refreshNow(): void;
}

const processedOutputStates = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

export function imageGenerationProgress(job: GenerationProgressInput): ImageGenerationProgress {
    const total = Math.max(1, job.quantity, job.outputs.length);
    const processed = Math.min(
        total,
        job.outputs.filter(output => processedOutputStates.has(output.state)).length,
    );
    return {
        processed,
        total,
        percentage: Math.round((processed / total) * 100),
    };
}

export function imageGenerationPollDelay(startedAt: number, now = Date.now()): number {
    return now - startedAt < 60_000 ? 2_000 : 5_000;
}

export function startImageGenerationPolling(
    refresh: () => Promise<void>,
    nextDelay: () => number,
): ImageGenerationPollingController {
    let stopped = false;
    let running = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const clearScheduledRefresh = () => {
        if (timeout !== undefined) clearTimeout(timeout);
        timeout = undefined;
    };
    const schedule = () => {
        if (stopped || running) return;
        clearScheduledRefresh();
        timeout = setTimeout(() => void run(), Math.max(250, nextDelay()));
    };
    const run = async () => {
        if (stopped || running) return;
        clearScheduledRefresh();
        running = true;
        try {
            await refresh();
        } catch {
            // The page owns the visible error state. Polling must recover after a transient failure.
        } finally {
            running = false;
            schedule();
        }
    };

    schedule();
    return {
        stop() {
            stopped = true;
            clearScheduledRefresh();
        },
        refreshNow() {
            void run();
        },
    };
}
