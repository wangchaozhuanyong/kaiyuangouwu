#!/usr/bin/env bash

set -Eeuo pipefail

readonly target_sha="${1:-}"
readonly artifact_name="${2:-}"
readonly artifact_s3_prefix="${3:-}"
readonly repository="/var/www/kaiyuangouwu"
readonly releases_dir="/var/www/kaiyuangouwu-releases"
readonly current_pointer="/var/www/kaiyuangouwu-current"
readonly current_marker="${releases_dir}/current-sha"
readonly deploy_lock="/run/lock/vendure-production-deploy.lock"
readonly expected_bucket="yunqiao-vendure-prod-backup-079740175286-apne1"
readonly expected_s3_prefix="s3://${expected_bucket}/deployments/${target_sha}"
readonly nginx_target="/etc/nginx/sites-available/damatong-production"
readonly environment_file="${repository}/packages/dev-server/.env"
readonly deployment_id="${target_sha}-github-${GITHUB_RUN_ID:-manual}-$(date -u +%Y%m%dT%H%M%SZ)"

fail() {
    printf 'Production deployment failed: %s\n' "$1" >&2
    if [[ "${rollback_needed:-0}" == "1" ]] && declare -F rollback >/dev/null; then
        rollback 1
    fi
    exit 1
}

if [[ ! "${target_sha}" =~ ^[0-9a-f]{40}$ ]]; then
    fail 'target SHA must be a full lowercase Git SHA'
fi
if [[ ! "${artifact_name}" =~ ^${target_sha}-[0-9]+-[0-9]+-linux-x64$ ]]; then
    fail 'artifact name does not match the target SHA and release naming contract'
fi
if [[ "${artifact_s3_prefix}" != "${expected_s3_prefix}" ]]; then
    fail 'artifact S3 prefix is outside the approved production deployment prefix'
fi

umask 027

if [[ "${VENDURE_DEPLOY_LOCK_HELD:-0}" == "1" ]]; then
    [[ "$(readlink "/proc/$$/fd/9" 2>/dev/null || true)" == "${deploy_lock}" ]] ||
        fail 'the inherited production deployment lock is missing'
else
    exec 9>"${deploy_lock}"
    flock --exclusive --wait 300 9 || fail 'timed out waiting for the production deployment lock'
fi

cd "${repository}"
git fetch origin main --no-tags --prune

readonly deployed_sha="$(cat "${current_marker}")"
readonly current_source_sha="$(git rev-parse HEAD^{commit})"
readonly remote_sha="$(git rev-parse refs/remotes/origin/main^{commit})"

[[ "${remote_sha}" == "${target_sha}" ]] || fail 'origin/main no longer matches the requested target SHA'
git merge-base --is-ancestor "${current_source_sha}" "${target_sha}" ||
    fail 'the server source cannot fast-forward to the requested target SHA'
git merge-base --is-ancestor "${deployed_sha}" "${target_sha}" ||
    fail 'the deployed runtime is not an ancestor of the requested target SHA'
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail 'the server repository has tracked changes'

if git diff --name-only "${deployed_sha}" "${target_sha}" -- \
    packages/dev-server/scripts/sync-storefront-media.mjs \
    packages/dev-server/scripts/sync-auth-visuals.mjs \
    packages/dev-server/scripts/repair-inventory-inheritance.mjs \
    packages/storefront/src/assets/storefront/ | grep -q .; then
    fail 'managed storefront data changed; use the reviewed manual publisher release path'
fi

git merge --ff-only refs/remotes/origin/main
[[ "$(git rev-parse HEAD^{commit})" == "${target_sha}" ]] || fail 'server source SHA mismatch after fast-forward'

# The root-owned bootstrap re-enters the script committed at the target SHA so
# deployment logic updates safely without requiring another AWS console login.
if [[ "${VENDURE_DEPLOY_REEXECUTED:-0}" != "1" ]]; then
    VENDURE_DEPLOY_LOCK_HELD=1 \
        VENDURE_DEPLOY_REEXECUTED=1 \
        GITHUB_RUN_ID="${GITHUB_RUN_ID:-manual}" \
        "${repository}/deploy/deploy-production-from-s3.sh" \
        "${target_sha}" "${artifact_name}" "${artifact_s3_prefix}"
    exit $?
