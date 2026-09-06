import { ProviderTelemetry } from '../types';

import { MAX_PROVIDER_BASE64_CHARACTERS, MAX_PROVIDER_IMAGE_BYTES } from './image-provider-constants';
import { DefinitiveImageProviderError } from './image-provider-errors';
export interface ProviderJsonResponse {
    payload: unknown;
    telemetry: ProviderTelemetry;
}

export function parseGeminiStreamResponse(text: string): unknown {
    const normalized = text.replace(/\r\n?/gu, '\n').trim();
    const events: unknown[] = [];
    for (const block of normalized.split(/\n\n+/gu)) {
        const data = block
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n')
            .trim();
        if (!data || data === '[DONE]') continue;
        try {
            events.push(JSON.parse(data) as unknown);
        } catch {
            throw new DefinitiveImageProviderError('中转站返回了无效的 Gemini 流式数据');
        }
    }
    if (events.length) return events;
    try {
        return JSON.parse(normalized) as unknown;
    } catch {
        throw new DefinitiveImageProviderError('中转站没有返回可识别的 Gemini 流式数据');
    }
}

export interface InlineImagePayload {
    data: string;
    mimeType?: string;
}

export function structuredInlineImage(value: unknown): InlineImagePayload | undefined {
    return (
        openAiResponsesInlineImage(value) ??
        inlineImageAt(value, ['data', 0], ['b64_json'], ['mime_type', 'mimeType']) ??
        inlineImageAt(value, ['output_image'], ['data'], ['mime_type', 'mimeType']) ??
        geminiInlineImage(value)
    );
}

export function openAiResponsesInlineImage(value: unknown): InlineImagePayload | undefined {
    const output = objectAt(value, ['output']);
    if (!Array.isArray(output)) return;
    for (const item of output) {
        if (objectAt(item, ['type']) !== 'image_generation_call') continue;
        const data = rawStringAt(item, ['result']);
        if (!data) continue;
        const mimeType = normalizedImageMimeType(stringAt(item, ['mime_type']));
        return { data, ...(mimeType ? { mimeType } : {}) };
    }
}

export function geminiInlineImage(value: unknown): InlineImagePayload | undefined {
    const events = Array.isArray(value) ? value : [value];
    for (const event of events) {
        const candidates = objectAt(event, ['candidates']);
        if (!Array.isArray(candidates)) continue;
        for (const candidate of candidates) {
            const parts = objectAt(candidate, ['content', 'parts']);
            if (!Array.isArray(parts)) continue;
            for (const part of parts) {
                const inlineData = objectAt(part, ['inlineData']) ?? objectAt(part, ['inline_data']);
                const image = inlineImageFromObject(inlineData, ['data'], ['mimeType', 'mime_type']);
                if (image) return image;
            }
        }
    }
}

export function inlineImageAt(
    value: unknown,
    path: Array<string | number>,
    dataKeys: string[],
    mimeTypeKeys: string[],
): InlineImagePayload | undefined {
    return inlineImageFromObject(objectAt(value, path), dataKeys, mimeTypeKeys);
}

export function inlineImageFromObject(
    value: unknown,
    dataKeys: string[],
    mimeTypeKeys: string[],
): InlineImagePayload | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const object = value as Record<string, unknown>;
    const data = dataKeys.map(key => object[key]).find(child => typeof child === 'string' && child.length);
    if (typeof data !== 'string') return;
    const mimeType = mimeTypeKeys
        .map(key => normalizedImageMimeType(object[key]))
        .find((child): child is string => Boolean(child));
    return { data, ...(mimeType ? { mimeType } : {}) };
}

