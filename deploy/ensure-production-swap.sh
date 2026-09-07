#!/usr/bin/env bash

set -Eeuo pipefail

readonly swap_directory="/var/lib/vendure-memory"
readonly swap_file="${swap_directory}/production.swap"
readonly swap_size_mib=2048
readonly swap_size_bytes=$((swap_size_mib * 1024 * 1024))
readonly minimum_active_swap_mib=2047
readonly minimum_active_swap_bytes=$((minimum_active_swap_mib * 1024 * 1024))
readonly disk_reserve_bytes=$((1024 * 1024 * 1024))
readonly fstab_file="/etc/fstab"
readonly sysctl_file="/etc/sysctl.d/60-vendure-production-memory.conf"

fail() {
    printf 'Production swap setup failed: %s\n' "$1" >&2
    exit 1
}

[[ "$(id -u)" == "0" ]] || fail 'must run as root'
[[ "$(uname -s)" == "Linux" ]] || fail 'requires Linux'

active_swap_bytes() {
    swapon --show=SIZE --bytes --noheadings 2>/dev/null | awk '{ total += $1 } END { print total + 0 }'
}

print_memory_snapshot() {
    local stage="${1}"
    local memory_total_kib
    local memory_available_kib
    memory_total_kib="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
    memory_available_kib="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)"
    printf 'PRODUCTION_SWAP stage=%s total_mib=%s available_mib=%s active_swap_mib=%s\n' \
        "${stage}" \
        "$((memory_total_kib / 1024))" \
        "$((memory_available_kib / 1024))" \
        "$(($(active_swap_bytes) / 1024 / 1024))"
}

configure_swappiness() {
    local temporary_file="${sysctl_file}.tmp.$$"
    trap 'rm -f -- "${temporary_file}"' RETURN
    {
        printf '# Managed by vendure production deployment.\n'
        printf 'vm.swappiness = 10\n'
    } >"${temporary_file}"
    chmod 0644 "${temporary_file}"
    install -o root -g root -m 0644 "${temporary_file}" "${sysctl_file}"
    sysctl --load "${sysctl_file}" >/dev/null
    rm -f -- "${temporary_file}"
    trap - RETURN
}

ensure_fstab_entry() {
    if ! awk -v target="${swap_file}" '$1 == target { found = 1 } END { exit !found }' "${fstab_file}"; then
        printf '%s none swap sw,nofail,pri=-2 0 0\n' "${swap_file}" >>"${fstab_file}"
    fi
}

create_swap_file() {
    local available_disk_bytes
    local temporary_swap="${swap_directory}/.production.swap.$$"

    install -d -o root -g root -m 0700 "${swap_directory}"
    available_disk_bytes="$(df --output=avail -B1 "${swap_directory}" | tail -n 1 | tr -d ' ')"
    [[ "${available_disk_bytes}" =~ ^[0-9]+$ ]] || fail 'could not determine available disk space'
    ((available_disk_bytes >= swap_size_bytes + disk_reserve_bytes)) ||
        fail 'less than 3 GiB is available for the swap file and disk reserve'

    trap 'rm -f -- "${temporary_swap}"' RETURN
    fallocate --length "${swap_size_mib}M" "${temporary_swap}"
    chmod 0600 "${temporary_swap}"
    mkswap "${temporary_swap}" >/dev/null
    mv -- "${temporary_swap}" "${swap_file}"
    trap - RETURN
}

print_memory_snapshot before

if ! swapon --show=NAME --noheadings 2>/dev/null | awk -v target="${swap_file}" '$1 == target { found = 1 } END { exit !found }'; then
    if [[ ! -e "${swap_file}" ]]; then
        create_swap_file
    fi
    [[ -f "${swap_file}" && ! -L "${swap_file}" ]] || fail 'swap path is not a regular file'
    [[ "$(stat --format='%a' "${swap_file}")" == "600" ]] || chmod 0600 "${swap_file}"
    swapon "${swap_file}"
fi

ensure_fstab_entry
configure_swappiness

print_memory_snapshot after
(( $(active_swap_bytes) >= minimum_active_swap_bytes )) ||
    fail 'at least 2047 MiB of active swap is required after filesystem metadata overhead'
printf 'PRODUCTION_SWAP_OK\n'
