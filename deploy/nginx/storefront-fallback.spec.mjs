import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(repo, 'deploy/nginx/damatong.conf'), 'utf8');
function block(label, after = 0) {
    const start = source.indexOf(label + ' {', after);
    assert.ok(start >= 0, 'Missing production Nginx block: ' + label);
    let depth = 0;
    for (let index = source.indexOf('{', start); index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    throw new Error('Unclosed Nginx block: ' + label);
}
const fallbackMap = block('map $request_uri $storefront_legacy_fallback');
const applicationRoutes = [
    ...readFileSync(path.join(repo, 'packages/storefront/src/routeTree.gen.ts'), 'utf8')
        .split('export interface FileRoutesByFullPath {')[1]
        .split('\n}')[0]
        .matchAll(/^\s+'([^']+)':/gm),
].map(match => match[1]);

test('real Nginx keeps application routes and legacy redirects while unknown routes retain 404', async t => {
    const docker = (...args) =>
        execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const endpoint = docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}');
    assert.match(process.env.DOCKER_HOST || endpoint, /^unix:\/\//, 'Use an explicitly local Docker daemon');
    const image = 'nginx@sha256:db35bfc6b2951e7f8a72db5db120288c127ffaeeb4a6d4b95a26fead017d5913';
    try {
        docker('image', 'inspect', image);
    } catch {
        docker('pull', image); // Fresh environments fetch the same immutable official image.
    }
    const cache = path.join(repo, '.cache/nginx-fallback-tests');
    mkdirSync(cache, { recursive: true });
    const fixture = mkdtempSync(path.join(cache, 'case-'));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    mkdirSync(path.join(fixture, 'www'));
    writeFileSync(
        path.join(fixture, 'www/index.html'),
        '<main>Application shell with recovery navigation</main>',
    );
    writeFileSync(path.join(fixture, 'proxy_params'), 'proxy_set_header X-Forwarded-Proto $scheme;\n');
    const config = [
        'events {}',
        'http {',
        'access_log off;',
        'error_log /dev/stderr warn;',
        'map $host $customer_vault_frame_origin { default "\'self\'"; }',
        fallbackMap,
        'upstream vendure_backend { server 127.0.0.1:8081; }',
        'server { listen 8081;',
        'location = /storefront/redirect {',
        'if ($http_x_storefront_original_uri ~ "^/old-route(?:[?]|$)") { return 301 /en/category; }',
        'if ($http_x_storefront_original_uri ~ "^/backend-failure") { return 503; }',
        'return 404; }',
        'location = /storefront/html { return 200 "Published public page"; }',
        '}',
        'server { listen 8080; root /fixtures/www;',
        block('location = /index.html'),
        block(
            'location ~ ^/(?:((?:zh|en)(?:/|$)))?(?:home|product|category|search|services|support|legal|guides/[A-Za-z0-9_-]+)?/?$',
        ),
        block('location /', source.indexOf('location = /index.html')),
        block('location @storefront_legacy_redirect'),
        block('location @storefront_unknown_route_redirect'),
        '} }',
    ].join('\n');
    writeFileSync(path.join(fixture, 'nginx.conf'), config);
    const id = docker(
        'run',
        '-d',
        '--rm',
        '--pull=never',
        '-p',
        '127.0.0.1::8080',
        '-v',
        fixture + ':/fixtures:ro',
        '-v',
        path.join(fixture, 'nginx.conf') + ':/etc/nginx/nginx.conf:ro',
        '-v',
        path.join(fixture, 'proxy_params') + ':/etc/nginx/proxy_params:ro',
        image,
    );
    t.after(() => docker('stop', '--time', '1', id));
    const port = docker('port', id, '8080/tcp').split(':').at(-1);
    const origin = 'http://127.0.0.1:' + port;
    await t.test('becomes ready', async () => {
        const deadline = Date.now() + 5000;
        while (true) {
            try {
                assert.equal((await fetch(origin + '/login')).status, 200);
                break;
            } catch (error) {
                if (Date.now() >= deadline) throw error;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    });
    await t.test('covers every current non-error file route', async () => {
        for (const route of applicationRoutes.filter(pathname => pathname !== '/not-found')) {
            const pathname = route.replace('$slug', 'synthetic-guide');
            const response = await fetch(origin + pathname + '?fixture=1');
            assert.equal(response.status, 200, pathname);
        }
        assert.equal((await fetch(origin + '/ACCOUNT/')).status, 200);
    });
    await t.test('retains 404 with the recovery shell and noindex', async () => {
        for (const route of [
            '/missing-page',
            '/zh/missing-page',
            '/en/missing-page?x=1',
            '/account/missing',
            '/cart-extra',
            '/not-found',
            '/zh/cart',
            '/missing-file.js',
        ]) {
            const response = await fetch(origin + route);
            assert.equal(response.status, 404, route);
            assert.match(await response.text(), /recovery navigation/, route);
            assert.match(response.headers.get('x-robots-tag'), /noindex/);
            assert.match(response.headers.get('cache-control'), /no-store/);
            assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        }
        const head = await fetch(origin + '/missing-page', { method: 'HEAD' });
        assert.equal(head.status, 404);
        assert.equal(await head.text(), '');
    });
    await t.test('preserves published redirects and does not hide backend failure', async () => {
        const redirect = await fetch(origin + '/old-route?utm_source=fixture', { redirect: 'manual' });
        assert.equal(redirect.status, 301);
        assert.match(redirect.headers.get('location'), /\/en\/category$/);
        assert.equal((await fetch(origin + '/backend-failure')).status, 503);
    });
});
