#!/usr/bin/env bash

set -Eeuo pipefail

readonly candidate="${1:-}"
readonly deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ecosystem="${deploy_dir}/ecosystem.production.config.cjs"
readonly audit_tag="vendure-production-switch"

sanitize_audit_value() {
    printf '%s' "${1:-unknown}" | LC_ALL=C tr -c 'A-Za-z0-9_./:@+-' '_'
}

readonly deployment_id="$(sanitize_audit_value "${VENDURE_DEPLOYMENT_ID:-manual-$(date -u +%Y%m%dT%H%M%SZ)-$$}")"
readonly actor="$(sanitize_audit_value "${SUDO_USER:-$(id -un)}")"
readonly effective_user="$(sanitize_audit_value "$(id -un)")"
readonly ssh_connection="${SSH_CONNECTION:-}"
readonly source_ip="$(sanitize_audit_value "${ssh_connection%% *}")"
readonly candidate_path="$(sanitize_audit_value "${candidate}")"
candidate_sha="unknown"
parent_process="$(ps -o comm= -p "${PPID}" 2>/dev/null || true)"
readonly parent_process="$(sanitize_audit_value "${parent_process:-unknown}")"

if [[ "${candidate##*/}" =~ ^([a-f0-9]{40})- ]]; then
    candidate_sha="${BASH_REMATCH[1]}"
fi

audit_switch() {
    local event="${1}"
    local status="${2}"
    local line="${3}"

    /usr/bin/logger --tag "${audit_tag}" -- \
        "event=$(sanitize_audit_value "${event}") deployment_id=${deployment_id} actor=${actor} effective_user=${effective_user} source_ip=${source_ip:-local} pid=$$ parent_pid=${PPID} parent=${parent_process} target_sha=$(sanitize_audit_value "${candidate_sha}") candidate=${candidate_path:-missing} status=$(sanitize_audit_value "${status}") line=$(sanitize_audit_value "${line}")"
}

fail_switch() {
    local message="${1}"
    local line="${BASH_LINENO[0]:-unknown}"

    trap - ERR
    printf '%s\n' "${message}" >&2
    audit_switch failed 1 "${line}" || true
    exit 1
}

handle_switch_error() {
    local status="$?"
    local line="${BASH_LINENO[0]:-unknown}"

    trap - ERR
    audit_switch failed "${status}" "${line}" || true
    exit "${status}"
}

if [[ ! -x /usr/bin/logger ]]; then
    printf 'Required production audit logger is missing: /usr/bin/logger\n' >&2
    exit 1
fi

trap handle_switch_error ERR
audit_switch requested pending 0

if [[ -z "${candidate}" || "${candidate}" != /* || "${candidate}" == "/" ]]; then
    fail_switch "Usage: ${0} /absolute/production/runtime"
fi

for required_path in \
    "${candidate}/packages/dev-server/dist/index.js" \
    "${candidate}/packages/dev-server/dist/index-worker.js" \
    "${candidate}/RUNTIME-METADATA.json" \
    "${ecosystem}"; do
    if [[ ! -f "${required_path}" ]]; then
        fail_switch "Required production runtime file is missing: ${required_path}"
    fi
done

candidate_sha="$(node - "${candidate}/RUNTIME-METADATA.json" <<'NODE'
const { readFileSync } = require('node:fs');

const metadata = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (typeof metadata.gitSha !== 'string' || !/^[a-f0-9]{40}$/u.test(metadata.gitSha)) {
    throw new Error('Runtime metadata contains an invalid Git SHA');
}
process.stdout.write(metadata.gitSha);
NODE
)"

# PM2 reload preserves pm_cwd and pm_exec_path. Replace the old process
# definitions so both services actually start from this immutable candidate.
for process_name in vendure-api vendure-worker; do
    if pm2 describe "${process_name}" >/dev/null 2>&1; then
        pm2 delete "${process_name}"
    fi
done

# Start the API and worker sequentially so their cold-start allocation does not
# overlap on the single-host production instance.
VENDURE_RUNTIME_DIR="${candidate}" pm2 start "${ecosystem}" --only vendure-api --update-env
api_ready_attempt=0
for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 10 http://127.0.0.1:3002/health >/dev/null 2>&1; then
        api_ready_attempt="${attempt}"
        break
    fi
    if [[ "${attempt}" == "30" ]]; then
        printf '%s\n' 'Candidate API health check failed; PM2 diagnostics follow:' >&2
        curl --fail --silent --show-error --max-time 10 \
            http://127.0.0.1:3002/health >/dev/null || true
        pm2 jlist | node -e '
let input = "";
process.stdin.on("data", chunk => (input += chunk)).on("end", () => {
    const processes = JSON.parse(input);
    const summary = processes.map(({ name, pm2_env: env }) => ({
        name,
        status: env?.status,
        restartTime: env?.restart_time,
        exitCode: env?.exit_code,
        cwd: env?.pm_cwd,
        entry: env?.pm_exec_path,
    }));
    process.stdout.write(`${JSON.stringify(summary)}\\n`);
});
' >&2 || true
        pm2 logs vendure-api --nostream --lines 120 --raw >&2 || true
        fail_switch 'candidate API health check did not pass before worker start'
    fi
    sleep 2
done
printf 'PRODUCTION_API_READY phase=pre-worker attempts=%s\n' "${api_ready_attempt}"
VENDURE_RUNTIME_DIR="${candidate}" pm2 start "${ecosystem}" --only vendure-worker --update-env

CANDIDATE="${candidate}" node <<'NODE'
const { execFileSync } = require('node:child_process');

const candidate = process.env.CANDIDATE;
const expectedProcesses = new Map([
    ['vendure-api', `${candidate}/packages/dev-server/dist/index.js`],
    ['vendure-worker', `${candidate}/packages/dev-server/dist/index-worker.js`],
]);
const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
const errors = [];

for (const [name, expectedEntry] of expectedProcesses) {
    const managedProcess = processes.find(item => item.name === name);
    if (!managedProcess) {
        errors.push(`${name} is missing`);
        continue;
    }
    if (managedProcess.pm2_env.status !== 'online') {
        errors.push(`${name} is ${String(managedProcess.pm2_env.status)}`);
    }
    if (managedProcess.pm2_env.pm_cwd !== candidate) {
        errors.push(`${name} cwd does not match the candidate`);
    }
    if (managedProcess.pm2_env.pm_exec_path !== expectedEntry) {
        errors.push(`${name} entry does not match the candidate`);
    }
}

if (errors.length) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exitCode = 1;
}
NODE

audit_switch succeeded 0 0
trap - ERR
