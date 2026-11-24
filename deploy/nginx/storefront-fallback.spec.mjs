import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    chmodSync,
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { get, request } from 'node:http';
import { request as requestHttps } from 'node:https';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { preserveFrontendAssets } from '../frontend-asset-compatibility.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(repo, 'deploy/nginx/damatong.conf'), 'utf8');
test('environment monitor allows only the two fixed browser IP observation origins', () => {
    const policies = [...source.matchAll(/add_header Content-Security-Policy "([^"]+)" always;/g)].map(
        match => match[1],
    );
    const monitoringPolicies = policies.filter(policy => policy.includes('api.ipify.org'));
    assert.equal(monitoringPolicies.length, 5);
    for (const policy of monitoringPolicies) {
        const connect = policy.split(';').find(directive => directive.trim().startsWith('connect-src'));
        assert.ok(connect.includes('https://api.ipify.org'));
        assert.ok(connect.includes('https://api64.ipify.org'));
        assert.ok(!connect.includes('*'));
        assert.ok(!connect.includes('https://ipwho.is'));
        assert.ok(!connect.includes('https://free.freeipapi.com'));
    }
    assert.ok(!source.slice(source.indexOf('server_name console.moyaoai.com;')).includes('api.ipify.org'));
});
test('MDAC allows Wasm only in the OCR worker and serves only the shipped models through the archive guard', () => {
    const policies = source.match(/add_header Content-Security-Policy "[^"]+" always;/g);
    assert.equal(policies.filter(policy => policy.includes('wasm-unsafe-eval')).length, 1);
    const worker = block('location = /mdac-ocr/worker.min.js');
    assert.match(worker, /script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'/);
    const models = block('location ~ ^/mdac-ocr/(?:eng|ocrb_int)[.]traineddata[.]gz$');
    assert.match(models, /try_files \$uri =404;/);
    const archiveDeny = block(
        'location ~* \\.(env|pem|key|crt|pfx|p12|sql|sqlite|db|log|bak|zip|tar|gz|7z|rar)$',
    );
    assert.ok(source.indexOf(models) < source.indexOf(archiveDeny));
    const page = block('location ~ ^/(?:(?:zh|en)/)?mdac/?$');
    assert.match(page, /rewrite \^ \/index[.]html last;/);
});

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
test('private recharge progress uses the bounded unbuffered realtime route', () => {
    const route = block('location ~ ^/storefront-realtime/(events|mail-events|recharge-events)$');
    for (const expected of [
        'proxy_buffering off;',
        'proxy_cache off;',
        'proxy_ignore_client_abort off;',
        'limit_conn vendure_realtime_per_ip 12;',
        'proxy_set_header vendure-token "";',
    ])
        assert.ok(route.includes(expected), expected);
});
const fallbackMap = block('map $request_uri $storefront_legacy_fallback');
const coopMap = block('map "$request_method|$sent_http_content_type|$http_user_agent" $storefront_html_coop');
const addressHost = 'address.moyaoai.com';
function toolVhost(host, directory, productionRoot) {
    return block('server', source.lastIndexOf('server {', source.indexOf(`server_name ${host};`)))
        .replace(/^ +listen 443 ssl http2;$/mu, '    listen 8080;')
        .replace(/^ +(?:listen \[::\]:443|ssl_certificate|access_log).*\n/gmu, '')
        .replace(/^ +if \(\$trusted_cloudflare_origin.*\n/mu, '')
        .replace(`root ${productionRoot};`, `root /fixtures/www/${directory};`);
}
const environmentHost = 'check.moyaoai.com';
test('environment checker requires its dedicated TLS certificate and trusted Cloudflare origin', () => {
    const server = block(
        'server',
        source.lastIndexOf('server {', source.indexOf('server_name ' + environmentHost)),
    );
    const tls = '/etc/letsencrypt/live/' + environmentHost + '/';
    assert.ok(server.includes('ssl_certificate ' + tls + 'fullchain.pem;'));
    assert.ok(server.includes('ssl_certificate_key ' + tls + 'privkey.pem;'));
    assert.ok(server.includes('if ($trusted_cloudflare_origin = 0) { return 444; }'));
});
const environmentVhost = toolVhost(
    environmentHost,
    '.environment-monitor-tool',
    '/var/www/kaiyuangouwu-storefront-current/.environment-monitor-tool',
)
    .replaceAll('/var/www/kaiyuangouwu-storefront-current', '/fixtures/www')
    .replace('proxy_pass http://vendure_backend/shop-api;', 'proxy_pass http://127.0.0.1:8082/shop-api;');
const addressVhost = block(
    'server',
    source.lastIndexOf('server {', source.indexOf(`server_name ${addressHost};`)),
)
    .replace(/^ +listen 443 ssl http2;$/mu, '    listen 8080;')
    .replace(/^ +(?:listen \[::\]:443|ssl_certificate|access_log).*\n/gmu, '')
    .replace(/^ +if \(\$trusted_cloudflare_origin.*\n/mu, '')
    .replace(
        'root /var/www/kaiyuangouwu-storefront-current/.address-tool;',
        'root /fixtures/www/.address-tool;',
    );
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
    mkdirSync(path.join(fixture, 'www/.address-tool/assets'), { recursive: true });
    for (const directory of ['.mail-tool', '.two-factor', '.environment-monitor-tool']) {
        mkdirSync(path.join(fixture, 'www', directory, 'assets'), { recursive: true });
        writeFileSync(path.join(fixture, 'www', directory, 'index.html'), `<main>${directory}</main>`);
        writeFileSync(
            path.join(fixture, 'www', directory, 'assets/tool-A1234567.js'),
            'export const tool = true;',
        );
    }
    writeFileSync(
        path.join(fixture, 'www/.address-tool/index.html'),
        '<main>Independent address tool</main>',
    );
    writeFileSync(
        path.join(fixture, 'www/.address-tool/assets/tool-A1234567.js'),
        'export const tool = true;',
    );
    writeFileSync(
        path.join(fixture, 'www/index.html'),
        '<main>Application shell with recovery navigation</main>',
    );
    writeFileSync(path.join(fixture, 'www/style.css'), 'body { color: black; }');
    writeFileSync(path.join(fixture, 'www/frontend-release.json'), '{"releaseId":"fixture"}');
    writeFileSync(path.join(fixture, 'www/.environment-monitor-tool/favicon.svg'), '<svg/>');
    mkdirSync(path.join(fixture, 'www/tools/claude-proxy'), { recursive: true });
    for (const extension of ['ps1', 'sh'])
        writeFileSync(
            path.join(fixture, 'www/tools/claude-proxy', 'clean-claude-proxy.' + extension),
            extension,
        );
    // Echo the HTTP request from the proxy so tests exercise Nginx's real body generation.
    writeFileSync(
        path.join(fixture, 'echo-request.sh'),
        [
            '#!/bin/sh',
            'while IFS= read -r line; do',
            '    line=$(printf "%s" "$line" | tr -d "\\r")',
            '    [ -z "$line" ] && break',
            '    case "$line" in "Content-Length: "*) length=$(printf "%s" "$line" | cut -d " " -f 2);; esac',
            '    headers="$headers$line\\n"',
            'done',
            'printf "%s\\r\\n" "HTTP/1.1 200 OK" "Set-Cookie: upstream=fixture" "Access-Control-Allow-Origin: *"',
            'printf "%s\\r\\n" "vendure-auth-token: upstream" "Connection: close" ""',
            'printf "%b\\n" "$headers"',
            'dd bs=1 count="$length" 2>/dev/null',
        ].join('\n'),
        { mode: 0o755 },
    );
    mkdirSync(path.join(fixture, 'www/mdac-ocr'));
    writeFileSync(path.join(fixture, 'www/mdac-ocr/worker.min.js'), 'self.onmessage = () => undefined;');
    writeFileSync(path.join(fixture, 'www/mdac-ocr/ocrb_int.traineddata.gz'), 'synthetic model');
    writeFileSync(path.join(fixture, 'www/mdac-ocr/unknown.gz'), 'denied fixture');
    mkdirSync(path.join(fixture, 'prior/assets'), { recursive: true });
    mkdirSync(path.join(fixture, 'www/assets'), { recursive: true });
    writeFileSync(path.join(fixture, 'prior/assets/cold-12345678.js'), 'export const version = "old";');
    writeFileSync(path.join(fixture, 'prior/assets/cold-abcdefgh.css'), '.old { color: blue; }');
    writeFileSync(path.join(fixture, 'www/assets/current-87654321.js'), 'export const version = "new";');
    preserveFrontendAssets(path.join(fixture, 'prior'), path.join(fixture, 'www'));
    rmSync(path.join(fixture, 'prior'), { recursive: true });
    writeFileSync(
        path.join(fixture, 'proxy_params'),
        'proxy_set_header X-Forwarded-Proto $scheme;\nproxy_set_header Host $host;\n',
    );
    const config = [
        'events {}',
        'http {',
        'access_log off;',
        'error_log /dev/stderr warn;',
        'default_type text/html;',
        'types { text/css css; application/javascript js; }',
        'limit_req_zone $binary_remote_addr zone=vendure_shop_api:1m rate=100r/s;',
        'map $host $customer_vault_frame_origin { default "\'self\'"; }',
        fallbackMap,
        coopMap,
        block(
            'map "$cookie_storefront_public_language$cookie_storefront_public_currency" $storefront_public_pref_cookie',
        ),
        block(
            'map "$request_method|$sent_http_content_type|$status|$storefront_public_pref_cookie|$storefront_html_coop" $storefront_html_cache_control',
        ),
        block('map $http_cookie $address_tool_cookie'),
        block('map $http_x_environment_observed_ipv4 $environment_monitor_ipv4'),
        block('map $http_x_environment_observed_ipv6 $environment_monitor_ipv6'),
        block('map "$http_authorization|$http_cookie" $storefront_public_coupon_guest'),
        block('map "$status|$uri" $build_asset_cache_control'),
        'map "$host|$http_x_storefront_original_uri" $environment_fixture_shell {',
        'default 0;',
        '"~^127[.]0[.]0[.]1[|](?:/(?:zh|en))?/(?:environment-monitor|announcements|flash-sale|recommendations)/?(?:[?]|$)" 1;',
        '}',
        'upstream vendure_backend { server 127.0.0.1:8081; }',
        'server { listen 8081;',
        'location ~ ^/(?:standalone-mail/query|storefront-realtime/mail-events)$ { return 200 ' +
            '"cookie=$http_cookie; auth=$http_authorization; token=$http_vendure_token; path=$uri"; }',
        'location ~ ^/api/address/(?:status|claim)$ { return 200 "cookie=$http_cookie; auth=$http_authorization; token=$http_vendure_token; host=$http_host"; }',
        'location = /storefront/redirect {',
        'if ($http_x_storefront_original_uri ~ "^/old-route(?:[?]|$)") { return 301 /en/category; }',
        'if ($http_x_storefront_original_uri ~ "^/backend-failure") { return 503; }',
        'if ($environment_fixture_shell) { add_header X-Accel-Redirect /index.html; return 200; }',
        'return 404; }',
        'location = /storefront/html { default_type "text/html; charset=utf-8";',
        'return 200 "Published public page; guest=$http_x_storefront_public_coupon_guest; ' +
            'cookie=$http_cookie; authorization=$http_authorization"; }',
        'location = /mail-query { return 200 "Legacy standalone mail portal"; }',
        'location = /mail-query/portal.js { default_type application/javascript; return 200 "/* Legacy mail portal script */"; }',
        '}',
        'server { listen 8080; root /fixtures/www;',
        block('location = /mail-query/portal.js'),
        'location = /__coupon_hint { return 200 $storefront_public_coupon_guest; }',
        block(
            source
                .split('\n')
                .find(line => line.trim().startsWith('location ~ "^/assets/'))
                .trim()
                .replace(/ \{$/u, ''),
        ),
        block('location ~* (^|/)\\.'),
        block('location = /index.html'),
        block('location ~ ^/(?:(?:zh|en)/)?mdac/?$'),
        block('location = /mdac-ocr/worker.min.js'),
        block('location ~ ^/mdac-ocr/(?:eng|ocrb_int)[.]traineddata[.]gz$'),
        block('location ~* \\.(env|pem|key|crt|pfx|p12|sql|sqlite|db|log|bak|zip|tar|gz|7z|rar)$'),
        block(
            'location ~ ^/(?:((?:zh|en)(?:/|$)))?(?:home|product|category|search|services|support|legal|' +
                'blog(?:/[A-Za-z0-9_-]+)?|guides/[A-Za-z0-9_-]+|p/[^/?#]+|c/[^/?#]+)?/?$',
        ),
        block('location /', source.indexOf('location = /index.html')),
        block('location @storefront_legacy_redirect'),
        block('location @storefront_unknown_route_redirect'),
        '}',
        'server { listen 8080; server_name console.fixture;',
        block('location ^~ /mail-query'),
        'location / { return 404; }',
        '}',
        addressVhost,
        toolVhost('mail.moyaoai.com', '.mail-tool', '/var/www/kaiyuangouwu-storefront-current/.mail-tool'),
        toolVhost('2fa.moyaoai.com', '.two-factor', '/var/www/kaiyuangouwu-two-factor-current'),
        environmentVhost,
        '}',
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
        '/bin/sh',
        '-c',
        'nc -lk -p 8082 -e /fixtures/echo-request.sh & exec nginx -g "daemon off;"',
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
    await t.test(
        'the standalone hostname serves only its own document, assets and two address endpoints',
        async () => {
            const getTool = (pathname, headers = {}) =>
                new Promise((resolve, reject) => {
                    get(origin + pathname, { headers: { host: addressHost, ...headers } }, response => {
                        response.setEncoding('utf8');
                        let text = '';
                        response.on('data', value => {
                            text += value;
                        });
                        response.on('end', () =>
                            resolve({ status: response.statusCode, headers: response.headers, text }),
                        );
                        response.on('error', reject);
                    }).on('error', reject);
                });
            const html = await getTool('/');
            assert.equal(html.status, 200);
            assert.equal(html.text, '<main>Independent address tool</main>');
            assert.equal(html.headers['referrer-policy'], 'no-referrer');
            assert.match(html.headers['content-security-policy'], /connect-src 'self';/u);
            assert.match(html.headers['cache-control'], /no-store/);
            const asset = await getTool('/assets/tool-A1234567.js');
            assert.equal(asset.status, 200);
            assert.match(asset.headers['cache-control'], /public, max-age=31536000, immutable/);
            assert.equal(asset.headers['content-security-policy'], html.headers['content-security-policy']);
            for (const pathname of [
                '/shop-api',
                '/admin-api',
                '/dashboard/',
                '/zh/',
                '/login',
                '/frontend-release.json',
                '/assets/current-87654321.js',
                '/api/address/list',
            ]) {
                const denied = await getTool(pathname);
                assert.equal(denied.status, 404, pathname);
                assert.match(denied.headers['cache-control'], /no-store/);
                assert.ok(!denied.text.includes('Published public page'), pathname);
            }
            const cookie = '__Host-tax_address_browser=' + 'a'.repeat(115);
            const status = await getTool('/api/address/status', {
                cookie: `session=fixture; ${cookie}`,
                authorization: 'Bearer fixture',
                'vendure-token': 'fixture',
            });
            assert.equal(status.text, `cookie=${cookie}; auth=; token=; host=${addressHost}`);
            assert.match(status.headers['cache-control'], /no-store/);
            assert.equal((await fetch(origin + '/.address-tool/index.html')).status, 404);
        },
    );
    await t.test('2FA and mail hosts expose only their tools and anonymous mail operations', async () => {
        const toolRequest = (host, pathname, method = 'GET') =>
            new Promise((resolve, reject) => {
                const req = request(
                    origin + pathname,
                    {
                        method,
                        headers: {
                            host,
                            cookie: 'session=synthetic',
                            authorization: 'Bearer synthetic',
                            'vendure-token': 'synthetic',
                        },
                    },
                    response => {
                        let text = '';
                        response.setEncoding('utf8');
                        response.on('data', chunk => {
                            text += chunk;
                        });
                        response.on('end', () =>
                            resolve({ status: response.statusCode, headers: response.headers, text }),
                        );
                    },
                );
                req.on('error', reject);
                req.end();
            });
        for (const [host, name] of [
            ['2fa.moyaoai.com', '.two-factor'],
            ['mail.moyaoai.com', '.mail-tool'],
        ]) {
            const html = await toolRequest(host, '/');
            assert.equal(html.text, `<main>${name}</main>`);
            assert.equal(html.headers['referrer-policy'], 'no-referrer');
            assert.match(html.headers['cache-control'], /no-store/);
            const asset = await toolRequest(host, '/assets/tool-A1234567.js');
            assert.equal(asset.status, 200);
            assert.match(asset.headers['cache-control'], /public, max-age=31536000, immutable/);
            assert.equal(asset.headers['content-security-policy'], html.headers['content-security-policy']);
            const missing = await toolRequest(host, '/assets/missing-A1234567.js');
            assert.equal(missing.status, 404);
            assert.match(missing.headers['cache-control'], /no-store/);
            for (const pathname of [
                '/shop-api',
                '/admin-api',
                '/dashboard/',
                '/zh/',
                '/login',
                '/support',
                '/services',
                '/api/address/claim',
            ]) {
                assert.equal((await toolRequest(host, pathname)).status, 404, host + pathname);
            }
        }
        assert.equal((await toolRequest('2fa.moyaoai.com', '/api/mail/query', 'POST')).status, 404);
        for (const [mailOperation, upstream] of [
            ['query', '/standalone-mail/query'],
            ['events', '/storefront-realtime/mail-events'],
        ]) {
            assert.equal((await toolRequest('mail.moyaoai.com', '/api/mail/' + mailOperation)).status, 405);
            const result = await toolRequest('mail.moyaoai.com', '/api/mail/' + mailOperation, 'POST');
            assert.equal(result.status, 200);
            assert.match(result.headers['cache-control'], /no-store/);
            assert.equal(result.text, `cookie=; auth=; token=; path=${upstream}`);
        }
        assert.equal((await fetch(origin + '/.mail-tool/index.html')).status, 404);
        assert.equal((await toolRequest('console.fixture', '/standalone-mail/query', 'POST')).status, 404);
    });
    await t.test(
        'environment host isolates the static tool and proxies only one anonymous network read',
        async () => {
            const ask = (pathname, { method = 'GET', headers = {}, body } = {}) =>
                new Promise((resolve, reject) => {
                    const req = request(
                        origin + pathname,
                        {
                            method,
                            headers: {
                                host: environmentHost,
                                ...(body ? { 'content-length': Buffer.byteLength(body) } : {}),
                                ...headers,
                            },
                        },
                        res => {
                            res.setEncoding('utf8');
                            let payload = '';
                            res.on('data', chunk => (payload += chunk));
                            res.on('end', () =>
                                resolve(
                                    new Response(payload, { status: res.statusCode, headers: res.headers }),
                                ),
                            );
                            res.on('error', reject);
                        },
                    );
                    req.on('error', reject);
                    req.end(body);
                });

            const html = await ask('/');
            assert.equal(await html.text(), '<main>.environment-monitor-tool</main>');
            assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
            assert.match(html.headers.get('cache-control'), /no-store/);
            assert.deepEqual(await (await ask('/frontend-release.json')).json(), { releaseId: 'fixture' });
            assert.equal((await ask('/favicon.svg')).status, 200);
            const asset = await ask('/assets/tool-A1234567.js');
            assert.equal(asset.status, 200);
            assert.match(asset.headers.get('cache-control'), /public, max-age=31536000, immutable/);
            for (const extension of ['ps1', 'sh'])
                assert.equal(
                    await (await ask('/tools/claude-proxy/clean-claude-proxy.' + extension)).text(),
                    extension,
                );
            for (const pathname of [
                '/services',
                '/zh',
                '/shop-api',
                '/admin-api',
                '/.environment-monitor-tool/index.html',
                '/tools/claude-proxy/other.sh',
                '/assets/missing-A1234567.css',
            ]) {
                assert.equal((await ask(pathname)).status, 404, pathname);
            }
            assert.equal((await fetch(origin + '/.environment-monitor-tool/index.html')).status, 404);
            const api = '/api/environment/network';
            assert.equal((await ask(api)).status, 405);
            assert.equal(
                (await ask(api, { method: 'POST', headers: { origin: 'https://evil.test' } })).status,
                403,
            );
            const post = (pathname, headers = {}, body) =>
                ask(pathname, {
                    method: 'POST',
                    body,
                    headers: { origin: 'https://' + environmentHost, ...headers },
                });
            assert.equal((await post(api + '?query=other')).status, 400);
            assert.equal((await post(api, { 'x-environment-observed-ipv4': '1.2.3.4"}' })).status, 400);
            assert.equal((await post(api, { 'x-environment-observed-ipv6': 'abcd::1%' })).status, 400);
            assert.equal((await post(api, {}, 'x'.repeat(1025))).status, 413);
            const result = await post(
                api,
                {
                    'x-environment-observed-ipv4': '8.8.8.8',
                    'x-environment-observed-ipv6': '2001:4860:4860::8888',
                    cookie: 'session=synthetic',
                    authorization: 'Bearer synthetic',
                    'vendure-token': 'synthetic',
                    'x-forwarded-for': '1.2.3.4',
                    'x-forwarded-host': 'untrusted.test',
                },
                '{"query":"mutation BlockedClientInput { logout { success } }"}',
            );
            assert.equal(result.status, 200);
            const [upstreamHeaders, upstreamBody] = (await result.text()).split('\n\n');
            assert.match(upstreamHeaders, /^POST \/shop-api HTTP\/1\.1/m);
            assert.match(upstreamHeaders, /^Host: moyaoai\.com$/im);
            assert.match(upstreamHeaders, /^Content-Type: application\/json$/im);
            assert.match(upstreamHeaders, /^X-Forwarded-Proto: https$/im);
            assert.doesNotMatch(upstreamHeaders, /synthetic|1[.]2[.]3[.]4|untrusted[.]test/);
            for (const forbidden of ['set-cookie', 'vendure-auth-token', 'access-control-allow-origin'])
                assert.equal(result.headers.has(forbidden), false, forbidden);
            assert.match(result.headers.get('cache-control'), /no-store/);
            const upstream = JSON.parse(upstreamBody);
            assert.deepEqual(Object.keys(upstream).sort(), ['query', 'variables']);
            assert.equal(
                upstream.query,
                [
                    'query EnvironmentNetworkReport($observedIpv4: String, $observedIpv6: String) {',
                    'environmentNetworkReport(observedIpv4: $observedIpv4, observedIpv6: $observedIpv6) {',
                    'checkedAt provider ip ipv4 ipv6 addressSource maskedIp cached lookupIssue country countryCode region city',
                    'postalCode latitude longitude geoProvider timezone isp asn connectionType fraudScore proxy vpn tor } }',
                ].join(' '),
            );
            assert.deepEqual(upstream.variables, {
                observedIpv4: '8.8.8.8',
                observedIpv6: '2001:4860:4860::8888',
            });
            const withoutObservations = await post(api);
            assert.deepEqual(JSON.parse((await withoutObservations.text()).split('\n\n')[1]).variables, {
                observedIpv4: null,
                observedIpv6: null,
            });
        },
    );
    await t.test('serves MDAC documents and keeps OCR permissions and archives scoped', async () => {
        for (const pathname of ['/mdac', '/zh/mdac', '/en/mdac']) {
            const document = await fetch(origin + pathname);
            assert.equal(document.status, 200, pathname);
            assert.ok(!document.headers.get('content-security-policy').includes('wasm-unsafe-eval'));
            assert.match(await document.text(), /Application shell/);
        }
        const worker = await fetch(origin + '/mdac-ocr/worker.min.js');
        assert.equal(worker.status, 200);
        assert.match(worker.headers.get('content-security-policy'), /script-src 'self' 'wasm-unsafe-eval'/);
        const model = await fetch(origin + '/mdac-ocr/ocrb_int.traineddata.gz');
        assert.equal(await model.text(), 'synthetic model');
        assert.equal((await fetch(origin + '/mdac-ocr/unknown.gz')).status, 404);
    });
    await t.test('marks only credential-free public preferences as anonymous presentation', async () => {
        for (const [headers, expected] of [
            [{}, '1'],
            [{ 'x-storefront-public-coupon-guest': '0' }, '1'],
            [{ cookie: 'storefront_public_language=en; storefront_public_currency=MYR' }, '1'],
            [{ cookie: 'session=synthetic-test-session' }, '0'],
            [{ authorization: 'Bearer synthetic-test-only' }, '0'],
            [{ cookie: 'session=synthetic-test-session', 'x-storefront-public-coupon-guest': '1' }, '0'],
        ]) {
            const response = await fetch(origin + '/__coupon_hint', { headers });
            assert.equal(await response.text(), expected);
            const document = await fetch(origin + '/en', { headers });
            assert.equal(document.status, 200);
            assert.equal(
                await document.text(),
                `Published public page; guest=${expected}; cookie=; authorization=`,
            );
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
            '/mail-query/missing',
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
    await t.test(
        'preserves successful client documents across locales without accepting unknown children',
        async () => {
            for (const route of ['announcements', 'flash-sale', 'recommendations']) {
                for (const prefix of ['', '/zh', '/en']) {
                    const response = await fetch(origin + prefix + '/' + route + '?fixture=1');
                    assert.equal(response.status, 200, prefix + '/' + route);
                    assert.match(response.headers.get('x-robots-tag'), /noindex/);
                    assert.match(await response.text(), /Application shell/);
                }
                const unknown = await fetch(origin + '/zh/' + route + '/missing');
                assert.equal(unknown.status, 404);
                assert.match(unknown.headers.get('x-robots-tag'), /noindex/);
            }
        },
    );
    await t.test('serves the enabled tool with 200 and keeps disabled stores at 404', async () => {
        for (const pathname of [
            '/environment-monitor',
            '/zh/environment-monitor?source=fixture',
            '/en/environment-monitor/',
        ]) {
            for (const [host, status] of [
                ['127.0.0.1', 200],
                ['disabled.fixture', 404],
            ]) {
                // Send the synthetic Host directly through the production proxy directives.
                const { response, body } = await new Promise((resolve, reject) => {
                    get(origin + pathname, { headers: { host } }, incoming => {
                        let text = '';
                        incoming.setEncoding('utf8');
                        incoming.on('data', chunk => (text += chunk));
                        incoming.on('end', () => resolve({ response: incoming, body: text }));
                        incoming.on('error', reject);
                    }).on('error', reject);
                });
                assert.equal(response.statusCode, status, pathname);
                assert.match(body, /recovery navigation/, pathname);
                assert.match(response.headers['x-robots-tag'], /noindex/);
                assert.match(response.headers['cache-control'], /no-store/);
                assert.equal(response.headers.location, undefined);
            }
        }
        assert.equal((await fetch(origin + '/zh/environment-monitor/missing')).status, 404);
    });
    await t.test(
        'mail document refresh uses the storefront shell while legacy scripts and console stay compatible',
        async () => {
            for (const route of ['/mail-query', '/mail-query/', '/mail-query?fixture=1']) {
                const response = await fetch(origin + route);
                assert.equal(response.status, 200, route);
                assert.match(await response.text(), /Application shell with recovery navigation/, route);
                assert.match(response.headers.get('cache-control'), /no-store/, route);
            }
            const head = await fetch(origin + '/mail-query', { method: 'HEAD' });
            assert.equal(head.status, 200);
            assert.equal(await head.text(), '');
            const script = await fetch(origin + '/mail-query/portal.js?v=fixture');
            assert.equal(script.status, 200);
            assert.match(script.headers.get('content-type'), /application\/javascript/);
            assert.match(await script.text(), /Legacy mail portal script/);
            for (const route of ['/mail-query', '/mail-query/portal.js?v=fixture']) {
                // Native fetch can replace Host with the URL authority. HTTP sends the
                // explicit host so this exercises the real console virtual host.
                const response = await new Promise((resolve, reject) => {
                    get(origin + route, { headers: { Host: 'console.fixture' } }, upstream => {
                        let body = '';
                        upstream.setEncoding('utf8');
                        upstream.on('data', chunk => (body += chunk));
                        upstream.on('end', () => resolve({ status: upstream.statusCode, body }));
                        upstream.on('error', reject);
                    }).on('error', reject);
                });
                assert.equal(response.status, 200, route);
                assert.match(response.body, /Legacy (?:standalone mail portal|mail portal script)/, route);
            }
        },
    );
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
                    // Only a cookieless public document for a UA outside the COOP exception
                    // may enter a shared cache; every other response stays no-store.
                    const sharedCacheable = route === '/zh/' && !affected.includes(userAgent);
                    assert.match(
                        response.headers.get('cache-control'),
                        sharedCacheable ? /s-maxage=300/u : /no-store/u,
                        `${method} ${route}: ${userAgent}`,
                    );
                }
            }
        }
        for (const cookie of ['storefront_public_language=en', 'storefront_public_currency=MYR']) {
            const response = await fetch(origin + '/zh/', { headers: { cookie } });
            assert.equal(response.status, 200);
            assert.match(response.headers.get('cache-control'), /no-store/u);
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

test('dedicated recharge TLS fails closed before DNS/cert activation and validates the private artifact', async t => {
    const docker = (...args) =>
        execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const endpoint = docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}');
    assert.match(process.env.DOCKER_HOST || endpoint, /^unix:\/\//u, 'Use an explicitly local Docker daemon');
    const image = 'nginx@sha256:db35bfc6b2951e7f8a72db5db120288c127ffaeeb4a6d4b95a26fead017d5913';
    try {
        docker('image', 'inspect', image);
    } catch {
        docker('pull', image);
    }
    const cache = path.resolve(repo, '.cache/nginx-fallback-tests');
    mkdirSync(cache, { recursive: true });
    const fixture = mkdtempSync(path.join(cache, 'recharge-'));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    chmodSync(fixture, 0o755);
    const hostname = 'recharge.moyaoai.com';
    const mainHost = 'shop.example.test';
    const cert = path.join(fixture, 'test-fullchain.pem');
    const key = path.join(fixture, 'test-privkey.pem');
    execFileSync(
        'openssl',
        [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-days',
            '1',
            '-subj',
            '/CN=shop.example.test',
            '-addext',
            'subjectAltName=DNS:shop.example.test,DNS:recharge.moyaoai.com',
            '-keyout',
            key,
            '-out',
            cert,
        ],
        { stdio: 'ignore' },
    );
    const tool = path.join(fixture, 'www/.recharge-tool');
    mkdirSync(path.join(tool, 'assets'), { recursive: true });
    mkdirSync(path.join(tool, '.compat-assets/assets'), { recursive: true });
    writeFileSync(path.join(tool, 'index.html'), '<main>Recharge tool fixture</main>');
    writeFileSync(path.join(tool, 'assets/tool-A1234567.js'), 'export const code = true;');
    writeFileSync(path.join(tool, '.compat-assets/assets/tool-B1234567.js'), 'export const previous = true;');
    writeFileSync(path.join(fixture, 'www/frontend-release.json'), '{}');
    const vhost = block('server', source.lastIndexOf('server {', source.indexOf('server_name ' + hostname)))
        .replace(/^ +listen 443 ssl http2;$/mu, '    listen 8443 ssl;')
        .replace(/^ +listen \[::\]:443[^\n]*\n/mu, '')
        .replaceAll('/var/www/kaiyuangouwu-storefront-current', '/fixtures/www');
    const config = [
        'events {}',
        'http {',
        'access_log off;',
        'types { application/javascript js; application/json json; }',
        'limit_req_zone $binary_remote_addr zone=vendure_shop_api:1m rate=100r/s;',
        'limit_conn_zone $binary_remote_addr zone=vendure_realtime_per_ip:1m;',
        'map $remote_addr $trusted_cloudflare_origin { default 1; }',
        block('map $request_uri $recharge_partner_slug'),
        block('map $recharge_partner_slug $recharge_partner_host').replace(
            'include /etc/nginx/recharge-partners.d/*.map;',
            'fixture-partner partner.example.test;',
        ),
        block('map $ssl_server_name $recharge_tls_directory').replace(
            '/etc/nginx/recharge-tls/recharge.moyaoai.com',
            '/fixtures/recharge-tls',
        ),
        'upstream vendure_backend { server 127.0.0.1:8081; }',
        'server { listen 8081; location / {',
        'return 200 "host=$host;path=$uri;cookie=$http_cookie;token=$http_vendure_token;auth=$http_authorization";',
        '} }',
        'server { listen 8443 ssl; server_name shop.example.test;',
        'ssl_certificate /fixtures/test-fullchain.pem; ssl_certificate_key /fixtures/test-privkey.pem;',
        'location / { return 200 "existing host"; } }',
        vhost,
        '}',
    ].join('\n');
    writeFileSync(path.join(fixture, 'nginx.conf'), config);
    const mount = [
        '-v',
        fixture + ':/fixtures:ro',
        '-v',
        path.join(fixture, 'nginx.conf') + ':/etc/nginx/nginx.conf:ro',
    ];
    docker('run', '--rm', '--pull=never', ...mount, image, 'nginx', '-t');
    const id = docker('run', '-d', '--rm', '--pull=never', '-p', '127.0.0.1::8443', ...mount, image);
    t.after(() => docker('stop', '--time', '1', id));
    const port = Number(docker('port', id, '8443/tcp').split(':').at(-1));
    const ca = readFileSync(cert);
    const open = (servername, pathname, method = 'GET') =>
        new Promise((resolve, reject) => {
            const options = {
                hostname: '127.0.0.1',
                servername,
                port,
                ca,
                path: pathname,
                method,
                headers: {
                    host: servername,
                    cookie: 'session=synthetic',
                    authorization: 'Bearer synthetic',
                    'vendure-token': 'synthetic',
                    'content-type': 'application/json',
                },
            };
            const req = requestHttps(options, response => {
                let body = '';
                response.setEncoding('utf8').on('data', chunk => {
                    body += chunk;
                });
                response.on('error', reject);
                response.on('end', () => resolve({ status: response.statusCode, body }));
            });
            req.on('error', reject);
            req.setTimeout(2000, () => req.destroy(new Error('Fixture timeout')));
            req.end(method === 'POST' ? '{}' : undefined);
        });
    const deadline = Date.now() + 5000;
    while (true) {
        try {
            assert.equal((await open(mainHost, '/')).body, 'existing host');
            break;
        } catch (error) {
            if (Date.now() >= deadline) throw error;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    await assert.rejects(open(hostname, '/'), /SSL alert|handshake failure|socket hang up/u);
    assert.equal((await open(mainHost, '/')).status, 200);
    mkdirSync(path.join(fixture, 'recharge-tls'));
    // Only this disposable test key is made readable by the fixture worker.
    copyFileSync(cert, path.join(fixture, 'recharge-tls/fullchain.pem'));
    copyFileSync(key, path.join(fixture, 'recharge-tls/privkey.pem'));
    chmodSync(path.join(fixture, 'recharge-tls/privkey.pem'), 0o644);
    assert.equal((await open(hostname, '/')).body, '<main>Recharge tool fixture</main>');
    assert.equal((await open(hostname, '/frontend-release.json')).body, '{}');
    assert.equal((await open(hostname, '/assets/tool-A1234567.js')).status, 200);
    assert.equal((await open(hostname, '/assets/tool-B1234567.js')).status, 200);
    assert.equal((await open(hostname, '/p/fixture-partner/?tab=query')).status, 200);
    assert.equal(
        (await open(hostname, '/api/recharge/config', 'POST')).body,
        'host=moyaoai.com;path=/api/recharge/config;cookie=;token=;auth=',
    );
    assert.equal(
        (await open(hostname, '/p/fixture-partner/api/recharge/events', 'POST')).body,
        'host=partner.example.test;path=/api/recharge/events;cookie=;token=;auth=',
    );
    for (const pathname of [
        '/p/unknown/',
        '/p/%66ixture-partner/',
        '/shop-api',
        '/zh/',
        '/.recharge-tool/index.html',
    ])
        assert.equal((await open(hostname, pathname)).status, 404, pathname);
});
