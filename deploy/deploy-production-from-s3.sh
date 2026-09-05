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
readonly reviewed_storefront_media_keys="${VENDURE_REVIEWED_STOREFRONT_MEDIA_KEYS:-}"
readonly reviewed_storefront_media_channel_codes="${VENDURE_REVIEWED_STOREFRONT_MEDIA_CHANNEL_CODES:-}"
readonly reviewed_auth_visuals="${VENDURE_REVIEWED_AUTH_VISUALS:-false}"
readonly reviewed_moyao_brand="${VENDURE_REVIEWED_MOYAO_BRAND:-false}"
readonly reviewed_homepage_carousel="${VENDURE_REVIEWED_HOMEPAGE_CAROUSEL:-false}"
readonly homepage_carousel_media_keys="home-hero-token-topup-v1,home-hero-codex-tiers-v1,home-hero-account-services-v1"

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
if [[ -n "${reviewed_storefront_media_keys}" && \
    ! "${reviewed_storefront_media_keys}" =~ ^[a-z0-9][a-z0-9-]*(,[a-z0-9][a-z0-9-]*)*$ ]]; then
    fail 'reviewed storefront media keys are invalid'
fi
if [[ -n "${reviewed_storefront_media_channel_codes}" && \
    ! "${reviewed_storefront_media_channel_codes}" =~ ^[a-z0-9_][a-z0-9_-]*(,[a-z0-9_][a-z0-9_-]*)*$ ]]; then
    fail 'reviewed storefront media Channel codes are invalid'
fi
if [[ "${reviewed_auth_visuals}" != "true" && "${reviewed_auth_visuals}" != "false" ]]; then
    fail 'reviewed auth visual flag must be true or false'
fi
if [[ "${reviewed_moyao_brand}" != "true" && "${reviewed_moyao_brand}" != "false" ]]; then
    fail 'reviewed MOYAO AI brand flag must be true or false'
fi
if [[ "${reviewed_homepage_carousel}" != "true" && "${reviewed_homepage_carousel}" != "false" ]]; then
    fail 'reviewed homepage carousel flag must be true or false'
fi
if [[ "${reviewed_homepage_carousel}" == "true" ]]; then
    [[ "${reviewed_storefront_media_channel_codes}" == "__default_channel__" ]] ||
        fail 'reviewed homepage carousel requires the primary Channel only'
    [[ "${reviewed_storefront_media_keys}" == "${homepage_carousel_media_keys}" ]] ||
        fail 'reviewed homepage carousel requires its exact three media keys'
fi
if [[ ( -n "${reviewed_storefront_media_keys}" || "${reviewed_auth_visuals}" == "true" || \
    "${reviewed_moyao_brand}" == "true" ) && \
    -z "${reviewed_storefront_media_channel_codes}" ]]; then
    fail 'reviewed Channel codes are required for managed publishers'
fi
if [[ -z "${reviewed_storefront_media_keys}" && "${reviewed_auth_visuals}" == "false" && \
    "${reviewed_moyao_brand}" == "false" && \
    -n "${reviewed_storefront_media_channel_codes}" ]]; then
    fail 'reviewed Channel scope was supplied without a managed publisher'
fi
if [[ "${reviewed_moyao_brand}" == "true" && \
    "${reviewed_storefront_media_channel_codes}" != "__default_channel__" ]]; then
    fail 'reviewed MOYAO AI brand requires the primary Channel only'
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

auth_visual_change=false
if ! git diff --quiet "${deployed_sha}" "${target_sha}" -- \
    packages/dev-server/scripts/sync-auth-visuals.mjs; then
    auth_visual_change=true
fi
if [[ "${auth_visual_change}" == "true" && "${reviewed_auth_visuals}" != "true" ]]; then
    fail 'managed auth visual publisher changed; select the reviewed auth visual release scope'
fi
if [[ "${auth_visual_change}" == "false" && "${reviewed_auth_visuals}" == "true" ]]; then
    fail 'reviewed auth visual scope was supplied without an auth visual publisher change'
fi

if [[ "${deployed_sha}" == "${target_sha}" ]]; then
    printf 'PRODUCTION_DEPLOY_ALREADY_CURRENT sha=%s\n' "${target_sha}"
    exit 0
fi

brand_change=false
if git diff --name-only "${deployed_sha}" "${target_sha}" -- \
    packages/dev-server/scripts/sync-moyao-brand.mjs \
    packages/storefront/src/assets/brand/ | grep -q .; then
    brand_change=true
fi
if [[ "${brand_change}" == "true" && "${reviewed_moyao_brand}" != "true" ]]; then
    fail 'MOYAO AI managed brand data changed; select the reviewed brand release scope'
