import { createHash, randomUUID } from 'node:crypto';
import { chmod, unlink } from 'node:fs/promises';
import { createConnection, createServer, Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface MailChange {
    kind: 'mail' | 'access';
    eventId: string;
    cursor?: string;
    primaryAccountId?: string;
    virtualEmailId?: string | null;
}

/** Same-host API/worker broadcast. Durable recovery remains in the mail outbox. */
export class IcloudMailBridge {
    private server?: Server;
    private socket?: Socket;
    private readonly peers = new Set<Socket>();
    private retry?: ReturnType<typeof setTimeout>;
    private stopped = false;
    private connecting = false;
    private failures = 0;
    private readonly queued = new Map<string, MailChange>();
    private readonly path: string;

    constructor(
        namespace: string,
        private readonly receive: (event: MailChange) => void,
        private readonly disconnected: () => void,
        path?: string,
    ) {
        const hash = createHash('sha256').update(namespace).digest('hex').slice(0, 24);
        this.path = path ?? join(tmpdir(), `vendure-mail-${process.getuid?.() ?? 'user'}-${hash}.sock`);
    }

    start() {
        void this.connect();
    }

    get connected() {
        return !this.stopped && this.socket?.readyState === 'open';
    }

    publish(event: MailChange) {
        // A failed publisher connection invalidates connected readers. Reconnection
        // performs one durable reconciliation, including events committed while offline.
        if (this.socket?.readyState === 'open') {
            if (!this.socket.write(`${JSON.stringify(event)}\n`)) this.socket.destroy();
        } else {
            this.queued.set(event.eventId, event);
            if (this.queued.size > 1000) {
                this.queued.clear();
                const change: MailChange = { kind: 'access', eventId: randomUUID() };
                this.queued.set(change.eventId, change);
            }
            this.disconnected();
        }
    }

    async stop() {
        this.stopped = true;
        if (this.retry) clearTimeout(this.retry);
        this.socket?.destroy();
        for (const peer of this.peers) peer.destroy();
        if (this.server) {
            await new Promise<void>(resolve => this.server?.close(() => resolve()));
        }
    }

    private async connect() {
        if (this.stopped || this.connecting) return;
        this.connecting = true;
        try {
            await this.attach();
            this.failures = 0;
        } catch (error) {
            if (this.stopped) return;
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT' || code === 'ECONNREFUSED') {
                if (code === 'ECONNREFUSED') await unlink(this.path).catch(() => undefined);
                await this.elect().catch(() => undefined);
            }
            this.disconnected();
            if (!this.stopped)
                this.retry = setTimeout(
                    () => void this.connect(),
                    Math.min(30_000, 100 * 2 ** Math.min(this.failures++, 8)),
                );
        } finally {
            this.connecting = false;
        }
    }

    private attach() {
        return new Promise<void>((resolve, reject) => {
            const socket = createConnection(this.path);
            socket.once('error', reject);
            socket.once('connect', () => {
                if (this.stopped) {
                    socket.destroy();
                    resolve();
                    return;
                }
                this.socket = socket;
                this.frames(socket, event => this.receive(event));
                socket.once('close', () => {
                    this.socket = undefined;
                    this.disconnected();
                    if (!this.stopped) this.retry = setTimeout(() => void this.connect(), 100);
                });
                for (const event of this.queued.values()) {
                    if (!socket.write(`${JSON.stringify(event)}\n`)) {
                        socket.destroy();
                        break;
                    }
                }
                this.queued.clear();
                resolve();
            });
        });
    }

    private elect() {
        return new Promise<void>((resolve, reject) => {
            const server = createServer(socket => {
                this.peers.add(socket);
                this.frames(socket, event => this.broadcast(event));
                socket.once('close', () => {
                    this.peers.delete(socket);
                    // A publisher can disconnect between commit and broadcast. Force
                    // every reader to reconcile rather than silently miss that event.
                    this.broadcast({ kind: 'access', eventId: randomUUID() });
                });
                // A restarted publisher may have committed mail while disconnected
                // and lost its in-memory queue. Its durable outbox is reconciled now.
                this.broadcast({ kind: 'access', eventId: randomUUID() });
            });
            server.once('error', reject);
            server.listen(this.path, () => {
                if (this.stopped) {
                    server.close(() => resolve());
                    return;
                }
                this.server = server;
                void chmod(this.path, 0o600).then(resolve, reject);
            });
        });
    }

    private broadcast(event: MailChange) {
        const frame = `${JSON.stringify(event)}\n`;
        for (const peer of this.peers) if (!peer.write(frame)) peer.destroy();
    }

    private frames(socket: Socket, receive: (event: MailChange) => void) {
        let pending = '';
        socket.on('error', () => undefined);
        socket.on('data', chunk => {
            pending += chunk.toString();
            if (pending.length > 16_384) {
                socket.destroy();
                return;
            }
            const frames = pending.split('\n');
            pending = frames.pop() ?? '';
            for (const frame of frames) {
                try {
                    const value = JSON.parse(frame) as MailChange;
                    if (!['mail', 'access'].includes(value.kind) || typeof value.eventId !== 'string') {
                        socket.destroy();
                        return;
                    }
                    receive(value);
                } catch {
                    socket.destroy();
                    return;
                }
            }
        });
    }
}
