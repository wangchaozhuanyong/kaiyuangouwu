"""Run domain acceptance against a new disposable MySQL container, never an existing database."""
import os
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parents[3]
docker = shutil.which('docker') or str(Path.home() / '.local/bin/docker')
bun = shutil.which('bun') or str(Path.home() / '.bun/bin/bun')
name = 'vendure-digital-domains-' + secrets.token_hex(4)
password = secrets.token_urlsafe(32)
environment = dict(os.environ, MYSQL_ROOT_PASSWORD=password, MYSQL_PWD=password)
result = 1
try:
    subprocess.run([docker, 'run', '--detach', '--name', name, '--tmpfs', '/var/lib/mysql:rw,size=1g', '--publish', '127.0.0.1::3306', '--env', 'MYSQL_ROOT_PASSWORD', 'mysql:8.4'], env=environment, check=True, stdout=subprocess.DEVNULL)
    print('Independent MySQL test container created.', flush=True)
    for _ in range(50):
        ready = subprocess.run([docker, 'exec', '--env', 'MYSQL_PWD', name, 'mysql', '-uroot', '--execute', 'SELECT 1'], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if ready.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Isolated MySQL did not become ready')
    port = subprocess.check_output([docker, 'port', name, '3306/tcp'], text=True).strip().rsplit(':', 1)[1]
    environment.update(DIGITAL_QA_MYSQL='isolated-container', DIGITAL_QA_PORT=port, DIGITAL_QA_PASSWORD=password)
    child = subprocess.Popen([bun, 'x', 'vitest', 'run', '--config', '../../e2e-common/vitest.config.mts', 'e2e/product-domains.e2e-spec.ts', *sys.argv[1:]], cwd=root / 'packages/commerce-fulfillment-plugin', env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in child.stdout:
        print(line.replace(password, '[redacted]'), end='', flush=True)
    result = child.wait()
finally:
    subprocess.run([docker, 'rm', '--force', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print('Independent MySQL test container removed.', flush=True)
sys.exit(result)
