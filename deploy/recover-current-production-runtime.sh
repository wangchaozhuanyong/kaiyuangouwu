#!/usr/bin/env bash

set -Eeuo pipefail

readonly repository="/var/www/kaiyuangouwu"
readonly releases_dir="/var/www/kaiyuangouwu-releases"
readonly current_pointer="/var/www/kaiyuangouwu-current"
readonly current_marker="${releases_dir}/current-sha"
readonly environment_file="${repository}/packages/dev-server/.env"
readonly deploy_lock="/run/lock/vendure-production-deploy.lock"
readonly candidate="$(readlink -f "${current_pointer}")"
readonly expected_sha="$(cat "${current_marker}")"
readonly deployment_id="recovery-${expected_sha}-github-${GITHUB_RUN_ID:-manual}-$(date -u +%Y%m%dT%H%M%SZ)"

fail() {
    printf 'Production recovery failed: %s\n' "$1" >&2
    exit 1
}

[[ "${expected_sha}" =~ ^[0-9a-f]{40}$ ]] || fail 'current-sha is invalid'
[[ -n "${candidate}" && "${candidate}" == "${releases_dir}/"* ]] ||
    fail 'the current runtime pointer is outside the release directory'

for required_path in \
    "${candidate}/packages/dev-server/dist/index.js" \
    "${candidate}/packages/dev-server/dist/index-worker.js" \
    "${candidate}/RUNTIME-METADATA.json" \
    "${environment_file}"; do
    [[ -f "${required_path}" ]] || fail "required recovery file is missing: ${required_path}"
done

readonly candidate_sha="$(node - "${candidate}/RUNTIME-METADATA.json" <<'NODE'
const { readFileSync } = require('node:fs');

const metadata = JSON.parse(readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(metadata.gitSha ?? ''));
NODE
)"
[[ "${candidate_sha}" == "${expected_sha}" ]] || fail 'current runtime and version marker disagree'

exec 9>"${deploy_lock}"
flock --exclusive --wait 300 9 || fail 'timed out waiting for the production deployment lock'

set -a
# shellcheck disable=SC1090
source "${environment_file}"
set +a

printf 'FAILED_CANDIDATE_LOGS_BEGIN\n'
pm2 logs vendure-api --lines 120 --nostream 9>&- || true
pm2 logs vendure-worker --lines 80 --nostream 9>&- || true
printf 'FAILED_CANDIDATE_LOGS_END\n'

VENDURE_DEPLOYMENT_ID="${deployment_id}" \
    "${repository}/deploy/switch-production-runtime.sh" "${candidate}" 9>&-

for attempt in $(seq 1 60); do
    if curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3002/health >/dev/null; then
        pm2 save 9>&-
        printf 'Production runtime recovered: %s\n' "${candidate_sha}"
        exit 0
    fi
    if [[ "${attempt}" == "60" ]]; then
        pm2 logs vendure-api --lines 120 --nostream 9>&- || true
        pm2 logs vendure-worker --lines 80 --nostream 9>&- || true
        fail 'the restored API did not pass its local health check'
    fi
    sleep 2
done
