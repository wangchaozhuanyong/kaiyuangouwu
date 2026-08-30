#!/usr/bin/env bash

set -Eeuo pipefail

readonly repository="/var/www/kaiyuangouwu"
readonly current_pointer="/var/www/kaiyuangouwu-current"
readonly current_marker="/var/www/kaiyuangouwu-releases/current-sha"
readonly memory_guard="${repository}/deploy/production-memory-guard.cjs"

fail() {
    printf 'Production health monitor failed: %s\n' "$1" >&2
    exit 1
}

[[ -f "${memory_guard}" ]] || fail 'memory guard is missing'
[[ -L "${current_pointer}" ]] || fail 'current runtime pointer is missing'
[[ -f "${current_marker}" ]] || fail 'current runtime marker is missing'

readonly candidate="$(readlink -f "${current_pointer}")"
readonly target_sha="$(tr -d '[:space:]' <"${current_marker}")"
readonly candidate_name="$(basename "${candidate}")"

[[ "${candidate}" == /var/www/kaiyuangouwu-releases/* ]] || fail 'current runtime is outside releases'
[[ "${target_sha}" =~ ^[0-9a-f]{40}$ ]] || fail 'current runtime marker is invalid'
[[ "${candidate_name}" =~ ^${target_sha}-[0-9]+-[0-9]+-linux-x64$ ]] ||
    fail 'current runtime does not match its version marker'

node "${memory_guard}" --stage scheduled-monitor --check
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3002/health >/dev/null
readonly image_health_json="$(
    curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3002/image-generation/health
)"
IMAGE_HEALTH_JSON="${image_health_json}" node -e "
const snapshot = JSON.parse(process.env.IMAGE_HEALTH_JSON || '{}');
for (const alert of snapshot.alerts || []) {
    process.stderr.write('AI_IMAGE_' + alert.severity + ' ' + alert.code + ' ' + alert.message + '\n');
}
"
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
