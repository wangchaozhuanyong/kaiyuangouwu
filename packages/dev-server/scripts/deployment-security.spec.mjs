import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

void test('production Nginx routes protected downloads and hardens both APIs', async () => {
    const config = await readFile(path.join(repositoryRoot, 'deploy/nginx/damatong.conf'), 'utf8');

    assert.match(config, /location \^~ \/digital-delivery\//u);
    assert.match(config, /limit_req_zone \$binary_remote_addr zone=vendure_shop_api/u);
    assert.match(config, /limit_req_zone \$binary_remote_addr zone=vendure_admin_api/u);
    assert.match(config, /Strict-Transport-Security/u);
    assert.match(config, /Content-Security-Policy/u);
    assert.match(config, /Permissions-Policy/u);
    assert.match(config, /^server_tokens off;$/mu);
    assert.match(config, /^ssl_protocols TLSv1\.2 TLSv1\.3;$/mu);
    assert.match(config, /^ssl_session_tickets off;$/mu);
    assert.match(config, /location = \/sitemap\.xml/u);
    assert.match(config, /proxy_pass http:\/\/vendure_backend\/promo\/sitemap/u);
    assert.match(config, /real_ip_header CF-Connecting-IP/u);
    assert.match(config, /geo \$realip_remote_addr \$trusted_cloudflare_origin/u);
    assert.equal(
        [...config.matchAll(/if \(\$trusted_cloudflare_origin = 0\) \{ return 444; \}/gu)].length,
        4,
    );
    assert.match(config, /root \/var\/www\/kaiyuangouwu-current\/packages\/storefront\/dist;/u);
});

void test('promotion route preserves backend CSP without inheriting the storefront policy', async () => {
    const config = await readFile(path.join(repositoryRoot, 'deploy/nginx/damatong.conf'), 'utf8');
    const promoLocation = config.match(/location = \/promo \{(?<body>[\s\S]*?)\n    \}/u)?.groups?.body;

    assert.ok(promoLocation);
    assert.match(promoLocation, /add_header Strict-Transport-Security/u);
    assert.match(promoLocation, /add_header Permissions-Policy/u);
    assert.doesNotMatch(promoLocation, /add_header Content-Security-Policy/u);
});

void test('production PM2 config starts compiled runtime entries without the development CLI', async () => {
    const config = await readFile(
        path.join(repositoryRoot, 'deploy/ecosystem.production.config.cjs'),
        'utf8',
    );

    assert.match(config, /VENDURE_RUNTIME_DIR/u);
    assert.match(config, /packages\/dev-server\/dist\/index-worker\.js/u);
    assert.match(config, /packages\/dev-server\/dist\/index\.js/u);
    assert.match(config, /VENDURE_DISABLE_TELEMETRY:\s*'true'/u);
    assert.doesNotMatch(config, /cli\.js/u);
});

void test('production runtime switch rebuilds PM2 definitions for an immutable release', async () => {
    const script = await readFile(path.join(repositoryRoot, 'deploy/switch-production-runtime.sh'), 'utf8');

    const requestAudit = script.indexOf('audit_switch requested');
    const processDeletion = script.indexOf('pm2 delete');
    const successAudit = script.indexOf('audit_switch succeeded');

    assert.notEqual(requestAudit, -1);
    assert.notEqual(processDeletion, -1);
    assert.notEqual(successAudit, -1);
    assert.ok(requestAudit < processDeletion);
    assert.ok(successAudit > processDeletion);
    assert.match(script, /\/usr\/bin\/logger --tag "\$\{audit_tag\}"/u);
    assert.match(script, /vendure-production-switch/u);
    assert.match(script, /audit_switch failed/u);
    assert.match(script, /VENDURE_DEPLOYMENT_ID/u);
    assert.match(script, /SSH_CONNECTION/u);
    assert.match(script, /RUNTIME-METADATA\.json/u);
    assert.match(script, /pm2 delete/u);
    assert.match(script, /pm2 start/u);
    assert.match(script, /pm_cwd/u);
    assert.match(script, /pm_exec_path/u);
    assert.doesNotMatch(script, /startOrReload/u);
});

void test('production runbook elevates only the root-owned atomic runtime switch', async () => {
    const runbook = await readFile(path.join(repositoryRoot, 'deploy/DEPLOYMENT_RUNBOOK.md'), 'utf8');
    const workflow = await readFile(
        path.join(repositoryRoot, '.github/workflows/build_production_runtime.yml'),
        'utf8',
    );

    assert.match(runbook, /tar --extract --gzip --same-permissions --file/u);
    assert.match(runbook, /stat --format='%a' "\$\{CANDIDATE\}"/u);
    assert.match(workflow, /stat --format='%a' "\$ARTIFACT_DIR"/u);
    assert.match(runbook, /sudo -n ln -s "\$\{CANDIDATE\}"/u);
    assert.match(runbook, /sudo -n mv -Tf/u);
    assert.match(runbook, /sudo -n nginx -t/u);
    assert.match(runbook, /sudo -n systemctl reload nginx/u);
    assert.match(runbook, /journalctl -t vendure-production-switch/u);
    assert.match(runbook, /VENDURE_DEPLOYMENT_ID/u);
    assert.match(runbook, /sync-storefront-media\.mjs --dry-run/u);
    assert.match(runbook, /sync-storefront-media\.mjs --apply --allow-remote/u);
});

void test('experimental UI examples do not commit Google API keys', async () => {
    const locationMap = await readFile(
        path.join(
            repositoryRoot,
            'packages/dev-server/test-plugins/experimental-ui/components/LocationMap.tsx',
        ),
        'utf8',
    );

    assert.doesNotMatch(locationMap, /AIza[A-Za-z0-9_-]{30,}/u);
});
