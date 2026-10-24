import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const mode = process.argv[2];

if (mode === 'multer-worker') {
    const multer = require('multer');
    const request = new PassThrough();
    const rejection = new Error('synthetic rejection');
    const boundary = 'SecurityRegressionFixture';
    const body = [
        '--' + boundary,
        'Content-Disposition: form-data; name="parked"; filename="a.txt"',
        'Content-Type: text/plain',
        '',
        'a',
        '--' + boundary,
        'Content-Disposition: form-data; name="rejected"; filename="b.txt"',
        'Content-Type: text/plain',
        '',
        'b',
    ].join('\r\n');
    let resume;
    let parser;
    let calls = 0;
    const deadline = setTimeout(() => {
        process.exitCode = 2;
    }, 5000);
    const upload = multer({
        fileHwm: 1,
        streamHandler(req, instance) {
            parser = instance;
            req.pipe(instance);
        },
        fileFilter(req, file, next) {
            if (file.fieldname === 'parked') {
                resume = next;
                return;
            }
            req.once('end', () => setImmediate(() => next(rejection)));
        },
    }).any();
    request.headers = {
        'content-type': 'multipart/form-data; boundary=' + boundary,
        'content-length': Buffer.byteLength(body),
    };
    upload(request, null, error => {
        calls++;
        assert.equal(error, rejection);
        assert.equal(typeof resume, 'function');
        setImmediate(() => {
            parser.once('close', () => {
                assert.equal(calls, 1);
                assert.deepEqual(request.files, []);
                clearTimeout(deadline);
                process.stdout.write('SAFE\n');
            });
            resume(null, true);
        });
    });
    request.end(body);
} else if (mode === 'undici-worker') {
    const undici = require('undici');
    const deadline = setTimeout(() => {
        process.exit(2);
    }, 5000);
    const server = http.createServer((request, response) => {
        if (request.url === '/bad') {
            response.writeHead(200, {
                'content-encoding': Array(6).fill('gzip').join(', '),
                'content-length': 100,
            });
            response.flushHeaders();
            response.socket.end();
            return;
        }
        const body = gzipSync(Buffer.from('{"ok":true}'));
        response.writeHead(200, {
            'content-encoding': 'gzip',
            'content-type': 'application/json',
            'content-length': body.length,
        });
        response.end(body);
    });
    server.listen(0, '127.0.0.1', async () => {
        const url = 'http://127.0.0.1:' + server.address().port;
        try {
            assert.deepEqual(await (await undici.fetch(url)).json(), { ok: true });
            await assert.rejects(undici.fetch(url + '/bad'));
            setTimeout(async () => {
                try {
                    assert.deepEqual(await (await undici.fetch(url)).json(), { ok: true });
                    await undici.getGlobalDispatcher().close();
                    clearTimeout(deadline);
                    server.close(() => process.stdout.write('SAFE\n'));
                } catch (error) {
                    process.stderr.write(String(error) + '\n');
                    process.exit(2);
                }
            }, 50);
        } catch (error) {
            process.stderr.write(String(error) + '\n');
            process.exit(2);
        }
    });
} else {
    for (const dependency of ['multer', 'undici']) {
        void test(`${dependency} malformed input cannot terminate the process; ordinary behavior still works`, () => {
            const result = spawnSync(
                process.execPath,
                [fileURLToPath(import.meta.url), dependency + '-worker'],
                { encoding: 'utf8', timeout: 7000 },
            );
            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stdout.trim(), 'SAFE');
        });
    }
}
