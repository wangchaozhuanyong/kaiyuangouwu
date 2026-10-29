#!/usr/bin/env bash

# Source only while holding the production deployment lock. The caller installs
# its EXIT cleanup before pausing, and calls restore on success and failure.
# The host's signature updater stops clamd and its worker to bound memory use;
# it must finish before deployment changes either runtime or image processes.
image_signature_timer_restore=0

pause_image_signature_updates() {
    local load_state timer_state update_state deadline
    load_state="$(sudo -n systemctl show vendure-image-signature-update.timer -p LoadState --value)" || return 1
    if [[ "${load_state}" == not-found ]]; then
        printf 'PRODUCTION_IMAGE_UPDATE_GUARD timer=not-installed\n'
        return 0
    fi
    [[ "${load_state}" == loaded ]] || return 1
    timer_state="$(sudo -n systemctl show vendure-image-signature-update.timer -p ActiveState --value)" || return 1
    case "${timer_state}" in
        active|activating)
            image_signature_timer_restore=1
            sudo -n systemctl stop vendure-image-signature-update.timer || return 1
            ;;
        inactive|failed) ;;
        *) return 1 ;;
    esac
    # Stopping a timer does not stop an update already running. Never interrupt
    # that update or reset antivirus startup limits to force a deployment.
    deadline=$(( $(date +%s) + 600 ))
    while true; do
        update_state="$(sudo -n systemctl show vendure-image-signature-update.service -p ActiveState --value)" || return 1
        case "${update_state}" in
            inactive|failed) break ;;
            active|activating|deactivating|reloading) ;;
            *) return 1 ;;
        esac
        if (( $(date +%s) >= deadline )); then
            printf 'PRODUCTION_IMAGE_UPDATE_GUARD update=timeout\n' >&2
            return 1
        fi
        sleep 1
    done
    sudo -n systemctl is-active --quiet vendure-clamd.service || return 1
    sudo -n systemctl is-active --quiet vendure-image-worker.service || return 1
    printf 'PRODUCTION_IMAGE_UPDATE_GUARD update=quiescent\n'
}

restore_image_signature_updates() {
    if [[ "${image_signature_timer_restore:-0}" == 1 ]]; then
        sudo -n systemctl start vendure-image-signature-update.timer || return 1
        image_signature_timer_restore=0
        printf 'PRODUCTION_IMAGE_UPDATE_GUARD timer=restored\n'
    fi
}
