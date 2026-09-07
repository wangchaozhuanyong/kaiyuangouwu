import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContentTranslationRequest } from '../types.js';

import {
    MyMemoryTranslationProvider,
    myMemoryTranslationInternals,
} from './mymemory-translation.provider.js';

const request = (text = '普通文具', format: 'TEXT' | 'HTML' = 'TEXT'): ContentTranslationRequest => ({
    sourceLanguageCode: 'zh_Hans',
    targetLanguageCode: 'en',
    segments: [{ key: 'name', text, format }],
});
const success = (translatedText: string) =>
    new Response(
        JSON.stringify({
            responseStatus: 200,
            quotaFinished: false,
            responseData: { translatedText },
        }),
    );
afterEach(() => vi.unstubAllGlobals());

describe('official free MyMemory fallback', () => {
    it('uses the documented free endpoint without an email, credentials or spoofed identity', async () => {
        const fetch = vi.fn().mockResolvedValue(success('Ordinary stationery'));
        vi.stubGlobal('fetch', fetch);
        await expect(new MyMemoryTranslationProvider().translate(request())).resolves.toEqual({
            provider: 'mymemory-free',
            translations: [{ key: 'name', text: 'Ordinary stationery' }],
        });
        const url = fetch.mock.calls[0][0] as URL;
        expect(url.origin + url.pathname).toBe('https://api.mymemory.translated.net/get');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            q: '普通文具',
            langpair: 'zh-CN|en',
            mt: '1',
        });
        expect(fetch.mock.calls[0][1]).not.toHaveProperty('headers');
        expect(fetch.mock.calls[0][1]).toHaveProperty('redirect', 'error');
    });

    it('uses only the explicitly configured contact email through the documented de parameter', async () => {
        const fetch = vi.fn().mockResolvedValue(success('Ordinary stationery'));
        vi.stubGlobal('fetch', fetch);
        const provider = new MyMemoryTranslationProvider({
            contactEmail: '  shop+translation@example.com  ',
        });
        expect(provider.isConfigured()).toBe(true);
        await provider.translate(request());
        const url = fetch.mock.calls[0][0] as URL;
        expect(Object.fromEntries(url.searchParams)).toEqual({
            q: '普通文具',
            langpair: 'zh-CN|en',
            mt: '1',
            de: 'shop+translation@example.com',
        });
        expect(provider.name).toBe(new MyMemoryTranslationProvider().name);
        expect(fetch.mock.calls[0][1]).toHaveProperty('redirect', 'error');
    });

    it('keeps a blank contact email anonymous', async () => {
        const fetch = vi.fn().mockResolvedValue(success('Ordinary stationery'));
        vi.stubGlobal('fetch', fetch);
        await new MyMemoryTranslationProvider({ contactEmail: '  ' }).translate(request());
        expect((fetch.mock.calls[0][0] as URL).searchParams.has('de')).toBe(false);
    });

    it.each(['not-an-email', 'two@example.com other@example.com', 'name@example.com\ninjected'])(
        'rejects an invalid contact configuration before sending text: %s',
        async contactEmail => {
            const fetch = vi.fn();
            vi.stubGlobal('fetch', fetch);
            const provider = new MyMemoryTranslationProvider({ contactEmail });
            expect(provider.isConfigured()).toBe(false);
            await expect(provider.translate(request())).rejects.toMatchObject({ code: 'CONFIGURATION' });
            expect(fetch).not.toHaveBeenCalled();
        },
    );

    it('does not expose the contact email from a network failure', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('https://example.com/?de=shop@example.com')),
        );
        const provider = new MyMemoryTranslationProvider({ contactEmail: 'shop@example.com' });
        await expect(provider.translate(request())).rejects.toMatchObject({
            code: 'UNAVAILABLE',
            message: expect.not.stringContaining('shop@example.com'),
        });
    });

    it('protects glossary terms, interpolation and links', async () => {
        const fetch = vi.fn((url: URL) =>
            Promise.resolve(success((url.searchParams.get('q') ?? '').replace('服务', 'service'))),
        );
        vi.stubGlobal('fetch', fetch);
        const result = await new MyMemoryTranslationProvider().translate({
            ...request('模钥服务 {{name}} https://example.com/product'),
            glossary: { 模钥: 'MOYAO AI' },
        });
        expect(result.translations[0].text).toBe('MOYAO AIservice {{name}} https://example.com/product');
        expect(fetch.mock.calls[0][0].searchParams.get('q')).not.toContain('https://example.com');
    });

    it('rejects a translation that drops protected content', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(success('Service')));
        await expect(
            new MyMemoryTranslationProvider().translate(request('服务 {{name}}')),
        ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('rejects a translation that silently drops a repeated glossary term', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(success('ZXQTERM0000QXZ service')));
        await expect(
            new MyMemoryTranslationProvider().translate({
                ...request('模钥服务 模钥'),
                glossary: { 模钥: 'MOYAO AI' },
            }),
        ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('preserves rich-text tags and attributes and escapes supplier-generated markup', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(success('<img src=x onerror=alert(1)> Stationery')));
        const result = await new MyMemoryTranslationProvider().translate(
            request('<p class="a>b">普通文具</p>', 'HTML'),
        );
        expect(result.translations[0].text).toBe(
            '<p class="a>b">&lt;img src=x onerror=alert(1)&gt; Stationery</p>',
        );
    });

    it.each(['<p title="中文">文具</p>', '<script>中文</script>', '<pre>中文</pre>'])(
        'leaves unsupported markup for the primary provider: %s',
        async html => {
            const fetch = vi.fn();
            vi.stubGlobal('fetch', fetch);
            await expect(
                new MyMemoryTranslationProvider().translate(request(html, 'HTML')),
            ).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
            expect(fetch).not.toHaveBeenCalled();
        },
    );

    it('splits long Unicode text at the 500-byte limit without splitting tokens or paragraphs', () => {
        const text = '文'.repeat(164) + 'ZXQTERM0000QXZ' + '商品'.repeat(100) + '\n第二段';
        const chunks = myMemoryTranslationInternals.splitText(text);
        expect(chunks.every(chunk => Buffer.byteLength(chunk, 'utf8') <= 500)).toBe(true);
        expect(chunks.filter(chunk => chunk.includes('ZXQTERM'))[0]).toContain('ZXQTERM0000QXZ');
        expect(chunks).toContain('\n');
        expect(chunks.join('').replace(/ /g, '')).toBe(text);
    });

    it('reuses duplicate text in one request', async () => {
        const fetch = vi.fn().mockImplementation(() => Promise.resolve(success('Stationery')));
        vi.stubGlobal('fetch', fetch);
        const result = await new MyMemoryTranslationProvider().translate({
            ...request(),
            segments: [
                { key: 'a', text: '文具' },
                { key: 'b', text: '文具' },
            ],
        });
        expect(result.translations).toHaveLength(2);
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('returns completed fields with a mid-batch quota error instead of losing them', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(success('Stationery'))
                .mockResolvedValueOnce(
                    new Response(JSON.stringify({ responseStatus: 429, quotaFinished: true })),
                ),
        );
        await expect(
            new MyMemoryTranslationProvider().translate({
                ...request(),
                segments: [
                    { key: 'a', text: '文具' },
                    { key: 'b', text: '商品' },
                ],
            }),
        ).rejects.toMatchObject({
            code: 'QUOTA',
            retryAfterMs: 3_600_000,
            translations: [{ key: 'a', text: 'Stationery' }],
        });
    });

    it.each([
        [{ responseStatus: 200, responseData: { translatedText: '仍是中文' } }, 'INVALID_RESPONSE'],
        [{ responseStatus: 200, responseData: { translatedText: '' } }, 'INVALID_RESPONSE'],
        [
            {
                responseStatus: 200,
                responseData: {
                    translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS',
                },
            },
            'INVALID_RESPONSE',
        ],
        [{ responseStatus: 429, quotaFinished: true }, 'QUOTA'],
        [{ responseStatus: 503 }, 'UNAVAILABLE'],
    ])('rejects unusable responses without caching an error message', async (body, code) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
        await expect(new MyMemoryTranslationProvider().translate(request())).rejects.toMatchObject({ code });
    });

    it('converts HTTP throttling and network outages into retryable provider failures', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(new Response('', { status: 429 }))
            .mockRejectedValueOnce(new Error('offline'));
        vi.stubGlobal('fetch', fetch);
        await expect(new MyMemoryTranslationProvider().translate(request())).rejects.toMatchObject({
            code: 'RATE_LIMIT',
        });
        await expect(new MyMemoryTranslationProvider().translate(request())).rejects.toMatchObject({
            code: 'UNAVAILABLE',
        });
    });
});
