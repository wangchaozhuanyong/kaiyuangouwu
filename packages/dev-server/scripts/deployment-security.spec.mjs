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
    assert.match(config, /limit_conn_zone \$binary_remote_addr zone=vendure_realtime_per_ip/u);
    assert.match(config, /^limit_conn_status 429;$/mu);
    assert.match(config, /^log_format vendure_realtime escape=json$/mu);
    assert.match(config, /"limit_conn_status":"\$limit_conn_status"/u);
    assert.match(config, /"limit_req_status":"\$limit_req_status"/u);
    assert.match(config, /"request_time":\$request_time/u);
    assert.match(config, /"upstream_response_time":"\$upstream_response_time"/u);
    assert.match(config, /"connection":\$connection/u);
    assert.match(config, /"cf_ray":"\$http_cf_ray"/u);
    assert.match(config, /Strict-Transport-Security/u);
    assert.match(config, /Content-Security-Policy/u);
    assert.match(config, /Permissions-Policy/u);
    assert.match(config, /^server_tokens off;$/mu);
    assert.match(config, /^ssl_protocols TLSv1\.2 TLSv1\.3;$/mu);
    assert.match(config, /^ssl_session_tickets off;$/mu);
    assert.match(config, /location = \/sitemap\.xml/u);
    assert.match(config, /proxy_pass http:\/\/vendure_backend\/promo\/sitemap/u);
    assert.match(config, /real_ip_header CF-Connecting-IP/u);
    assert.match(config, /^set_real_ip_from 127\.0\.0\.0\/8;$/mu);
    assert.match(config, /^set_real_ip_from ::1\/128;$/mu);
    assert.match(config, /geo \$realip_remote_addr \$trusted_cloudflare_origin/u);
    const trustedOriginGeo = config.match(
        /geo \$realip_remote_addr \$trusted_cloudflare_origin \{(?<body>[\s\S]*?)\n\}/u,
    );
    assert.ok(trustedOriginGeo?.groups?.body);
    assert.match(trustedOriginGeo.groups.body, /^\s+127\.0\.0\.0\/8 1;$/mu);
    assert.match(trustedOriginGeo.groups.body, /^\s+::1\/128 1;$/mu);
    assert.equal(
        [...config.matchAll(/if \(\$trusted_cloudflare_origin = 0\) \{ return 444; \}/gu)].length,
        4,
    );
    assert.match(config, /root \/var\/www\/kaiyuangouwu-current\/packages\/storefront\/dist;/u);
    const httpDefaultServer = config.slice(
        config.indexOf('listen 80 default_server;'),
        config.indexOf('server_name moyaoai.com www.moyaoai.com console.moyaoai.com'),
    );
    assert.match(httpDefaultServer, /return 301 https:\/\/\$host\$request_uri;/u);
    const storefrontServer = config.slice(
        config.indexOf('listen 443 ssl http2 default_server;'),
        config.indexOf('server_name console.damatong.net;'),
    );
    assert.match(storefrontServer, /listen 443 ssl http2 default_server;/u);
    assert.match(storefrontServer, /server_name moyaoai\.com damatong\.net _;/u);
    assert.doesNotMatch(storefrontServer, /auth_request|_storefront_promotion_gate/u);
    assert.doesNotMatch(storefrontServer, /@storefront_promotion_entry/u);
    assert.match(storefrontServer, /location \/ \{[\s\S]*?try_files \$uri \$uri\/ \/index\.html;/u);
    const realtimeLocations = [
        ...config.matchAll(/location = \/storefront-realtime\/events \{(?<body>[\s\S]*?)\n    \}/gu),
    ];
    assert.equal(realtimeLocations.length, 1);
    for (const location of realtimeLocations) {
        assert.match(location.groups.body, /proxy_buffering off;/u);
        assert.match(location.groups.body, /proxy_read_timeout 1h;/u);
        assert.match(location.groups.body, /limit_conn vendure_realtime_per_ip 12;/u);
        assert.match(location.groups.body, /proxy_set_header vendure-token "";/u);
        assert.match(
            location.groups.body,
            /access_log \/var\/log\/nginx\/moyao-storefront-realtime\.log vendure_realtime;/u,
        );
        assert.match(location.groups.body, /proxy_ignore_client_abort off;/u);
    }
});

