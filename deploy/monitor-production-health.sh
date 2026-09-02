#!/usr/bin/env bash

set -Eeuo pipefail

readonly repository="/var/www/kaiyuangouwu"
readonly current_pointer="/var/www/kaiyuangouwu-current"
readonly current_marker="/var/www/kaiyuangouwu-releases/current-sha"
readonly memory_guard="${repository}/deploy/production-memory-guard.cjs"
readonly environment_file="${repository}/packages/dev-server/.env"
readonly healthcheck_maximum_age_seconds=1200
readonly restore_drill_maximum_age_seconds=777600

fail() {
    printf 'Production health monitor failed: %s\n' "$1" >&2
    exit 1
}

require_recent_systemd_success() {
    local timer_name="$1"
    local service_name="$2"
    local maximum_age_seconds="$3"
    local result
    local completed_at
    local completed_epoch
    local current_epoch
    local age_seconds

    [[ "$(systemctl is-enabled "${timer_name}")" == "enabled" ]] ||
        fail "${timer_name} is not enabled"
    [[ "$(systemctl is-active "${timer_name}")" == "active" ]] ||
        fail "${timer_name} is not active"

    result="$(systemctl show "${service_name}" -p Result --value)"
    [[ "${result}" == "success" ]] || fail "${service_name} last result is ${result:-missing}"

    completed_at="$(systemctl show "${service_name}" -p ExecMainExitTimestamp --value)"
    [[ -n "${completed_at}" && "${completed_at}" != "n/a" ]] ||
        fail "${service_name} has no completion timestamp"
    completed_epoch="$(date -u --date="${completed_at}" +%s 2>/dev/null)" ||
        fail "${service_name} completion timestamp is invalid"
    current_epoch="$(date -u +%s)"
    age_seconds=$((current_epoch - completed_epoch))
    ((age_seconds >= 0 && age_seconds <= maximum_age_seconds)) ||
        fail "${service_name} last success is stale (${age_seconds}s)"

    printf 'PRODUCTION_SYSTEMD_CHECK timer=%s service=%s age_seconds=%s status=healthy\n' \
        "${timer_name}" "${service_name}" "${age_seconds}"
}

[[ -f "${memory_guard}" ]] || fail 'memory guard is missing'
[[ -r "${environment_file}" ]] || fail 'production environment file is not readable'
[[ -L "${current_pointer}" ]] || fail 'current runtime pointer is missing'
[[ -f "${current_marker}" ]] || fail 'current runtime marker is missing'

readonly candidate="$(readlink -f "${current_pointer}")"
readonly target_sha="$(tr -d '[:space:]' <"${current_marker}")"
readonly candidate_name="$(basename "${candidate}")"

