#!/usr/bin/env bash

set -Eeuo pipefail

readonly repository="/var/www/kaiyuangouwu"
readonly releases_dir="/var/www/kaiyuangouwu-releases"
readonly current_pointer="/var/www/kaiyuangouwu-current"
readonly current_marker="${releases_dir}/current-sha"
readonly environment_file="${repository}/packages/dev-server/.env"
readonly deploy_lock="/run/lock/vendure-production-deploy.lock"

fail() {
    printf 'Production recovery failed: %s\n' "$1" >&2
    exit 1
}

exec 9>"${deploy_lock}"
flock --exclusive --wait 300 9 || fail 'timed out waiting for the production deployment lock'

readonly previous_pointer="$(readlink -f "${current_pointer}")"
readonly expected_sha="$(cat "${current_marker}")"
readonly deployment_id="recovery-${expected_sha}-github-${GITHUB_RUN_ID:-manual}-$(date -u +%Y%m%dT%H%M%SZ)"
[[ "${expected_sha}" =~ ^[0-9a-f]{40}$ ]] || fail 'current-sha is invalid'
[[ -L "${current_pointer}" && -n "${previous_pointer}" && "${previous_pointer}" == "${releases_dir}/"* ]] ||
    fail 'the current runtime pointer is outside the release directory'

# A failed late release can leave the candidate pointer switched while the
# successful-version marker still identifies the last verified release. Select
# only that marker's unique immutable runtime; never promote the failed pointer.
candidate="$(node - "${releases_dir}" "${expected_sha}" "${previous_pointer}" <<'NODE'
const { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } = require('node:fs');
const path = require('node:path');
const [releases, expectedSha, current] = process.argv.slice(2);
const valid = directory => {
    try {
        return path.dirname(directory) === releases && lstatSync(directory).isDirectory() &&
            realpathSync(directory) === directory &&
            JSON.parse(readFileSync(path.join(directory, 'RUNTIME-METADATA.json'), 'utf8')).gitSha === expectedSha &&
            ['index.js', 'index-worker.js'].every(name =>
                existsSync(path.join(directory, 'packages/dev-server/dist', name)));
    } catch { return false; }
};
if (valid(current)) process.stdout.write(current);
else {
    const matches = readdirSync(releases)
        .filter(name => name.startsWith(expectedSha + '-') && /^[a-f0-9]{40}-[A-Za-z0-9-]+$/u.test(name))
        .map(name => path.join(releases, name)).filter(valid);
    if (matches.length !== 1) {
        process.stderr.write('Last verified runtime is missing or ambiguous; recovery remains blocked\n');
        process.exitCode = 1;
    } else process.stdout.write(matches[0]);
}
NODE
)" || fail 'could not identify a unique last verified runtime'
readonly candidate

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

set -a
# shellcheck disable=SC1090
source "${environment_file}"
set +a

# The mandatory schema guard still precedes every pointer/process mutation.
node "${repository}/deploy/usdt-migration-guard.cjs" check-runtime "${candidate}"
printf 'PRODUCTION_RECOVERY_SOURCE expected=%s previous=%s selected=%s\n' \
    "${expected_sha}" "${previous_pointer}" "${candidate}"

readonly recovery_pointer="/var/www/.kaiyuangouwu-current.recovery-${GITHUB_RUN_ID:-manual}-$$"
created_pointer=0
cleanup_pointer() {
    if [[ "${created_pointer}" == "1" && -L "${recovery_pointer}" ]]; then
        sudo -n rm -f -- "${recovery_pointer}"
    fi
}
trap cleanup_pointer EXIT
if [[ "${previous_pointer}" != "${candidate}" ]]; then
    sudo -n ln -s "${candidate}" "${recovery_pointer}"
    created_pointer=1
    sudo -n mv -Tf "${recovery_pointer}" "${current_pointer}"
    created_pointer=0
fi
[[ "$(readlink -f "${current_pointer}")" == "${candidate}" ]] || fail 'recovery pointer did not match the verified runtime'

VENDURE_DEPLOYMENT_ID="${deployment_id}" \
    "${repository}/deploy/switch-production-runtime.sh" "${candidate}" 9>&- 2>&1 | node -e '
let pending = "";
const report = line => {
    if (/^USDT_RUNTIME_GUARD_OK operation=check-runtime$/u.test(line) ||
        /^PRODUCTION_API_READY phase=pre-worker attempts=[0-9]+$/u.test(line)) console.log(line);
    else if (line.startsWith("USDT_RUNTIME_GUARD_FAILED ")) {
        const code = line.match(/ error_code=([A-Z_]+)$/u)?.[1] ?? "UNKNOWN";
        console.log(`USDT_RUNTIME_GUARD_FAILED error_code=${code}`);
    }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
        report(pending.slice(0, newline)); pending = pending.slice(newline + 1);
    }
    if (pending.length > 65536) pending = "";
}).on("end", () => { if (pending) report(pending); });
'

if [[ -f "${candidate}/deploy/image-worker/server.cjs" ]]; then
    # Stop/start only the image worker; restarting through clamd's Wants cycle
    # can unnecessarily restart antivirus and exhaust its startup rate limit.
    sudo -n systemctl stop vendure-image-worker.service
    sudo -n systemctl start vendure-image-worker.service
    sudo -n systemctl is-active --quiet vendure-image-worker.service || fail 'image worker did not resume'
fi

for attempt in $(seq 1 60); do
    if curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3002/health >/dev/null; then
        pm2 save 9>&-
        if [[ -f "${candidate}/deploy/image-worker/server.cjs" ]]; then
            # Type=simple reports the worker active before its socket is ready.
            # Readiness must tolerate that bounded startup interval.
            image_ready=0
            for image_attempt in $(seq 1 30); do
                if curl --fail --silent --max-time 10 http://127.0.0.1:3002/image-generation/health >/dev/null; then
                    image_ready=1
                    break
                fi
                sleep 1
            done
            [[ "${image_ready}" == "1" ]] || fail 'recovered image service did not pass bounded readiness'
            printf 'PRODUCTION_RECOVERY_IMAGE_READY attempts=%s\n' "${image_attempt}"
        fi
        sudo -n systemctl restart vendure-production-healthcheck.service ||
            fail 'runtime resumed but the production health service failed'
        printf 'Production runtime recovered: %s\n' "${candidate_sha}"
        exit 0
    fi
    if [[ "${attempt}" == "60" ]]; then
        fail 'the restored API did not pass its local health check'
    fi
    sleep 2
done
