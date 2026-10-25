import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { preserveFrontendAssets } from '../frontend-asset-compatibility.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(repo, 'deploy/nginx/damatong.conf'), 'utf8');
function block(label, after = 0) {
    const start = source.indexOf(label + ' {', after);
    assert.ok(start >= 0, 'Missing production Nginx block: ' + label);
    let depth = 0;
    for (let index = start + label.length + 1; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    throw new Error('Unclosed Nginx block: ' + label);
}
const fallbackMap = block('map $request_uri $storefront_legacy_fallback');
const coopMap = block('map "$request_method|$sent_http_content_type|$http_user_agent" $storefront_html_coop');
const applicationRoutes = [
    ...readFileSync(path.join(repo, 'packages/storefront/src/routeTree.gen.ts'), 'utf8')
        .split('export interface FileRoutesByFullPath {')[1]
        .split('\n}')[0]
        .matchAll(/^\s+['"]([^'"]+)['"]:/gm),
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
    // mkdtemp is 0700. Linux bind mounts retain that mode, so the Nginx
    // worker needs traversal permission on this public, synthetic fixture root.
    chmodSync(fixture, 0o755);
    mkdirSync(path.join(fixture, 'www'));
    writeFileSync(
        path.join(fixture, 'www/index.html'),
        '<main>Application shell with recovery navigation</main>',
    );
    writeFileSync(path.join(fixture, 'www/style.css'), 'body { color: black; }');
    mkdirSync(path.join(fixture, 'prior/assets'), { recursive: true });
    mkdirSync(path.join(fixture, 'www/assets'), { recursive: true });
    writeFileSync(path.join(fixture, 'prior/assets/cold-12345678.js'), 'export const version = "old";');
    writeFileSync(path.join(fixture, 'prior/assets/cold-abcdefgh.css'), '.old { color: blue; }');
    writeFileSync(path.join(fixture, 'www/assets/current-87654321.js'), 'export const version = "new";');
    preserveFrontendAssets(path.join(fixture, 'prior'), path.join(fixture, 'www'));
    rmSync(path.join(fixture, 'prior'), { recursive: true });
    writeFileSync(path.join(fixture, 'proxy_params'), 'proxy_set_header X-Forwarded-Proto $scheme;\n');
    const config = [
        'events {}',
        'http {',
        'access_log off;',
        'error_log /dev/stderr warn;',
        'default_type text/html;',
        'types { text/css css; application/javascript js; }',
        'map $host $customer_vault_frame_origin { default "\'self\'"; }',
        fallbackMap,
        coopMap,
        block('map "$status|$uri" $build_asset_cache_control'),
        'upstream vendure_backend { server 127.0.0.1:8081; }',
        'server { listen 8081;',
        'location = /storefront/redirect {',
        'if ($http_x_storefront_original_uri ~ "^/old-route(?:[?]|$)") { return 301 /en/category; }',
        'if ($http_x_storefront_original_uri ~ "^/backend-failure") { return 503; }',
        'return 404; }',
        'location = /storefront/html { default_type "text/html; charset=utf-8"; return 200 "Published public page"; }',
        '}',
        'server { listen 8080; root /fixtures/www;',
        block(
            source
                .split('\n')
                .find(line => line.trim().startsWith('location ~ "^/assets/'))
                .trim()
                .replace(/ \{$/u, ''),
        ),
        block('location ~* (^|/)\\.'),
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
    docker(
        'run',
        '--rm',
        '--pull=never',
        '-v',
        fixture + ':/fixtures:ro',
        '-v',
        path.join(fixture, 'nginx.conf') + ':/etc/nginx/nginx.conf:ro',
        '-v',
        path.join(fixture, 'proxy_params') + ':/etc/nginx/proxy_params:ro',
        image,
        'nginx',
        '-t',
    );
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
        assert.ok(applicationRoutes.length > 0, 'Generated route parsing must not silently skip coverage');
        for (const route of applicationRoutes.filter(pathname => pathname !== '/not-found')) {
            const pathname = route.replace('$slug', 'synthetic-guide');
            const response = await fetch(origin + pathname + '?fixture=1');
            assert.equal(response.status, 200, pathname);
        }
        assert.equal((await fetch(origin + '/ACCOUNT/')).status, 200);
    });
    await t.test(
        'serves native and retained hashed assets at the original URL without mixing build directories',
        async () => {
            for (const file of ['cold-12345678.js', 'cold-abcdefgh.css', 'current-87654321.js']) {
                const response = await fetch(origin + '/assets/' + file);
                assert.equal(response.status, 200, file);
                assert.match(response.headers.get('content-type'), /javascript|css/u);
                assert.match(response.headers.get('cache-control'), /immutable/u);
                assert.doesNotMatch(await response.text(), /<html/u);
            }
            assert.equal((await fetch(origin + '/.compat-assets/assets/cold-12345678.js')).status, 404);
            const missing = await fetch(origin + '/assets/missing-12345678.js');
            assert.equal(missing.status, 404);
            assert.match(missing.headers.get('cache-control'), /no-store/u);
        },
    );
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
    await t.test('limits the COOP exception to reproduced iPhone Chrome HTML responses', async () => {
        const iphone =
            'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X) ' +
            'AppleWebKit/605.1.15 (KHTML, like Gecko)';
        const chrome = version => `${iphone} CriOS/${version} Mobile/15E148 Safari/604.1`;
        const affected = [chrome('155.0.8059.37'), chrome('156.0.8078.46')];
        const unaffected = [
            '',
            chrome('157.0.8100.1'),
            chrome('156.0.8078.47'),
            chrome('156.0.8078.46').replace('27_0_1', '27_0_2'),
            chrome('156.0.8078.46').replace('iPhone', 'iPad'),
            `${iphone} Version/27.0 Mobile/15E148 Safari/604.1`,
            'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/156.0.8078.46 Mobile Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/156.0.8078.46 Safari/537.36',
            'unrecognized-prefix ' + affected[1],
            affected[1] + ' unrecognized-suffix',
        ];
        for (const userAgent of [...affected, ...unaffected]) {
            for (const route of ['/zh/', '/index.html', '/login', '/missing-page']) {
                for (const method of ['GET', 'HEAD']) {
                    const response = await fetch(origin + route, {
                        method,
                        headers: { 'User-Agent': userAgent },
                    });
                    assert.equal(
                        response.headers.get('cross-origin-opener-policy'),
                        affected.includes(userAgent) ? null : 'same-origin-allow-popups',
                        `${method} ${route}: ${userAgent}`,
                    );
                    assert.match(response.headers.get('content-type'), /^text\/html/);
                    assert.match(response.headers.get('vary'), /\bUser-Agent\b/i);
                    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
                    assert.equal(response.headers.get('x-frame-options'), 'DENY');
                    assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
                    assert.match(
                        response.headers.get('content-security-policy'),
                        /upgrade-insecure-requests/,
                    );
                    assert.match(
                        response.headers.get('content-security-policy'),
                        /accounts\.google\.com\/gsi\//,
                    );
                    assert.match(response.headers.get('cache-control'), /no-store/);
                }
            }
        }
        const css = await fetch(origin + '/style.css', {
            headers: { 'User-Agent': affected[1] },
        });
        assert.equal(css.headers.get('content-type'), 'text/css');
        assert.equal(css.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
        const post = await fetch(origin + '/zh/', {
            method: 'POST',
            headers: { 'User-Agent': affected[1] },
        });
        assert.equal(post.status, 405);
        assert.equal(post.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    });
});