[[ "${candidate}" == /var/www/kaiyuangouwu-releases/* ]] || fail 'current runtime is outside releases'
[[ "${target_sha}" =~ ^[0-9a-f]{40}$ ]] || fail 'current runtime marker is invalid'
[[ "${candidate_name}" =~ ^${target_sha}-[0-9]+-[0-9]+-linux-x64$ ]] ||
    fail 'current runtime does not match its version marker'

require_recent_systemd_success \
    vendure-production-healthcheck.timer \
    vendure-production-healthcheck.service \
    "${healthcheck_maximum_age_seconds}"
require_recent_systemd_success \
    vendure-mysql-restore-drill.timer \
    vendure-mysql-restore-drill.service \
    "${restore_drill_maximum_age_seconds}"

node "${memory_guard}" --stage scheduled-monitor --check
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3002/health >/dev/null
readonly image_health_json="$(
    curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3002/image-generation/health
)"
IMAGE_HEALTH_JSON="${image_health_json}" node -e "
const snapshot = JSON.parse(process.env.IMAGE_HEALTH_JSON || '{}');
const metrics = {
    status: snapshot.status,
    recentCallStatus: snapshot.recentCallStatus,
    workerStatus: snapshot.workerStatus,
    workerStale: snapshot.workerStale,
    queueStale: snapshot.queueStale,
    queuedOutputs: snapshot.queuedOutputs,
    activeOutputs: snapshot.activeOutputs,
    attempts24h: snapshot.attempts24h,
    successes24h: snapshot.successes24h,
    failures24h: snapshot.failures24h,
    unknowns24h: snapshot.unknowns24h,
    successRate: snapshot.successRate,
    unknownRate: snapshot.unknownRate,
    missingCostCount: snapshot.missingCostCount,
    missingCostRate: snapshot.missingCostRate,
    failureBuckets: Array.isArray(snapshot.failureBuckets)
        ? snapshot.failureBuckets.map(({ code, count }) => ({ code, count }))
        : [],
    keyRedundancy: Array.isArray(snapshot.keyRedundancy)
        ? snapshot.keyRedundancy.map(({ scope, healthyKeyCount }) => ({ scope, healthyKeyCount }))
        : [],
};
process.stdout.write('AI_IMAGE_METRICS ' + JSON.stringify(metrics) + '\n');
for (const alert of snapshot.alerts || []) {
    process.stderr.write('AI_IMAGE_' + alert.severity + ' ' + alert.code + ' ' + alert.message + '\n');
}
"

set -a
# shellcheck disable=SC1090
source "${environment_file}"
set +a
for required_name in DB_HOST DB_PORT DB_USERNAME DB_PASSWORD DB_NAME; do
    [[ -n "${!required_name:-}" ]] || fail "required database setting is missing: ${required_name}"
done

readonly resolution_diagnostics_sql="
SELECT
    modelCodeSnapshot,
    providerScopeSnapshot,
    REPLACE(COALESCE(REGEXP_SUBSTR(errorMessage, '原生 [124]K'), '原生 unknown'), '原生 ', '') AS requestedResolution,
    REPLACE(REPLACE(COALESCE(REGEXP_SUBSTR(errorMessage, '实际 [0-9]{1,5}×[0-9]{1,5}'), '实际 unknown'), '实际 ', ''), '×', 'x') AS actualDimensions,
    COUNT(*)
FROM image_generation_cost_event
WHERE createdAt >= UTC_TIMESTAMP() - INTERVAL 24 HOUR
  AND failureCode = 'IMAGE_RESOLUTION_MISMATCH'
GROUP BY modelCodeSnapshot, providerScopeSnapshot, requestedResolution, actualDimensions
ORDER BY COUNT(*) DESC, modelCodeSnapshot, providerScopeSnapshot, requestedResolution, actualDimensions
LIMIT 20"
resolution_rows="$(
    MYSQL_PWD="${DB_PASSWORD}" mysql \
        --host="${DB_HOST}" \
        --port="${DB_PORT}" \
        --user="${DB_USERNAME}" \
        --batch \
        --skip-column-names \
        --execute="${resolution_diagnostics_sql}" \
        "${DB_NAME}"
)" || fail 'resolution diagnostic query failed'
while IFS=$'\t' read -r model provider requested actual count; do
    [[ -n "${model}" ]] || continue
    [[ "${model}" =~ ^[A-Za-z0-9_-]{1,48}$ ]] || fail 'unsafe model code in resolution diagnostics'
    [[ "${provider}" =~ ^[A-Z]{2,24}$ ]] || fail 'unsafe provider scope in resolution diagnostics'
    [[ "${requested}" =~ ^([124]K|unknown)$ ]] || fail 'unsafe requested resolution diagnostic'
    [[ "${actual}" =~ ^([0-9]{1,5}x[0-9]{1,5}|unknown)$ ]] || fail 'unsafe actual resolution diagnostic'
    [[ "${count}" =~ ^[0-9]+$ ]] || fail 'unsafe resolution diagnostic count'
    printf 'AI_IMAGE_RESOLUTION_MISMATCH model=%s provider=%s requested=%s actual=%s count=%s\n' \
        "${model}" "${provider}" "${requested}" "${actual}" "${count}"
done <<<"${resolution_rows}"

readonly missing_cost_diagnostics_sql="
SELECT modelCodeSnapshot, providerScopeSnapshot, outcome, COUNT(*)
FROM image_generation_cost_event
WHERE createdAt >= UTC_TIMESTAMP() - INTERVAL 24 HOUR
  AND actualCostMicrounits IS NULL
GROUP BY modelCodeSnapshot, providerScopeSnapshot, outcome
ORDER BY COUNT(*) DESC, modelCodeSnapshot, providerScopeSnapshot, outcome
LIMIT 20"
missing_cost_rows="$(
    MYSQL_PWD="${DB_PASSWORD}" mysql \
        --host="${DB_HOST}" \
        --port="${DB_PORT}" \
        --user="${DB_USERNAME}" \
        --batch \
        --skip-column-names \
        --execute="${missing_cost_diagnostics_sql}" \
        "${DB_NAME}"
)" || fail 'missing-cost diagnostic query failed'
while IFS=$'\t' read -r model provider outcome count; do
    [[ -n "${model}" ]] || continue
    [[ "${model}" =~ ^[A-Za-z0-9_-]{1,48}$ ]] || fail 'unsafe model code in missing-cost diagnostics'
    [[ "${provider}" =~ ^[A-Z]{2,24}$ ]] || fail 'unsafe provider scope in missing-cost diagnostics'
    [[ "${outcome}" =~ ^[A-Z_]{2,24}$ ]] || fail 'unsafe outcome in missing-cost diagnostics'
    [[ "${count}" =~ ^[0-9]+$ ]] || fail 'unsafe missing-cost diagnostic count'
    printf 'AI_IMAGE_MISSING_COST model=%s provider=%s outcome=%s count=%s\n' \
        "${model}" "${provider}" "${outcome}" "${count}"
done <<<"${missing_cost_rows}"

curl --fail --silent --show-error --max-time 15 https://damatong.net/health >/dev/null
node "${repository}/deploy/verify-dashboard-assets.mjs" \
    --dashboard-url https://console.damatong.net/dashboard/

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

printf 'PRODUCTION_HEALTH_MONITOR_OK target_sha=%s runtime=%s\n' "${target_sha}" "${candidate}"
