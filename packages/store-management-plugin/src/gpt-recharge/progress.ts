export interface RechargeProgress {
    attempt: string;
    execution: number;
    version: number;
    changedAt: string;
    retryAt?: string | null;
    milestones: Array<{ key: string; state: 'active' | 'complete' | 'waiting'; at: string }>;
}

export function safeRechargeProgress(value: unknown): RechargeProgress | undefined {
    const row = value as RechargeProgress | undefined;
    if (
        !row ||
        typeof row.attempt !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(row.attempt) ||
        !Number.isSafeInteger(row.version) ||
        row.version < 1 ||
        !Number.isSafeInteger(row.execution) ||
        row.execution < 0 ||
        row.execution > 999 ||
        !Number.isFinite(Date.parse(row.changedAt)) ||
        !Array.isArray(row.milestones) ||
        row.milestones.length > 8
    )
        return undefined;
    const keys = [
        'accepted',
        'account',
        'checkout',
        'card',
        'billing',
        'payment',
        'subscription',
        'complete',
    ];
    if (
        new Set(row.milestones.map(step => step?.key)).size !== row.milestones.length ||
        row.milestones.some(
            step =>
                !step ||
                !keys.includes(step.key) ||
                !['active', 'complete', 'waiting'].includes(step.state) ||
                !Number.isFinite(Date.parse(step.at)),
        )
    )
        return undefined;
    return {
        attempt: row.attempt,
        execution: row.execution,
        retryAt:
            row.retryAt && Number.isFinite(Date.parse(row.retryAt))
                ? new Date(row.retryAt).toISOString()
                : null,
        version: row.version,
        changedAt: new Date(row.changedAt).toISOString(),
        milestones: row.milestones.map(step => ({
            key: step.key,
            state: step.state,
            at: new Date(step.at).toISOString(),
        })),
    };
}

/** Bounded framing and idle timeout for the authenticated private executor stream. */
export async function readRechargeProgressStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    onTask: (task: unknown) => Promise<void>,
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const cancel = () => void reader.cancel().catch(() => undefined);
    signal.addEventListener('abort', cancel, { once: true });
    try {
        while (!signal.aborted) {
            timeout = setTimeout(() => {
                timedOut = true;
                cancel();
            }, 45000);
            const { value, done } = await reader.read();
            clearTimeout(timeout);
            if (timedOut) throw new Error('Progress stream timed out');
            if (done) return;
            pending += decoder.decode(value, { stream: true });
            if (pending.length > 65536) throw new Error('Progress frame too large');
            let boundary: number;
            while ((boundary = pending.indexOf('\n\n')) >= 0) {
                const frame = pending.slice(0, boundary);
                pending = pending.slice(boundary + 2);
                if (!frame.startsWith('event: task\n')) continue;
                const data = frame
                    .split('\n')
                    .filter(line => line.startsWith('data:'))
                    .map(line => line.slice(5).trim())
                    .join('\n');
                if (!signal.aborted) await onTask(JSON.parse(data));
            }
        }
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
