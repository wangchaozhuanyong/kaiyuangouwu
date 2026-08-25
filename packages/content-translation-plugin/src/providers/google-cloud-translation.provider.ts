import {
    ContentTranslationFormat,
    ContentTranslationProvider,
    ContentTranslationRequest,
    ContentTranslationResult,
    ContentTranslationSegment,
} from '../types.js';

interface GoogleCloudTranslationProviderOptions {
    apiKey: string;
    endpoint?: string;
}

interface ProtectedText {
    text: string;
    restore: (translated: string) => string;
}

interface GoogleTranslationResponse {
    data?: {
        translations?: Array<{ translatedText?: string }>;
    };
    error?: { message?: string };
}

const protectedPattern = /https?:\/\/[^\s<]+|\{\{[^{}]+\}\}|\{[^{}]+\}|%[A-Z0-9_]+%/giu;

export class GoogleCloudTranslationProvider implements ContentTranslationProvider {
    readonly name = 'google-cloud-translation-basic';
    private readonly apiKey: string;
    private readonly endpoint: string;

    constructor(options: GoogleCloudTranslationProviderOptions) {
        this.apiKey = options.apiKey.trim();
        this.endpoint = options.endpoint ?? 'https://translation.googleapis.com/language/translate/v2';
    }

    isConfigured(): boolean {
        return this.apiKey.length > 0;
    }

    async translate(request: ContentTranslationRequest): Promise<ContentTranslationResult> {
        if (!this.isConfigured()) {
            throw new Error('Google Cloud Translation API key is not configured');
        }
        const translations = new Map<string, string>();
        for (const format of ['TEXT', 'HTML'] as const) {
            const segments = request.segments.filter(segment => (segment.format ?? 'TEXT') === format);
            if (!segments.length) continue;
            const translated = await this.translateGroup(
                segments,
                format,
                request.glossary ?? {},
                request.sourceLanguageCode,
                request.targetLanguageCode,
            );
            translated.forEach(item => translations.set(item.key, item.text));
        }
        return {
            provider: this.name,
            translations: request.segments.map(segment => ({
                key: segment.key,
                text: translations.get(segment.key) ?? '',
            })),
        };
    }

    private async translateGroup(
        segments: ContentTranslationSegment[],
        format: ContentTranslationFormat,
        glossary: Record<string, string>,
        sourceLanguageCode: string,
        targetLanguageCode: string,
    ): Promise<Array<{ key: string; text: string }>> {
        const protectedSegments = segments.map(segment => protectText(segment.text, glossary));
        const response = await fetch(`${this.endpoint}?key=${encodeURIComponent(this.apiKey)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                q: protectedSegments.map(segment => segment.text),
                source: toGoogleLanguageCode(sourceLanguageCode),
                target: toGoogleLanguageCode(targetLanguageCode),
                format: format === 'HTML' ? 'html' : 'text',
            }),
        });
        const body = (await response.json()) as GoogleTranslationResponse;
        if (!response.ok) {
            throw new Error(body.error?.message || `Google Cloud Translation failed (${response.status})`);
        }
        const results = body.data?.translations ?? [];
        if (results.length !== segments.length) {
            throw new Error('Google Cloud Translation returned an unexpected number of translations');
        }
        return results.map((result, index) => {
            const restored = protectedSegments[index].restore(
                decodeHtmlEntities(result.translatedText ?? ''),
            );
            if (segments[index].text.trim() && !restored.trim()) {
                throw new Error(
                    `Google Cloud Translation returned an empty value for ${segments[index].key}`,
                );
            }
            return { key: segments[index].key, text: restored };
        });
    }
}

function toGoogleLanguageCode(languageCode: string): string {
    return languageCode === 'zh_Hans' ? 'zh-CN' : languageCode;
}

function protectText(value: string, glossary: Record<string, string>): ProtectedText {
    const replacements: Array<{ token: string; value: string }> = [];
    let sequence = 0;
    const reserve = (original: string, translated = original) => {
        const token = `ZXQTERM${String(sequence++).padStart(4, '0')}QXZ`;
        replacements.push({ token, value: translated });
        return token;
    };
    let text = value.replace(protectedPattern, match => reserve(match));
    for (const [source, target] of Object.entries(glossary).sort(
        ([left], [right]) => right.length - left.length,
    )) {
        if (!source) continue;
        text = text.split(source).join(reserve(source, target));
    }
    return {
        text,
        restore: translated => {
            let restored = translated;
            for (const replacement of replacements) {
                const tokenPattern = new RegExp([...replacement.token].map(escapeRegExp).join('\\s*'), 'giu');
                restored = restored.replace(tokenPattern, replacement.value);
            }
            if (/ZXQ\s*TERM/iu.test(restored)) {
                throw new Error('A protected translation placeholder could not be restored');
            }
            return restored;
        },
    };
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

export const googleTranslationInternals = { protectText, decodeHtmlEntities, toGoogleLanguageCode };
