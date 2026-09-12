export interface AdminOrderNotification {
    kind: 'order-placed' | 'order-pending';
    version: 1;
    id: string;
    orderId: string;
    occurredAt: string;
}

export async function readAdminOrderStream(
    response: Response,
    signal: AbortSignal,
    handlers: { ready: (cursor: string) => void; order: (event: AdminOrderNotification) => void },
): Promise<void> {
    if (
        !response.ok ||
        !response.headers.get('content-type')?.includes('text/event-stream') ||
        !response.body
    ) {
        await response.body?.cancel();
        throw new Error('Order event stream unavailable');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const cancel = () => {
        void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        while (!signal.aborted) {
            const { value, done } = await reader.read();
            if (done || signal.aborted) return;
            buffer += decoder.decode(value, { stream: true });
            let separator: RegExpExecArray | null;
            while ((separator = /\r?\n\r?\n/.exec(buffer))) {
                const frame = buffer.slice(0, separator.index);
                buffer = buffer.slice(separator.index + separator[0].length);
                if (frame.length > 65536) throw new Error('Order event frame too large');
                dispatchFrame(frame, handlers);
            }
            if (buffer.length > 65536) throw new Error('Order event frame too large');
        }
    } finally {
        signal.removeEventListener('abort', cancel);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

function dispatchFrame(frame: string, handlers: Parameters<typeof readAdminOrderStream>[2]): void {
    let event = '';
    let id = '';
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
        const separator = line.indexOf(':');
        if (separator < 1) continue;
        const field = line.slice(0, separator);
        const value = line.slice(separator + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        if (field === 'id') id = value;
        if (field === 'data') data.push(value);
    }
    if (!data.length || (event !== 'ready' && event !== 'order-placed' && event !== 'order-pending')) return;
    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(data.join('\n'));
    } catch {
        return;
    }
    if (!payload || payload.version !== 1) return;
    if (event === 'ready' && validId(payload.cursor)) handlers.ready(payload.cursor);
    if (
        (event === 'order-placed' || event === 'order-pending') &&
        validId(id) &&
        payload.id === id &&
        validId(payload.orderId) &&
        typeof payload.occurredAt === 'string' &&
        Number.isFinite(Date.parse(payload.occurredAt))
    ) {
        handlers.order({ ...payload, kind: event } as unknown as AdminOrderNotification);
    }
}

function validId(value: unknown): value is string {
    return typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,200}$/.test(value);
}
