import { describe, expect, it } from 'vitest';

import { normalizeProviderAdminConfigs } from './provider-admin-configs';

type ProviderConfig = NonNullable<Parameters<typeof normalizeProviderAdminConfigs>[0]>[number];

describe('normalizeProviderAdminConfigs', () => {
    it('waits while the provider query has not returned', () => {
        expect(normalizeProviderAdminConfigs(undefined)).toBeUndefined();
    });

    it('preserves an empty key pool so the dashboard can show its add-key state', () => {
        expect(normalizeProviderAdminConfigs([])).toEqual({
            usedFallback: false,
            configs: [],
        });
    });

    it('preserves returned key-pool credentials without injecting fake provider keys', () => {
        const openAiConfig: ProviderConfig = {
            id: '1',
            code: 'openai-primary',
            name: 'OpenAI 主 Key',
            purpose: 'BOTH',
            scope: 'OPENAI',
            credentialConfigured: true,
            credentialEnabled: true,
            baseUrl: 'https://relay.example.com/v1',
            apiKeyLast4: '1234',
            textModelId: 'gpt-5.4-mini',
            orchestrationModelId: 'gpt-5.4-mini',
            providerHealthStatus: 'HEALTHY',
            providerHealthMessage: '连接正常',
            priority: 10,
            weight: 1,
            modelCodes: [],
        };

        const result = normalizeProviderAdminConfigs([openAiConfig]);

        expect(result?.usedFallback).toBe(false);
        expect(result?.configs[0]).toBe(openAiConfig);
        expect(result?.configs).toHaveLength(1);
    });
});