export function findGenericInlineImage(value: unknown, depth = 0): InlineImagePayload | undefined {
    if (depth > 8 || !value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    for (const key of ['b64_json', 'data', 'result']) {
        const child = object[key];
        if (typeof child !== 'string' || !looksLikeBase64ImageData(child)) continue;
        const mimeType =
            normalizedImageMimeType(object.mimeType) ?? normalizedImageMimeType(object.mime_type);
        return { data: child, ...(mimeType ? { mimeType } : {}) };
    }
    for (const child of Object.values(object)) {
        const nested = findGenericInlineImage(child, depth + 1);
        if (nested) return nested;
    }
}

export function findEmbeddedInlineImage(value: unknown, depth = 0): InlineImagePayload | undefined {
    if (depth > 8) return;
    if (typeof value === 'string') return extractImageDataUrl(value, true);
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value as Record<string, unknown>)) {
        const nested = findEmbeddedInlineImage(child, depth + 1);
        if (nested) return nested;
    }
}

export function extractImageDataUrl(value: string, embedded = false): InlineImagePayload | undefined {
    const markerIndex = embedded
        ? asciiCaseInsensitiveIndexOf(value, 'data:image/')
        : asciiCaseInsensitiveIndexOf(value, 'data:image/', 0, true);
    if (markerIndex < 0) return;
    const mimeStart = markerIndex + 'data:'.length;
    const separatorIndex = asciiCaseInsensitiveIndexOf(value, ';base64,', mimeStart);
    if (separatorIndex < 0 || separatorIndex - mimeStart > 64) return;
    const mimeType = normalizedImageMimeType(value.slice(mimeStart, separatorIndex));
    if (!mimeType) return;
    const dataStart = separatorIndex + ';base64,'.length;
    let dataEnd = dataStart;
    while (dataEnd < value.length && isBase64OrWhitespaceCharacter(value.charCodeAt(dataEnd))) {
        dataEnd += 1;
    }
    if (dataEnd === dataStart) return;
    return { data: value.slice(dataStart, dataEnd), mimeType };
}

export function decodeBase64Image(value: string, telemetry: ProviderTelemetry): Buffer {
    const inspection = inspectBase64(value);
    if (inspection === 'TOO_LARGE') {
        throw new DefinitiveImageProviderError('中转站图片超过 25MB', telemetry);
    }
    if (inspection !== 'VALID') {
        throw new DefinitiveImageProviderError('中转站返回了无效的图片编码', telemetry);
    }
    const bytes = Buffer.from(value, 'base64');
    if (!bytes.length) {
        throw new DefinitiveImageProviderError('中转站返回的图片大小无效', telemetry);
    }
    if (bytes.length > MAX_PROVIDER_IMAGE_BYTES) {
        throw new DefinitiveImageProviderError('中转站图片超过 25MB', telemetry);
    }
    return bytes;
}

export function looksLikeBase64ImageData(value: string): boolean {
    if (value.length < 128) return false;
    const dataUrl = extractImageDataUrl(value);
    return inspectBase64(dataUrl?.data ?? value) !== 'INVALID';
}

export function inspectBase64(value: string): 'VALID' | 'INVALID' | 'TOO_LARGE' {
    let characterCount = 0;
    let paddingCount = 0;
    let paddingStarted = false;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (isAsciiWhitespace(code)) continue;
        characterCount += 1;
        if (characterCount > MAX_PROVIDER_BASE64_CHARACTERS) return 'TOO_LARGE';
        if (code === 61) {
            paddingStarted = true;
            paddingCount += 1;
            if (paddingCount > 2) return 'INVALID';
            continue;
        }
        if (paddingStarted || !isBase64Character(code)) return 'INVALID';
    }
    if (!characterCount || characterCount % 4 === 1) return 'INVALID';
    if (paddingCount && characterCount % 4 !== 0) return 'INVALID';
    return 'VALID';
}

export function isBase64OrWhitespaceCharacter(code: number): boolean {
    return isBase64Character(code) || code === 61 || isAsciiWhitespace(code);
}

export function isBase64Character(code: number): boolean {
    return (
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        code === 43 ||
        code === 47
    );
}

export function isAsciiWhitespace(code: number): boolean {
    return code === 9 || code === 10 || code === 13 || code === 32;
}

export function normalizedImageMimeType(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 64 || !/^image\/[a-z0-9.+-]+$/iu.test(value)) return;
    return value.toLowerCase();
}

