import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageProviderCipherService } from '../security/image-provider-cipher.service';

import { ImageProviderCredential } from '../entities/image-provider-credential.entity';

import { ImageProviderClient, RetryableImageProviderError } from './image-provider.client';

afterEach(() => vi.unstubAllGlobals());

describe('ImageProviderClient', () => {
    const safeUrls = {
        validate: vi.fn((value: string) => Promise.resolve(new URL(value))),
        endpoint: vi.fn(
            (base: URL, pathname: string) => new URL(`${base.toString().replace(/\/$/u, '')}/${pathname}`),
        ),
    };
    const cipher = {
        decrypt: vi.fn(() => 'relay-key'),
        encrypt: vi.fn(() => 'encrypted'),
    } as unknown as ImageProviderCipherService;
    const credential = new ImageProviderCredential({
        enabled: true,
        baseUrl: 'https://relay.example.com/v1',
        encryptedApiKey: 'encrypted',
        textModelId: 'text-model',
        healthStatus: 'HEALTHY',
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
            reference: { bytes: Buffer.from('reference-image'), mimeType: 'image/png' },
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
                        ],
                    }),
                ],
                tools: [
                    expect.objectContaining({
                        type: 'image_generation',
                        model: 'gpt-image-1',
                        quality: 'low',
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
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ id: 'request-1', data: [{ b64_json: encoded.repeat(16) }] }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            ),
        );
        const client = new ImageProviderClient(cipher, safeUrls);

        const result = await client.generate(credential, 'OPENAI_IMAGES', {
            providerModelId: 'gpt-image-2',
            prompt: 'product photo',
            aspectRatio: '1:1',
            idempotencyKey: 'image-job-1',
        });

        expect(result.providerRequestId).toBe('request-1');
        expect(result.metadata).toEqual(
            expect.objectContaining({ delivery: 'inline', providerRequestId: 'request-1' }),
        );
        expect(JSON.stringify(result.metadata)).not.toContain(encoded);
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
            reference: { bytes: Buffer.from('reference-image'), mimeType: 'image/png' },
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
                ],
                response_format: {
                    type: 'image',
                    mime_type: 'image/png',
                    aspect_ratio: '3:4',
                    image_size: '1K',
                },
            }),
        );
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
