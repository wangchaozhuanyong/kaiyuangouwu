import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { TelegramClient, TelegramClientError } from './telegram-client';

const servers: Server[] = [];

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))),
    );
});

describe('TelegramClient', () => {
    it('sends JSON POST messages with HTML mode, silence and a URL button', async () => {
        let receivedPath = '';
        let receivedBody: Record<string, unknown> = {};
        const url = await startServer(async request => {
            receivedPath = request.url ?? '';
            receivedBody = await jsonBody(request);
            return { status: 200, body: { ok: true, result: { message_id: 987654321 } } };
        });
        const client = new TelegramClient({ token: 'test-token', apiBaseUrl: url });

        const result = await client.sendMessage({
            chatId: '-1001234567890',
            text: '<b>内部通知</b>',
            silent: true,
            button: { label: '打开后台', url: 'https://console.example.com/orders/1' },
        });

        expect(result.messageId).toBe('987654321');
        expect(receivedPath).toBe('/bottest-token/sendMessage');
        expect(receivedBody).toMatchObject({
            chat_id: '-1001234567890',
            text: '<b>内部通知</b>',
            parse_mode: 'HTML',
            disable_notification: true,
        });
        expect(receivedBody.reply_markup).toEqual({
            inline_keyboard: [[{ text: '打开后台', url: 'https://console.example.com/orders/1' }]],
        });
    });

    it('uses retry_after returned by Telegram for 429 responses', async () => {
        const url = await startServer(() =>
            Promise.resolve({
                status: 429,
                body: {
                    ok: false,
                    error_code: 429,
                    description: 'Too Many Requests',
                    parameters: { retry_after: 17 },
                },
            }),
        );
        const client = new TelegramClient({ token: 'test-token', apiBaseUrl: url });

        await expect(client.sendMessage({ chatId: '-1001', text: 'test' })).rejects.toMatchObject({
            code: 'RATE_LIMITED',
            retryable: true,
            retryAfterSeconds: 17,
        } satisfies Partial<TelegramClientError>);
    });

    it('marks authorization failures as non-retryable without exposing the token', async () => {
        const url = await startServer(() =>
            Promise.resolve({
                status: 401,
                body: { ok: false, error_code: 401, description: 'Unauthorized test-token' },
            }),
        );
        const client = new TelegramClient({ token: 'test-token', apiBaseUrl: url });

        const error = await client.sendMessage({ chatId: '-1001', text: 'test' }).catch(value => value);
        expect(error).toBeInstanceOf(TelegramClientError);
        expect(error).toMatchObject({ code: 'AUTHORIZATION', retryable: false });
        expect(String(error.message)).not.toContain('test-token');
    });
});

async function startServer(
    handler: (request: import('node:http').IncomingMessage) => Promise<{ status: number; body: unknown }>,
): Promise<string> {
    const server = createServer((request, response) => {
        void handler(request).then(result => {
            response.statusCode = result.status;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(result.body));
        });
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server failed to bind');
    return `http://127.0.0.1:${address.port}`;
}

async function jsonBody(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}
