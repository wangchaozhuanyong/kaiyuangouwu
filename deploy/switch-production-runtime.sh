#!/usr/bin/env bash

set -Eeuo pipefail

readonly candidate="${1:-}"
readonly deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ecosystem="${deploy_dir}/ecosystem.production.config.cjs"

if [[ -z "${candidate}" || "${candidate}" != /* || "${candidate}" == "/" ]]; then
    printf 'Usage: %s /absolute/production/runtime\n' "${0}" >&2
    exit 1
fi

for required_path in \
    "${candidate}/packages/dev-server/dist/index.js" \
    "${candidate}/packages/dev-server/dist/index-worker.js" \
    "${ecosystem}"; do
    if [[ ! -f "${required_path}" ]]; then
        printf 'Required production runtime file is missing: %s\n' "${required_path}" >&2
        exit 1
    fi
done

# PM2 reload preserves pm_cwd and pm_exec_path. Replace the old process
# definitions so both services actually start from this immutable candidate.
for process_name in vendure-api vendure-worker; do
    if pm2 describe "${process_name}" >/dev/null 2>&1; then
        pm2 delete "${process_name}"
    fi
done

VENDURE_RUNTIME_DIR="${candidate}" pm2 start "${ecosystem}" --update-env

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
