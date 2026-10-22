import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyChanges } from '../scripts/ci-impact.mjs';

import { assertFrontendScope } from './frontend-release.mjs';
import {
    assertNginxScope,
    assertPublicTransition,
    atomicConfig,
    DESKTOP_UA,
    IPHONE_UA,
    nginxTransaction,
    observePublic,
} from './nginx-release.mjs';
import nginxRevision from './nginx-revision.cjs';
import { nginxDeployCommand, nginxReceiptFromInvocation } from './nginx-ssm.mjs';
import { selectReleaseRoute } from './release-route.mjs';

const old = 'a'.repeat(40);
const target = 'b'.repeat(40);
const hash = 'c'.repeat(64);
const revisions = { baseSha: old, targetSha: target, storefrontSha: old, adminSha: old };
const controls = [
    'deploy/nginx-release.mjs',
    'deploy/nginx-revision.cjs',
    'deploy/nginx-ssm.mjs',
    'deploy/deploy-nginx-from-s3.sh',
    'deploy/release-route.mjs',
    '.github/workflows/deploy_nginx.yml',
    'scripts/ci-impact.mjs',
];
const config = 'deploy/nginx/damatong.conf';
const scope = (files, options = {}) =>
    selectReleaseRoute({ ...revisions, plan: classifyChanges(files), changedSince: () => false, ...options });

test('Nginx controls alone do not select an application or database release', () => {
    const plan = classifyChanges(controls);
    assert.equal(plan.lane, 'none');
    assert.equal(plan.controls, true);
    assert.deepEqual(plan.packages, []);
    assert.deepEqual(plan.databases, []);
    assert.equal(
        scope([config, ...controls, 'docs/local-validation/ios-coop-compat-20261022/README.md']).lane,
        'nginx',
    );
});

test('only already-published frontend inputs may accompany an independent Nginx release', () => {
    const files = [config, ...controls, 'packages/storefront/src/index.css'];
    assert.equal(scope(files).lane, 'nginx');
    assert.equal(scope(files, { changedSince: () => true }).lane, 'runtime');
    assert.equal(scope(files, { storefrontSha: 'unknown' }).lane, 'runtime');
    assert.equal(scope(files, { adminSha: 'unknown' }).lane, 'runtime');
});

test('a verified active Nginx revision cannot force later frontend or control changes into runtime', () => {
    const files = [config, ...controls, 'packages/storefront/src/index.css'];
    assert.equal(
        scope(files, { nginxSha: old, nginxChangedSince: () => false, changedSince: () => true }).lane,
        'frontend',
    );
    assert.equal(
        scope([config, ...controls], { nginxSha: old, nginxChangedSince: () => false }).lane,
        'none',
    );
    assert.equal(
        scope(files, { nginxSha: old, nginxChangedSince: () => true, changedSince: () => true }).lane,
        'runtime',
    );
    assert.equal(
        scope([config, 'packages/core/src/order.ts'], { nginxSha: old, nginxChangedSince: () => false }).lane,
        'runtime',
    );
    assert.throws(() =>
        nginxRevision.withoutActiveNginx(files, { nginxSha: 'unverified', targetSha: target }),
    );
    assert.deepEqual(
        nginxRevision.withoutActiveNginx(files, { nginxSha: old, targetSha: target }, () => false),
        files.filter(file => file !== config),
    );
    // The actual frontend scope function accepts the normalized file list;
    // production supplies nginxSha only from native/on-host inspection.
    const normalized = files.filter(file => file !== config);
    assert.equal(
        assertFrontendScope(normalized, ['next-admin', 'storefront'], { ...revisions }, () => true).lane,
        'frontend',
    );
});

