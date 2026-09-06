import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    GoogleCloudTranslationProvider,
    googleTranslationInternals,
} from './google-cloud-translation.provider.js';

describe('GoogleCloudTranslationProvider', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    const request = {
        sourceLanguageCode: 'zh_Hans' as const,
        targetLanguageCode: 'en' as const,
        segments: [{ key: 'label', text: '商业服务' }],
    };

    it('recognizes Google 403 rate limits and cools down before another request', async () => {
        vi.useFakeTimers();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ...response({ error: { message: 'User Rate Limit Exceeded' } }, false),
                status: 403,
            })
            .mockResolvedValueOnce(
                response({ data: { translations: [{ translatedText: 'Business services' }] } }),
            );
        vi.stubGlobal('fetch', fetchMock);
        const provider = new GoogleCloudTranslationProvider({ apiKey: 'test-key' });
        await expect(provider.translate(request)).rejects.toMatchObject({ code: 'RATE_LIMIT' });
        await expect(provider.translate(request)).rejects.toMatchObject({ code: 'RATE_LIMIT' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(60_000);
        await expect(provider.translate(request)).resolves.toMatchObject({
            translations: [{ key: 'label', text: 'Business services' }],
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
        [403, 'Daily Limit Exceeded', 'QUOTA'],
        [403, 'API key not valid', 'CONFIGURATION'],
        [429, 'Too many requests', 'RATE_LIMIT'],
        [503, 'Unavailable', 'UNAVAILABLE'],
    ])('classifies provider failure %s without exposing upstream detail', async (status, message, code) => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ...response({ error: { message } }, false), status }),
        );
        const provider = new GoogleCloudTranslationProvider({ apiKey: 'test-key' });
        await expect(provider.translate(request)).rejects.toMatchObject({ code });
    });

    it('bounds requests and hides credentials from transport errors', async () => {
        const fetchMock = vi
            .fn()
            .mockRejectedValue(new Error('failed https://translation.test/?key=private-key'));
        vi.stubGlobal('fetch', fetchMock);
        const provider = new GoogleCloudTranslationProvider({ apiKey: 'private-key' });
        await expect(provider.translate(request)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
        expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it('protects glossary terms, variables and URLs', () => {
        const protectedValue = googleTranslationInternals.protectText(
            '模钥 优惠 {discount}，访问 https://example.com',
            { 模钥: 'MOYAO AI' },
        );

        expect(protectedValue.text).not.toContain('模钥');
        expect(protectedValue.text).not.toContain('{discount}');
        expect(protectedValue.restore(protectedValue.text)).toBe(
            'MOYAO AI 优惠 {discount}，访问 https://example.com',
        );
    });

    it('preserves the separator after a protected glossary term', () => {
        const protectedValue = googleTranslationInternals.protectText('ChatGPT', {
            ChatGPT: 'ChatGPT',
        });
        const tokenWithInsertedSpaces = [...protectedValue.text].join(' ');

        expect(protectedValue.restore(`${tokenWithInsertedSpaces} Subscription`)).toBe(
            'ChatGPT Subscription',
        );
    });

    it('translates text and HTML in separate batches', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(response({ data: { translations: [{ translatedText: 'Coffee' }] } }))
            .mockResolvedValueOnce(
                response({ data: { translations: [{ translatedText: '&lt;p&gt;Details&lt;/p&gt;' }] } }),
            );
        vi.stubGlobal('fetch', fetchMock);
        const provider = new GoogleCloudTranslationProvider({ apiKey: 'test-key' });

        await expect(
            provider.translate({
                sourceLanguageCode: 'zh_Hans',
                targetLanguageCode: 'en',
                segments: [
                    { key: 'name', text: '咖啡' },
                    { key: 'description', text: '<p>详情</p>', format: 'HTML' },
                ],
            }),
        ).resolves.toEqual({
            provider: 'google-cloud-translation-basic',
            translations: [
                { key: 'name', text: 'Coffee' },
                { key: 'description', text: '<p>Details</p>' },
            ],
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not claim to be configured without an API key', () => {
        expect(new GoogleCloudTranslationProvider({ apiKey: '' }).isConfigured()).toBe(false);
    });
});

function response(body: unknown, ok = true): Pick<Response, 'ok' | 'status' | 'json'> {
    return {
        ok,
        status: ok ? 200 : 400,
        json: () => Promise.resolve(body),
    };
}
