import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    GoogleCloudTranslationProvider,
    googleTranslationInternals,
} from './google-cloud-translation.provider.js';

describe('GoogleCloudTranslationProvider', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('protects glossary terms, variables and URLs', () => {
        const protectedValue = googleTranslationInternals.protectText(
            '大马通优惠 {discount}，访问 https://example.com',
            { 大马通: 'Damatong' },
        );

        expect(protectedValue.text).not.toContain('大马通');
        expect(protectedValue.text).not.toContain('{discount}');
        expect(protectedValue.restore(protectedValue.text)).toBe(
            'Damatong优惠 {discount}，访问 https://example.com',
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
        json: async () => body,
    };
}
