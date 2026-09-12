#!/usr/bin/env bash
set -Eeuo pipefail

readonly target_sha="${1:-}"
readonly archive_name="${2:-}"
readonly archive_sha256="${3:-}"
readonly repository=/var/www/kaiyuangouwu
readonly releases_dir=/var/www/kaiyuangouwu-storefront-releases
readonly current_pointer=/var/www/kaiyuangouwu-storefront-current
readonly deploy_lock=/run/lock/vendure-production-deploy.lock
readonly artifact_bucket=yunqiao-vendure-prod-backup-079740175286-apne1

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$target_sha" =~ ^[a-f0-9]{40}$ ]] || fail 'Expected full source SHA'
[[ "$archive_sha256" =~ ^[a-f0-9]{64}$ ]] || fail 'Expected artifact SHA256'
[[ "$archive_name" =~ ^storefront-fast-${target_sha}-[0-9]+-[0-9]+\.tar\.gz$ ]] || fail 'Invalid archive name'

# The full release and fast lane hold the same server lock through acceptance/rollback.
exec 9>"$deploy_lock"
flock --exclusive --wait 300 9 || fail 'Timed out waiting for production deployment lock'
cd "$repository"
repo_git() { git -C "$repository" "$@"; }
repo_git fetch origin main --no-tags
[[ "$(repo_git rev-parse refs/remotes/origin/main)" == "$target_sha" ]] || fail 'Requested SHA is no longer origin/main'
readonly backend_sha="$(cat /var/www/kaiyuangouwu-releases/current-sha)"
[[ "$backend_sha" =~ ^[a-f0-9]{40}$ ]] || fail 'Invalid current backend SHA'
[[ "$(repo_git rev-parse HEAD)" == "$backend_sha" ]] || fail 'Server source differs from the active full release'
[[ -z "$(repo_git status --porcelain --untracked-files=no)" ]] || fail 'Server source has tracked changes'
repo_git merge-base --is-ancestor "$backend_sha" "$target_sha" || fail 'Runtime is not an ancestor of target'
repo_git diff --name-only -z "$backend_sha" "$target_sha" -- |
    node "$repository/deploy/storefront-release.mjs" scope
[[ -L "$current_pointer" && -f "$current_pointer/index.html" ]] || fail 'Run a full release to initialize the storefront pointer first'
sudo -n nginx -T 2>/dev/null | awk '/root \/var\/www\/kaiyuangouwu-storefront-current;/ { found = 1 } END { exit !found }' ||
    fail 'Nginx has not migrated to the atomic storefront pointer; run a full release first'

umask 022
sudo -n install -d -o ubuntu -g ubuntu -m 0755 "$releases_dir"
readonly staging_dir="$(mktemp -d "$releases_dir/.incoming-XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT
readonly candidate="$releases_dir/${archive_name%.tar.gz}"
[[ ! -e "$candidate" ]] || fail 'This immutable storefront release already exists; use a new run attempt'
aws s3 cp "s3://$artifact_bucket/deployments/$target_sha/$archive_name" "$staging_dir/archive.tar.gz" --only-show-errors
printf '%s  %s\n' "$archive_sha256" "$staging_dir/archive.tar.gz" | sha256sum --check -

# Validate every archive member before extracting anything, including links and traversal.
python3 - "$staging_dir/archive.tar.gz" "$staging_dir/dist" <<'PY'
import pathlib
import sys
import tarfile

with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe storefront archive member')
    archive.extractall(sys.argv[2], members=members)
PY
test -s "$staging_dir/dist/index.html"
test -d "$staging_dir/dist/assets"
python3 - "$staging_dir/dist/storefront-release.json" "$target_sha" "$backend_sha" "$archive_sha256" "$archive_name" <<'PY'
import json
import pathlib
import sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    'sourceSha': sys.argv[2], 'backendSha': sys.argv[3],
    'artifactSha256': sys.argv[4], 'artifact': sys.argv[5],
}) + '\n')
PY
chmod -R a+rX "$staging_dir/dist"
mv "$staging_dir/dist" "$candidate"
sudo -n node "$repository/deploy/storefront-release.mjs" activate "$candidate" "$current_pointer" "${archive_name%.tar.gz}"
printf 'STOREFRONT_FAST_LANE_DEPLOYED_OK sha=%s\n' "$target_sha"
