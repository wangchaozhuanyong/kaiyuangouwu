import { afterEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_GENERATION_DELIVERY_TIMEOUT_MS } from '../constants';
import { ImageProviderCredential } from '../entities/image-provider-credential.entity';
import { type ImageProviderCipherService } from '../security/image-provider-cipher.service';

import { responseTelemetry } from './image-provider-telemetry';
import {
    AmbiguousImageProviderError,
    DefinitiveImageProviderError,
    ImageProviderClient,
    LocalImageProcessingError,
    RetryableImageProviderError,
} from './image-provider.client';

// Protocol unit tests substitute only the socket transport; integration tests use real sockets.
vi.mock('./image-provider-io', async importOriginal => ({
    ...(await importOriginal<typeof import('./image-provider-io')>()),
    pinnedProviderRequest: (target: { url: URL }, init: RequestInit) => fetch(target.url, init),
}));

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('ImageProviderClient', () => {
    const safeUrls = {
        resolveForRequest: vi.fn((value: string) =>
            Promise.resolve({ url: new URL(value), address: '93.184.216.34', family: 4 }),
        ),
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
        orchestrationModelId: 'orchestration-model',
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
            'models/gemini-3.1-flash-lite',
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

    it.each(['OPENAI', 'GEMINI'] as const)(
        'keeps charged response telemetry when the %s prompt optimizer returns no text',
        async scope => {
            const usage = { total_tokens: 42, total_cost: 0.015, currency: 'USD' };
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue(
                    new Response(
                        JSON.stringify(
                            scope === 'GEMINI'
                                ? {
                                      responseId: 'empty-prompt-response',
                                      candidates: [{ content: { parts: [{ text: '   ' }] } }],
                                      usageMetadata: usage,
                                  }
                                : {
                                      id: 'empty-prompt-response',
                                      choices: [{ message: { content: null } }],
                                      usage,
                                  },
                        ),
                        { status: 200 },
                    ),
                ),
            );
            const client = new ImageProviderClient(cipher, safeUrls);

            await expect(
                client.optimizePrompt(
                    new ImageProviderCredential({ ...credential, scope }),
                    'vision-model',
                    'Return JSON',
                    'Extract the bag from the reference',
                ),
            ).rejects.toMatchObject({
                name: 'DefinitiveImageProviderError',
                details: {
                    httpStatus: 200,
                    providerRequestId: 'empty-prompt-response',
                    reportedCostEvidence: { amount: 0.015, currency: 'USD', field: 'usage.total_cost' },
                    usage: { total_tokens: 42, total_cost: 0.015 },
                },
            });
        },
    );

    it.each(['OPENAI', 'GEMINI'] as const)(
        'sends numbered reference images to the %s prompt optimizer',
        async scope => {
            const fetchMock = vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify(
                        scope === 'GEMINI'
                            ? {
                                  candidates: [{ content: { parts: [{ text: '{"subject":"袋装咖啡"}' }] } }],
                              }
                            : { choices: [{ message: { content: '{"subject":"袋装咖啡"}' } }] },
                    ),
                    { status: 200 },
                ),
            );
            vi.stubGlobal('fetch', fetchMock);
            const client = new ImageProviderClient(cipher, safeUrls);
            const references = [
                { bytes: Buffer.from('woman-holding-coffee-bag'), mimeType: 'image/png' },
                { bytes: Buffer.from('studio-background'), mimeType: 'image/jpeg' },
            ];

            await client.optimizePrompt(
                new ImageProviderCredential({ ...credential, scope }),
                'vision-model',
                'Return JSON',
                '把图1女人手里的咖啡做成商品图，使用图2背景',
                references,
            );

            const body = parseJsonRequestBody(fetchMock.mock.calls[0][1] as RequestInit);
            const labels = ['Reference image 1 (图1)', 'Reference image 2 (图2)'];
            if (scope === 'GEMINI') {
                expect(body).toMatchObject({
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                { text: '把图1女人手里的咖啡做成商品图，使用图2背景' },
                                { text: labels[0] },
                                {
                                    inlineData: {
                                        mimeType: 'image/png',
                                        data: references[0].bytes.toString('base64'),
                                    },
                                },
                                { text: labels[1] },
                                {
                                    inlineData: {
                                        mimeType: 'image/jpeg',
                                        data: references[1].bytes.toString('base64'),
                                    },
                                },
                            ],
                        },
                    ],
                });
            } else {
                expect(body).toMatchObject({
                    messages: [
                        { role: 'system', content: 'Return JSON' },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: '把图1女人手里的咖啡做成商品图，使用图2背景' },
                                { type: 'text', text: labels[0] },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:image/png;base64,${references[0].bytes.toString('base64')}`,
                                    },
                                },
                                { type: 'text', text: labels[1] },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:image/jpeg;base64,${references[1].bytes.toString('base64')}`,
                                    },
                                },
                            ],
                        },
                    ],
                });
            }
        },
    );

    it('keeps text-only OpenAI prompt requests compatible', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: '{"subject":"袋装咖啡"}' } }],
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal('fetch', fetchMock);
        await new ImageProviderClient(cipher, safeUrls).optimizePrompt(
            credential,
            'text-model',
            'Return JSON',
            '袋装咖啡商品图',
        );
        expect(parseJsonRequestBody(fetchMock.mock.calls[0][1] as RequestInit)).toMatchObject({
            messages: [
                { role: 'system', content: 'Return JSON' },
                { role: 'user', content: '袋装咖啡商品图' },
            ],
        });
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
                model: 'orchestration-model',
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
        const encoded = Buffer.from('fake-image-bytes'.repeat(16)).toString('base64');
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ id: 'request-1', data: [{ b64_json: encoded }] }), {
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
                headerRequestId: 'header-request-1',
                modelResponseId: 'cost-request-1',
                reportedCostEvidence: { amount: 0.004672, currency: null, field: 'usage.total_cost' },
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
                    reportedCostEvidence: { amount: 0.15, currency: null, field: 'usage.total_cost' },
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

    it('decodes a multi-megabyte Gemini 4K SSE image without a RegExp stack overflow', async () => {
        const source = Buffer.alloc(7 * 1024 * 1024, 0xab);
        const encoded = source.toString('base64');
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                [
                    `data: ${JSON.stringify({ responseId: 'gemini-stream-4k', candidates: [] })}`,
                    '',
                    `data: ${JSON.stringify({
                        candidates: [
                            {
                                content: {
                                    parts: [
                                        { text: 'Generated a square product image.' },
                                        { inlineData: { mimeType: 'image/png', data: encoded } },
                                    ],
                                },
                            },
                        ],
                        usageMetadata: { totalTokenCount: 2_520 },
                    })}`,
                    '',
                    'data: [DONE]',
                    '',
                ].join('\n'),
                {
                    status: 200,
                    headers: { 'content-type': 'text/event-stream', 'x-request-id': 'relay-stream-4k' },
                },
            ),
        );
        vi.stubGlobal('fetch', fetchMock);
        const client = new ImageProviderClient(cipher, safeUrls);

        const result = await client.generate(credential, 'GEMINI_NATIVE_STREAM', {
            providerModelId: 'gemini-3.1-flash-image',
            prompt: 'square product campaign',
            aspectRatio: '1:1',
            resolution: '4K',
            idempotencyKey: 'image-job-gemini-stream-4k',
        });

        expect(result.bytes.equals(source)).toBe(true);
        expect(result).toMatchObject({
            mimeType: 'image/png',
            providerRequestId: 'gemini-stream-4k',
            telemetry: {
                httpStatus: 200,
                providerRequestId: 'gemini-stream-4k',
                usage: { totalTokenCount: 2_520 },
            },
        });
        expect(JSON.stringify(result.metadata)).not.toContain(encoded.slice(0, 1_000));
        const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(parseJsonRequestBody(init)).toEqual(
            expect.objectContaining({
                generationConfig: expect.objectContaining({
                    imageConfig: { aspectRatio: '1:1', imageSize: '4K' },
                }),
            }),
        );
    }, 15_000);

    it('keeps response telemetry when inline image decoding fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        id: 'invalid-image-response',
                        data: [{ b64_json: 'not-valid-base64!!!' }],
                    }),
                    { status: 200, headers: { 'x-request-id': 'invalid-image-header' } },
                ),
            ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        try {
            await client.generate(credential, 'OPENAI_IMAGES', {
                providerModelId: 'gpt-image-2',
                prompt: 'product photo',
                aspectRatio: '1:1',
                idempotencyKey: 'image-job-invalid-base64',
            });
            throw new Error('Expected generation to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(DefinitiveImageProviderError);
            expect((error as Error).message).toBe('中转站返回了无效的图片编码');
            expect((error as DefinitiveImageProviderError).details).toEqual(
                expect.objectContaining({ httpStatus: 200, providerRequestId: 'invalid-image-response' }),
            );
        }
    });

    it('converts unexpected local parsing failures into a safe error with telemetry', async () => {
        const client = new ImageProviderClient(cipher, safeUrls);
        const response = new Proxy<Record<string, unknown>>(
            {},
            {
                ownKeys() {
                    throw new RangeError('Maximum call stack size exceeded');
                },
            },
        );
        const invokeImageResult = client as unknown as {
            imageResult(
                value: unknown,
                telemetry: { httpStatus: number; providerRequestId: string },
            ): Promise<unknown>;
        };

        try {
            await invokeImageResult.imageResult(response, {
                httpStatus: 200,
                providerRequestId: 'local-parser-response',
            });
            throw new Error('Expected generation to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(LocalImageProcessingError);
            expect((error as Error).message).toBe('中转站返回的图片无法解析');
            expect((error as LocalImageProcessingError).sourceErrorName).toBe('RangeError');
            expect((error as LocalImageProcessingError).details).toEqual({
                httpStatus: 200,
                providerRequestId: 'local-parser-response',
            });
        }
    });

    it('rejects decoded images above 25MB before allocating the output buffer', async () => {
        const encoded = 'A'.repeat(Math.ceil((25 * 1024 * 1024) / 3) * 4 + 4);
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValue(
                    new Response(
                        JSON.stringify({ id: 'oversized-image-response', data: [{ b64_json: encoded }] }),
                        { status: 200 },
                    ),
                ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        await expect(
            client.generate(credential, 'OPENAI_IMAGES', {
                providerModelId: 'gpt-image-2',
                prompt: 'oversized product photo',
                aspectRatio: '1:1',
                idempotencyKey: 'image-job-oversized-base64',
            }),
        ).rejects.toMatchObject({
            message: '中转站图片超过 25MB',
            details: { httpStatus: 200, providerRequestId: 'oversized-image-response' },
        });
    }, 15_000);

    it('supports snake_case Gemini inline image parts', async () => {
        const encoded = Buffer.from('snake-case-gemini-image'.repeat(16)).toString('base64');
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    `data: ${JSON.stringify({
                        responseId: 'gemini-snake-case',
                        candidates: [
                            {
                                content: {
                                    parts: [{ inline_data: { mime_type: 'image/webp', data: encoded } }],
                                },
                            },
                        ],
                    })}\n\ndata: [DONE]\n\n`,
                    { status: 200, headers: { 'content-type': 'text/event-stream' } },
                ),
            ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        await expect(
            client.generate(credential, 'GEMINI_NATIVE_STREAM', {
                providerModelId: 'gemini-3.1-flash-image',
                prompt: 'product photo',
                aspectRatio: '4:3',
                resolution: '2K',
                idempotencyKey: 'image-job-gemini-snake-case',
            }),
        ).resolves.toMatchObject({ mimeType: 'image/webp', providerRequestId: 'gemini-snake-case' });
    });

    it('rejects malformed Gemini SSE with HTTP telemetry intact', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response('data: {not-json}\n\n', {
                    status: 200,
                    headers: { 'content-type': 'text/event-stream', 'x-request-id': 'malformed-sse' },
                }),
            ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        try {
            await client.generate(credential, 'GEMINI_NATIVE_STREAM', {
                providerModelId: 'gemini-3.1-flash-image',
                prompt: 'product photo',
                aspectRatio: '1:1',
                resolution: '4K',
                idempotencyKey: 'image-job-malformed-sse',
            });
            throw new Error('Expected generation to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(DefinitiveImageProviderError);
            expect((error as Error).message).toBe('中转站返回了无效的 Gemini 流式数据');
            expect((error as DefinitiveImageProviderError).details).toEqual({
                httpStatus: 200,
                providerRequestId: 'malformed-sse',
                headerRequestId: 'malformed-sse',
                headerRequestIdSource: 'x-request-id',
            });
        }
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

describe('provider audit evidence boundaries', () => {
    it('keeps the final cumulative stream snapshot without summing or mixing earlier frames', () => {
        const telemetry = responseTelemetry(new Response('', { headers: { 'x-request-id': 'gateway-id' } }), [
            {
                responseId: 'model-id',
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8, totalTokenCount: 18 },
            },
            {
                responseId: 'model-id',
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 20,
                    thoughtsTokenCount: 5,
                    totalTokenCount: 35,
                },
            },
        ]);
        expect(telemetry).toMatchObject({
            headerRequestId: 'gateway-id',
            modelResponseId: 'model-id',
            usage: { totalTokenCount: 35, thoughtsTokenCount: 5 },
        });
    });
    it('does not classify a header-only request as a model response', () => {
        const telemetry = responseTelemetry(new Response('', { headers: { 'request-id': 'gateway' } }), {});
        expect(telemetry.headerRequestId).toBe('gateway');
        expect(telemetry.modelResponseId).toBeUndefined();
    });
    it('does not turn unverified cost or missing currency into an actual USD charge', () => {
        const telemetry = responseTelemetry(new Response(''), { usage: { total_cost: 0.1 } });
        expect(telemetry.actualCostMicrounits).toBeUndefined();
        expect(telemetry.costCurrency).toBeUndefined();
        expect(telemetry.reportedCostEvidence).toMatchObject({ amount: 0.1, currency: null });
    });
});
