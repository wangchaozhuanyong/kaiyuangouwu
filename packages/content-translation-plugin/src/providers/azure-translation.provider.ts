import { isUsableEnglishTranslation } from '@vendure/common/lib/translation-validation';

import { PartialTranslationProviderError, TranslationProviderError } from '../translation-provider-error.js';
import {
    ContentTranslationFormat,
    ContentTranslationProvider,
    ContentTranslationRequest,
    ContentTranslationResult,
    ContentTranslationSegment,
} from '../types.js';

import { protectText } from './translation-text.js';

interface AzureTranslationProviderOptions {
    apiKey: string;
    /** Omit for a Global Translator resource; regional resources require the Azure location name. */
    region?: string;
}

interface AzureTranslationResponse {
    translations?: Array<{ to?: string; text?: string }>;
}

/** Standard NMT v3 only. Provision the resource as F0; this adapter cannot change its pricing tier. */
export class AzureTranslationProvider implements ContentTranslationProvider {
    readonly name = 'azure-translator-v3';
    private readonly apiKey: string;
    private readonly region: string;

    constructor(options: AzureTranslationProviderOptions) {
        this.apiKey = options.apiKey.trim();
        this.region = (options.region ?? '').trim().toLowerCase();
    }

    isConfigured(): boolean {
        return this.apiKey.length > 0;
    }

    async translate(request: ContentTranslationRequest): Promise<ContentTranslationResult> {
        if (!this.isConfigured()) throw new TranslationProviderError('CONFIGURATION');
        const translations: ContentTranslationResult['translations'] = [];
        // Stay within the executor's 30-second shared lease, including mixed TEXT/HTML batches.
        const deadline = Date.now() + 20_000;
        try {
            for (const format of ['TEXT', 'HTML'] as const) {
                const segments = request.segments.filter(segment => (segment.format ?? 'TEXT') === format);
                if (!segments.length) continue;
                translations.push(...(await this.translateGroup(request, segments, format, deadline)));
            }
        } catch (error) {
            if (error instanceof TranslationProviderError && translations.length)
                throw new PartialTranslationProviderError(error, translations);
            throw error;
        }
        const byKey = new Map(translations.map(item => [item.key, item]));
        return {
            provider: this.name,
            translations: request.segments.flatMap(segment => {
                const translated = byKey.get(segment.key);
                return translated ? [translated] : [];
            }),
        };
    }

    private async translateGroup(
        request: ContentTranslationRequest,
        segments: ContentTranslationSegment[],
        format: ContentTranslationFormat,
        deadline: number,
    ): Promise<ContentTranslationResult['translations']> {
        if (segments.length > 1000) throw new TranslationProviderError('TEXT_TOO_LONG');
        const protectedSegments = segments.map(segment => protectText(segment.text, request.glossary ?? {}));
        if (protectedSegments.reduce((sum, segment) => sum + [...segment.text].length, 0) > 50_000)
            throw new TranslationProviderError('TEXT_TOO_LONG');
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new TranslationProviderError('BUSY', 60_000);
        const url = new URL('https://api.cognitive.microsofttranslator.com/translate');
        url.searchParams.set('api-version', '3.0');
        url.searchParams.set('from', 'zh-Hans');
        url.searchParams.set('to', request.targetLanguageCode);
        url.searchParams.set('textType', format === 'HTML' ? 'html' : 'plain');
        const headers: Record<string, string> = {
            'Content-Type': 'application/json; charset=UTF-8',
            'Ocp-Apim-Subscription-Key': this.apiKey,
        };
        if (this.region && this.region !== 'global') headers['Ocp-Apim-Subscription-Region'] = this.region;
        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(Math.min(10_000, remaining)),
                headers,
                body: JSON.stringify(protectedSegments.map(segment => ({ Text: segment.text }))),
            });
        } catch {
            throw new TranslationProviderError('UNAVAILABLE');
        }
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            // An intermediary may return non-JSON rate-limit/timeout pages.
            if (!response.ok) throw azureFailure(response, undefined);
            throw new TranslationProviderError('INVALID_RESPONSE');
        }
        if (!response.ok) {
            const code =
                body &&
                typeof body === 'object' &&
                'error' in body &&
                body.error &&
                typeof body.error === 'object' &&
                'code' in body.error
                    ? Number(body.error.code)
                    : undefined;
            throw azureFailure(response, code);
        }
        if (!Array.isArray(body) || body.length !== segments.length)
            throw new TranslationProviderError('INVALID_RESPONSE');
        return (body as AzureTranslationResponse[]).map((result, index) => {
            const values = result?.translations;
            if (!Array.isArray(values) || values.length !== 1 || values[0]?.to !== request.targetLanguageCode)
                throw new TranslationProviderError('INVALID_RESPONSE');
            const value = values[0].text;
            if (typeof value !== 'string') throw new TranslationProviderError('INVALID_RESPONSE');
            const protectedText = protectedSegments[index];
            const tokens = protectedText.text.match(/ZXQTERM\d{4}QXZ/gu) ?? [];
            for (const token of new Set(tokens)) {
                const pattern = new RegExp([...token].join('\\s*'), 'giu');
                if ((value.match(pattern)?.length ?? 0) !== tokens.filter(item => item === token).length)
                    throw new TranslationProviderError('INVALID_RESPONSE');
            }
            // Azure returns real HTML for textType=html. Do not decode escaped user text into markup.
            const text = protectedText.restore(value);
            if (!isUsableEnglishTranslation(text)) throw new TranslationProviderError('INVALID_RESPONSE');
            return { key: segments[index].key, text };
        });
    }
}

function azureFailure(response: Response, code: number | undefined) {
    const header = response.headers.get('retry-after');
    const delay = header
        ? Number.isFinite(Number(header))
            ? Number(header) * 1000
            : Date.parse(header) - Date.now()
        : undefined;
    const retryAfter = delay !== undefined && Number.isFinite(delay) ? Math.max(0, delay) : undefined;
    if (response.status === 403 && code === 403001)
        return new TranslationProviderError('QUOTA', Math.max(3_600_000, retryAfter ?? 0));
    if (response.status === 429) return new TranslationProviderError('RATE_LIMIT', retryAfter);
    if (response.status >= 500 || response.status === 408)
        return new TranslationProviderError('UNAVAILABLE', retryAfter);
    if ([400050, 400072, 400077].includes(code ?? 0)) return new TranslationProviderError('TEXT_TOO_LONG');
    if (response.status === 400) return new TranslationProviderError('INVALID_CONTENT');
    return new TranslationProviderError('CONFIGURATION');
}
