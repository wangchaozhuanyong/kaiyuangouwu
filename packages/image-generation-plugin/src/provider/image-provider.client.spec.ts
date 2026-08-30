import { afterEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_GENERATION_DELIVERY_TIMEOUT_MS } from '../constants';
import { ImageProviderCredential } from '../entities/image-provider-credential.entity';
import { type ImageProviderCipherService } from '../security/image-provider-cipher.service';

import {
    AmbiguousImageProviderError,
    DefinitiveImageProviderError,
    ImageProviderClient,
    RetryableImageProviderError,
} from './image-provider.client';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('ImageProviderClient', () => {
    const safeUrls = {
        validate: vi.fn((value: string) => Promise.resolve(new URL(value))),
        endpoint: vi.fn(
            (base: URL, pathname: string) => new URL(`${base.toString().replace(/\/$/u, '')}/${pathname}`),
        ),
        resolveRemoteImage: vi.fn((value: string) =>
            Promise.resolve({ url: new URL(value), address: '93.184.216.34', family: 4 }),
        ),
    };
    const cipher = {
        decrypt: vi.fn(() => 'relay-key'),
        encrypt: vi.fn(() => 'encrypted'),
    } as unknown as ImageProviderCipherService;
    const credential = new ImageProviderCredential({
        scope: 'OPENAI',
        enabled: true,
        baseUrl: 'https://relay.example.com/v1',
        encryptedApiKey: 'encrypted',
        textModelId: 'text-model',
        healthStatus: 'HEALTHY',
    });

    it('optimizes prompts through the Gemini native JSON endpoint', async () => {
        const geminiCredential = new ImageProviderCredential({
            ...credential,
            scope: 'GEMINI',
            textModelId: 'models/gemini-3.1-flash-lite',
        });
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    responseId: 'gemini-prompt-1',
                    candidates: [
                        {
                            content: {
                                parts: [
                                    { text: '{"useCase":"product-photo",' },
                                    { text: '"subject":"coffee maker"}' },
                                ],
                            },
                        },
                    ],
                    usageMetadata: { totalTokenCount: 42 },
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal('fetch', fetchMock);
        const client = new ImageProviderClient(cipher, safeUrls);

        const result = await client.optimizePrompt(
            geminiCredential,
            'Return strict JSON',
            'Make a product photo',
        );

        expect(result.text).toBe('{"useCase":"product-photo",\n"subject":"coffee maker"}');
        expect(result.telemetry).toEqual(
            expect.objectContaining({
                providerRequestId: 'gemini-prompt-1',
                usage: { totalTokenCount: 42 },
            }),
        );
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url.pathname).toBe('/v1/models/gemini-3.1-flash-lite:generateContent');
        expect(init.headers).toEqual(expect.objectContaining({ 'x-goog-api-key': 'relay-key' }));
        expect(parseJsonRequestBody(init)).toEqual(
            expect.objectContaining({
                systemInstruction: { parts: [{ text: 'Return strict JSON' }] },
                generationConfig: expect.objectContaining({ responseMimeType: 'application/json' }),
            }),
        );
    });

    it('uses the Responses image tool with separate orchestration and image models', async () => {
        const encoded = Buffer.from('responses-image-bytes'.repeat(16)).toString('base64');
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: 'response-1',
                    output: [
                        { type: 'image_generation_call', id: 'image-call-1', result: encoded },
                        { type: 'message', content: [] },
                    ],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            ),
        );
        vi.stubGlobal('fetch', fetchMock);
        const client = new ImageProviderClient(cipher, safeUrls);

        const result = await client.generate(credential, 'OPENAI_RESPONSES_IMAGE', {
            providerModelId: 'gpt-image-1',
            prompt: 'keep the product and replace the background',
            aspectRatio: '3:4',
            references: [
                { bytes: Buffer.from('reference-image-1'), mimeType: 'image/png' },
                { bytes: Buffer.from('reference-image-2'), mimeType: 'image/jpeg' },
            ],
            idempotencyKey: 'image-responses-1',
        });

        expect(result).toMatchObject({ mimeType: 'image/png', providerRequestId: 'response-1' });
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url).toEqual(new URL('https://relay.example.com/v1/responses'));
        expect(init.headers).toEqual(expect.objectContaining({ 'idempotency-key': 'image-responses-1' }));
        expect(parseJsonRequestBody(init)).toEqual(
            expect.objectContaining({
                model: 'text-model',
                input: [
                    expect.objectContaining({
                        role: 'user',
                        content: [
                            expect.objectContaining({ type: 'input_text' }),
                            expect.objectContaining({ type: 'input_image' }),
                            expect.objectContaining({ type: 'input_image' }),
                        ],
                    }),
                ],
                tools: [
                    expect.objectContaining({
                        type: 'image_generation',
                        model: 'gpt-image-1',
                        quality: 'medium',
                        size: '1024x1536',
                        action: 'edit',
                    }),
                ],
                tool_choice: { type: 'image_generation' },
                store: false,
            }),
        );
    });

    it('keeps base64 image payloads out of persisted provider metadata', async () => {
        const encoded = Buffer.from('fake-image-bytes').toString('base64');
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ id: 'request-1', data: [{ b64_json: encoded.repeat(16) }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const client = new ImageProviderClient(cipher, safeUrls);

        const result = await client.generate(credential, 'OPENAI_IMAGES', {
            providerModelId: 'gpt-image-2',
            prompt: 'product photo',
            aspectRatio: '16:9',
            resolution: '4K',
            idempotencyKey: 'image-job-1',
        });

        expect(result.providerRequestId).toBe('request-1');
        expect(result.metadata).toEqual(
            expect.objectContaining({ delivery: 'inline', providerRequestId: 'request-1' }),
        );
        expect(JSON.stringify(result.metadata)).not.toContain(encoded);
        const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(parseJsonRequestBody(init)).toEqual(
            expect.objectContaining({ model: 'gpt-image-2', quality: 'medium', size: '3840x2160' }),
        );
    });

    it('classifies HTTP 429 as the only automatic retry condition', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        const client = new ImageProviderClient(cipher, safeUrls);

        await expect(
            client.generate(credential, 'OPENAI_IMAGES', {
                providerModelId: 'gpt-image-2',
                prompt: 'product photo',
                aspectRatio: '1:1',
                idempotencyKey: 'image-job-2',
            }),
        ).rejects.toBeInstanceOf(RetryableImageProviderError);
    });

    it('classifies uncertain upstream failures separately from definitive request failures', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('{"error":"timeout at relay"}', { status: 504 }))
            .mockResolvedValueOnce(new Response('{"error":"invalid input"}', { status: 400 }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new ImageProviderClient(cipher, safeUrls);
        const input = {
            providerModelId: 'gpt-image-2',
            prompt: 'product photo',
            aspectRatio: '1:1',
            idempotencyKey: 'image-job-http-failure',
        };

        await expect(client.generate(credential, 'OPENAI_IMAGES', input)).rejects.toBeInstanceOf(
            AmbiguousImageProviderError,
        );
        await expect(client.generate(credential, 'OPENAI_IMAGES', input)).rejects.toBeInstanceOf(
            DefinitiveImageProviderError,
        );
    });

    it('captures request, usage, and cost telemetry without storing response image bytes', async () => {
        const encoded = Buffer.from('telemetry-image'.repeat(16)).toString('base64');
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        id: 'cost-request-1',
                        data: [{ b64_json: encoded }],
                        usage: { total_tokens: 321, total_cost: 0.004672 },
                    }),
                    { status: 200, headers: { 'x-request-id': 'header-request-1' } },
                ),
            ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        const result = await client.generate(credential, 'OPENAI_IMAGES', {
            providerModelId: 'gpt-image-2',
            prompt: 'product photo',
            aspectRatio: '1:1',
            idempotencyKey: 'image-job-telemetry',
        });

        expect(result.telemetry).toEqual(
            expect.objectContaining({
                httpStatus: 200,
                providerRequestId: 'cost-request-1',
                actualCostMicrounits: 4_672,
                costCurrency: 'USD',
                usage: { total_tokens: 321, total_cost: 0.004672 },
            }),
        );
        expect(JSON.stringify(result.telemetry)).not.toContain(encoded);
    });

    it('keeps cost telemetry when the paid response does not contain a usable image', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        id: 'charged-invalid-image',
                        data: [],
                        usage: { total_cost: 0.15 },
                    }),
                    { status: 200 },
                ),
            ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        try {
            await client.generate(credential, 'OPENAI_IMAGES', {
                providerModelId: 'gpt-image-2',
                prompt: 'product photo',
                aspectRatio: '1:1',
                idempotencyKey: 'image-job-invalid-paid-response',
            });
            throw new Error('Expected generation to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(DefinitiveImageProviderError);
            expect((error as DefinitiveImageProviderError).details).toEqual(
                expect.objectContaining({
                    providerRequestId: 'charged-invalid-image',
                    actualCostMicrounits: 150_000,
                    costCurrency: 'USD',
                }),
            );
        }
    });

    it('accepts a data URL embedded in an OpenAI-compatible chat response', async () => {
        const encoded = Buffer.from('chat-image-bytes'.repeat(12)).toString('base64');
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    content: `Generated image: data:image/webp;base64,${encoded}`,
                                },
                            },
                        ],
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        const result = await client.generate(credential, 'OPENAI_COMPATIBLE_CHAT', {
            providerModelId: 'relay-gemini-image',
            prompt: 'product photo',
            aspectRatio: '1:1',
            idempotencyKey: 'image-job-3',
        });

        expect(result.mimeType).toBe('image/webp');
        expect(result.bytes.length).toBeGreaterThan(0);
        expect(JSON.stringify(result.metadata)).not.toContain(encoded);
    });

    it('supports Gemini Interactions image generation and reference input', async () => {
        const encoded = Buffer.from('interaction-image-bytes'.repeat(16)).toString('base64');
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: 'interaction-1',
                    output_image: { type: 'image', mime_type: 'image/jpeg', data: encoded },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            ),
        );
        vi.stubGlobal('fetch', fetchMock);
        const client = new ImageProviderClient(cipher, safeUrls);

        const result = await client.generate(credential, 'GEMINI_INTERACTIONS', {
            providerModelId: 'models/gemini-3.1-flash-image',
            prompt: 'keep the product and replace the background',
            aspectRatio: '3:4',
            resolution: '4K',
            references: [
                { bytes: Buffer.from('reference-image-1'), mimeType: 'image/png' },
                { bytes: Buffer.from('reference-image-2'), mimeType: 'image/jpeg' },
            ],
            idempotencyKey: 'image-job-interactions-1',
        });

        expect(result).toMatchObject({ mimeType: 'image/jpeg', providerRequestId: 'interaction-1' });
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url).toEqual(new URL('https://relay.example.com/v1/interactions'));
        expect(init.headers).toEqual(
            expect.objectContaining({
                'idempotency-key': 'image-job-interactions-1',
                'x-goog-api-key': 'relay-key',
            }),
        );
        expect(parseJsonRequestBody(init)).toEqual(
            expect.objectContaining({
                model: 'gemini-3.1-flash-image',
                input: [
                    { type: 'text', text: 'keep the product and replace the background' },
                    expect.objectContaining({ type: 'image', mime_type: 'image/png' }),
                    expect.objectContaining({ type: 'image', mime_type: 'image/jpeg' }),
                ],
                response_format: {
                    type: 'image',
                    mime_type: 'image/png',
                    aspect_ratio: '3:4',
                    image_size: '4K',
                },
            }),
        );
    });

    it('supports Gemini native SSE image generation without waiting for a synchronous edge response', async () => {
        const encoded = Buffer.from('stream-image-bytes'.repeat(16)).toString('base64');
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                [
                    `data: ${JSON.stringify({ responseId: 'gemini-stream-1', candidates: [] })}`,
                    '',
                    `data: ${JSON.stringify({
                        candidates: [
                            {
                                content: {
                                    parts: [{ inlineData: { mimeType: 'image/jpeg', data: encoded } }],
                                },
                            },
                        ],
                    })}`,
                    '',
                    'data: [DONE]',
                    '',
                ].join('\n'),
                { status: 200, headers: { 'content-type': 'text/event-stream' } },
            ),
        );
        vi.stubGlobal('fetch', fetchMock);
        const client = new ImageProviderClient(cipher, safeUrls);

        const result = await client.generate(credential, 'GEMINI_NATIVE_STREAM', {
            providerModelId: 'gemini-3.1-flash-image',
            prompt: 'keep the product and replace the background',
            aspectRatio: '3:4',
            resolution: '2K',
            reference: { bytes: Buffer.from('reference-image'), mimeType: 'image/png' },
            idempotencyKey: 'image-job-gemini-stream-1',
        });

        expect(result).toMatchObject({ mimeType: 'image/jpeg' });
        expect(result.bytes.length).toBeGreaterThan(0);
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url).toEqual(
            new URL(
                'https://relay.example.com/v1/models/gemini-3.1-flash-image:streamGenerateContent?alt=sse',
            ),
        );
        expect(init.headers).toEqual(
            expect.objectContaining({
                accept: 'text/event-stream',
                'idempotency-key': 'image-job-gemini-stream-1',
                'x-goog-api-key': 'relay-key',
            }),
        );
        expect(parseJsonRequestBody(init)).toEqual(
            expect.objectContaining({
                contents: [
                    {
                        role: 'user',
                        parts: [
                            expect.objectContaining({ text: expect.stringContaining('Aspect ratio: 3:4') }),
                            expect.objectContaining({
                                inlineData: expect.objectContaining({ mimeType: 'image/png' }),
                            }),
                        ],
                    },
                ],
                generationConfig: expect.objectContaining({
                    responseModalities: ['TEXT', 'IMAGE'],
                    imageConfig: { aspectRatio: '3:4', imageSize: '2K' },
                }),
            }),
        );
    });

    it('keeps an image request open beyond the ordinary 120-second API timeout', async () => {
        vi.useFakeTimers();
        const requestState: { signal?: AbortSignal } = {};
        vi.stubGlobal(
            'fetch',
            vi.fn(
                (_url: URL, init: RequestInit) =>
                    new Promise<Response>((_resolve, reject) => {
                        requestState.signal = init.signal as AbortSignal;
                        requestState.signal.addEventListener('abort', () => {
                            const abortError = new Error('aborted');
                            abortError.name = 'AbortError';
                            reject(abortError);
                        });
                    }),
            ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        const result: Promise<Error> = client
            .generate(credential, 'OPENAI_IMAGES', {
                providerModelId: 'gpt-image-2',
                prompt: 'product photo',
                aspectRatio: '1:1',
                idempotencyKey: 'image-job-long-running',
            })
            .then(
                () => {
                    throw new Error('Expected the provider request to time out');
                },
                reason => reason as Error,
            );
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(120_000);

        expect(requestState.signal?.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(IMAGE_GENERATION_DELIVERY_TIMEOUT_MS - 120_000);
        const timeoutError = await result;
        expect(timeoutError).toBeInstanceOf(AmbiguousImageProviderError);
        expect(timeoutError.message).toBe('中转站在 10 分钟内未返回完整生图结果');
    });

    it('accepts a Gemini stream whose image body arrives after 120 seconds', async () => {
        vi.useFakeTimers();
        const encoded = Buffer.from('delayed-stream-image'.repeat(16)).toString('base64');
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                setTimeout(() => {
                    controller.enqueue(
                        new TextEncoder().encode(
                            `data: ${JSON.stringify({
                                responseId: 'gemini-delayed-stream-1',
                                candidates: [
                                    {
                                        content: {
                                            parts: [{ inlineData: { mimeType: 'image/png', data: encoded } }],
                                        },
                                    },
                                ],
                            })}\n\ndata: [DONE]\n\n`,
                        ),
                    );
                    controller.close();
                }, 121_000);
            },
        });
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValue(
                    new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
                ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        const result = client.generate(credential, 'GEMINI_NATIVE_STREAM', {
            providerModelId: 'gemini-3.1-flash-image',
            prompt: 'product photo',
            aspectRatio: '1:1',
            idempotencyKey: 'image-job-delayed-stream',
        });
        await vi.advanceTimersByTimeAsync(121_000);

        await expect(result).resolves.toMatchObject({
            mimeType: 'image/png',
            providerRequestId: 'gemini-delayed-stream-1',
        });
    });

    it('verifies a relay model through the read-only metadata endpoint', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ id: 'gpt-image-2' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        await expect(client.testModel(credential, 'gpt-image-2')).resolves.toEqual({
            ok: true,
            message: expect.stringContaining('只读元数据端点'),
        });
        expect(fetch).toHaveBeenCalledWith(
            new URL('https://relay.example.com/v1/models/gpt-image-2'),
            expect.objectContaining({ method: 'GET' }),
        );
    });

    it('falls back to the model list and supports Gemini models/name identifiers', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(new Response('', { status: 404 }))
                .mockResolvedValueOnce(
                    new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.1-flash-image' }] }), {
                        status: 200,
                    }),
                ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        await expect(client.testModel(credential, 'gemini-3.1-flash-image')).resolves.toEqual({
            ok: true,
            message: expect.stringContaining('模型列表'),
        });
    });
});

function parseJsonRequestBody(init: RequestInit): unknown {
    if (typeof init.body !== 'string') {
        throw new TypeError('Expected a JSON string request body');
    }
    return JSON.parse(init.body);
}
