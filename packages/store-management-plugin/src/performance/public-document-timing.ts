import { AsyncLocalStorage } from 'node:async_hooks';

const phases = [
    'page-access',
    'page-revision',
    'page-read',
    'page-document-media',
    'page-document-check',
    'page-loader',
    'page-loader-config',
    'page-loader-content',
    'page-loader-products',
    'page-loader-collections',
    'page-loader-visual',
    'page-loader-flash',
    'page-loader-best-sellers',
    'page-loader-media',
    'render-artifact',
    'render-template',
    'render-styles',
    'render-react',
    'render-assemble',
] as const;
export type PublicDocumentPhase = (typeof phases)[number];
export type PublicCacheReadOutcome = 'hit' | 'miss' | 'join' | 'bypass';
const outcomes = new Set<PublicCacheReadOutcome>(['hit', 'miss', 'join', 'bypass']);
interface DocumentTiming {
    durations: Map<PublicDocumentPhase, number>;
    cache?: PublicCacheReadOutcome | 'mixed';
    closed: boolean;
}
const requests = new AsyncLocalStorage<DocumentTiming>();

/** Diagnostics belong to one response, never to a cached page or a shared loader result. */
export function withPublicDocumentTiming<T>(read: () => T): T {
    return requests.run({ durations: new Map(), closed: false }, read);
}

function finishPhase(phase: PublicDocumentPhase): () => void {
    const request = requests.getStore();
    if (!request || request.closed || !phases.includes(phase)) return () => undefined;
    let start: number;
    try {
        start = performance.now();
    } catch {
        return () => undefined;
    }
    return () => {
        if (request.closed) return;
        try {
            const elapsed = performance.now() - start;
            if (Number.isFinite(elapsed) && elapsed >= 0)
                request.durations.set(
                    phase,
                    Math.min(120_000, (request.durations.get(phase) ?? 0) + elapsed),
                );
        } catch {
            // Observability must never replace the read's value or error.
        }
    };
}

export function measurePublicDocument<T>(phase: PublicDocumentPhase, read: () => Promise<T>): Promise<T> {
    if (!requests.getStore()) return read();
    const finish = finishPhase(phase);
    try {
        return read().finally(finish);
    } catch (error) {
        finish();
        throw error;
    }
}

export function measurePublicDocumentSync<T>(phase: PublicDocumentPhase, read: () => T): T {
    const finish = finishPhase(phase);
    try {
        return read();
    } finally {
        finish();
    }
}

export function recordPublicDocumentCache(outcome: PublicCacheReadOutcome): void {
    const request = requests.getStore();
    if (!request || request.closed || !outcomes.has(outcome)) return;
    request.cache = request.cache && request.cache !== outcome ? 'mixed' : outcome;
}

/** Seal before sending: optional reads finishing later cannot change a reported sample. */
export function publicDocumentTimingHeader(): string[] {
    const request = requests.getStore();
    if (!request) return [];
    request.closed = true;
    const entries = [...request.durations].map(
        ([phase, duration]) => `storefront-${phase};dur=${duration.toFixed(1)}`,
    );
    if (request.cache) entries.push(`storefront-page-cache;desc="${request.cache}"`);
    return entries;
}
