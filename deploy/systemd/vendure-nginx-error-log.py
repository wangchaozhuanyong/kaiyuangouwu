#!/usr/bin/env python3
"""Receive Nginx errors in memory; persist only allowlisted diagnostic fields."""
import datetime
import json
import os
import re
import socket

SOCKET_PATH = '/run/vendure-nginx-log/error.sock'
CATEGORIES = (
    ('connect() failed', 'upstream_connect_failed'),
    ('upstream timed out', 'upstream_timeout'),
    ('upstream prematurely closed', 'upstream_closed'),
    ('no live upstreams', 'upstream_unavailable'),
    ('too large', 'size_limit'),
    ('limiting requests', 'request_limit'),
    ('limiting connections', 'connection_limit'),
    ('SSL_do_handshake() failed', 'tls_handshake_failed'),
    ('open() ', 'file_open_failed'),
    ('permission denied', 'permission_denied'),
)


def safe_record(data):
    message = data.decode('utf-8', errors='replace')
    priority = re.match(r'^<(\d{1,3})>', message)
    level = int(priority.group(1)) % 8 if priority else 3
    # Never retain free text, URLs, quoted paths, request headers, or referers.
    # Matching an unknown diagnostic must not fall back to the original message.
    diagnostic = message.split(', client:', 1)[0]
    category = next((name for pattern, name in CATEGORIES if pattern in diagnostic), 'nginx_error')
    errno = re.search(r'\((\d{1,4}):', diagnostic)
    return {
        'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': 'vendure_nginx',
        'severity': level,
        'category': category,
        'errno': int(errno.group(1)) if errno else None,
    }


def main():
    os.umask(0o117)
    if os.path.lexists(SOCKET_PATH):
        os.unlink(SOCKET_PATH)
    receiver = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    receiver.bind(SOCKET_PATH)
    os.chmod(SOCKET_PATH, 0o660)
    print(json.dumps({'source': 'vendure_nginx', 'event': 'receiver_ready'}), flush=True)
    while True:
        packet = receiver.recv(65536)
        print(json.dumps(safe_record(packet), separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
