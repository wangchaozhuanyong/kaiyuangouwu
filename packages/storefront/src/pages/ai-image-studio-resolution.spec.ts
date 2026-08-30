import { describe, expect, it } from 'vitest';

import { aspectRatioSupports4K, imageResolutionAvailability } from './ai-image-studio-resolution';

const model = {
    resolutionOptions: [
        { resolution: '1K' as const, unitPrice: 15, supportedAspectRatios: ['1:1', '16:9'] },
        { resolution: '4K' as const, unitPrice: 39, supportedAspectRatios: ['16:9'] },
    ],
};

describe('image studio resolution availability', () => {
    it('allows a priced resolution supported by the current aspect ratio', () => {
        expect(imageResolutionAvailability(model, '1K', '1:1').status).toBe('AVAILABLE');
    });

    it('rejects a resolution that the selected model does not provide', () => {
        expect(imageResolutionAvailability(model, '2K', '1:1').status).toBe('UNSUPPORTED');
    });

    it('does not offer a resolution until the administrator has configured its price', () => {
        const unpricedModel = {
            resolutionOptions: [{ resolution: '2K' as const, unitPrice: 0, supportedAspectRatios: ['1:1'] }],
        };

        expect(imageResolutionAvailability(unpricedModel, '2K', '1:1').status).toBe('UNSUPPORTED');
    });

    it('rejects an otherwise supported resolution for an incompatible aspect ratio', () => {
        expect(imageResolutionAvailability(model, '4K', '1:1').status).toBe('ASPECT_RATIO_UNSUPPORTED');
    });

    it('identifies aspect ratios that support the configured 4K tier', () => {
        expect(aspectRatioSupports4K(model, '16:9')).toBe(true);
        expect(aspectRatioSupports4K(model, '1:1')).toBe(false);
    });
});
