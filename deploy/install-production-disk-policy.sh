#!/usr/bin/env bash

set -Eeuo pipefail
readonly source_root="${1:-}"
readonly expected_manifest="${2:-}"
readonly mode="${3:---check}"
[[ "$source_root" == /* && "$source_root" != / && -d "$source_root" && ! -L "$source_root" ]]
[[ "$expected_manifest" =~ ^[a-f0-9]{64}$ ]]
[[ "$mode" == --check || "$mode" == --apply ]]
[[ "$(id -u)" == 0 ]]
[[ -f "$source_root/SHA256SUMS" && ! -L "$source_root/SHA256SUMS" ]]
[[ "$(sha256sum "$source_root/SHA256SUMS" | cut -d ' ' -f 1)" == "$expected_manifest" ]]
(cd "$source_root" && sha256sum --check --status SHA256SUMS)

readonly files=(
    vendure-production-disk-maintenance
    vendure-production-release-retention.cjs
    vendure-frontend-release-retention.cjs
    vendure-file-backup-retention.py
    vendure-file-backup
    vendure-disk-budget.py
    vendure-backup-s3-guard.py
)
readonly dropins=(
    vendure-production-release-retention.service.d/50-disk-budget.conf
    vendure-production-release-retention.path.d/50-disk-budget.conf
    vendure-file-backup-retention.service.d/60-verified-local-count.conf
    vendure-file-backup.service.d/60-bounded-disk.conf
)
for name in "${files[@]}"; do
    [[ -f "$source_root/deploy/systemd/$name" && ! -L "$source_root/deploy/systemd/$name" ]]
    destination_name="$name"
    if [[ "$name" == vendure-file-backup ]]; then destination_name=vendure-file-backup-bounded; fi
    [[ ! -L "/usr/local/sbin/$destination_name" ]]
done
for name in "${dropins[@]}"; do
    [[ -f "$source_root/deploy/systemd/$name" && ! -L "$source_root/deploy/systemd/$name" ]]
    [[ ! -L "/etc/systemd/system/$name" && ! -L "/etc/systemd/system/${name%/*}" ]]
done
printf 'PRODUCTION_DISK_POLICY_VERIFIED manifest_sha256=%s mode=%s\n' "$expected_manifest" "$mode"
if [[ "$mode" == --check ]]; then exit 0; fi

readonly production_lock=/run/lock/vendure-production-deploy.lock
[[ -f "$production_lock" && ! -L "$production_lock" ]]
exec 9<"$production_lock"
flock --exclusive --wait 300 9
readonly backup_directory="/var/backups/vendure/disk-policy-$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -o root -g root -m 0700 "$backup_directory"
for name in "${files[@]}"; do
    destination_name="$name"
    if [[ "$name" == vendure-file-backup ]]; then destination_name=vendure-file-backup-bounded; fi
    destination="/usr/local/sbin/$destination_name"
    if [[ -e "$destination" ]]; then
        [[ -f "$destination" && ! -L "$destination" ]]
        cp -p -- "$destination" "$backup_directory/$destination_name"
    fi
    install -o root -g root -m 0755 "$source_root/deploy/systemd/$name" "$destination"
done
for name in "${dropins[@]}"; do
    destination="/etc/systemd/system/$name"
    if [[ -e "$destination" ]]; then
        [[ -f "$destination" && ! -L "$destination" ]]
        install -d -o root -g root -m 0700 "$backup_directory/${name%/*}"
        cp -p -- "$destination" "$backup_directory/$name"
    fi
    install -d -o root -g root -m 0755 "${destination%/*}"
    install -o root -g root -m 0644 "$source_root/deploy/systemd/$name" "$destination"
done
systemctl daemon-reload
# Close our descriptor before starting a service which takes the same lock.
exec 9<&-
systemctl enable --now vendure-production-release-retention.path
systemctl restart vendure-production-release-retention.path
systemctl enable --now vendure-file-backup-retention.timer
systemctl start vendure-production-release-retention.service
systemctl start vendure-file-backup-retention.service
printf 'PRODUCTION_DISK_POLICY_APPLIED manifest_sha256=%s recovery_directory=%s\n' \
    "$expected_manifest" "$backup_directory"
