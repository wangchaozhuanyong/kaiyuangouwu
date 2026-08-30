import { describe, expect, it } from 'vitest';

import { classifyImageGenerationFailure } from './image-generation-failure';
import {
    AmbiguousImageProviderError,
    DefinitiveImageProviderError,
    LocalImageProcessingError,
    RetryableImageProviderError,
} from './provider/image-provider.client';

describe('classifyImageGenerationFailure', () => {
    it('keeps local parsing and storage failures out of Key health', () => {
        expect(
            classifyImageGenerationFailure(
                new LocalImageProcessingError(
                    'Maximum call stack size exceeded',
                    { httpStatus: 200 },
                    'RangeError',
                ),
                'RESPONSE_RECEIVED',
            ),
        ).toMatchObject({
            code: 'LOCAL_IMAGE_PROCESSING',
            affectsProviderHealth: false,
            publicMessage: expect.not.stringContaining('Maximum call stack'),
        });
        expect(classifyImageGenerationFailure(new Error('disk full'), 'RESPONSE_RECEIVED')).toMatchObject({
            code: 'STORAGE',
            affectsProviderHealth: false,
        });
    });

    it('separates authentication, rate limiting and ambiguous results', () => {
        expect(
            classifyImageGenerationFailure(
                new DefinitiveImageProviderError('unauthorized', { httpStatus: 401 }),
                'REQUEST_STARTED',
            ),
        ).toMatchObject({ code: 'UPSTREAM_AUTH', retryable: true, ambiguous: false });
        expect(
            classifyImageGenerationFailure(
                new RetryableImageProviderError('rate limited', {
                    httpStatus: 429,
                    retryAfterSeconds: 30,
                }),
                'REQUEST_STARTED',
            ),
        ).toMatchObject({ code: 'UPSTREAM_RATE_LIMIT', retryable: true });
        expect(
            classifyImageGenerationFailure(
                new AmbiguousImageProviderError('中转站请求超时'),
                'REQUEST_STARTED',
            ),
        ).toMatchObject({ code: 'UPSTREAM_TIMEOUT', retryable: false, ambiguous: true });
    });

    it('classifies invalid and oversized responses with stable public messages', () => {
        expect(
            classifyImageGenerationFailure(
                new DefinitiveImageProviderError('中转站响应中没有可识别的图片', { httpStatus: 200 }),
                'RESPONSE_RECEIVED',
            ),
        ).toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
        expect(
            classifyImageGenerationFailure(
                new DefinitiveImageProviderError('中转站图片超过 25MB', { httpStatus: 200 }),
                'RESPONSE_RECEIVED',
            ),
        ).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    });

    it('classifies an exhausted credential pool without penalizing a Key', () => {
        expect(classifyImageGenerationFailure(new Error('没有可路由的健康 Key'), 'CLAIMED')).toMatchObject({
            code: 'CREDENTIAL_UNAVAILABLE',
            affectsProviderHealth: false,
            retryable: false,
        });
    });
});
