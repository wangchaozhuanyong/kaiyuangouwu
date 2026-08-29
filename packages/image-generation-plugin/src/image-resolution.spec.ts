import { describe, expect, it } from 'vitest';

import { resolutionOptionsForModel, supportsNativeResolution } from './image-resolution';

describe('image resolution capabilities', () => {
    it('exposes all native Gemini 3 resolution tiers', () => {
        const model = modelConfig('gemini-3.1-flash-image', 'GEMINI_NATIVE_STREAM');
        expect(resolutionOptionsForModel(model).map(option => option.resolution)).toEqual(['1K', '2K', '4K']);
        expect(supportsNativeResolution(model, '4K', '1:1')).toBe(true);
    });

    it('limits GPT Image 2 native 4K to supported portrait and landscape ratios', () => {
        const model = modelConfig('gpt-image-2', 'OPENAI_IMAGES');
        expect(supportsNativeResolution(model, '2K', '1:1')).toBe(true);
        expect(supportsNativeResolution(model, '4K', '16:9')).toBe(true);
        expect(supportsNativeResolution(model, '4K', '1:1')).toBe(false);
    });

    it('does not advertise fake high-resolution tiers for older image models', () => {
        const model = modelConfig('gpt-image-1.5', 'OPENAI_RESPONSES_IMAGE');
        expect(resolutionOptionsForModel(model).map(option => option.resolution)).toEqual(['1K']);
    });
});

function modelConfig(
    modelId: string,
    protocol: 'OPENAI_RESPONSES_IMAGE' | 'OPENAI_IMAGES' | 'GEMINI_NATIVE_STREAM',
) {
    return {
        officialModelId: modelId,
        providerModelId: modelId,
        protocol,
        unitPrice: 100,
        unitPrice2K: 200,
        unitPrice4K: 400,
    };
}