void test('production ingress keeps MOYAO AI and Meiyijia on separate channel-resolved hosts', async () => {
    const config = await readFile(path.join(repositoryRoot, 'deploy/nginx/damatong.conf'), 'utf8');

    assert.match(config, /server_name moyaoai\.com damatong\.net _;/u);
    assert.match(config, /server_name console\.moyaoai\.com;/u);
    assert.match(config, /server_name www\.moyaoai\.com www\.damatong\.net;/u);
    assert.match(config, /www\.damatong\.net damatong\.net;/u);
    assert.match(config, /return 301 https:\/\/console\.moyaoai\.com\$request_uri;/u);
    assert.match(config, /\/etc\/letsencrypt\/live\/moyaoai\.com\/fullchain\.pem/u);
});

void test('promotion route preserves backend CSP without inheriting the storefront policy', async () => {
    const config = await readFile(path.join(repositoryRoot, 'deploy/nginx/damatong.conf'), 'utf8');
    const promoLocation = config.match(/location = \/promo \{(?<body>[\s\S]*?)\n    \}/u)?.groups?.body;

    assert.ok(promoLocation);
    assert.match(promoLocation, /add_header Strict-Transport-Security/u);
    assert.match(promoLocation, /add_header Permissions-Policy/u);
    assert.doesNotMatch(promoLocation, /add_header Content-Security-Policy/u);
});

void test('production console proxies the dashboard health check to Vendure', async () => {
    const config = await readFile(path.join(repositoryRoot, 'deploy/nginx/damatong.conf'), 'utf8');
    const consoleServer = config.slice(config.indexOf('server_name console.moyaoai.com;'));
    const healthLocation = consoleServer.match(/location = \/health \{(?<body>[\s\S]*?)\n    \}/u);

    assert.ok(healthLocation?.groups?.body);
    assert.match(healthLocation.groups.body, /proxy_pass http:\/\/vendure_backend;/u);
    assert.match(healthLocation.groups.body, /include proxy_params;/u);
});

void test('legacy browser fallback files remain exact static routes beside the direct storefront', async () => {
    const config = await readFile(path.join(repositoryRoot, 'deploy/nginx/damatong.conf'), 'utf8');
    const fallbackLocations = ['/legacy-browser-guard.js', '/unsupported-browser.html'].map(route =>
        config.match(
            new RegExp(
                `location = ${route.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} \\{(?<body>[\\s\\S]*?)\\n    \\}`,
                'u',
            ),
        ),
    );

    for (const location of fallbackLocations) {
        assert.ok(location?.groups?.body);
        assert.match(location.groups.body, /try_files \$uri =404;/u);
        assert.doesNotMatch(location.groups.body, /auth_request/u);
    }
    assert.match(fallbackLocations[1].groups.body, /script-src 'none'/u);
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
    assert.match(
        config,
        /IMAGE_PROMPT_SKILL_AUTO_ACTIVATE:\s*process\.env\.IMAGE_PROMPT_SKILL_AUTO_ACTIVATE\s*\?\?\s*'true'/u,
    );
    assert.match(config, /max_memory_restart:\s*'768M'/u);
    assert.match(config, /restart_delay:\s*5000/u);
    assert.match(config, /STORE_DOMAIN_CNAME_TARGET:\s*'stores\.moyaoai\.com'/u);
    assert.match(config, /STORE_DOMAIN_ROUTING_MODE:\s*'require-domain'/u);
    assert.match(config, /STORE_DOMAIN_BYPASS_HOSTS:\s*''/u);
    assert.match(config, /CLOUDFLARE_SAAS_API_TOKEN:\s*process\.env\.CLOUDFLARE_SAAS_API_TOKEN/u);
    assert.doesNotMatch(config, /CLOUDFLARE_SAAS_API_TOKEN:\s*['"][^'"]+['"]/u);
    assert.match(config, /STOREFRONT_PROMOTION_GATE_ENABLED:\s*'false'/u);
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
    assert.match(script, /PRODUCTION_API_READY phase=pre-worker attempts=/u);
    assert.match(
        script,
        /curl --fail --silent --max-time 10 http:\/\/127\.0\.0\.1:3002\/health >\/dev\/null 2>&1/u,
    );
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
    assert.match(runbook, /sync-storefront-media\.mjs --verify/u);
    assert.match(runbook, /sync-moyao-brand\.mjs --dry-run/u);
    assert.match(runbook, /sync-moyao-brand\.mjs --apply --allow-remote/u);
});

