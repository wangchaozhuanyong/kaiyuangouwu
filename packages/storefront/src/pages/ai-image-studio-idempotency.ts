export interface StableImageStudioRequest {
    fingerprint: string;
    idempotencyKey: string;
}

export function stableImageStudioRequest(
    current: StableImageStudioRequest | null,
    fingerprint: string,
    createId: () => string,
): StableImageStudioRequest {
    if (current?.fingerprint === fingerprint) return current;
    return { fingerprint, idempotencyKey: createId() };
}
