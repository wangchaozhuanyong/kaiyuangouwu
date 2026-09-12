import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The deployed API and worker share one host, OS user and runtime directory.
// A private local socket relays worker events without a broker, database polling or public endpoint.
export function orderEventSocketPath(runtimeDirectory = process.cwd()): string {
    const instance = createHash('sha256').update(path.resolve(runtimeDirectory)).digest('hex').slice(0, 16);
    return path.join(tmpdir(), `vendure-orders-${process.getuid?.() ?? 'local'}-${instance}`, 'events.sock');
}

export async function listenForOrderEvents(
    socketPath: string,
    onOrder: (orderId: string, kind: 'placed' | 'changed') => Promise<void>,
): Promise<() => Promise<void>> {
    await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    const sockets = new Set<Socket>();
    const server = createServer(socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => socket.destroy());
        socket.setTimeout(5000, () => socket.destroy());
        socket.setEncoding('utf8');
        let data = '';
        let received = false;
        socket.on('data', chunk => {
            data += chunk.toString();
            if (data.length > 1024 || received) {
                socket.destroy();
                return;
            }
            if (!data.includes('\n')) return;
            received = true;
            const message = data.trim();
            const kind = message.startsWith('changed:') ? 'changed' : 'placed';
            const id = kind === 'changed' ? message.slice(8) : message;
            if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
                socket.destroy();
                return;
            }
            void onOrder(id, kind).then(
                () => socket.end('ok\n'),
                () => socket.destroy(),
            );
        });
    });
    try {
        await listen(server, socketPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
        // Only remove a stale socket. Never replace another running API's listener.
        if (await socketIsLive(socketPath)) throw error;
        if (!(await lstat(socketPath)).isSocket()) throw error;
        await unlink(socketPath);
        await listen(server, socketPath);
    }
    await chmod(socketPath, 0o600);
    return async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) =>
            server.close(error => (error ? reject(error) : resolve())),
        );
    };
}

export async function relayOrderEvent(
    socketPath: string,
    orderId: string,
    kind: 'placed' | 'changed' = 'placed',
): Promise<void> {
    // Retry only a real event, for brief API/worker restart overlap; there is no idle timer.
    for (let attempt = 0; ; attempt++) {
        try {
            await new Promise<void>((resolve, reject) => {
                const socket = createConnection(socketPath);
                let acknowledged = false;
                socket.setTimeout(5000, () => socket.destroy(new Error('Order event relay timed out')));
                socket.on('error', reject);
                socket.on('connect', () =>
                    socket.write(`${kind === 'changed' ? 'changed:' : ''}${orderId}\n`),
                );
                socket.on('data', chunk => {
                    if (chunk.toString().trim() === 'ok') {
                        acknowledged = true;
                        resolve();
                        socket.end();
                    }
                });
                socket.on('close', () => {
                    if (!acknowledged) reject(new Error('Order event relay closed'));
                });
            });
            return;
        } catch (error) {
            if (attempt >= 3) throw error;
            await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
        }
    }
}

function listen(server: Server, socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(socketPath, () => {
            server.off('error', onError);
            resolve();
        });
    });
}

function socketIsLive(socketPath: string): Promise<boolean> {
    return new Promise(resolve => {
        const socket = createConnection(socketPath);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', error => resolve((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED'));
    });
}