test('active configuration identity recognizes independent and later full-runtime versions but rejects drift', () => {
    const middle = 'd'.repeat(40);
    const history = [old, middle, target];
    const ancestor = (a, b) => history.indexOf(a) <= history.indexOf(b);
    const blob = sha => (sha === old ? 'original' : 'candidate');
    const marker = { sourceSha: middle, configSha256: 'a', result: 'PASS' };
    // Marker checksums are produced from the exact bytes, never version labels.
    marker.configSha256 = createHash('sha256').update('candidate').digest('hex');
    const original = nginxRevision.resolveNginxRevision(
        { backendSha: old, targetSha: target, actual: 'original' },
        blob,
        ancestor,
    );
    assert.equal(original.sourceSha, old);
    const independent = nginxRevision.resolveNginxRevision(
        { backendSha: old, targetSha: target, actual: 'candidate', marker },
        blob,
        ancestor,
    );
    assert.equal(independent.sourceSha, middle);
    const full = nginxRevision.resolveNginxRevision(
        { backendSha: target, targetSha: target, actual: 'candidate', marker },
        blob,
        ancestor,
    );
    assert.equal(full.sourceSha, target);
    assert.throws(
        () =>
            nginxRevision.resolveNginxRevision(
                { backendSha: old, targetSha: target, actual: 'unexpected', marker },
                blob,
                ancestor,
            ),
        /unreviewed drift/u,
    );
    assert.throws(
        () =>
            nginxRevision.resolveNginxRevision(
                {
                    backendSha: old,
                    targetSha: target,
                    actual: 'candidate',
                    marker: { ...marker, configSha256: '0'.repeat(64) },
                },
                blob,
                ancestor,
            ),
        /differs from Git/u,
    );
});

test('backend, dependency, unknown deployment, full and managed scopes cannot use Nginx-only publication', () => {
    for (const file of [
        'packages/core/src/order.ts',
        'bun.lock',
        'packages/storefront/vite.config.ts',
        'deploy/unreviewed-command.sh',
        'deploy/nginx/another.conf',
    ])
        assert.equal(scope([config, ...controls, file]).lane, 'runtime', file);
    assert.equal(scope([config], { managed: true }).lane, 'runtime');
    assert.equal(scope([config], { plan: classifyChanges([config], [], { full: true }) }).lane, 'runtime');
    assert.throws(() => assertNginxScope(revisions, classifyChanges([config, 'packages/core/src/order.ts'])));
    assert.throws(() => assertNginxScope(revisions, classifyChanges(controls)));
});

test('the configuration transaction validates before mutation and restores on every post-install failure', async () => {
    for (const failed of [
        'validateCandidate',
        'backup',
        'install',
        'validateLive',
        'reload',
        'verify',
        'none',
    ]) {
        const events = [];
        let thrown = false;
        const steps = Object.fromEntries(
            [
                'validateCandidate',
                'backup',
                'install',
                'validateLive',
                'reload',
                'verify',
                'restore',
                'verifyRestored',
            ].map(name => [
                name,
                async () => {
                    events.push(name);
                    if (name === failed && !thrown) {
                        thrown = true;
                        throw new Error('Injected failure');
                    }
                    return 'accepted';
                },
            ]),
        );
        if (failed === 'none') {
            assert.equal(await nginxTransaction(steps), 'accepted');
            assert.deepEqual(events, [
                'validateCandidate',
                'backup',
                'install',
                'validateLive',
                'reload',
                'verify',
            ]);
        } else {
            await assert.rejects(
                nginxTransaction(steps),
                failed === 'validateCandidate' || failed === 'backup'
                    ? /Injected failure/u
                    : /original configuration was restored and verified/u,
            );
            if (['validateCandidate', 'backup'].includes(failed))
                assert.ok(!events.includes('install') && !events.includes('restore'));
            else assert.deepEqual(events.slice(-4), ['restore', 'validateLive', 'reload', 'verifyRestored']);
        }
    }
});