fi

readonly archive_name="${artifact_name}.tar.gz"
readonly checksum_name="${archive_name}.sha256"
readonly candidate="${releases_dir}/${artifact_name}"
readonly previous_runtime="$(readlink -f "${current_pointer}")"
readonly staging_dir="$(mktemp -d "${releases_dir}/.incoming-${artifact_name}.XXXXXX")"
readonly archive_path="${staging_dir}/${archive_name}"
readonly checksum_path="${staging_dir}/${checksum_name}"
readonly nginx_backup="${nginx_target}.pre-${deployment_id}"
readonly memory_guard="${repository}/deploy/production-memory-guard.cjs"
readonly swap_controller_source="${repository}/deploy/ensure-production-swap.sh"
readonly swap_controller="/usr/local/sbin/vendure-production-swap"

rollback_needed=0
nginx_changed=0
pointer_changed=0

cleanup() {
    if [[ "${staging_dir}" == "${releases_dir}/.incoming-${artifact_name}."* ]]; then
        rm -rf -- "${staging_dir}"
    fi
}

rollback() {
    local status="${1:-$?}"
    trap - ERR

    if [[ "${rollback_needed}" == "1" ]]; then
        printf 'ROLLBACK_BEGIN\n'
        VENDURE_DEPLOYMENT_ID="${deployment_id}-rollback" \
            "${repository}/deploy/switch-production-runtime.sh" "${previous_runtime}" 9>&- || true
        pm2 save 9>&- || true

        if [[ "${pointer_changed}" == "1" ]]; then
            sudo -n ln -s "${previous_runtime}" "/var/www/.kaiyuangouwu-current.rollback.$$" || true
            sudo -n mv -Tf "/var/www/.kaiyuangouwu-current.rollback.$$" "${current_pointer}" || true
        fi
        if [[ "${nginx_changed}" == "1" && -f "${nginx_backup}" ]]; then
            sudo -n install -o root -g root -m 0644 "${nginx_backup}" "${nginx_target}" || true
            sudo -n nginx -t && sudo -n systemctl reload nginx || true
        fi
        printf 'ROLLBACK_DONE\n'
    fi

    cleanup
    exit "${status}"
}

trap cleanup EXIT
trap rollback ERR

sudo -n install -o root -g root -m 0755 "${swap_controller_source}" "${swap_controller}"
sudo -n "${swap_controller}"
node "${memory_guard}" --stage pre-download --check
printf 'DEPLOY_DOWNLOAD_BEGIN\n'
aws s3 cp "${artifact_s3_prefix}/${archive_name}" "${archive_path}" --only-show-errors
aws s3 cp "${artifact_s3_prefix}/${checksum_name}" "${checksum_path}" --only-show-errors
(
    cd "${staging_dir}"
    sha256sum --check "${checksum_name}"
)

tar --list --gzip --file "${archive_path}" | awk -v root="${artifact_name}" '
    $0 != root && index($0, root "/") != 1 { bad = 1 }
    END { exit bad }
' || fail 'runtime archive contains a path outside its release directory'

if [[ ! -e "${candidate}" ]]; then
    tar --extract --gzip --same-permissions --no-same-owner \
        --directory "${staging_dir}" --file "${archive_path}"
    [[ -d "${staging_dir}/${artifact_name}" ]] || fail 'runtime archive did not contain its expected directory'
    mv "${staging_dir}/${artifact_name}" "${candidate}"
fi

[[ "$(stat --format='%a' "${candidate}")" == "755" ]] || fail 'runtime directory mode is not 755'
node "${candidate}/verify-runtime.mjs" --expected-sha "${target_sha}"

retain_release_file() {
    local source_path="${1}"
    local destination_path="${2}"

    if [[ -e "${destination_path}" ]]; then
        cmp --silent "${source_path}" "${destination_path}" ||
            fail "retained release file differs from the verified download: ${destination_path}"
        rm -- "${source_path}"
    else
        mv -- "${source_path}" "${destination_path}"
    fi
    chmod 0644 "${destination_path}"
}

