interface GenerationProgressInput {
    quantity: number;
    outputs: ReadonlyArray<{ state: string }>;
}

export interface ImageGenerationProgress {
    processed: number;
    total: number;
    percentage: number;
    determinate: boolean;
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
        determinate: processed > 0,
    };
}

export function imageGenerationElapsedSeconds(startedAt: string | number, now = Date.now()): number {
    const startedAtMs = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
    if (!Number.isFinite(startedAtMs)) return 0;
    return Math.max(0, Math.floor((now - startedAtMs) / 1_000));
}

export function imageGenerationPollDelay(startedAt: number, now = Date.now()): number {
    return now - startedAt < 60_000 ? 2_000 : 5_000;
}