test('failed recovery is reported distinctly and cannot produce a successful receipt', async () => {
    const noop = async () => undefined;
    await assert.rejects(
        nginxTransaction({
            validateCandidate: noop,
            backup: noop,
            install: noop,
            validateLive: noop,
            reload: noop,
            verify: async () => {
                throw new Error('bad public response');
            },
            restore: async () => {
                throw new Error('backup unavailable');
            },
            verifyRestored: noop,
        }),
        /recovery requires attention/u,
    );
});

test('real file replacement and recovery preserve the exact previous configuration bytes', async t => {
    const parent = fileURLToPath(new URL('../.local-validation/nginx-release/', import.meta.url));
    mkdirSync(parent, { recursive: true });
    const root = mkdtempSync(join(parent, 'case-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, 'active.conf');
    const original = Buffer.from('original configuration\n');
    writeFileSync(file, original);
    const noop = async () => undefined;
    await assert.rejects(
        nginxTransaction({
            validateCandidate: noop,
            backup: noop,
            install: () => atomicConfig(file, Buffer.from('candidate\n'), 'test'),
            validateLive: noop,
            reload: noop,
            verify: () => {
                assert.equal(readFileSync(file, 'utf8'), 'candidate\n');
                throw new Error('public header check failed');
            },
            restore: () => atomicConfig(file, original, 'restore'),
            verifyRestored: () => assert.deepEqual(readFileSync(file), original),
        }),
        /restored and verified/u,
    );
    assert.deepEqual(readFileSync(file), original);
    const pending = file + '.collision.pending';
    writeFileSync(pending, 'another owner');
    assert.throws(() => atomicConfig(file, Buffer.from('bad'), 'collision'), /EEXIST/u);
    assert.deepEqual(readFileSync(file), original);
    assert.equal(readFileSync(pending, 'utf8'), 'another owner');
});

const origins = ['https://one.example', 'https://two.example', 'https://three.example'];
function publicFetcher(candidate, mutate = () => undefined) {
    return async (url, options) => {
        assert.equal(url.protocol, 'https:');
        assert.equal(options.redirect, 'error');
        assert.ok([DESKTOP_UA, IPHONE_UA].includes(options.headers['User-Agent']));
        const api = url.pathname === '/shop-api';
        if (api) assert.equal(options.headers['Apollo-Require-Preflight'], 'true');
        const headers = new Headers({
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
            'Content-Security-Policy': "default-src 'self'",
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'camera=()',
            'Content-Type': api ? 'application/json' : 'text/html',
            'Cache-Control': 'private, no-store',
            Vary: 'Accept-Encoding, User-Agent',
        });
        if (!candidate || api || options.headers['User-Agent'] !== IPHONE_UA)
            headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
        mutate(headers, { api, url });
        return new Response(
            api ? JSON.stringify({ data: { __typename: 'Query' } }) : '<html><body>store</body></html>',
            { status: 200, headers },
        );
    };
}

test('public acceptance checks all three stores and retains API and unrelated security headers', async () => {
    const before = await observePublic(origins, 'before', publicFetcher(false));
    const after = await observePublic(origins, 'after', publicFetcher(true));
    assert.equal(after.length, 9);
    assertPublicTransition(before, after);
    for (const name of ['content-security-policy', 'strict-transport-security', 'permissions-policy']) {
        const changed = structuredClone(after);
        changed[0].headers[name] = 'changed';
        assert.throws(() => assertPublicTransition(before, changed), /Security header changed/u);
    }
    const insecureApi = structuredClone(after);
    insecureApi[2].headers['cross-origin-opener-policy'] = null;
    assert.throws(() => assertPublicTransition(before, insecureApi), /COOP policy/u);
    await assert.rejects(
        observePublic(origins, 'bad', async () => new Response('error', { status: 503 })),
        /HTTP 200/u,
    );
});

test('SSM command rejects shell injection and never enters the runtime deployment path', () => {
    const input = {
        sha: target,
        archive: `nginx-${target}-42-1.tar.gz`,
        checksum: hash,
        configHash: hash,
        backendSha: old,
        storefrontSha: old,
        adminSha: old,
    };
    const command = nginxDeployCommand(input);
    assert.match(command, /git archive "\$1" deploy scripts/u);
    assert.match(command, /deploy-nginx-from-s3\.sh/u);
    assert.ok(
        !/pm2\s+(?:stop|restart)|deploy-production-from-s3|git\s+(?:reset|checkout|clean)/u.test(command),
    );
    for (const key of Object.keys(input))
        assert.throws(() => nginxDeployCommand({ ...input, [key]: "'; echo bad" }));
    const installer = readFileSync(new URL('./deploy-nginx-from-s3.sh', import.meta.url), 'utf8');
    assert.match(installer, /flock --exclusive --wait 300 9/u);
    assert.ok(installer.indexOf('flock --exclusive') < installer.indexOf('Active backend revision changed'));
    assert.match(installer, /readonly nginx_revision=/u);
    assert.ok(installer.indexOf('readonly nginx_revision=') < installer.indexOf('aws s3 cp'));
    assert.ok(
        !/pm2\s+(?:stop|restart)|migration:run|deploy-production-from-s3|systemctl\s+(?:stop|restart)/u.test(
            installer,
        ),
    );
    const shell = execFileSync(
        'bash',
        ['-n', fileURLToPath(new URL('./deploy-nginx-from-s3.sh', import.meta.url))],
        { encoding: 'utf8' },
    );
    assert.equal(shell, '');
});

test('only native successful invocation evidence with exact preserved identities supplies acceptance', () => {
    const commandId = '12345678-1234-1234-1234-123456789abc';
    const expected = { sha: target, configHash: hash, backendSha: old, commandId };
    const receipt = {
        sourceSha: target,
        configSha256: hash,
        result: 'PASS',
        before: { runtimeSha: old, pid: 123 },
        after: { runtimeSha: old, pid: 123 },
    };
    const invocation = {
        CommandId: commandId,
        InstanceId: 'i-041a146558e432cbf',
        Comment: `Nginx release ${target}`,
        Status: 'Success',
        ResponseCode: 0,
        StandardOutputContent: `NGINX_RECEIPT ${JSON.stringify(receipt)}\nNGINX_DEPLOYED_OK sha=${target} config_sha256=${hash}\n`,
    };
    assert.deepEqual(nginxReceiptFromInvocation(invocation, expected), receipt);
    for (const [key, value] of [
        ['CommandId', 'another'],
        ['InstanceId', 'another'],
        ['Comment', 'another'],
        ['Status', 'Failed'],
        ['ResponseCode', 1],
        ['StandardOutputContent', 'truncated'],
    ])
        assert.throws(() => nginxReceiptFromInvocation({ ...invocation, [key]: value }, expected));
    receipt.after.pid++;
    assert.throws(
        () =>
            nginxReceiptFromInvocation(
                {
                    ...invocation,
                    StandardOutputContent: `NGINX_RECEIPT ${JSON.stringify(receipt)}\nNGINX_DEPLOYED_OK sha=${target} config_sha256=${hash}\n`,
                },
                expected,
            ),
        /identities changed/u,
    );
});

test('Production Release requires Nginx acceptance and cannot silently fall through to runtime', () => {
    const workflow = readFileSync(
        new URL('../.github/workflows/production_release.yml', import.meta.url),
        'utf8',
    );
    assert.match(workflow, /needs\.route\.outputs\.lane == 'nginx'/u);
    assert.match(workflow, /nginx\) \[\[ "\$NGINX_RESULT" == success \]\]/u);
    const child = readFileSync(new URL('../.github/workflows/deploy_nginx.yml', import.meta.url), 'utf8');
    assert.match(child, /release-evidence\.mjs verify/u);
    assert.match(child, /nginx-acceptance-\$\{\{ inputs\.target_sha \}\}/u);
    assert.ok(!/bun install|migration|build_production|deploy_production_runtime/u.test(child));
});