# The staging directory is below releases_dir, so these are same-filesystem renames.
# Avoiding a second full archive copy prevents avoidable disk I/O and page-cache pressure.
retain_release_file "${archive_path}" "${releases_dir}/${archive_name}"
retain_release_file "${checksum_path}" "${releases_dir}/${checksum_name}"

node "${memory_guard}" --stage pre-migration --check
printf 'DEPLOY_MIGRATION_BEGIN\n'
sudo -n systemctl start vendure-mysql-backup.service
[[ "$(sudo -n systemctl show vendure-mysql-backup.service -p Result --value)" == "success" ]] ||
    fail 'the pre-migration database backup failed'

set -a
# shellcheck disable=SC1090
sudo -n "$(command -v node)" \
    "${repository}/deploy/initialize-production-usdt-secrets.mjs" "${environment_file}"
source "${environment_file}"
set +a

NODE_ENV=production READINESS_PROCESS_ROLE=migration RUN_MIGRATIONS=true RUN_JOB_QUEUE=0 \
    node "${repository}/packages/dev-server/scripts/production-env-readiness.mjs"
(
    cd "${candidate}"
    NODE_ENV=production RUN_MIGRATIONS=true RUN_JOB_QUEUE=0 \
        node packages/dev-server/dist/run-migrations.js
)
NODE_ENV=production READINESS_PROCESS_ROLE=server RUN_MIGRATIONS=false RUN_JOB_QUEUE=0 \
    node "${repository}/packages/dev-server/scripts/production-env-readiness.mjs"
NODE_ENV=production READINESS_PROCESS_ROLE=worker RUN_MIGRATIONS=false RUN_JOB_QUEUE=0 \
    node "${repository}/packages/dev-server/scripts/production-env-readiness.mjs"

node "${memory_guard}" --stage pre-switch --check
rollback_needed=1
VENDURE_DEPLOYMENT_ID="${deployment_id}" \
    "${repository}/deploy/switch-production-runtime.sh" "${candidate}" 9>&-

for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3002/health >/dev/null; then
        break
    fi
    [[ "${attempt}" != "30" ]] || fail 'candidate API health check did not pass'
    sleep 2
done
for attempt in $(seq 1 45); do
    if curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3002/image-generation/health >/dev/null; then
        break
    fi
    [[ "${attempt}" != "45" ]] || fail 'candidate AI image worker health check did not pass'
    sleep 2
done
node "${repository}/deploy/verify-dashboard-assets.mjs" \
    --dashboard-url http://127.0.0.1:3002/dashboard/ \
    --release-id "${target_sha}"
node "${memory_guard}" --stage post-switch --report
pm2 save 9>&-

sudo -n cp -p "${nginx_target}" "${nginx_backup}"
sudo -n install -o root -g root -m 0644 "${repository}/deploy/nginx/damatong.conf" "${nginx_target}"
nginx_changed=1
sudo -n nginx -t
sudo -n systemctl reload nginx

sudo -n ln -s "${candidate}" "/var/www/.kaiyuangouwu-current.new.$$"
sudo -n mv -Tf "/var/www/.kaiyuangouwu-current.new.$$" "${current_pointer}"
pointer_changed=1

curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3002/health >/dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3002/image-generation/health >/dev/null
curl --fail --silent --show-error --max-time 15 https://damatong.net/health >/dev/null
node "${repository}/deploy/verify-dashboard-assets.mjs" \
    --dashboard-url https://console.damatong.net/dashboard/ \
    --release-id "${target_sha}"

sudo -n install -o root -g root -m 0755 \
    "${repository}/deploy/systemd/vendure-production-release-retention.cjs" \
    /usr/local/sbin/vendure-production-release-retention
sudo -n install -o root -g root -m 0755 \
    "${repository}/deploy/systemd/vendure-production-healthcheck" \
    /usr/local/sbin/vendure-production-healthcheck
