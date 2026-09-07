import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContentTranslationRequest } from '../types.js';

import { AzureTranslationProvider } from './azure-translation.provider.js';

const request: ContentTranslationRequest = {
    sourceLanguageCode: 'zh_Hans',
    targetLanguageCode: 'en',
    segments: [{ key: 'title', text: '普通文具' }],
};
const success = (text = 'Ordinary stationery') =>
    new Response(JSON.stringify([{ translations: [{ to: 'en', text }] }]));
const failure = (status: number, code: number, retryAfter?: string) =>
    new Response(JSON.stringify({ error: { code, message: 'Untrusted upstream error detail' } }), {
        status,
        headers: retryAfter ? { 'Retry-After': retryAfter } : {},
    });
const provider = (region?: string) => new AzureTranslationProvider({ apiKey: 'test-key', region });

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Azure Translator standard NMT v3 fallback', () => {
    it('uses the official endpoint, header authentication and the standard translation API', async () => {
        const fetch = vi.fn().mockResolvedValue(success());
        vi.stubGlobal('fetch', fetch);
        await expect(provider().translate(request)).resolves.toEqual({
            provider: 'azure-translator-v3',
            translations: [{ key: 'title', text: 'Ordinary stationery' }],
        });
        const url = fetch.mock.calls[0][0] as URL;
        const options = fetch.mock.calls[0][1] as RequestInit;
        expect(url.origin + url.pathname).toBe('https://api.cognitive.microsofttranslator.com/translate');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            'api-version': '3.0',
            from: 'zh-Hans',
            to: 'en',
            textType: 'plain',
        });
        expect(url.toString()).not.toContain('test-key');
        expect(options.headers).toEqual({
            'Content-Type': 'application/json; charset=UTF-8',
            'Ocp-Apim-Subscription-Key': 'test-key',
        });
        expect(options.redirect).toBe('error');
        expect(options.signal).toBeInstanceOf(AbortSignal);
        if (typeof options.body !== 'string') throw new Error('Expected a JSON string body');
        expect(JSON.parse(options.body)).toEqual([{ Text: '普通文具' }]);
    });

    it.each([
        [' EastAsia ', 'eastasia'],
        ['global', undefined],
        ['', undefined],
    ])(
        'handles the resource region %s without confusing Global resources with regional ones',
        async (region, header) => {
            const fetch = vi.fn().mockResolvedValue(success());
            vi.stubGlobal('fetch', fetch);
            await provider(region).translate(request);
            expect(fetch.mock.calls[0][1].headers['Ocp-Apim-Subscription-Region']).toBe(header);
        },
    );

    it('does not call Azure when the key is absent', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const disabled = new AzureTranslationProvider({ apiKey: '  ' });
        expect(disabled.isConfigured()).toBe(false);
        await expect(disabled.translate(request)).rejects.toMatchObject({ code: 'CONFIGURATION' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('preserves brands, interpolations and links', async () => {
        const fetch = vi.fn((_url: URL, options: RequestInit) => {
            if (typeof options.body !== 'string') throw new Error('Expected a JSON string body');
            const input = JSON.parse(options.body) as Array<{ Text: string }>;
            return Promise.resolve(success(input[0].Text.replace('文具', ' Stationery ')));
        });
        vi.stubGlobal('fetch', fetch);
        const result = await provider().translate({
            ...request,
            glossary: { 品牌: 'Store Brand' },
            segments: [{ key: 'name', text: '品牌文具{{name}} https://example.com/product' }],
        });
        expect(result.translations[0].text).toBe(
            'Store Brand Stationery {{name}} https://example.com/product',
        );
    });

    it('rejects silently dropped protected text', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(success('Stationery')));
        await expect(
            provider().translate({
                ...request,
                segments: [{ key: 'name', text: '文具 {{name}}' }],
            }),
        ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('separates plain and HTML batches while preserving source field order and escaped user text', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(success('Stationery'))
            .mockResolvedValueOnce(success('<p>Details &lt;img src=x&gt;</p>'));
        vi.stubGlobal('fetch', fetch);
        const result = await provider().translate({
            ...request,
            segments: [
                { key: 'description', text: '<p>详情 &lt;img src=x&gt;</p>', format: 'HTML' },
                { key: 'name', text: '文具' },
            ],
        });
        expect(result.translations).toEqual([
            { key: 'description', text: '<p>Details &lt;img src=x&gt;</p>' },
            { key: 'name', text: 'Stationery' },
        ]);
        expect((fetch.mock.calls[0][0] as URL).searchParams.get('textType')).toBe('plain');
        expect((fetch.mock.calls[1][0] as URL).searchParams.get('textType')).toBe('html');
    });

    it('preserves completed fields when F0 quota expires between format batches', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValueOnce(success()).mockResolvedValueOnce(failure(403, 403001)),
        );
        await expect(
            provider().translate({
                ...request,
                segments: [...request.segments, { key: 'details', text: '<p>详情</p>', format: 'HTML' }],
            }),
        ).rejects.toMatchObject({
            code: 'QUOTA',
            retryAfterMs: 3_600_000,
            translations: [{ key: 'title', text: 'Ordinary stationery' }],
        });
    });

    it.each([
        [403, 403001, 'QUOTA'],
        [403, 403000, 'CONFIGURATION'],
        [401, 401000, 'CONFIGURATION'],
        [429, 429001, 'RATE_LIMIT'],
        [408, 408002, 'UNAVAILABLE'],
        [503, 503000, 'UNAVAILABLE'],
        [400, 400050, 'TEXT_TOO_LONG'],
        [400, 400020, 'INVALID_CONTENT'],
    ])('maps Azure HTTP %s / %s to %s without exposing upstream messages', async (status, code, expected) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failure(status, code)));
        await expect(provider().translate(request)).rejects.toMatchObject({
            code: expected,
            message: expect.not.stringContaining('Untrusted upstream error detail'),
        });
    });

    it('honors longer Retry-After cooldowns', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(failure(429, 429000, '120'))
                .mockResolvedValueOnce(failure(403, 403001, '7200')),
        );
        await expect(provider().translate(request)).rejects.toMatchObject({
            code: 'RATE_LIMIT',
            retryAfterMs: 120_000,
        });
        await expect(provider().translate(request)).rejects.toMatchObject({
            code: 'QUOTA',
            retryAfterMs: 7_200_000,
        });
    });

    it.each([
        null,
        {},
        [],
        [{ translations: [] }],
        [{ translations: [{ to: 'zh-Hans', text: 'Wrong language' }] }],
        [{ translations: [{ to: 'en', text: '仍是中文' }] }],
        [{ translations: [{ to: 'en', text: '' }] }],
    ])('rejects malformed or unusable results', async body => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
        await expect(provider().translate(request)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('handles non-JSON throttling and hides transport secrets', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(new Response('<html>busy</html>', { status: 429 }))
                .mockRejectedValueOnce(new Error('transport includes test-key')),
        );
        await expect(provider().translate(request)).rejects.toMatchObject({ code: 'RATE_LIMIT' });
        await expect(provider().translate(request)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    });

    it('rejects requests over the documented character or array limits before network access', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        await expect(
            provider().translate({
                ...request,
                segments: [{ key: 'large', text: '文'.repeat(50_001) }],
            }),
        ).rejects.toMatchObject({ code: 'TEXT_TOO_LONG' });
        await expect(
            provider().translate({
                ...request,
                segments: Array.from({ length: 1001 }, (_, i) => ({ key: String(i), text: '文' })),
            }),
        ).rejects.toMatchObject({ code: 'TEXT_TOO_LONG' });
        expect(fetch).not.toHaveBeenCalled();
    });
});
