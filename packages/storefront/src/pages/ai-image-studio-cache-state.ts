import type { ImageStudioDraft } from './ai-image-studio-cache';

// Only unsaved editor input has a separate owner. Server data belongs to the root QueryClient.
export const studioCacheState: {
    drafts: Map<string, ImageStudioDraft>;
    generation: number;
    dispose?: () => void;
} = {
    drafts: new Map<string, ImageStudioDraft>(),
    generation: 0,
};

export function clearStudioCache(): void {
    studioCacheState.generation++;
    studioCacheState.drafts.clear();
    studioCacheState.dispose?.();
}
