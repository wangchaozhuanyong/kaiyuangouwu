import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';

describe('image generation GraphQL surface', () => {
    it('does not expose relay model IDs or credentials in the Shop API', () => {
        const schema = print(shopApiExtensions);

        expect(schema).not.toContain('providerModelId');
        expect(schema).not.toContain('apiKeyLast4');
        expect(schema).not.toContain('baseUrl');
        expect(schema).toContain('officialModelId');
        expect(schema).toContain('descriptionZh');
        expect(schema).toContain('descriptionEn');
        expect(schema).toContain('deleteMyImageGenerationJob');
        expect(schema).toContain('referenceAssetIds: [ID!]');
        expect(schema).toContain('referenceInstruction: String');
        expect(schema).toMatch(
            /type ImageGenerationOutput implements Node[\s\S]*width: Int[\s\S]*height: Int/,
        );
    });

    it('separates provider credentials from store-level image configuration', () => {
        const schema = print(adminApiExtensions);

        expect(schema).toContain('imageProviderAdminConfigs');
        expect(schema).toContain('type ImageProviderAdminConfig');
        expect(schema).toContain('enum ImageProviderScope');
        expect(schema).toContain('OPENAI_RESPONSES_IMAGE');
        expect(schema).toContain('GEMINI_INTERACTIONS');
        expect(schema).toContain('GEMINI_NATIVE_STREAM');
        expect(schema).toContain('testImageProviderConnection(scope: ImageProviderScope!)');
        expect(schema).toContain('extend type ImageStudioModel');
        expect(schema).toContain('testImageModel');
        expect(schema).toContain('lastTestedAt');
        expect(schema).toContain('supportsIdempotency');
        expect(schema).toContain('smokeTestImageModel');
        expect(schema).toContain('reconcileStaleImageGenerationOutputs');
        expect(schema).toContain('imageGenerationCostSummary');
        expect(schema).toContain('supportedUseCases');
        expect(schema).toContain('supportedModels');
        expect(schema).toContain('routingStrategy');
        expect(schema).toContain('skillAutoActivateEnabled');
    });
});