void test('production runbook verifies a direct storefront with an optional promotion page', async () => {
    const runbook = await readFile(path.join(repositoryRoot, 'deploy/DEPLOYMENT_RUNBOOK.md'), 'utf8');

    assert.match(runbook, /node deploy\/verify-production-release\.mjs/u);
    assert.match(runbook, /node deploy\/verify-storefront-realtime\.mjs/u);
    assert.match(runbook, /公网探针会模拟旧版客户端携带无效 `vendure-token`/u);
    assert.match(
        runbook,
        /--mode public-smoke \\\n\s+--url [^\n]+ \\\n\s+--ready-timeout-ms 2000 \\\n\s+--heartbeat-timeout-ms 18000 \\\n\s+--release-id/u,
    );
    assert.match(runbook, /--mode origin-full/u);
    assert.match(runbook, /audit_realtime_capacity=true/u);
    assert.doesNotMatch(runbook, /curl[^\n]*storefront-realtime\/events/u);
    assert.match(runbook, /主域名首页和 Shop API 无推广 Cookie 也能直接访问/u);
    assert.doesNotMatch(runbook, /STOREFRONT_ENTRY_REQUIRED/u);
    assert.doesNotMatch(runbook, /curl -I https:\/\/damatong\.net\/assets\//u);
});

void test('OIDC production deployment uses a locked, immutable S3-to-SSM release path', async () => {
    const script = await readFile(path.join(repositoryRoot, 'deploy/deploy-production-from-s3.sh'), 'utf8');
    const workflow = await readFile(
        path.join(repositoryRoot, '.github/workflows/deploy_production_runtime.yml'),
        'utf8',
    );
    const artifactWorkflow = await readFile(
        path.join(repositoryRoot, '.github/workflows/build_production_runtime.yml'),
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
    assert.match(script, /_SYSTEMD_INVOCATION_ID/u);
    assert.match(script, /Created verified MySQL backup:/u);
    assert.match(script, /offsite=yes/u);
    assert.match(script, /DEPLOY_BACKUP_OK/u);
    assert.match(script, /initialize-production-usdt-secrets\.mjs/u);
    assert.match(script, /export STOREFRONT_PROMOTION_GATE_ENABLED=false/u);
    assert.ok(
        script.indexOf('initialize-production-usdt-secrets.mjs') <
            script.lastIndexOf('source "${environment_file}"'),
    );
    assert.ok(script.includes(migrationReadinessCommand));
    assert.match(script, /switch-production-runtime\.sh/u);
    assert.match(script, /127\.0\.0\.1:3002\/image-generation\/health/u);
    assert.match(script, /candidate AI image worker health check did not pass/u);
    assert.match(script, /PRODUCTION_API_READY phase=post-switch attempts=/u);
    assert.match(script, /PRODUCTION_AI_HEALTH_READY attempts=/u);
    assert.match(script, /vendure-production-healthcheck\.timer/u);
    assert.match(script, /systemctl start vendure-production-healthcheck\.service/u);
    assert.match(script, /rollback 1/u);
    assert.match(script, /9>&-/u);
    assert.match(script, /PRODUCTION_DEPLOY_OK/u);
    assert.match(script, /verify-dashboard-assets\.mjs/u);
    assert.match(script, /--dashboard-url https:\/\/console\.moyaoai\.com\/dashboard\//u);
    assert.doesNotMatch(script, /--dashboard-url https:\/\/console\.damatong\.net/u);
    assert.match(script, /--release-id "\$\{target_sha\}"/u);
    assert.match(script, /managed storefront data changed/u);
    assert.match(script, /VENDURE_REVIEWED_STOREFRONT_MEDIA_KEYS/u);
    assert.match(script, /reviewed storefront media keys are invalid/u);
    assert.match(script, /VENDURE_REVIEWED_STOREFRONT_MEDIA_CHANNEL_CODES/u);
    assert.match(script, /reviewed Channel codes are required for managed publishers/u);
    assert.match(script, /reviewed storefront media Channel codes are invalid/u);
    assert.match(script, /VENDURE_REVIEWED_AUTH_VISUALS/u);
    assert.match(script, /managed auth visual publisher changed/u);
    assert.match(script, /VENDURE_REVIEWED_MOYAO_BRAND/u);
    assert.match(script, /MOYAO AI managed brand data changed; select the reviewed brand release scope/u);
    assert.match(script, /reviewed MOYAO AI brand scope was supplied without a brand change/u);
    assert.match(script, /reviewed MOYAO AI brand requires the primary Channel only/u);
    assert.match(script, /VENDURE_REVIEWED_DAMATONG_STOREFRONT/u);
    assert.match(script, /VENDURE_REVIEWED_DAMATONG_CHANNEL_TOKEN/u);
    assert.match(script, /Damatong managed storefront data changed/u);
    assert.match(script, /reviewed Damatong storefront scope was supplied without a Damatong data change/u);
    assert.match(script, /reviewed Damatong storefront requires the my-malaysia Channel token/u);
    assert.match(script, /packages\/storefront\/src\/assets\/brand\/moyao-ai\//u);
    assert.match(script, /packages\/storefront\/src\/assets\/brand\/damatong-market\//u);
    assert.match(script, /packages\/storefront\/src\/assets\/storefront\/damatong\//u);
    assert.match(script, /unsupported managed data change/u);
    assert.equal(
        (
            script.match(
                /^\s*STOREFRONT_MEDIA_CHANNEL_CODES="\$\{reviewed_storefront_media_channel_codes\}"/gmu,
            ) ?? []
        ).length,
        3,
    );
    assert.equal(
        (
            script.match(
                /^\s*AUTH_VISUAL_CHANNEL_CODES="\$\{reviewed_storefront_media_channel_codes\}"/gmu,
            ) ?? []
        ).length,
        3,
    );
    assert.match(script, /sync-storefront-media\.mjs[\s\S]*--keys/u);
    assert.doesNotMatch(script, /sync-storefront-media\.mjs[\s\S]{0,200}--channel-codes/u);
    assert.match(script, /--apply --allow-remote/u);
    assert.match(script, /--verify/u);
    assert.ok(script.indexOf('--dry-run') < script.indexOf('--apply --allow-remote'));
    assert.ok(script.indexOf('--apply --allow-remote') < script.indexOf('--verify'));
    assert.match(script, /PRODUCTION_DEPLOY_ALREADY_CURRENT/u);
    assert.match(script, /STOREFRONT_MEDIA_PREFLIGHT_BEGIN/u);
    assert.match(script, /STOREFRONT_MEDIA_PREFLIGHT_OK/u);
    assert.match(script, /STOREFRONT_MEDIA_VERIFY_OK/u);
    assert.match(script, /AUTH_VISUAL_PREFLIGHT_BEGIN/u);
    assert.match(script, /AUTH_VISUAL_PUBLISH_OK/u);
    assert.match(script, /sync-auth-visuals\.mjs --verify/u);
    assert.match(script, /AUTH_VISUAL_VERIFY_OK/u);
    assert.match(script, /MOYAO_BRAND_PREFLIGHT_BEGIN/u);
    assert.match(script, /MOYAO_BRAND_PREFLIGHT_OK/u);
    assert.match(script, /MOYAO_BRAND_PUBLISH_BEGIN/u);
    assert.match(script, /MOYAO_BRAND_PUBLISH_OK/u);
    assert.match(script, /MOYAO_BRAND_VERIFY_OK/u);
    assert.match(script, /sync-moyao-brand\.mjs --dry-run/u);
    assert.match(script, /sync-moyao-brand\.mjs --apply --allow-remote/u);
    assert.match(script, /sync-moyao-brand\.mjs --verify/u);
    assert.equal((script.match(/^\s*VENDURE_STOREFRONT_URL=https:\/\/moyaoai\.com/gmu) ?? []).length, 9);
    assert.match(script, /DAMATONG_PREFLIGHT_BEGIN/u);
    assert.match(script, /DAMATONG_PREFLIGHT_OK/u);
    assert.match(script, /DAMATONG_PUBLISH_BEGIN/u);
    assert.match(script, /DAMATONG_PUBLISH_OK/u);
    assert.match(script, /DAMATONG_VERIFY_OK/u);
    assert.match(script, /sync-damatong-storefront\.mjs --dry-run/u);
    assert.match(script, /sync-damatong-storefront\.mjs --apply --allow-remote/u);
    assert.match(script, /sync-damatong-storefront\.mjs --verify/u);
    assert.equal((script.match(/^\s*VENDURE_STOREFRONT_URL=https:\/\/damatong\.net/gmu) ?? []).length, 3);
    assert.ok(script.indexOf('STOREFRONT_MEDIA_PREFLIGHT_BEGIN') < script.indexOf('DEPLOY_MIGRATION_BEGIN'));
    assert.ok(
        script.indexOf('STOREFRONT_MEDIA_PREFLIGHT_OK') < script.indexOf('vendure-mysql-backup.service'),
    );
    assert.ok(script.indexOf('MOYAO_BRAND_PREFLIGHT_OK') < script.indexOf('vendure-mysql-backup.service'));
    assert.ok(script.indexOf('DAMATONG_PREFLIGHT_OK') < script.indexOf('vendure-mysql-backup.service'));
    assert.ok(
        script.indexOf('switch-production-runtime.sh" "${candidate}') <
            script.indexOf('STOREFRONT_MEDIA_PUBLISH_BEGIN'),
    );
    assert.ok(
        script.indexOf('switch-production-runtime.sh" "${candidate}') <
            script.indexOf('MOYAO_BRAND_PUBLISH_BEGIN'),
    );
    assert.ok(
        script.indexOf('switch-production-runtime.sh" "${candidate}') <
            script.indexOf('DAMATONG_PUBLISH_BEGIN'),
    );
    assert.match(script, /rollback_needed=0\n\s+printf 'ROLLBACK_BEGIN/u);
    assert.equal(script.match(/ROLLBACK_BEGIN/gu)?.length, 1);
    assert.match(script, /sync-moyao-brand\.mjs/u);
    assert.match(script, /packages\/storefront\/src\/assets\/brand\//u);
    assert.match(script, /MOYAO AI managed brand data changed/u);
    assert.match(script, /readonly memory_guard=.*production-memory-guard\.cjs/u);
    assert.match(script, /ensure-production-swap\.sh/u);
    assert.match(script, /vendure-production-swap/u);
    assert.match(script, /sudo -n "\$\{swap_controller\}"/u);
    assert.match(script, /node "\$\{memory_guard\}" --stage pre-download --check/u);
    assert.match(script, /node "\$\{memory_guard\}" --stage pre-migration --check/u);
    assert.match(script, /node "\$\{memory_guard\}" --stage pre-switch --check/u);
    assert.match(script, /node "\$\{memory_guard\}" --stage post-switch --report/u);
    assert.match(script, /retain_release_file/u);
    assert.match(script, /mv -- "\$\{source_path\}" "\$\{destination_path\}"/u);
    assert.match(script, /vendure-mysql-restore-drill\.service/u);
    assert.match(script, /systemctl enable --now vendure-mysql-restore-drill\.timer/u);
    assert.match(script, /systemctl is-enabled vendure-mysql-restore-drill\.timer/u);
    assert.match(script, /systemctl is-active vendure-mysql-restore-drill\.timer/u);

    assert.match(workflow, /workflow_run:/u);
    assert.match(workflow, /id-token: write/u);
    assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/u);
    assert.match(workflow, /aws-actions\/configure-aws-credentials@[0-9a-f]{40}/u);
    assert.match(workflow, /yunqiao-vendure-github-deploy/u);
    assert.match(workflow, /i-041a146558e432cbf/u);
    assert.match(workflow, /AWS-RunShellScript/u);
    assert.match(workflow, /release-plan\.json/u);
    assert.match(workflow, /archiveSha256/u);
    assert.match(workflow, /VENDURE_REVIEWED_STOREFRONT_MEDIA_KEYS/u);
    assert.match(workflow, /VENDURE_REVIEWED_STOREFRONT_MEDIA_CHANNEL_CODES/u);
    assert.match(workflow, /VENDURE_REVIEWED_AUTH_VISUALS/u);
    assert.match(workflow, /VENDURE_REVIEWED_MOYAO_BRAND/u);
    assert.match(workflow, /MOYAO_BRAND/u);
    assert.match(workflow, /VENDURE_REVIEWED_DAMATONG_STOREFRONT/u);
    assert.match(workflow, /VENDURE_REVIEWED_DAMATONG_CHANNEL_TOKEN/u);
    assert.match(workflow, /DAMATONG_STOREFRONT/u);
    assert.match(workflow, /damatongChannelToken/u);
    assert.match(workflow, /SSM_RESULT="\$RUNNER_TEMP\/ssm-result\.json"/u);
    assert.match(workflow, /grep -E '\^\(PRODUCTION_\|DEPLOY_\|STOREFRONT_MEDIA_/u);
    assert.match(workflow, /tail -n 160/u);
    assert.doesNotMatch(workflow, /AWS_ACCESS_KEY_ID/u);
    assert.doesNotMatch(workflow, /AWS_SECRET_ACCESS_KEY/u);

    assert.match(artifactWorkflow, /media_keys:/u);
    assert.match(artifactWorkflow, /channel_codes:/u);
    assert.match(artifactWorkflow, /auth_visuals:/u);
    assert.match(artifactWorkflow, /moyao_brand:/u);
    assert.match(artifactWorkflow, /damatong_storefront:/u);
    assert.match(artifactWorkflow, /damatong_channel_token:/u);
    assert.match(artifactWorkflow, /release-plan\.json/u);
    assert.match(artifactWorkflow, /release-plan\.json\.sha256/u);
    assert.match(artifactWorkflow, /archiveSha256/u);
    assert.match(artifactWorkflow, /mediaChannelCodes/u);
    assert.match(artifactWorkflow, /authVisuals/u);
    assert.match(artifactWorkflow, /moyaoBrand/u);
    assert.match(artifactWorkflow, /damatongStorefront/u);
    assert.match(artifactWorkflow, /damatongChannelToken/u);
    await assert.rejects(
        readFile(path.join(repositoryRoot, '.github/workflows/deploy_reviewed_storefront_media.yml')),
        { code: 'ENOENT' },
    );
});

void test('MySQL restore drill is isolated, hardened, and scheduled weekly', async () => {
    const restoreScript = await readFile(
        path.join(repositoryRoot, 'deploy/systemd/vendure-mysql-restore-drill'),
        'utf8',
    );
    const service = await readFile(
        path.join(repositoryRoot, 'deploy/systemd/vendure-mysql-restore-drill.service'),
        'utf8',
    );
    const timer = await readFile(
        path.join(repositoryRoot, 'deploy/systemd/vendure-mysql-restore-drill.timer'),
        'utf8',
    );

    assert.match(restoreScript, /vendure_restore_drill_/u);
    assert.match(restoreScript, /trap cleanup_restore_database EXIT/u);
    assert.match(restoreScript, /sha256sum --check/u);
    assert.match(restoreScript, /gzip -t/u);
    assert.match(restoreScript, /backup_tables=.*CREATE TABLE/u);
    assert.match(restoreScript, /backupTables/u);
    assert.match(restoreScript, /backup_tables.*restored_tables/u);
    assert.match(restoreScript, /restore-drill\.json/u);
    assert.match(service, /^User=root$/mu);
    assert.match(service, /^NoNewPrivileges=true$/mu);
    assert.match(service, /^ProtectSystem=strict$/mu);
    assert.match(service, /^StateDirectory=vendure-readiness$/mu);
    assert.match(service, /^StateDirectoryMode=0700$/mu);
    assert.match(service, /^ReadOnlyPaths=\/var\/backups\/vendure-mysql$/mu);
    assert.match(service, /^ReadWritePaths=\/var\/lib\/vendure-readiness$/mu);
    assert.match(timer, /^OnCalendar=Sun \*-\*-\* 20:15:00 UTC$/mu);
    assert.match(timer, /^RandomizedDelaySec=30m$/mu);
    assert.match(timer, /^Persistent=true$/mu);
});

void test('production swap setup is fixed-size, persistent, and low-swappiness', async () => {
    const script = await readFile(path.join(repositoryRoot, 'deploy/ensure-production-swap.sh'), 'utf8');

    assert.match(script, /swap_file="\$\{swap_directory\}\/production\.swap"/u);
    assert.match(script, /swap_size_mib=2048/u);
    assert.match(script, /minimum_active_swap_mib=2047/u);
    assert.match(script, /active_swap_bytes\) >= minimum_active_swap_bytes/u);
    assert.doesNotMatch(script, /active_swap_bytes\) >= swap_size_bytes/u);
    assert.match(script, /disk_reserve_bytes/u);
    assert.match(script, /mkswap/u);
    assert.match(script, /swapon/u);
    assert.match(script, /\/etc\/fstab/u);
    assert.match(script, /vm\.swappiness = 10/u);
    assert.match(script, /PRODUCTION_SWAP_OK/u);
    assert.doesNotMatch(script, /swapoff/u);
});

void test('scheduled production monitor checks memory, processes, and health through OIDC SSM', async () => {
    const script = await readFile(path.join(repositoryRoot, 'deploy/monitor-production-health.sh'), 'utf8');
    const systemdHealthcheck = await readFile(
        path.join(repositoryRoot, 'deploy/systemd/vendure-production-healthcheck'),
        'utf8',
    );
    const workflow = await readFile(
        path.join(repositoryRoot, '.github/workflows/monitor_production_health.yml'),
        'utf8',
    );

    assert.match(script, /production-memory-guard\.cjs/u);
    assert.match(script, /--stage scheduled-monitor --check/u);
    assert.match(script, /127\.0\.0\.1:3002\/health/u);
    assert.match(script, /127\.0\.0\.1:3002\/image-generation\/health/u);
    assert.match(script, /AI_IMAGE_/u);
    assert.match(script, /AI_IMAGE_METRICS/u);
    assert.match(script, /attempts24h/u);
    assert.match(script, /failureBuckets/u);
    assert.match(script, /healthyKeyCount/u);
    assert.match(script, /failureCode = 'IMAGE_RESOLUTION_MISMATCH'/u);
    assert.match(script, /actualCostMicrounits IS NULL/u);
    assert.match(script, /AI_IMAGE_RESOLUTION_MISMATCH model=/u);
    assert.match(script, /AI_IMAGE_MISSING_COST model=/u);
    assert.match(script, /REGEXP_SUBSTR\(errorMessage/u);
    assert.doesNotMatch(script, /printf[^\n]*errorMessage/u);
    assert.match(script, /https:\/\/damatong\.net\/health/u);
    assert.match(script, /verify-storefront-realtime\.mjs/u);
    assert.match(
        script,
        /--mode public-smoke \\\n\s+--url [^\n]+ \\\n\s+--ready-timeout-ms 2000 \\\n\s+--heartbeat-timeout-ms 18000 \\\n\s+--release-id "\$\{target_sha\}"/u,
    );
    assert.match(script, /AUDIT_STOREFRONT_REALTIME_CAPACITY/u);
    assert.match(script, /--mode origin-full/u);
    assert.match(script, /--connection-limit 12/u);
    assert.match(script, /--safe-concurrency 8/u);
    assert.match(script, /--release-timeout-ms 5000/u);
    assert.match(script, /verify-dashboard-assets\.mjs/u);
    assert.match(script, /--dashboard-url https:\/\/console\.moyaoai\.com\/dashboard\//u);
    assert.doesNotMatch(script, /--dashboard-url https:\/\/console\.damatong\.net/u);
    assert.match(script, /require_recent_systemd_success/u);
    assert.match(script, /vendure-production-healthcheck\.timer/u);
    assert.match(script, /vendure-production-healthcheck\.service/u);
    assert.match(script, /vendure-mysql-restore-drill\.timer/u);
    assert.match(script, /vendure-mysql-restore-drill\.service/u);
    assert.match(script, /ExecMainExitTimestamp/u);
    assert.match(script, /ActiveState/u);
    assert.match(script, /systemd_completion_wait_attempts=46/u);
    assert.match(script, /systemd_completion_wait_interval_seconds=2/u);
    assert.match(script, /sleep "\$\{systemd_completion_wait_interval_seconds\}"/u);
    assert.match(script, /restore_drill_maximum_age_seconds=777600/u);
    assert.match(script, /pm2 jlist/u);
    assert.match(script, /vendure-api/u);
    assert.match(script, /vendure-worker/u);
    assert.match(script, /PRODUCTION_HEALTH_MONITOR_OK/u);
    assert.match(systemdHealthcheck, /127\.0\.0\.1:3002\/image-generation\/health/u);
    assert.match(systemdHealthcheck, /image-generation-health-failed/u);
    assert.match(systemdHealthcheck, /restore-drill\.json/u);
    assert.match(systemdHealthcheck, /maximum_restore_drill_age_seconds/u);
    assert.match(systemdHealthcheck, /restore-drill-missing-or-stale/u);

    assert.match(workflow, /schedule:/u);
    assert.match(workflow, /workflow_dispatch:/u);
    assert.match(workflow, /audit_realtime_capacity:/u);
    assert.match(workflow, /AUDIT_STOREFRONT_REALTIME_CAPACITY=\$\{REALTIME_CAPACITY_AUDIT\}/u);
    assert.match(workflow, /id-token: write/u);
    assert.match(workflow, /aws-actions\/configure-aws-credentials@[0-9a-f]{40}/u);
    assert.match(workflow, /AWS-RunShellScript/u);
    assert.match(workflow, /monitor-production-health\.sh/u);
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