fi
if [[ "${brand_change}" == "false" && "${reviewed_moyao_brand}" == "true" ]]; then
    fail 'reviewed MOYAO AI brand scope was supplied without a brand change'
fi

homepage_carousel_change=false
if ! git diff --quiet "${deployed_sha}" "${target_sha}" -- \
    packages/dev-server/scripts/sync-homepage-carousel.mjs \
    packages/storefront/src/assets/storefront/carousel/; then
    homepage_carousel_change=true
fi
if [[ "${homepage_carousel_change}" == "true" && "${reviewed_homepage_carousel}" != "true" ]]; then
    fail 'managed homepage carousel changed; select the reviewed homepage carousel release scope'
fi
if [[ "${homepage_carousel_change}" == "false" && "${reviewed_homepage_carousel}" == "true" ]]; then
    fail 'reviewed homepage carousel scope was supplied without a carousel change'
fi

mapfile -t managed_storefront_changes < <(
    git diff --name-only "${deployed_sha}" "${target_sha}" -- \
        packages/dev-server/scripts/sync-storefront-media.mjs \
        packages/dev-server/scripts/repair-inventory-inheritance.mjs \
        packages/storefront/src/assets/storefront/
)
if [[ "${#managed_storefront_changes[@]}" -gt 0 ]]; then
    [[ -n "${reviewed_storefront_media_keys}" ]] ||
        fail 'managed storefront data changed; provide reviewed media keys in the production release plan'
    for managed_storefront_change in "${managed_storefront_changes[@]}"; do
        case "${managed_storefront_change}" in
            packages/dev-server/scripts/sync-storefront-media.mjs | \
                packages/storefront/src/assets/storefront/*)
                ;;
            *)
                fail 'reviewed storefront media release contains an unsupported managed data change'
                ;;
        esac
    done
elif [[ -n "${reviewed_storefront_media_keys}" && "${homepage_carousel_change}" == "false" ]]; then
    fail 'reviewed storefront media scope was supplied without a managed storefront data change'
fi

git merge --ff-only refs/remotes/origin/main
[[ "$(git rev-parse HEAD^{commit})" == "${target_sha}" ]] || fail 'server source SHA mismatch after fast-forward'

# The root-owned bootstrap re-enters the script committed at the target SHA so
# deployment logic updates safely without requiring another AWS console login.
if [[ "${VENDURE_DEPLOY_REEXECUTED:-0}" != "1" ]]; then
    VENDURE_DEPLOY_LOCK_HELD=1 \
        VENDURE_DEPLOY_REEXECUTED=1 \
        GITHUB_RUN_ID="${GITHUB_RUN_ID:-manual}" \
        VENDURE_REVIEWED_STOREFRONT_MEDIA_KEYS="${reviewed_storefront_media_keys}" \
        VENDURE_REVIEWED_STOREFRONT_MEDIA_CHANNEL_CODES="${reviewed_storefront_media_channel_codes}" \
        VENDURE_REVIEWED_AUTH_VISUALS="${reviewed_auth_visuals}" \
        VENDURE_REVIEWED_MOYAO_BRAND="${reviewed_moyao_brand}" \
        VENDURE_REVIEWED_HOMEPAGE_CAROUSEL="${reviewed_homepage_carousel}" \
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
        rollback_needed=0
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

if [[ -n "${reviewed_storefront_media_keys}" || "${reviewed_auth_visuals}" == "true" || \
    "${reviewed_moyao_brand}" == "true" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${environment_file}"
    set +a
fi
if [[ -n "${reviewed_storefront_media_keys}" ]]; then
    printf 'STOREFRONT_MEDIA_PREFLIGHT_BEGIN keys=%s channels=%s\n' \
        "${reviewed_storefront_media_keys}" "${reviewed_storefront_media_channel_codes}"
    cd "${candidate}"
    STOREFRONT_MEDIA_CHANNEL_CODES="${reviewed_storefront_media_channel_codes}" \
        VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-storefront-media.mjs \
            --keys "${reviewed_storefront_media_keys}" --dry-run
    cd "${repository}"
    printf 'STOREFRONT_MEDIA_PREFLIGHT_OK keys=%s channels=%s\n' \
        "${reviewed_storefront_media_keys}" "${reviewed_storefront_media_channel_codes}"
fi
if [[ "${reviewed_auth_visuals}" == "true" ]]; then
    printf 'AUTH_VISUAL_PREFLIGHT_BEGIN channels=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
    cd "${candidate}"
    AUTH_VISUAL_CHANNEL_CODES="${reviewed_storefront_media_channel_codes}" \
        VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-auth-visuals.mjs --dry-run
    cd "${repository}"
    printf 'AUTH_VISUAL_PREFLIGHT_OK channels=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
fi
if [[ "${reviewed_moyao_brand}" == "true" ]]; then
    printf 'MOYAO_BRAND_PREFLIGHT_BEGIN channel=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
    cd "${candidate}"
    VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-moyao-brand.mjs --dry-run \
            --channel-code "${reviewed_storefront_media_channel_codes}"
    cd "${repository}"
    printf 'MOYAO_BRAND_PREFLIGHT_OK channel=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
fi

if [[ "${reviewed_homepage_carousel}" == "true" ]]; then
    printf 'HOMEPAGE_CAROUSEL_PREFLIGHT_BEGIN channel=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
    cd "${candidate}"
    HOMEPAGE_CAROUSEL_CHANNEL_CODES="${reviewed_storefront_media_channel_codes}" \
        VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-homepage-carousel.mjs --dry-run
    cd "${repository}"
    printf 'HOMEPAGE_CAROUSEL_PREFLIGHT_OK channel=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
fi

node "${memory_guard}" --stage pre-migration --check
printf 'DEPLOY_MIGRATION_BEGIN\n'
sudo -n systemctl start vendure-mysql-backup.service
readonly backup_service="vendure-mysql-backup.service"
readonly backup_result="$(sudo -n systemctl show "${backup_service}" -p Result --value)"
[[ "${backup_result}" == "success" ]] ||
    fail 'the pre-migration database backup failed'
readonly backup_invocation_id="$(
    sudo -n systemctl show "${backup_service}" -p InvocationID --value
)"
[[ "${backup_invocation_id}" =~ ^[0-9a-f]{32}$ ]] ||
    fail 'the pre-migration database backup invocation is invalid'
readonly backup_evidence="$(
    sudo -n journalctl --quiet --no-pager --output=cat \
        "_SYSTEMD_INVOCATION_ID=${backup_invocation_id}" |
        grep -E '^Created verified MySQL backup: /var/backups/vendure-mysql/vendure-[0-9]{8}T[0-9]{6}Z\.sql\.gz offsite=yes$' |
        tail -n 1 || true
)"
if [[ "${backup_evidence}" =~ ^Created\ verified\ MySQL\ backup:\ (/var/backups/vendure-mysql/vendure-[0-9]{8}T[0-9]{6}Z\.sql\.gz)\ offsite=yes$ ]]; then
    backup_file="${BASH_REMATCH[1]}"
else
    fail 'the pre-migration database backup evidence is missing or offsite upload was not verified'
fi
readonly backup_file
sudo -n test -s "${backup_file}" || fail 'the verified database backup file is missing'
sudo -n test -s "${backup_file}.sha256" || fail 'the verified database backup checksum is missing'
printf 'DEPLOY_BACKUP_OK file=%s offsite=yes invocation_id=%s\n' \
    "${backup_file}" "${backup_invocation_id}"

set -a
# shellcheck disable=SC1090
sudo -n "$(command -v node)" \
    "${repository}/deploy/initialize-production-usdt-secrets.mjs" "${environment_file}"
source "${environment_file}"
set +a
# The main domain is a direct storefront. Keep legacy encrypted env files from
# re-enabling the retired promotion-cookie gate during readiness or migrations.
export STOREFRONT_PROMOTION_GATE_ENABLED=false

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

api_ready_attempt=0
for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 10 http://127.0.0.1:3002/health >/dev/null 2>&1; then
        api_ready_attempt="${attempt}"
        break
    fi
    if [[ "${attempt}" == "30" ]]; then
        curl --fail --silent --show-error --max-time 10 \
            http://127.0.0.1:3002/health >/dev/null || true
        fail 'candidate API health check did not pass'
    fi
    sleep 2
done
printf 'PRODUCTION_API_READY phase=post-switch attempts=%s\n' "${api_ready_attempt}"
ai_health_ready_attempt=0
for attempt in $(seq 1 45); do
    if curl --fail --silent --max-time 10 \
        http://127.0.0.1:3002/image-generation/health >/dev/null 2>&1; then
        ai_health_ready_attempt="${attempt}"
        break
    fi
    if [[ "${attempt}" == "45" ]]; then
        curl --fail --silent --show-error --max-time 10 \
            http://127.0.0.1:3002/image-generation/health >/dev/null || true
        fail 'candidate AI image worker health check did not pass'
    fi
    sleep 2
done
printf 'PRODUCTION_AI_HEALTH_READY attempts=%s\n' "${ai_health_ready_attempt}"
node "${repository}/deploy/verify-dashboard-assets.mjs" \
    --dashboard-url http://127.0.0.1:3002/dashboard/ \
    --release-id "${target_sha}"
if [[ "${reviewed_moyao_brand}" == "true" ]]; then
    printf 'MOYAO_BRAND_PUBLISH_BEGIN channel=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
    cd "${candidate}"
    VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-moyao-brand.mjs --apply --allow-remote \
            --channel-code "${reviewed_storefront_media_channel_codes}"
    VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-moyao-brand.mjs --verify \
            --channel-code "${reviewed_storefront_media_channel_codes}"
    cd "${repository}"
    printf 'MOYAO_BRAND_PUBLISH_OK channel=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
    printf 'MOYAO_BRAND_VERIFY_OK channel=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
fi
if [[ -n "${reviewed_storefront_media_keys}" ]]; then
    printf 'STOREFRONT_MEDIA_PUBLISH_BEGIN keys=%s channels=%s\n' \
        "${reviewed_storefront_media_keys}" "${reviewed_storefront_media_channel_codes}"
    cd "${candidate}"
    STOREFRONT_MEDIA_CHANNEL_CODES="${reviewed_storefront_media_channel_codes}" \
        VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-storefront-media.mjs \
            --keys "${reviewed_storefront_media_keys}" --apply --allow-remote
    STOREFRONT_MEDIA_CHANNEL_CODES="${reviewed_storefront_media_channel_codes}" \
        VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-storefront-media.mjs \
            --keys "${reviewed_storefront_media_keys}" --verify
    cd "${repository}"
    printf 'STOREFRONT_MEDIA_PUBLISH_OK keys=%s channels=%s\n' \
        "${reviewed_storefront_media_keys}" "${reviewed_storefront_media_channel_codes}"
    printf 'STOREFRONT_MEDIA_VERIFY_OK keys=%s channels=%s\n' \
        "${reviewed_storefront_media_keys}" "${reviewed_storefront_media_channel_codes}"
fi
if [[ "${reviewed_auth_visuals}" == "true" ]]; then
    printf 'AUTH_VISUAL_PUBLISH_BEGIN channels=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
    cd "${candidate}"
    AUTH_VISUAL_CHANNEL_CODES="${reviewed_storefront_media_channel_codes}" \
        VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-auth-visuals.mjs --apply --allow-remote
    AUTH_VISUAL_CHANNEL_CODES="${reviewed_storefront_media_channel_codes}" \
        VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-auth-visuals.mjs --verify
    cd "${repository}"
    printf 'AUTH_VISUAL_PUBLISH_OK channels=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
    printf 'AUTH_VISUAL_VERIFY_OK channels=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
fi
if [[ "${reviewed_homepage_carousel}" == "true" ]]; then
    printf 'HOMEPAGE_CAROUSEL_PUBLISH_BEGIN channel=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
    cd "${candidate}"
    HOMEPAGE_CAROUSEL_CHANNEL_CODES="${reviewed_storefront_media_channel_codes}" \
        VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-homepage-carousel.mjs --apply --allow-remote
    HOMEPAGE_CAROUSEL_CHANNEL_CODES="${reviewed_storefront_media_channel_codes}" \
        VENDURE_API_ORIGIN=http://127.0.0.1:3002 \
        VENDURE_STOREFRONT_URL=https://moyaoai.com \
        node packages/dev-server/scripts/sync-homepage-carousel.mjs --verify
    cd "${repository}"
    printf 'HOMEPAGE_CAROUSEL_PUBLISH_OK channel=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
    printf 'HOMEPAGE_CAROUSEL_VERIFY_OK channel=%s\n' \
        "${reviewed_storefront_media_channel_codes}"
fi
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
    --dashboard-url https://console.moyaoai.com/dashboard/ \
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
cmp --silent "${repository}/deploy/deploy-production-from-s3.sh" \
    /usr/local/sbin/vendure-production-deploy-from-s3 ||
    fail 'installed production bootstrap differs from the reviewed source'
printf 'PRODUCTION_BOOTSTRAP_VERIFIED sha=%s homepage_carousel_guard=enabled\n' "${target_sha}"
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now vendure-production-release-retention.path
sudo -n systemctl enable --now vendure-mysql-restore-drill.timer
sudo -n systemctl enable --now vendure-production-healthcheck.timer
if ! sudo -n systemctl start vendure-production-healthcheck.service; then
    sudo -n journalctl -u vendure-production-healthcheck.service -n 80 --no-pager >&2 || true
    fail 'the production health check service failed'
fi
if [[ ! -s /var/lib/vendure-readiness/restore-drill.json || \
    "$(sudo -n systemctl show vendure-mysql-restore-drill.service -p Result --value)" != "success" ]]; then
    if ! sudo -n systemctl start vendure-mysql-restore-drill.service; then
        sudo -n journalctl -u vendure-mysql-restore-drill.service -n 80 --no-pager >&2 || true
        fail 'the MySQL restore drill failed'
    fi
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