export function findRemoteImageUrl(value: unknown, depth = 0): string | undefined {
    if (depth > 8) return;
    if (typeof value === 'string') return extractHttpUrl(value);
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    for (const key of ['url', 'image_url']) {
        const child = object[key];
        if (typeof child !== 'string') continue;
        const imageUrl = extractHttpUrl(child);
        if (imageUrl) return imageUrl;
    }
    for (const child of Object.values(object)) {
        const nested = findRemoteImageUrl(child, depth + 1);
        if (nested) return nested;
    }
}

export function extractHttpUrl(value: string): string | undefined {
    const httpIndex = asciiCaseInsensitiveIndexOf(value, 'http://');
    const httpsIndex = asciiCaseInsensitiveIndexOf(value, 'https://');
    const start = httpIndex < 0 ? httpsIndex : httpsIndex < 0 ? httpIndex : Math.min(httpIndex, httpsIndex);
    if (start < 0) return;
    let end = start;
    const maximumEnd = Math.min(value.length, start + 4_096);
    while (end < maximumEnd && !isUrlTerminator(value.charCodeAt(end))) end += 1;
    return end > start ? value.slice(start, end) : undefined;
}

export function isUrlTerminator(code: number): boolean {
    return isAsciiWhitespace(code) || code === 34 || code === 39 || code === 41;
}

export function asciiCaseInsensitiveIndexOf(
    value: string,
    needle: string,
    fromIndex = 0,
    requireAtStart = false,
): number {
    const lastStart = requireAtStart ? fromIndex : value.length - needle.length;
    for (let start = fromIndex; start <= lastStart; start += 1) {
        let offset = 0;
        while (offset < needle.length) {
            const code = value.charCodeAt(start + offset);
            const folded = code >= 65 && code <= 90 ? code + 32 : code;
            if (folded !== needle.charCodeAt(offset)) break;
            offset += 1;
        }
        if (offset === needle.length) return start;
        if (requireAtStart) return -1;
    }
    return -1;
}

export function objectAt(value: unknown, path: Array<string | number>): unknown {
    return path.reduce<unknown>((current, key) => {
        if (Array.isArray(current) && typeof key === 'number') return current[key];
        if (current && typeof current === 'object' && typeof key === 'string')
            return (current as Record<string, unknown>)[key];
        return undefined;
    }, value);
}

export function stringAt(value: unknown, path: Array<string | number>): string | undefined {
    const found = objectAt(value, path);
    return typeof found === 'string' && found.trim() ? found : undefined;
}

export function rawStringAt(value: unknown, path: Array<string | number>): string | undefined {
    const found = objectAt(value, path);
    return typeof found === 'string' && found.length ? found : undefined;
}

export function geminiResponseText(value: unknown): string | undefined {
    const parts = objectAt(value, ['candidates', 0, 'content', 'parts']);
    if (!Array.isArray(parts)) return;
    const text = parts
        .map(part => stringAt(part, ['text']))
        .filter((part): part is string => Boolean(part))
        .join('\n')
        .trim();
    return text || undefined;
}

export function findStringByKey(
    value: unknown,
    keys: Set<string>,
    predicate: (value: string) => boolean,
    depth = 0,
): string | undefined {
    if (depth > 8 || !value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keys.has(key) && typeof child === 'string' && predicate(child)) return child;
        const nested = findStringByKey(child, keys, predicate, depth + 1);
        if (nested) return nested;
    }
}

export function collectModelIdentifiers(value: unknown, depth = 0): string[] {
    if (depth > 6 || value == null) return [];
    if (Array.isArray(value)) {
        return value.flatMap(item => collectModelIdentifiers(item, depth + 1));
    }
    if (typeof value !== 'object') return [];
    const identifiers: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (['id', 'name', 'model', 'modelId'].includes(key) && typeof child === 'string') {
            identifiers.push(child);
        } else if (typeof child === 'object' && child != null) {
            identifiers.push(...collectModelIdentifiers(child, depth + 1));
        }
    }
    return identifiers;
}

export function sameModelIdentifier(left: string, right: string): boolean {
    const normalize = (value: string) =>
        value
            .trim()
            .replace(/^models\//iu, '')
            .toLowerCase();
    return normalize(left) === normalize(right);
}
