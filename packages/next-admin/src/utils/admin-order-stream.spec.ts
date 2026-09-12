import { describe, expect, it, vi } from 'vitest';
import { readAdminOrderStream } from './admin-order-stream';

async function read(chunks: string[]) {
    const handlers = { ready: vi.fn(), order: vi.fn() };
    const response = new Response(
        new ReadableStream({
            start(controller) {
                for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
                controller.close();
            },
        }),
        { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    );
    await readAdminOrderStream(response, new AbortController().signal, handlers);
    return handlers;
}

describe('SSE decoding', () => {
    it('handles split CRLF frames, comments and multiple frames in one chunk', async () => {
        const handlers = await read([
            ': heart',
            'beat\r\n\r',
            '\nevent: ready\r\ndata: {"version":1,"cursor":"server:0"}\r\n\r\n',
            'id: server:1\nevent: order-placed\ndata: {"version":1,\n',
            'data: "id":"server:1","orderId":"1","occurredAt":"2026-09-10T00:00:00Z"}\n\n',
        ]);
        expect(handlers.ready).toHaveBeenCalledExactlyOnceWith('server:0');
        expect(handlers.order).toHaveBeenCalledExactlyOnceWith({
            kind: 'order-placed',
            version: 1,
            id: 'server:1',
            orderId: '1',
            occurredAt: '2026-09-10T00:00:00Z',
        });
    });
    it('ignores unknown event types, malformed data and mismatched IDs', async () => {
        const handlers = await read([
            'event: invalidate\ndata: {}\n\nevent: order-placed\ndata: broken\n\n',
            'id: a\nevent: order-placed\ndata: {"version":1,"id":"b","orderId":"1","occurredAt":"2026-09-10"}\n\n',
        ]);
        expect(handlers.order).not.toHaveBeenCalled();
    });
    it('rejects a non-stream response instead of accepting an HTML login page', async () => {
        await expect(
            readAdminOrderStream(new Response('<html/>'), new AbortController().signal, {
                ready: vi.fn(),
                order: vi.fn(),
            }),
        ).rejects.toThrow('unavailable');
    });
    it('bounds malformed frames', async () => {
        await expect(read(['a'.repeat(65537)])).rejects.toThrow('too large');
    });
});
