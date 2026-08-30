import type { ImageResolution, ImageStudioModel } from '../types';

export const customerImageResolutions = ['1K', '2K', '4K'] as const satisfies readonly ImageResolution[];

type ResolutionModel = Pick<ImageStudioModel, 'resolutionOptions'> | null | undefined;
type ResolutionOption = ImageStudioModel['resolutionOptions'][number];

export type ImageResolutionAvailability =
    | { status: 'AVAILABLE'; option: ResolutionOption }
    | { status: 'ASPECT_RATIO_UNSUPPORTED'; option: ResolutionOption }
    | { status: 'UNSUPPORTED'; option: null };

export function imageResolutionAvailability(
    model: ResolutionModel,
    resolution: ImageResolution,
    aspectRatio: string,
): ImageResolutionAvailability {
    const option = model?.resolutionOptions.find(item => item.resolution === resolution);
    if (!option || option.unitPrice <= 0) return { status: 'UNSUPPORTED', option: null };
    if (!option.supportedAspectRatios.includes(aspectRatio)) {
        return { status: 'ASPECT_RATIO_UNSUPPORTED', option };
    }
    return { status: 'AVAILABLE', option };
}

export function aspectRatioSupports4K(model: ResolutionModel, aspectRatio: string): boolean {
    return imageResolutionAvailability(model, '4K', aspectRatio).status === 'AVAILABLE';
}
