'use strict';
const { createConnection } = require('node:net');

function command(socketPath, parts) {
    return new Promise((resolve, reject) => {
        const socket = createConnection({ path: socketPath });
        const timer = setTimeout(() => socket.destroy(new Error('SCAN_TIMEOUT')), 10_000);
        let response = '';
        socket.on('connect', async () => {
            try {
                for (const part of parts) {
                    if (!socket.write(part))
                        await new Promise((ok, fail) => {
                            const onDrain = () => {
                                socket.off('error', onError);
                                ok();
                            };
                            const onError = error => {
                                socket.off('drain', onDrain);
                                fail(error);
                            };
                            socket.once('drain', onDrain);
                            socket.once('error', onError);
                        });
                }
            } catch {
                socket.destroy(new Error('SCAN_UNAVAILABLE'));
            }
        });
        socket.on('data', chunk => {
            response += chunk.toString('utf8');
            if (response.length > 4096) socket.destroy(new Error('SCAN_RESPONSE'));
            else if (response.includes('\0')) {
                resolve(response.split('\0')[0]);
                socket.destroy();
            }
        });
        socket.on('error', reject);
        socket.on('close', () => {
            clearTimeout(timer);
            if (!response.includes('\0')) reject(new Error('SCAN_TRUNCATED'));
        });
    });
}

async function scanBytes(socketPath, bytes, now = Date.now()) {
    const version = await command(socketPath, [Buffer.from('zVERSION\0')]);
    const timestamp = Date.parse(version.split('/').slice(2).join('/'));
    if (!Number.isFinite(timestamp) || timestamp > now + 300_000 || now - timestamp > 48 * 60 * 60_000) {
        throw new Error('SCAN_DEFINITIONS_STALE');
    }
    function* chunks() {
        yield Buffer.from('zINSTREAM\0');
        for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
            const chunk = bytes.subarray(offset, offset + 64 * 1024);
            const header = Buffer.alloc(4);
            header.writeUInt32BE(chunk.length);
            yield header;
            yield chunk;
        }
        yield Buffer.alloc(4);
    }
    const result = await command(socketPath, chunks());
    if (result !== 'stream: OK') throw new Error('SCAN_REJECTED');
}
module.exports = { scanBytes };
