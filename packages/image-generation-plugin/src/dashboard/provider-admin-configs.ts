import type { ImageProviderAdminConfigRecord } from './image-generation.graphql';

export interface NormalizedProviderAdminConfigs {
    configs: ImageProviderAdminConfigRecord[];
    usedFallback: boolean;
}

export function normalizeProviderAdminConfigs(
    configs: readonly ImageProviderAdminConfigRecord[] | null | undefined,
): NormalizedProviderAdminConfigs | undefined {
    if (configs == null) return undefined;

    return {
        configs: [...configs],
        usedFallback: false,
    };
}
