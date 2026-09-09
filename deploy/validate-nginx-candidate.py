#!/usr/bin/env python3
"""Validate the production HTTP snippet without touching live Nginx temp paths."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

TEMP_KINDS = ('client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi')
LIVE_TEMP_PATHS = tuple(Path('/var/lib/nginx') / name for name in ('body', *TEMP_KINDS[1:]))


def live_metadata():
    return {str(p): (p.stat().st_uid, p.stat().st_gid, p.stat().st_mode, p.stat().st_ctime_ns)
            for p in LIVE_TEMP_PATHS}


def candidate_config(source, root):
    if re.search(r'(?m)^\s*(?:client_body|proxy|fastcgi|uwsgi|scgi)_temp_path\s', source):
        raise ValueError('Candidate defines temp paths; review isolation before validation')
    includes = re.findall(r'(?m)^\s*include\s+([^;]+);', source)
    if any(value.strip() not in ('proxy_params', '/etc/nginx/proxy_params') for value in includes):
        raise ValueError('Candidate contains an unreviewed include')
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
