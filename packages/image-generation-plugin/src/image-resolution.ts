import type { ImageModelConfig } from './entities/image-model-config.entity';
import type { ImageProviderProtocol, ImageResolution } from './types';

export const imageResolutions = ['1K', '2K', '4K'] as const satisfies readonly ImageResolution[];

export interface ImageResolutionOption {
    resolution: ImageResolution;
    unitPrice: number;
    supportedAspectRatios: string[];
}

type ResolutionModel = Pick<
    ImageModelConfig,
    'officialModelId' | 'providerModelId' | 'protocol' | 'unitPrice' | 'unitPrice2K' | 'unitPrice4K'
>;

const ALL_ASPECT_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9'];
const FOUR_K_OPENAI_ASPECT_RATIOS = ['9:16', '16:9'];

export function resolutionOptionsForModel(model: ResolutionModel): ImageResolutionOption[] {
    const oneK: ImageResolutionOption = {
        resolution: '1K',
        unitPrice: model.unitPrice,
        supportedAspectRatios: [...ALL_ASPECT_RATIOS],
    };
    const officialModelId = model.officialModelId
        .trim()
        .replace(/^models\//iu, '')
        .toLowerCase();
    const providerModelId = model.providerModelId
        .trim()
        .replace(/^models\//iu, '')
        .toLowerCase();

    if (isGeminiNativeProtocol(model.protocol) && supportsGeminiResolutionTiers(officialModelId)) {
        return [
            oneK,
            {
                resolution: '2K',
                unitPrice: model.unitPrice2K,
                supportedAspectRatios: [...ALL_ASPECT_RATIOS],
            },
            {
                resolution: '4K',
                unitPrice: model.unitPrice4K,
                supportedAspectRatios: [...ALL_ASPECT_RATIOS],
            },
        ];
    }

    if (
        ['OPENAI_IMAGES', 'OPENAI_RESPONSES_IMAGE'].includes(model.protocol) &&
        (officialModelId === 'gpt-image-2' || providerModelId === 'gpt-image-2')
    ) {
        return [
            oneK,
            {
                resolution: '2K',
                unitPrice: model.unitPrice2K,
                supportedAspectRatios: [...ALL_ASPECT_RATIOS],
            },
            {
                resolution: '4K',
                unitPrice: model.unitPrice4K,
                supportedAspectRatios: [...FOUR_K_OPENAI_ASPECT_RATIOS],
            },
        ];
    }

    return [oneK];
}

export function resolutionPrice(model: ResolutionModel, resolution: ImageResolution): number {
    return resolutionOptionsForModel(model).find(option => option.resolution === resolution)?.unitPrice ?? 0;
}

export function supportsNativeResolution(
    model: ResolutionModel,
    resolution: ImageResolution,
    aspectRatio?: string,
): boolean {
    const option = resolutionOptionsForModel(model).find(item => item.resolution === resolution);
    return Boolean(option && (!aspectRatio || option.supportedAspectRatios.includes(aspectRatio)));
}

export function isImageResolution(value: string): value is ImageResolution {
    return imageResolutions.includes(value as ImageResolution);
}

function isGeminiNativeProtocol(protocol: ImageProviderProtocol): boolean {
    return ['GEMINI_INTERACTIONS', 'GEMINI_NATIVE', 'GEMINI_NATIVE_STREAM'].includes(protocol);
}

function supportsGeminiResolutionTiers(modelId: string): boolean {
    return /^(?:gemini-3(?:\.\d+)?-(?:pro|flash)-image)(?:-|$)/u.test(modelId);
}
