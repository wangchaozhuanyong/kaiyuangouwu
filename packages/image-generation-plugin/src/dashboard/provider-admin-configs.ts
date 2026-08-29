import type { ImageProviderAdminConfigRecord } from './image-generation.graphql';

const PROVIDER_SCOPES = ['OPENAI', 'GEMINI'] as const;

export interface NormalizedProviderAdminConfigs {
    configs: ImageProviderAdminConfigRecord[];
    usedFallback: boolean;
}

export function normalizeProviderAdminConfigs(
    configs: readonly ImageProviderAdminConfigRecord[] | null | undefined,
): NormalizedProviderAdminConfigs | undefined {
    if (configs == null) return undefined;

    const configByScope = new Map(configs.map(config => [config.scope, config]));
    const missingScopes = PROVIDER_SCOPES.filter(scope => !configByScope.has(scope));

    return {
        configs: PROVIDER_SCOPES.map(scope => configByScope.get(scope) ?? emptyProviderConfig(scope)),
        usedFallback: missingScopes.length > 0,
    };
}

function emptyProviderConfig(scope: ImageProviderAdminConfigRecord['scope']): ImageProviderAdminConfigRecord {
    return {
        scope,
        credentialConfigured: false,
        credentialEnabled: false,
        baseUrl: '',
        apiKeyLast4: '',
        textModelId: '',
        providerHealthStatus: 'UNCONFIGURED',
        providerHealthMessage: null,
    };
}
