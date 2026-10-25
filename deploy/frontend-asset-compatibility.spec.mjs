import assert from 'node:assert/strict';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { FRONTEND_ASSET_WINDOW_MS, preserveFrontendAssets } from './frontend-asset-compatibility.mjs';
const base = resolve('.local-validation/asset-compatibility');
mkdirSync(base, { recursive: true });
function fixture(t) {
    const root = mkdtempSync(resolve(base, 'case-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const dirs = ['old', 'next', 'third'].map(n => resolve(root, n));
    for (const d of dirs) {
        mkdirSync(resolve(d, 'assets'), { recursive: true });
        writeFileSync(resolve(d, 'index.html'), d);
    }
    return dirs;
}
test('old document URLs remain readable from new active root after old release is removed', t => {
    const [old, next] = fixture(t);
    writeFileSync(resolve(old, 'assets/route-12345678.js'), 'old code');
    writeFileSync(resolve(old, 'assets/route-abcdefgh.css'), 'old css');
    writeFileSync(resolve(next, 'assets/current-87654321.js'), 'current code');
    const html = readFileSync(resolve(next, 'index.html'), 'utf8');
    assert.equal(preserveFrontendAssets(old, next, 100).retained, 2);
    rmSync(old, { recursive: true });
    assert.equal(readFileSync(resolve(next, '.compat-assets/assets/route-12345678.js'), 'utf8'), 'old code');
    assert.equal(readFileSync(resolve(next, 'index.html'), 'utf8'), html);
    assert.deepEqual(readdirSync(resolve(next, 'assets')), ['current-87654321.js']);
});
test('compatibility propagates across releases without renewing expired assets', t => {
    const [old, next, third] = fixture(t);
    writeFileSync(resolve(old, 'assets/route-12345678.js'), 'old code');
    preserveFrontendAssets(old, next, 100);
    preserveFrontendAssets(old, next, 200);
    preserveFrontendAssets(next, third, 101 + FRONTEND_ASSET_WINDOW_MS);
    assert(!existsSync(resolve(third, '.compat-assets/assets/route-12345678.js')));
});
test('the exact old JS and CSS URLs remain served across an atomic release switch', async t => {
    const [old, next] = fixture(t);
    writeFileSync(resolve(old, 'assets/cold-12345678.js'), 'export const version = "old";');
    writeFileSync(resolve(old, 'assets/cold-abcdefgh.css'), '.page { color: blue; }');
    let active = old;
    const server = createServer((request, response) => {
        const name = new URL(request.url, 'http://localhost').pathname;
        let file = resolve(active, '.' + name);
        if (!existsSync(file)) file = resolve(active, '.compat-assets', '.' + name);
        if (!file.startsWith(active + '/') || !existsSync(file)) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {
            'content-type': name.endsWith('.js') ? 'application/javascript' : 'text/css',
        });
        response.end(readFileSync(file));
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    t.after(() => new Promise(done => server.close(done)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    preserveFrontendAssets(old, next);
    active = next;
    rmSync(old, { recursive: true });
    for (const name of ['cold-12345678.js', 'cold-abcdefgh.css']) {
        const result = await fetch(`${origin}/assets/${name}`);
        assert.equal(result.status, 200);
        assert.match(result.headers.get('content-type'), /javascript|css/u);
        assert.doesNotMatch(await result.text(), /<html/u);
    }
});
test('rejects collisions, symlinks and copying non-build files', t => {
    const [old, next] = fixture(t);
    writeFileSync(resolve(old, 'assets/route-12345678.js'), 'old code');
    writeFileSync(resolve(next, 'assets/route-12345678.js'), 'different');
    assert.throws(() => preserveFrontendAssets(old, next), /collision/);
    rmSync(resolve(next, 'assets/route-12345678.js'));
    symlinkSync(resolve(old, 'index.html'), resolve(old, 'assets/secret-abcdefgh.js'));
    assert.throws(() => preserveFrontendAssets(old, next), /regular file/);
    rmSync(resolve(old, 'assets/secret-abcdefgh.js'));
    writeFileSync(resolve(old, 'assets/private.txt'), 'private');
    preserveFrontendAssets(old, next);
    assert(!existsSync(resolve(next, 'assets/private.txt')));
});
