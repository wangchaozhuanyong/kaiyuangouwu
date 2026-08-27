import { describe, expect, it } from 'vitest';

import { providerScopeForModel } from './image-generation-config.service';

describe('providerScopeForModel', () => {
    it('routes native Gemini models to the Gemini credential', () => {
        expect(providerScopeForModel('GEMINI_NATIVE', 'gemini-3.1-flash-image')).toBe('GEMINI');
        expect(providerScopeForModel('GEMINI_INTERACTIONS', 'relay-image-model')).toBe('GEMINI');
    });

    it('routes Gemini-compatible chat model IDs to the Gemini credential', () => {
        expect(providerScopeForModel('OPENAI_COMPATIBLE_CHAT', 'models/gemini-3-pro-image')).toBe('GEMINI');
        expect(providerScopeForModel('OPENAI_COMPATIBLE_CHAT', 'imagen-4.0-generate-001')).toBe('GEMINI');
    });

    it('routes OpenAI image models to the OpenAI credential', () => {
        expect(providerScopeForModel('OPENAI_IMAGES', 'gpt-image-2')).toBe('OPENAI');
        expect(providerScopeForModel('OPENAI_RESPONSES_IMAGE', 'gpt-image-1')).toBe('OPENAI');
    });
});