sudo -n install -o root -g root -m 0644 \
    "${repository}/deploy/systemd/vendure-production-healthcheck.service" \
    /etc/systemd/system/vendure-production-healthcheck.service
sudo -n install -o root -g root -m 0644 \
    "${repository}/deploy/systemd/vendure-production-healthcheck.timer" \
    /etc/systemd/system/vendure-production-healthcheck.timer
sudo -n install -o root -g root -m 0755 \
    "${repository}/deploy/systemd/vendure-mysql-restore-drill" \
    /usr/local/sbin/vendure-mysql-restore-drill
sudo -n install -o root -g root -m 0644 \
    "${repository}/deploy/systemd/vendure-mysql-restore-drill.service" \
    /etc/systemd/system/vendure-mysql-restore-drill.service
sudo -n install -o root -g root -m 0644 \
    "${repository}/deploy/systemd/vendure-mysql-restore-drill.timer" \
    /etc/systemd/system/vendure-mysql-restore-drill.timer
sudo -n install -o root -g root -m 0644 \
    "${repository}/deploy/systemd/vendure-production-release-retention.service" \
    /etc/systemd/system/vendure-production-release-retention.service
sudo -n install -o root -g root -m 0644 \
    "${repository}/deploy/systemd/vendure-production-release-retention.path" \
    /etc/systemd/system/vendure-production-release-retention.path
sudo -n install -o root -g root -m 0755 \
    "${repository}/deploy/deploy-production-from-s3.sh" \
    /usr/local/sbin/vendure-production-deploy-from-s3
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now vendure-production-release-retention.path
sudo -n systemctl enable --now vendure-mysql-restore-drill.timer
sudo -n systemctl enable --now vendure-production-healthcheck.timer
sudo -n systemctl start vendure-production-healthcheck.service
if [[ ! -s /var/lib/vendure-readiness/restore-drill.json || \
    "$(sudo -n systemctl show vendure-mysql-restore-drill.service -p Result --value)" != "success" ]]; then
    sudo -n systemctl start vendure-mysql-restore-drill.service
fi
[[ "$(sudo -n systemctl is-enabled vendure-mysql-restore-drill.timer)" == "enabled" ]]
[[ "$(sudo -n systemctl is-active vendure-mysql-restore-drill.timer)" == "active" ]]
[[ "$(sudo -n systemctl show vendure-mysql-restore-drill.service -p Result --value)" == "success" ]]
[[ "$(sudo -n systemctl is-enabled vendure-production-healthcheck.timer)" == "enabled" ]]
[[ "$(sudo -n systemctl is-active vendure-production-healthcheck.timer)" == "active" ]]
[[ "$(sudo -n systemctl show vendure-production-healthcheck.service -p Result --value)" == "success" ]]

printf '%s\n' "${target_sha}" > "${releases_dir}/.current-sha.new"
mv "${releases_dir}/.current-sha.new" "${current_marker}"

[[ "$(readlink -f "${current_pointer}")" == "${candidate}" ]]
[[ "$(cat "${current_marker}")" == "${target_sha}" ]]
pm2 jlist | CANDIDATE="${candidate}" node -e "
let input = '';
process.stdin.on('data', chunk => (input += chunk)).on('end', () => {
    const expectedCandidate = process.env.CANDIDATE;
    const processes = JSON.parse(input);
    for (const name of ['vendure-api', 'vendure-worker']) {
        const managed = processes.find(item => item.name === name);
        if (!managed || managed.pm2_env.status !== 'online' || managed.pm2_env.pm_cwd !== expectedCandidate) {
            process.exit(1);
        }
    }
});
"
sudo -n journalctl -t vendure-production-switch --since '30 minutes ago' --no-pager -o cat |
    grep -F "deployment_id=${deployment_id}" | grep -F 'event=succeeded'

rollback_needed=0
trap - ERR
printf 'deployment_id=%s\n' "${deployment_id}"
printf 'previous_runtime=%s\n' "${previous_runtime}"
printf 'target_runtime=%s\n' "${candidate}"
printf 'PRODUCTION_DEPLOY_OK\n'
