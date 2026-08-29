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
    assert.match(script, /--only vendure-api/u);
    assert.match(script, /127\.0\.0\.1:3002\/health/u);
    assert.match(script, /--only vendure-worker/u);
    assert.ok(script.indexOf('--only vendure-api') < script.indexOf('--only vendure-worker'));
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

void test('production runbook uses the promotion-aware release verifier', async () => {
    const runbook = await readFile(path.join(repositoryRoot, 'deploy/DEPLOYMENT_RUNBOOK.md'), 'utf8');

    assert.match(runbook, /node deploy\/verify-production-release\.mjs/u);
    assert.match(runbook, /STOREFRONT_ENTRY_REQUIRED/u);
    assert.doesNotMatch(runbook, /curl -I https:\/\/damatong\.net\/assets\//u);
});

void test('OIDC production deployment uses a locked, immutable S3-to-SSM release path', async () => {
    const script = await readFile(path.join(repositoryRoot, 'deploy/deploy-production-from-s3.sh'), 'utf8');
    const workflow = await readFile(
        path.join(repositoryRoot, '.github/workflows/deploy_production_runtime.yml'),
        'utf8',
    );
    const migrationReadinessCommand = [
        'NODE_ENV=production READINESS_PROCESS_ROLE=migration RUN_MIGRATIONS=true RUN_JOB_QUEUE=0 \\',
        '    node "${repository}/packages/dev-server/scripts/production-env-readiness.mjs"',
    ].join('\n');

    assert.match(script, /vendure-production-deploy\.lock/u);
    assert.match(script, /flock --exclusive --wait 300/u);
    assert.match(script, /git merge --ff-only refs\/remotes\/origin\/main/u);
    assert.match(script, /sha256sum --check/u);
    assert.match(script, /verify-runtime\.mjs" --expected-sha/u);
    assert.match(script, /vendure-mysql-backup\.service/u);
    assert.ok(script.includes(migrationReadinessCommand));
    assert.match(script, /switch-production-runtime\.sh/u);
    assert.match(script, /rollback 1/u);
    assert.match(script, /9>&-/u);
    assert.match(script, /PRODUCTION_DEPLOY_OK/u);
    assert.match(script, /managed storefront data changed/u);
    assert.match(script, /readonly memory_guard=.*production-memory-guard\.cjs/u);
    assert.match(script, /node "\$\{memory_guard\}" --stage pre-download --check/u);
    assert.match(script, /node "\$\{memory_guard\}" --stage pre-migration --check/u);
    assert.match(script, /node "\$\{memory_guard\}" --stage pre-switch --check/u);
    assert.match(script, /node "\$\{memory_guard\}" --stage post-switch --report/u);
    assert.match(script, /retain_release_file/u);
    assert.match(script, /mv -- "\$\{source_path\}" "\$\{destination_path\}"/u);

    assert.match(workflow, /workflow_run:/u);
    assert.match(workflow, /id-token: write/u);
    assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/u);
    assert.match(workflow, /aws-actions\/configure-aws-credentials@[0-9a-f]{40}/u);
    assert.match(workflow, /yunqiao-vendure-github-deploy/u);
    assert.match(workflow, /i-041a146558e432cbf/u);
    assert.match(workflow, /AWS-RunShellScript/u);
    assert.doesNotMatch(workflow, /AWS_ACCESS_KEY_ID/u);
    assert.doesNotMatch(workflow, /AWS_SECRET_ACCESS_KEY/u);
});

void test('OIDC production recovery restarts only the last verified immutable runtime', async () => {
    const script = await readFile(
        path.join(repositoryRoot, 'deploy/recover-current-production-runtime.sh'),
        'utf8',
    );
    const workflow = await readFile(
        path.join(repositoryRoot, '.github/workflows/recover_production_runtime.yml'),
        'utf8',
    );

    assert.match(script, /kaiyuangouwu-current/u);
    assert.match(script, /current-sha/u);
    assert.match(script, /RUNTIME-METADATA\.json/u);
    assert.match(script, /candidate_sha.*expected_sha/u);
    assert.match(script, /vendure-production-deploy\.lock/u);
    assert.match(script, /switch-production-runtime\.sh/u);
    assert.match(script, /127\.0\.0\.1:3002\/health/u);
    assert.match(script, /pm2 save/u);

    assert.match(workflow, /workflow_dispatch:/u);
    assert.match(workflow, /id-token: write/u);
    assert.match(workflow, /git merge --ff-only/u);
    assert.match(workflow, /recover-current-production-runtime\.sh/u);
    assert.match(workflow, /AWS-RunShellScript/u);
    assert.doesNotMatch(workflow, /AWS_ACCESS_KEY_ID/u);
    assert.doesNotMatch(workflow, /AWS_SECRET_ACCESS_KEY/u);
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
