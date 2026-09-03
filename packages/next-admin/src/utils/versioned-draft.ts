export function resolveVersionedDraft<T>(
    sourceSignature: string,
    loadedSignature: string,
    sourceDraft: T | null,
    storedDraft: T | null,
) {
    return sourceSignature && sourceSignature !== loadedSignature ? sourceDraft : storedDraft;
}
