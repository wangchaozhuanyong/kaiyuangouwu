import { ContentTranslationProvider, ContentTranslationRequest, ContentTranslationResult } from '../types.js';

export class UnavailableTranslationProvider implements ContentTranslationProvider {
    readonly name = 'unavailable';

    isConfigured(): boolean {
        return false;
    }

    async translate(_request: ContentTranslationRequest): Promise<ContentTranslationResult> {
        throw new Error('Automatic translation is not configured');
    }
}
