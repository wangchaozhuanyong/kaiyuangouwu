#!/usr/bin/env bash
set -Eeuo pipefail
readonly target_sha="${1:-}"
readonly archive_name="${2:-}"
readonly archive_sha256="${3:-}"
readonly config_sha256="${4:-}"
readonly expected_backend_sha="${5:-}"
readonly expected_storefront_sha="${6:-}"
readonly expected_admin_sha="${7:-}"
readonly repository=/var/www/kaiyuangouwu
readonly releases_dir=/var/www/kaiyuangouwu-nginx-releases
readonly artifact_bucket=yunqiao-vendure-prod-backup-079740175286-apne1
readonly controls_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fail() { printf '%s\n' "$*" >&2; exit 1; }
for sha in "$target_sha" "$expected_backend_sha" "$expected_storefront_sha" "$expected_admin_sha"; do
    [[ "$sha" =~ ^[a-f0-9]{40}$ ]] || fail 'Expected full component source SHA'
done
for hash in "$archive_sha256" "$config_sha256"; do
    [[ "$hash" =~ ^[a-f0-9]{64}$ ]] || fail 'Expected artifact/configuration checksum'
done
[[ "$archive_name" =~ ^nginx-${target_sha}-[0-9]+-[0-9]+\.tar\.gz$ ]] || fail 'Invalid Nginx archive name'
exec 9>/run/lock/vendure-production-deploy.lock
flock --exclusive --wait 300 9 || fail 'Timed out waiting for production deployment lock'
cd "$repository"
git fetch origin main --no-tags
[[ "$(git rev-parse origin/main)" == "$target_sha" ]] || fail 'Target is no longer current main'
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail 'Server has tracked source changes'
readonly backend_sha="$(cat /var/www/kaiyuangouwu-releases/current-sha)"
[[ "$backend_sha" == "$expected_backend_sha" ]] || fail 'Active backend revision changed after preflight'
node "$controls_root/deploy/frontend-release.mjs" backend-runtime "$backend_sha" "$target_sha"
read_frontend_sha() {
    node -e 'const fs=require("node:fs");const sha=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).sourceSha;if(!/^[a-f0-9]{40}$/.test(sha))process.exit(1);process.stdout.write(sha)' "$1"
}
readonly storefront_sha="$(read_frontend_sha /var/www/kaiyuangouwu-storefront-current/frontend-release.json)"
readonly admin_sha="$(read_frontend_sha /var/www/kaiyuangouwu-next-admin-current/frontend-release.json)"
[[ "$storefront_sha" == "$expected_storefront_sha" && "$admin_sha" == "$expected_admin_sha" ]] || fail 'Active frontend revision changed after preflight'
for sha in "$storefront_sha" "$admin_sha"; do
    git merge-base --is-ancestor "$sha" "$target_sha" || fail 'Active frontend source diverges from target'
done
node "$controls_root/deploy/nginx-release.mjs" scope "$backend_sha" "$target_sha" "$storefront_sha" "$admin_sha"
readonly source_config_hash="$(git show "$target_sha:deploy/nginx/damatong.conf" | sha256sum | cut -d ' ' -f 1)"
[[ "$source_config_hash" == "$config_sha256" ]] || fail 'Artifact configuration does not match the reviewed Git source'
# The helper recognizes either the immutable runtime's original configuration
# or the independent Nginx marker, including a later full-runtime replacement.
readonly nginx_revision="$(sudo -n node "$controls_root/deploy/nginx-revision.cjs" "$backend_sha" "$target_sha")"
readonly previous_config_hash="$(printf '%s' "$nginx_revision" | node -e 'let text="";process.stdin.on("data",chunk=>text+=chunk).on("end",()=>{const m=JSON.parse(text);if(!/^[a-f0-9]{64}$/.test(m.configSha256))process.exit(1);process.stdout.write(m.configSha256)})')"
sudo -n install -d -o ubuntu -g ubuntu -m 0755 "$releases_dir"
archive_bytes="$(aws s3api head-object --bucket "$artifact_bucket" --key "deployments/$target_sha/$archive_name" --query ContentLength --output text)"
[[ "$archive_bytes" =~ ^[1-9][0-9]*$ && "$archive_bytes" -le 2097152 ]] || fail 'Nginx artifact exceeds its bounded staging size'
python3 "$controls_root/deploy/systemd/vendure-disk-budget.py" stage --archive-bytes "$archive_bytes" --runtime-bytes 1048576
readonly staging="$(mktemp -d "$releases_dir/.incoming-XXXXXX")"
trap 'rm -rf -- "$staging"' EXIT
readonly release_id="${archive_name%.tar.gz}"
readonly candidate="$releases_dir/$release_id"
[[ ! -e "$candidate" && ! -L "$candidate" ]] || fail 'Nginx release candidate already exists; inspect the original attempt'
aws s3 cp "s3://$artifact_bucket/deployments/$target_sha/$archive_name" "$staging/archive.tar.gz" --only-show-errors
printf '%s  %s\n' "$archive_sha256" "$staging/archive.tar.gz" | sha256sum --check -
mkdir "$staging/payload"
python3 - "$staging/archive.tar.gz" "$staging/payload/damatong.conf" "$config_sha256" <<'PYEXTRACT'
import hashlib,pathlib,sys,tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members=archive.getmembers()
    if len(members)!=1 or members[0].name!='damatong.conf' or not members[0].isfile() or not 0<members[0].size<=1024*1024:
        raise SystemExit('Unexpected Nginx archive member')
    data=archive.extractfile(members[0]).read(1024*1024+1)
    if hashlib.sha256(data).hexdigest()!=sys.argv[3]:raise SystemExit('Nginx payload checksum differs')
    pathlib.Path(sys.argv[2]).write_bytes(data)
PYEXTRACT
mv "$staging/payload" "$candidate"
sudo -n chown root:root "$candidate"
sudo -n chmod 0750 "$candidate"
sudo -n node "$controls_root/deploy/nginx-release.mjs" activate "$candidate/damatong.conf" "$target_sha" "$config_sha256" "$previous_config_hash" "$release_id"
printf 'NGINX_DEPLOYED_OK sha=%s config_sha256=%s\n' "$target_sha" "$config_sha256"
