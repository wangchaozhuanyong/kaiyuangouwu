'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtemp, mkdir, readdir, rm } = require('node:fs/promises');
const { createServer: createNetServer } = require('node:net');
const { request } = require('node:http');
const { tmpdir } = require('node:os');
const path = require('node:path');
const sharp = require(require.resolve('sharp', { paths: [path.join(__dirname, '../../packages/core')] }));
const { createImageWorker, decode } = require('./server.cjs');
const { scanBytes } = require('./clamd.cjs');

async function fixture(options = {}) {
    // Short paths also fit macOS's Unix-domain socket pathname limit.
    const root = await mkdtemp(path.join(tmpdir(), 'vi-'));
    const socket = path.join(root, 's');
    const quarantine = path.join(root, 'q');
    await mkdir(quarantine);
    const server = createImageWorker({
        quarantineRoot: quarantine,
        clamdSocket: '',
        scan: async () => {},
        ...options,
    });
    server.listen(socket);
    await once(server, 'listening');
    return {
        root,
        socket,
        quarantine,
        close: async () => {
            server.close();
            await once(server, 'close');
            await rm(root, { recursive: true, force: true });
        },
    };
}
function post(socketPath, bytes, kind = 'avatar', headers = {}) {
    return new Promise((resolve, reject) => {
        const req = request(
            {
                socketPath,
                path: `/normalize/${kind}`,
                method: 'POST',
                agent: false,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': bytes.length,
                    ...headers,
                },
            },
            res => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () =>
                    resolve({ status: res.statusCode, bytes: Buffer.concat(chunks), headers: res.headers }),
                );
            },
        );
        req.on('error', reject);
        req.end(bytes);
    });
}

for (const kind of ['avatar', 'reference', 'output'])
    test(`actual child decoder normalizes ${kind} and removes metadata`, async () => {
        const f = await fixture();
        try {
            const source = await sharp({
                create: { width: 1024, height: 768, channels: 3, background: '#ffffff' },
            })
                .jpeg()
                .withMetadata({ exif: { IFD0: { Artist: 'synthetic metadata' } } })
                .toBuffer();
            const result = await post(f.socket, source, kind);
            assert.equal(result.status, 200);
            const info = await sharp(result.bytes).metadata();
            assert.equal(info.exif, undefined);
            assert.equal(info.width, kind === 'avatar' ? 512 : 1024);
            assert.ok(result.headers['x-input-sha256']);
            // Cleanup completes in the handler after sending the response.
            await new Promise(resolve => setTimeout(resolve, 30));
            assert.deepEqual(await readdir(f.quarantine), []);
        } finally {
            await f.close();
        }
    });

test('scan rejection never reaches decoder and exposes no input in the response', async () => {
    let decoded = false;
    const f = await fixture({
        scan: async () => {
            throw new Error('synthetic scanner detection');
        },
        decoder: async () => {
            decoded = true;
            return Buffer.from('bad');
        },
    });
    try {
        const result = await post(f.socket, Buffer.from('synthetic upload'));
        assert.equal(result.status, 422);
        assert.equal(decoded, false);
        assert.equal(result.bytes.toString(), 'IMAGE_REJECTED');
    } finally {
        await f.close();
    }
});

test('broken images and forged content do not become ready', async () => {
    const f = await fixture();
    try {
        assert.equal((await post(f.socket, Buffer.from('<svg></svg>'))).status, 422);
        const source = await sharp({
            create: { width: 100, height: 100, channels: 3, background: '#ffffff' },
        })
            .png()
            .toBuffer();
        assert.equal((await post(f.socket, source.subarray(0, 40))).status, 422);
        assert.equal(
            (await post(f.socket, source, 'avatar', { 'Content-Length': 6 * 1024 * 1024 })).status,
            413,
        );
    } finally {
        await f.close();
    }
});

test('pixel limits and decoder timeouts fail closed', async () => {
    const f = await fixture();
    try {
        const huge = await sharp({ create: { width: 4100, height: 4000, channels: 3, background: '#fff' } })
            .png()
            .toBuffer();
        assert.equal((await post(f.socket, huge)).status, 422);
        await assert.rejects(decode(path.join(f.root, 'missing'), 'avatar', 1));
    } finally {
        await f.close();
    }
});

test('concurrent uploads above worker capacity are rejected without queuing', async () => {
    let release;
    const barrier = new Promise(resolve => {
        release = resolve;
    });
    let scans = 0;
    const f = await fixture({
        scan: async () => {
            scans++;
            await barrier;
        },
        decoder: async () => Buffer.from('clean'),
    });
    try {
        const first = post(f.socket, Buffer.from('one'));
        const second = post(f.socket, Buffer.from('two'));
        while (scans < 2) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal((await post(f.socket, Buffer.from('three'))).status, 503);
        release();
        await Promise.all([first, second]);
    } finally {
        release();
        await f.close();
    }
});

async function scanner(version, result, run) {
    const root = await mkdtemp(path.join(tmpdir(), 'vc-'));
    const socketPath = path.join(root, 's');
    let captured;
    const server = createNetServer(socket => {
        let data = Buffer.alloc(0);
        socket.on('data', chunk => {
            data = Buffer.concat([data, chunk]);
            const end = data.indexOf(0);
            if (end < 0) return;
            const command = data.subarray(0, end).toString();
            if (command === 'zVERSION') {
                socket.end(version + '\0');
                return;
            }
            if (command !== 'zINSTREAM') return;
            let offset = end + 1;
            const parts = [];
            while (offset + 4 <= data.length) {
                const size = data.readUInt32BE(offset);
                offset += 4;
                if (!size) {
                    captured = Buffer.concat(parts);
                    socket.end(result + '\0');
                    return;
                }
                if (offset + size > data.length) return;
                parts.push(data.subarray(offset, offset + size));
                offset += size;
            }
        });
    });
    server.listen(socketPath);
    await once(server, 'listening');
    try {
        await run(socketPath, () => captured);
    } finally {
        server.close();
        await once(server, 'close');
        await rm(root, { recursive: true, force: true });
    }
}

test('ClamAV protocol scans exact bytes and accepts only an explicit clean result with fresh definitions', async () => {
    const bytes = Buffer.alloc(130_000, 65);
    await scanner(
        `ClamAV 1.4.0/12345/${new Date().toUTCString()}`,
        'stream: OK',
        async (socket, captured) => {
            await scanBytes(socket, bytes);
            assert.deepEqual(captured(), bytes);
        },
    );
});
for (const result of [
    'stream: Synthetic FOUND',
    'INSTREAM size limit exceeded. ERROR',
    'stream: OK\nextra',
]) {
    test(`ClamAV rejects non-clean response: ${result}`, async () => {
        await scanner(`ClamAV 1.4.0/12345/${new Date().toUTCString()}`, result, async socket => {
            await assert.rejects(scanBytes(socket, Buffer.from('synthetic')));
        });
    });
}
test('ClamAV stale definitions and unavailable daemon block processing', async () => {
    await scanner('ClamAV 1.4.0/12345/Mon, 01 Jan 2024 00:00:00 GMT', 'stream: OK', async socket => {
        await assert.rejects(scanBytes(socket, Buffer.from('synthetic')), /STALE/);
    });
    await assert.rejects(scanBytes('/nonexistent-vendure-test-socket', Buffer.from('synthetic')));
});
