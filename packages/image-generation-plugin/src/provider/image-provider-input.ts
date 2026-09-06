import { ProviderGenerationInput } from '../types';

import { DefinitiveImageProviderError } from './image-provider-errors';
export function openAiSize(aspectRatio: string, resolution: string, providerModelId: string): string {
    if (
        providerModelId
            .trim()
            .replace(/^models\//iu, '')
            .toLowerCase() === 'gpt-image-2'
    ) {
        const sizes: Record<string, Record<string, string>> = {
            '1K': {
                '1:1': '1024x1024',
                '3:4': '768x1024',
                '4:3': '1024x768',
                '9:16': '624x1104',
                '16:9': '1104x624',
            },
            '2K': {
                '1:1': '2048x2048',
                '3:4': '1536x2048',
                '4:3': '2048x1536',
                '9:16': '1152x2048',
                '16:9': '2048x1152',
            },
            '4K': {
                '9:16': '2160x3840',
                '16:9': '3840x2160',
            },
        };
        const size = sizes[resolution]?.[aspectRatio];
        if (!size) throw new DefinitiveImageProviderError('GPT Image 2 不支持所选画幅的原生清晰度');
        return size;
    }
    if (['3:4', '9:16'].includes(aspectRatio)) return '1024x1536';
    if (['4:3', '16:9'].includes(aspectRatio)) return '1536x1024';
    return '1024x1024';
}

export function geminiParts(input: ProviderGenerationInput): Array<Record<string, unknown>> {
    const parts: Array<Record<string, unknown>> = [
        { text: `${input.prompt}\nAspect ratio: ${input.aspectRatio}` },
    ];
    for (const reference of providerReferences(input)) {
        parts.push({
            inlineData: {
                mimeType: reference.mimeType,
                data: reference.bytes.toString('base64'),
            },
        });
    }
    return parts;
}

export function providerReferences(
    input: ProviderGenerationInput,
): Array<{ bytes: Buffer; mimeType: string }> {
    if (input.references?.length) return input.references;
    return input.reference ? [input.reference] : [];
}
