import { describe, expect, it } from 'vitest';

import { normalizeProviderAdminConfigs } from './provider-admin-configs';

type ProviderConfig = NonNullable<Parameters<typeof normalizeProviderAdminConfigs>[0]>[number];

describe('normalizeProviderAdminConfigs', () => {
    it('waits while the provider query has not returned', () => {
        expect(normalizeProviderAdminConfigs(undefined)).toBeUndefined();
    });

    it('supplies safe editable defaults when the API returns an empty list', () => {
        expect(normalizeProviderAdminConfigs([])).toEqual({
            usedFallback: true,
            configs: [
                expect.objectContaining({
                    scope: 'OPENAI',
                    credentialConfigured: false,
                    credentialEnabled: false,
                    providerHealthStatus: 'UNCONFIGURED',
                }),
                expect.objectContaining({
                    scope: 'GEMINI',
                    credentialConfigured: false,
                    credentialEnabled: false,
                    providerHealthStatus: 'UNCONFIGURED',
                }),
            ],
        });
    });

    it('preserves returned credentials and only fills the missing provider', () => {
        const openAiConfig: ProviderConfig = {
            scope: 'OPENAI',
            credentialConfigured: true,
            credentialEnabled: true,
            baseUrl: 'https://relay.example.com/v1',
            apiKeyLast4: '1234',
            textModelId: 'gpt-5.4-mini',
            providerHealthStatus: 'HEALTHY',
            providerHealthMessage: '连接正常',
        };

        const result = normalizeProviderAdminConfigs([openAiConfig]);

        expect(result?.usedFallback).toBe(true);
        expect(result?.configs[0]).toBe(openAiConfig);
        expect(result?.configs[1]).toEqual(expect.objectContaining({ scope: 'GEMINI' }));
    });

    it('uses complete API data without a fallback warning', () => {
        const configs = ['OPENAI', 'GEMINI'].map(scope => ({
            scope,
            credentialConfigured: false,
            credentialEnabled: false,
            baseUrl: '',
            apiKeyLast4: '',
            textModelId: '',
            providerHealthStatus: 'UNCONFIGURED',
            providerHealthMessage: null,
        })) as ProviderConfig[];

        expect(normalizeProviderAdminConfigs(configs)).toEqual({ configs, usedFallback: false });
    });
});
