import { describe, expect, it } from 'vitest';

import { imageProtocolOption, imageProtocolOptionsForModel } from './image-protocol-options';

describe('image protocol options', () => {
    it('shows only Codex-compatible choices for GPT Image models', () => {
        const options = imageProtocolOptionsForModel({
            code: 'OPENAI_IMAGE_2',
            officialModelId: 'gpt-image-2',
            providerModelId: 'gpt-image-2',
            protocol: 'OPENAI_RESPONSES_IMAGE',
        });

        expect(options.map(option => option.value)).toEqual([
            'OPENAI_RESPONSES_IMAGE',
            'OPENAI_IMAGES',
            'OPENAI_COMPATIBLE_CHAT',
        ]);
        expect(options[0]).toMatchObject({
            recommended: true,
            label: 'Codex 订阅号中转（推荐）',
        });
        expect(options[0].description).toContain('gpt-image-2');
    });

    it('shows only Gemini-compatible choices for Gemini image models', () => {
        const options = imageProtocolOptionsForModel({
            code: 'GEMINI_FLASH',
            officialModelId: 'gemini-3.1-flash-image',
            providerModelId: 'gemini-3.1-flash-image',
            protocol: 'GEMINI_NATIVE_STREAM',
        });

        expect(options.map(option => option.value)).toEqual([
            'GEMINI_NATIVE_STREAM',
            'GEMINI_NATIVE',
            'GEMINI_INTERACTIONS',
        ]);
        expect(options[0]).toMatchObject({
            recommended: true,
            label: 'Gemini 订阅号中转（推荐）',
        });
        expect(imageProtocolOption('GEMINI_NATIVE_STREAM').description).toContain('gemini-3.1-flash-image');
    });
});
