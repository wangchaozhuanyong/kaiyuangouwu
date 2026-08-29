import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ImageProviderCredential } from '../entities/image-provider-credential.entity';
import { type ImageProviderCipherService } from '../security/image-provider-cipher.service';
import { type SafeProviderUrlService } from '../security/safe-provider-url.service';

import { ImageProviderClient } from './image-provider.client';

interface RelayRequest {
    method: string;
    path: string;
    headers: IncomingMessage['headers'];
    body: Buffer;
}

const imageBase64 = Buffer.from('mock-provider-image-bytes-'.repeat(16)).toString('base64');
const requests: RelayRequest[] = [];
let baseUrl = '';

const server = createServer((request, response) => {
    void handleRequest(request, response);
});

beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('模拟中转站未返回 TCP 地址');
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
});

beforeEach(() => {
    requests.length = 0;
});

describe('ImageProviderClient mock relay integration', () => {
    const cipher = { decrypt: () => 'mock-relay-key' } as unknown as ImageProviderCipherService;
    const safeUrls: SafeProviderUrlService = {
        validate: (value: string) => Promise.resolve(new URL(value)),
        endpoint: (base: URL, pathname: string) =>
            new URL(`${base.toString().replace(/\/$/u, '')}/${pathname.replace(/^\//u, '')}`),
        resolveRemoteImage: (value: string) =>
            Promise.resolve({ url: new URL(value), address: '127.0.0.1', family: 4 }),
    };
    const credential = new ImageProviderCredential({
        scope: 'OPENAI',
        enabled: true,
        encryptedApiKey: 'encrypted',
        textModelId: 'prompt-model',
        healthStatus: 'HEALTHY',
    });

    function client(): ImageProviderClient {
        credential.baseUrl = baseUrl;
        return new ImageProviderClient(cipher, safeUrls);
    }

    it('tests the exact model without creating an image', async () => {
        const result = await client().testModel(credential, 'gpt-image-2');

        expect(result.ok).toBe(true);
        expect(requests).toHaveLength(1);
        expect(requests[0]).toEqual(
            expect.objectContaining({ method: 'GET', path: '/v1/models/gpt-image-2' }),
        );
        expect(requests[0].headers.authorization).toBe('Bearer mock-relay-key');
    });

    it('generates and edits through the OpenAI Images protocol', async () => {
        const provider = client();
        const generated = await provider.generate(credential, 'OPENAI_IMAGES', {
            providerModelId: 'gpt-image-2',
            prompt: 'clean product photo',
            aspectRatio: '16:9',
            idempotencyKey: 'output-generate-1',
        });
        const edited = await provider.generate(credential, 'OPENAI_IMAGES', {
            providerModelId: 'gpt-image-2',
            prompt: 'keep product and replace background',
            aspectRatio: '1:1',
            reference: { bytes: Buffer.from('reference-image'), mimeType: 'image/png' },
            idempotencyKey: 'output-edit-1',
        });

        expect(generated.bytes.toString('base64')).toBe(imageBase64);
        expect(edited.bytes.toString('base64')).toBe(imageBase64);
        const generationRequest = requests.find(item => item.path === '/v1/images/generations');
        expect(JSON.parse(generationRequest?.body.toString('utf8') ?? '{}')).toEqual(
            expect.objectContaining({ model: 'gpt-image-2', size: '1104x624' }),
        );
        expect(generationRequest?.headers['idempotency-key']).toBe('output-generate-1');
        const editRequest = requests.find(item => item.path === '/v1/images/edits');
        expect(editRequest?.headers['content-type']).toContain('multipart/form-data');
        expect(editRequest?.body.toString('utf8')).toContain('keep product and replace background');
    });

    it('generates through the OpenAI Responses image tool protocol', async () => {
        const result = await client().generate(credential, 'OPENAI_RESPONSES_IMAGE', {
            providerModelId: 'gpt-image-1',
            prompt: 'cute astronaut cat sticker',
            aspectRatio: '1:1',
            idempotencyKey: 'output-responses-1',
        });

        expect(result.bytes.toString('base64')).toBe(imageBase64);
        expect(result.providerRequestId).toBe('responses-request');
        expect(requests[0].path).toBe('/v1/responses');
        expect(requests[0].headers['idempotency-key']).toBe('output-responses-1');
        expect(JSON.parse(requests[0].body.toString('utf8'))).toEqual(
            expect.objectContaining({
                model: 'prompt-model',
                tools: [
                    expect.objectContaining({
                        type: 'image_generation',
                        model: 'gpt-image-1',
                        quality: 'low',
                        size: '1024x1024',
                        action: 'generate',
                    }),
                ],
                store: false,
            }),
        );
    });

    it('supports OpenAI-compatible chat image responses', async () => {
        const result = await client().generate(credential, 'OPENAI_COMPATIBLE_CHAT', {
            providerModelId: 'relay-image-chat',
            prompt: 'editorial portrait',
            aspectRatio: '3:4',
            idempotencyKey: 'output-chat-1',
        });

        expect(result.mimeType).toBe('image/webp');
        expect(result.bytes.toString('base64')).toBe(imageBase64);
        const relayRequest = requests[0];
        expect(relayRequest.path).toBe('/v1/chat/completions');
        expect(JSON.parse(relayRequest.body.toString('utf8'))).toEqual(
            expect.objectContaining({ model: 'relay-image-chat', modalities: ['text', 'image'] }),
        );
    });

    it('supports Gemini native inline image responses and API-key header', async () => {
        const result = await client().generate(credential, 'GEMINI_NATIVE', {
            providerModelId: 'gemini-3.1-flash-image',
            prompt: 'luxury interior',
            aspectRatio: '9:16',
            idempotencyKey: 'output-gemini-1',
        });

        expect(result.mimeType).toBe('image/png');
        expect(result.bytes.toString('base64')).toBe(imageBase64);
        expect(requests[0].path).toBe('/v1/models/gemini-3.1-flash-image:generateContent');
        expect(requests[0].headers['x-goog-api-key']).toBe('mock-relay-key');
    });

    it('supports the current Gemini Interactions image protocol', async () => {
        const result = await client().generate(credential, 'GEMINI_INTERACTIONS', {
            providerModelId: 'gemini-3.1-flash-image',
            prompt: 'clean product campaign',
            aspectRatio: '4:3',
            idempotencyKey: 'output-gemini-interactions-1',
        });

        expect(result.mimeType).toBe('image/jpeg');
        expect(result.bytes.toString('base64')).toBe(imageBase64);
        expect(requests[0].path).toBe('/v1/interactions');
        expect(requests[0].headers['x-goog-api-key']).toBe('mock-relay-key');
        expect(JSON.parse(requests[0].body.toString('utf8'))).toEqual(
            expect.objectContaining({
                model: 'gemini-3.1-flash-image',
                response_format: expect.objectContaining({ aspect_ratio: '4:3', image_size: '1K' }),
            }),
        );
    });

    it('optimizes prompts through the configured text model', async () => {
        const result = await client().optimizePrompt(credential, 'Return JSON', 'make this prompt better');

        expect(result.text).toBe('{"subject":"product"}');
        expect(result.telemetry?.httpStatus).toBe(200);
        const payload = JSON.parse(requests[0].body.toString('utf8')) as { model: string };
        expect(payload.model).toBe('prompt-model');
        expect(requests[0].headers['idempotency-key']).toMatch(/^prompt-/u);
    });

    it('optimizes prompts through a Gemini credential when selected', async () => {
        const geminiCredential = new ImageProviderCredential({
            ...credential,
            scope: 'GEMINI',
            textModelId: 'gemini-text-model',
        });
        geminiCredential.baseUrl = baseUrl;

        const result = await client().optimizePrompt(
            geminiCredential,
            'Return JSON',
            'make this prompt better',
        );

        expect(result.text).toBe('{"subject":"gemini-product"}');
        expect(requests[0].path).toBe('/v1/models/gemini-text-model:generateContent');
        expect(requests[0].headers['x-goog-api-key']).toBe('mock-relay-key');
    });
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const path = new URL(request.url ?? '/', 'http://relay.test').pathname;
    requests.push({
        method: request.method ?? 'GET',
        path,
        headers: request.headers,
        body: Buffer.concat(chunks),
    });

    if (request.method === 'GET' && path === '/v1/models/gpt-image-2') {
        return sendJson(response, { id: 'gpt-image-2' });
    }
    if (request.method === 'GET' && path === '/v1/models') {
        return sendJson(response, { data: [{ id: 'gpt-image-2' }] });
    }
    if (path === '/v1/images/generations' || path === '/v1/images/edits') {
        return sendJson(response, { id: 'openai-request', data: [{ b64_json: imageBase64 }] });
    }
    if (path === '/v1/responses') {
        return sendJson(response, {
            id: 'responses-request',
            output: [{ type: 'image_generation_call', result: imageBase64 }],
        });
    }
    if (path === '/v1/chat/completions') {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model?: string };
        if (payload.model === 'prompt-model') {
            return sendJson(response, { choices: [{ message: { content: '{"subject":"product"}' } }] });
        }
        return sendJson(response, {
            id: 'chat-request',
            choices: [{ message: { content: `data:image/webp;base64,${imageBase64}` } }],
        });
    }
    if (path === '/v1/models/gemini-3.1-flash-image:generateContent') {
        return sendJson(response, {
            responseId: 'gemini-request',
            candidates: [
                { content: { parts: [{ inlineData: { mimeType: 'image/png', data: imageBase64 } }] } },
            ],
        });
    }
    if (path === '/v1/models/gemini-text-model:generateContent') {
        return sendJson(response, {
            responseId: 'gemini-prompt-request',
            candidates: [{ content: { parts: [{ text: '{"subject":"gemini-product"}' }] } }],
        });
    }
    if (path === '/v1/interactions') {
        return sendJson(response, {
            id: 'gemini-interaction-request',
            output_image: { type: 'image', mime_type: 'image/jpeg', data: imageBase64 },
        });
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"not found"}');
}

function sendJson(response: ServerResponse, payload: unknown): void {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
}
