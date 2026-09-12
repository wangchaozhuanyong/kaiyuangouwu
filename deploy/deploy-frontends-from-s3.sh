#!/usr/bin/env bash
set -Eeuo pipefail
readonly target_sha="${1:-}"
readonly archive_name="${2:-}"
readonly archive_sha256="${3:-}"
readonly components="${4:-}"
readonly repository=/var/www/kaiyuangouwu
readonly releases_dir=/var/www/kaiyuangouwu-frontend-releases
readonly artifact_bucket=yunqiao-vendure-prod-backup-079740175286-apne1
fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$target_sha" =~ ^[a-f0-9]{40}$ ]] || fail 'Expected full source SHA'
[[ "$archive_sha256" =~ ^[a-f0-9]{64}$ ]] || fail 'Expected artifact checksum'
[[ "$archive_name" =~ ^frontends-${target_sha}-[0-9]+-[0-9]+\.tar\.gz$ ]] || fail 'Invalid archive name'
case "$components" in storefront|next-admin|next-admin,storefront) ;; *) fail 'Invalid component scope' ;; esac
exec 9>/run/lock/vendure-production-deploy.lock
flock --exclusive --wait 300 9 || fail 'Timed out waiting for production deployment lock'
cd "$repository"
git fetch origin main --no-tags
[[ "$(git rev-parse origin/main)" == "$target_sha" ]] || fail 'Target is no longer current main'
readonly backend_sha="$(cat /var/www/kaiyuangouwu-releases/current-sha)"
[[ "$backend_sha" =~ ^[a-f0-9]{40}$ ]] || fail 'Invalid backend version'
[[ "$(git rev-parse HEAD)" == "$backend_sha" ]] || fail 'Server source differs from active runtime'
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail 'Server has tracked source changes'
git merge-base --is-ancestor "$backend_sha" "$target_sha"
git diff --no-renames --name-only -z "$backend_sha" "$target_sha" -- | node deploy/frontend-release.mjs scope "$components"
# A full release installs both pointers and the Nginx routing before static releases are possible.
IFS=',' read -r -a apps <<< "$components"
for app in "${apps[@]}"; do
    pointer="/var/www/kaiyuangouwu-${app}-current"
    [[ -L "$pointer" && -s "$pointer/index.html" ]] || fail "Full release must initialize $app first"
done
sudo -n nginx -T 2>/dev/null | awk '/kaiyuangouwu-next-admin-current/ { admin=1 } /kaiyuangouwu-storefront-current/ { storefront=1 } END { exit !(admin && storefront) }' || fail 'Static routing has not been initialized'
sudo -n install -d -o ubuntu -g ubuntu -m 0755 "$releases_dir"
readonly staging="$(mktemp -d "$releases_dir/.incoming-XXXXXX")"
trap 'rm -rf -- "$staging"' EXIT
readonly candidate="$releases_dir/${archive_name%.tar.gz}"
aws s3 cp "s3://$artifact_bucket/deployments/$target_sha/$archive_name" "$staging/archive.tar.gz" --only-show-errors
printf '%s  %s\n' "$archive_sha256" "$staging/archive.tar.gz" | sha256sum --check -
python3 - "$staging/archive.tar.gz" "$staging/payload" "$components" <<'PYEXTRACT'
import pathlib,sys,tarfile
components=set(sys.argv[3].split(','))
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members=archive.getmembers()
    if sum(m.size for m in members)>1024*1024*1024: raise SystemExit('Oversized frontend archive')
    for m in members:
        p=pathlib.PurePosixPath(m.name)
        if p.is_absolute() or '..' in p.parts or not (m.isfile() or m.isdir()): raise SystemExit('Unsafe frontend archive member')
        if p.parts and p.parts[0] not in components: raise SystemExit('Unexpected frontend component')
    archive.extractall(sys.argv[2],members=members)
PYEXTRACT
for app in "${apps[@]}"; do
    test -s "$staging/payload/$app/index.html"
    test -d "$staging/payload/$app/assets"
    python3 - "$staging/payload/$app/frontend-release.json" "$target_sha" "$backend_sha" "$archive_sha256" "$app" <<'PYMANIFEST'
import json,pathlib,sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({'sourceSha':sys.argv[2],'backendSha':sys.argv[3],'artifactSha256':sys.argv[4],'component':sys.argv[5]})+'\n')
PYMANIFEST
done
if [[ -e "$candidate" ]]; then
    diff --recursive --brief "$candidate" "$staging/payload" || fail 'Existing immutable candidate differs from the verified payload'
else
    chmod -R a+rX "$staging/payload"
    mv "$staging/payload" "$candidate"
fi
sudo -n node deploy/frontend-release.mjs activate "$components" "$candidate" "${archive_name%.tar.gz}"
printf 'FRONTEND_DEPLOYED_OK sha=%s components=%s\n' "$target_sha" "$components"
