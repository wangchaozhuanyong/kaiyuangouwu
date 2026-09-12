'use strict';
const { fork } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chmod, mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path');
const { scanBytes } = require('./clamd.cjs');
const LIMITS = { avatar: 5 * 1024 * 1024, reference: 10 * 1024 * 1024, output: 25 * 1024 * 1024 };

function decode(file, kind, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
        const child = fork(path.join(__dirname, 'decoder.cjs'), [file, kind], {
            env: { NODE_ENV: 'production', PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' },
            execArgv: ['--max-old-space-size=192'],
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        let received = false;
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.on('message', result => {
            if (received) return;
            received = true;
            if (
                !result ||
                typeof result.bytes !== 'string' ||
                result.bytes.length > Math.ceil(LIMITS[kind] / 3) * 4
            ) {
                reject(new Error('DECODE_INVALID'));
                child.kill('SIGKILL');
                return;
            }
            resolve(Buffer.from(result.bytes, 'base64'));
        });
        child.on('error', reject);
        child.on('exit', () => {
            clearTimeout(timer);
            if (!received) reject(new Error('DECODE_FAILED'));
        });
    });
}

function createImageWorker({ quarantineRoot, clamdSocket, scan = scanBytes, decoder = decode }) {
    let active = 0;
    const server = createServer(async (request, response) => {
        const kind = request.url?.split('/')[2];
        if (
            request.method !== 'POST' ||
            request.url !== `/normalize/${kind}` ||
            !Object.hasOwn(LIMITS, kind)
        ) {
            response.writeHead(404).end();
            return;
        }
        const expectedSize = Number(request.headers['content-length']);
        if (
            request.headers['content-type'] !== 'application/octet-stream' ||
            !Number.isSafeInteger(expectedSize) ||
            expectedSize <= 0 ||
            expectedSize > LIMITS[kind]
        ) {
            response.writeHead(413).end();
            return;
        }
        if (active >= 2) {
            response.writeHead(503).end();
            return;
        }
        active++;
        let directory;
        const deadline = setTimeout(() => request.destroy(), 28_000);
        try {
            const chunks = [];
            let size = 0;
            for await (const chunk of request) {
                size += chunk.length;
                if (size > LIMITS[kind]) throw new Error('IMAGE_SIZE');
                chunks.push(chunk);
            }
            if (size !== expectedSize) throw new Error('IMAGE_TRUNCATED');
            const bytes = Buffer.concat(chunks);
            // Quarantine lives on a bounded private tmpfs. Nothing here is web-accessible.
            directory = await mkdtemp(path.join(quarantineRoot, 'upload-'));
            const file = path.join(directory, 'input');
            await writeFile(file, bytes, { mode: 0o600, flag: 'wx' });
            await scan(clamdSocket, bytes);
            const result = await decoder(file, kind);
            if (!result.length || result.length > LIMITS[kind]) throw new Error('IMAGE_SIZE');
            if (!response.destroyed)
                response
                    .writeHead(200, {
                        'Content-Type': 'application/octet-stream',
                        'Content-Length': result.length,
                        'Cache-Control': 'no-store',
                        'X-Input-SHA256': createHash('sha256').update(bytes).digest('hex'),
                    })
                    .end(result);
        } catch {
            if (!response.destroyed && !response.headersSent) response.writeHead(422).end('IMAGE_REJECTED');
        } finally {
            clearTimeout(deadline);
            if (directory)
                await rm(directory, { recursive: true, force: true }).catch(() => {
                    process.stderr.write('Image quarantine cleanup failed\n');
                });
            active--;
        }
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 5000;
    server.maxHeadersCount = 20;
    server.maxConnections = 8;
    return server;
}

async function main() {
    const socketPath = process.env.CUSTOMER_IMAGE_PROCESSOR_SOCKET;
    const clamdSocket = process.env.CUSTOMER_IMAGE_CLAMD_SOCKET;
    const quarantineRoot = process.env.CUSTOMER_IMAGE_QUARANTINE_DIR;
    if (![socketPath, clamdSocket, quarantineRoot].every(value => value && path.isAbsolute(value))) {
        throw new Error('Image worker requires absolute local socket and quarantine paths');
    }
    process.umask(0o077);
    await mkdir(quarantineRoot, { recursive: true, mode: 0o700 });
    const server = createImageWorker({ quarantineRoot, clamdSocket });
    server.listen(socketPath, async () => {
        await chmod(socketPath, 0o660);
    });
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
if (require.main === module)
    main().catch(() => {
        process.stderr.write('Image worker startup failed\n');
        process.exitCode = 1;
    });
module.exports = { createImageWorker, decode };
