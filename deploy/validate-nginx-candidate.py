#!/usr/bin/env python3
"""Validate the production HTTP snippet without touching live Nginx temp paths."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit

TEMP_KINDS = ('client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi')
LIVE_TEMP_PATHS = tuple(Path('/var/lib/nginx') / name for name in ('body', *TEMP_KINDS[1:]))
VAULT_FRAME_INCLUDE = '/etc/nginx/customer-vault-frames/*.map'


def vault_frame_entries(directory):
    """Inline only exact host/origin pairs, never execute a live Nginx include."""
    if directory.is_symlink():
        raise ValueError('Vault frame directory must not be a symlink')
    entries = {}
    for file in sorted(directory.glob('*.map')):
        if file.is_symlink() or not file.is_file() or file.stat().st_size > 65536:
            raise ValueError('Invalid vault frame map file')
        for line in file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            match = re.fullmatch(r'([a-zA-Z0-9.-]+)\s+"(https://[a-zA-Z0-9.:-]+)";', line)
            if not match:
                raise ValueError('Vault frame map must contain only exact HTTPS origins')
            host, origin = match.groups()
            url = urlsplit(origin)
            if (host.lower() in ('default', 'hostnames', 'volatile', 'include') or
                    not url.hostname or url.port == 0 or
                    any(not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?', label)
                        for name in (host, url.hostname) for label in name.split('.'))):
                raise ValueError('Invalid vault frame hostname')
            host = host.lower()
            if host in entries:
                raise ValueError('Duplicate vault frame host')
            entries[host] = origin
    return '\n'.join(f'{host} "{origin}";' for host, origin in entries.items())


def live_metadata():
    return {str(p): (p.stat().st_uid, p.stat().st_gid, p.stat().st_mode, p.stat().st_ctime_ns)
            for p in LIVE_TEMP_PATHS}


def candidate_config(source, root, frame_directory=Path('/etc/nginx/customer-vault-frames')):
    if re.search(r'(?m)^\s*(?:client_body|proxy|fastcgi|uwsgi|scgi)_temp_path\s', source):
        raise ValueError('Candidate defines temp paths; review isolation before validation')
    includes = [value.strip() for value in re.findall(r'(?m)^\s*include\s+([^;]+);', source)]
    if any(value not in ('proxy_params', '/etc/nginx/proxy_params', VAULT_FRAME_INCLUDE)
           for value in includes):
        raise ValueError('Candidate contains an unreviewed include')
    if VAULT_FRAME_INCLUDE in includes:
        entries = vault_frame_entries(frame_directory)
        source = re.sub(r'(?m)^\s*include\s+' + re.escape(VAULT_FRAME_INCLUDE) + r'\s*;',
                        lambda _: entries, source)
    source = source.replace('include proxy_params;', 'include /etc/nginx/proxy_params;')
    source = re.sub(r'(?m)^\s*access_log\s+[^;]+;', '    access_log off;', source)
    source = re.sub(r'(?m)^\s*error_log\s+[^;]+;', f'    error_log {root / "error.log"};', source)
    paths = ''.join(f'{kind}_temp_path {root / kind};\n' for kind in TEMP_KINDS)
    return (
        f'user www-data;\npid {root / "nginx.pid"};\nerror_log {root / "error.log"};\n'
        'events {}\nhttp {\naccess_log off;\ninclude /etc/nginx/mime.types;\n'
        + paths + source + '\n}\n'
    )


def validate_candidate(source):
    # nginx -t creates/chowns configured paths even though it does not start workers.
    before = live_metadata()
    with tempfile.TemporaryDirectory(prefix='vendure-nginx-candidate-') as directory:
        root = Path(directory)
        config = root / 'nginx.conf'
        config.write_text(candidate_config(source, root))
        result = subprocess.run(
            ['nginx', '-t', '-p', directory + '/', '-c', str(config)], capture_output=True,
        )
        if before != live_metadata():
            raise RuntimeError('Production temp directory metadata changed unexpectedly')
        # Nginx errors can contain request paths; never persist raw output here.
        return {'exitCode': result.returncode, 'productionTempDirectoriesUnchanged': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path, help='Reviewed production HTTP-context snippet')
    args = parser.parse_args()
    result = validate_candidate(args.candidate.read_text())
    print(json.dumps(result))
    return result['exitCode']


if __name__ == '__main__':
    raise SystemExit(main())
