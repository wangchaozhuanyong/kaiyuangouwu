import { containsHanContent, isUsableEnglishTranslation } from '@vendure/common/lib/translation-validation';

import { PartialTranslationProviderError, TranslationProviderError } from '../translation-provider-error.js';
import { ContentTranslationProvider, ContentTranslationRequest, ContentTranslationResult } from '../types.js';

import { decodeHtmlEntities, protectText } from './translation-text.js';

interface MyMemoryResponse {
    responseStatus?: number | string;
    responseDetails?: string;
    quotaFinished?: boolean;
    responseData?: { translatedText?: string };
}

/** Official free API: anonymous by default, with an optional owner-approved contact email. */
export class MyMemoryTranslationProvider implements ContentTranslationProvider {
    readonly name = 'mymemory-free';
    private readonly contactEmail: string;

    constructor(options: { contactEmail?: string } = {}) {
        this.contactEmail = options.contactEmail?.trim() ?? '';
    }

    isConfigured(): boolean {
        return !this.contactEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(this.contactEmail);
    }

    async translate(request: ContentTranslationRequest): Promise<ContentTranslationResult> {
        if (!this.isConfigured()) throw new TranslationProviderError('CONFIGURATION');
        const translations: ContentTranslationResult['translations'] = [];
        // The execution service's shared lease is 30 seconds. Finish or yield before it expires.
        const deadline = Date.now() + 20_000;
        const memo = new Map<string, string>();
        try {
            for (const segment of request.segments) {
                const html = segment.format === 'HTML';
                // Preserve markup byte-for-byte; never ask a plain-text service to generate HTML.
                const parts = html ? htmlParts(segment.text) : [segment.text];
                const result: string[] = [];
                for (const part of parts) {
                    if ((html && isMarkup(part)) || !containsHanContent(part)) {
                        result.push(part);
                        continue;
                    }
                    const protectedText = protectText(part, request.glossary ?? {});
                    const chunks = splitText(protectedText.text);
                    const translated: string[] = [];
                    for (const chunk of chunks) {
                        if (!containsHanContent(chunk)) {
                            translated.push(chunk);
                            continue;
                        }
                        const chunkText = chunk.trim();
                        let chunkValue = memo.get(chunkText);
                        if (chunkValue === undefined) {
                            chunkValue = await this.translateChunk(chunkText, request, deadline);
                            memo.set(chunkText, chunkValue);
                        }
                        translated.push(
                            chunk.slice(0, chunk.indexOf(chunkText)) +
                                chunkValue +
                                chunk.slice(chunk.indexOf(chunkText) + chunkText.length),
                        );
                    }
                    const value = protectedText.restore(translated.join(''));
                    // A missing placeholder must not silently erase a brand, URL or interpolation.
                    const tokens = protectedText.text.match(/ZXQTERM\d{4}QXZ/gu) ?? [];
                    for (const token of new Set(tokens)) {
                        const tokenPattern = new RegExp([...token].join('\\s*'), 'giu');
                        if (
                            (translated.join('').match(tokenPattern)?.length ?? 0) !==
                            tokens.filter(item => item === token).length
                        )
                            throw new TranslationProviderError('INVALID_RESPONSE');
                    }
                    result.push(html ? escapeHtml(value) : value);
                }
                const text = result.join('');
                if (!isUsableEnglishTranslation(text)) throw new TranslationProviderError('INVALID_RESPONSE');
                translations.push({ key: segment.key, text });
            }
        } catch (error) {
            if (error instanceof TranslationProviderError && translations.length)
                throw new PartialTranslationProviderError(error, translations);
            throw error;
        }
        return { provider: this.name, translations };
    }

    private async translateChunk(text: string, request: ContentTranslationRequest, deadline: number) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new TranslationProviderError('BUSY', 60_000);
        const url = new URL('https://api.mymemory.translated.net/get');
        url.searchParams.set('q', text);
        url.searchParams.set('langpair', `zh-CN|${request.targetLanguageCode}`);
        url.searchParams.set('mt', '1');
        if (this.contactEmail) url.searchParams.set('de', this.contactEmail);
        let response: Response;
        try {
            response = await fetch(url, {
                signal: AbortSignal.timeout(Math.min(8000, remaining)),
                redirect: 'error',
            });
        } catch {
            throw new TranslationProviderError('UNAVAILABLE');
        }
        if (response.status === 429) throw new TranslationProviderError('RATE_LIMIT', 60_000);
        if (!response.ok)
            throw new TranslationProviderError(response.status >= 500 ? 'UNAVAILABLE' : 'CONFIGURATION');
        let body: MyMemoryResponse;
        try {
            body = (await response.json()) as MyMemoryResponse;
        } catch {
            throw new TranslationProviderError('INVALID_RESPONSE');
        }
        if (!body || typeof body !== 'object') throw new TranslationProviderError('INVALID_RESPONSE');
        if (body.quotaFinished || Number(body.responseStatus) === 429)
            throw new TranslationProviderError('QUOTA', 3_600_000);
        if (Number(body.responseStatus) !== 200)
            throw new TranslationProviderError(
                Number(body.responseStatus) >= 500 ? 'UNAVAILABLE' : 'INVALID_CONTENT',
            );
        const textResult = body.responseData?.translatedText;
        if (
            typeof textResult !== 'string' ||
            /MYMEMORY WARNING|YOU USED ALL AVAILABLE|NEXT AVAILABLE IN/i.test(textResult)
        )
            throw new TranslationProviderError('INVALID_RESPONSE');
        const value = decodeHtmlEntities(textResult).trim();
        if (!isUsableEnglishTranslation(value)) throw new TranslationProviderError('INVALID_RESPONSE');
        return value;
    }
}

// The API accepts one paragraph of at most 500 UTF-8 bytes. Keep placeholders and code points intact.
function splitText(text: string): string[] {
    const chunks: string[] = [];
    let current = '';
    for (const atom of text.match(/ZXQTERM\d{4}QXZ|\r\n|[\s\S]/gu) ?? []) {
        if (/\r|\n/u.test(atom)) {
            if (current) chunks.push(current);
            chunks.push(atom);
            current = '';
        } else {
            if (Buffer.byteLength(current + atom, 'utf8') > 500) {
                chunks.push(current, ' ');
                current = '';
            }
            current += atom;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

function isMarkup(value: string) {
    return /^<(?:!|\/?[A-Za-z])/u.test(value);
}

function htmlParts(value: string) {
    // Complex raw-text elements stay pending for the primary provider instead of corrupting their content.
    if (/<\s*(?:script|style|pre|code)\b/iu.test(value))
        throw new TranslationProviderError('INVALID_CONTENT');
    const parts = value
        .split(/(<!--[\s\S]*?-->|<\/?[A-Za-z](?:[^"'<>]|"[^"]*"|'[^']*')*>)/gu)
        .filter(Boolean);
    if (parts.some(part => isMarkup(part) && containsHanContent(part)))
        throw new TranslationProviderError('INVALID_CONTENT');
    return parts;
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export const myMemoryTranslationInternals = { splitText };
