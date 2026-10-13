import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, '.local-validation/runtime-disk-guard');
mkdirSync(output, { recursive: true });
const script = readFileSync(join(root, 'deploy/deploy-production-from-s3.sh'), 'utf8');
const start = script.indexOf('check_production_disk_staging_headroom() {');
const headroom = script.slice(start, script.indexOf('\n}', start) + 2);

for (const allowed of [true, false])
    test(`runtime ${allowed ? 'allows' : 'refuses'} staging against the combined release and file-backup budget`, () => {
        const result = spawnSync(
            'bash',
            [
                '-c',
                `
set -Eeuo pipefail
previous_runtime=/fixture/current
expected_bucket=fixture-bucket
target_sha=fixture
archive_name=fixture.tar.gz
repository=/fixture/controls
df() { printf '/dev/root 49691512 28006580 21668548 57%% /\\n' | sed '1i\\
Filesystem 1024-blocks Used Available Capacity Mounted\n'; }
du() { printf '612988\\t/fixture/current\\n'; }
aws() { printf '156000'; }
sudo() { printf '3191755364'; }
python3() {
    [[ "$*" == *"vendure-disk-budget.py --maximum 85 stage --archive-bytes 156000 --runtime-bytes ${612988 * 1024} --extra-bytes 3191755364" ]]
    printf 'COMBINED_BUDGET_CHECKED\\n'
    return ${allowed ? 0 : 1}
}
fail() { printf '%s\\n' "$*" >&2; exit 1; }
${headroom}
check_production_disk_staging_headroom
printf 'DOWNLOAD_ALLOWED\\n'
`,
            ],
            { encoding: 'utf8' },
        );
        assert.match(result.stdout, /COMBINED_BUDGET_CHECKED/u);
        assert.equal(result.status, allowed ? 0 : 1, result.stderr);
        assert.equal(result.stdout.includes('DOWNLOAD_ALLOWED'), allowed);
    });

test('native runtime SSM command refuses deployment if protected disk maintenance fails', t => {
    const directory = mkdtempSync(join(output, 'native-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const producer = `
import pathlib,textwrap,os,subprocess
w=pathlib.Path('.github/workflows/deploy_production_runtime.yml').read_text()
s=w.index('                  import base64\\n',w.index('Prepare Systems Manager')) if 'Prepare Systems Manager' in w else w.index('                  import base64\\n')
e=w.index('\\n                  PY',s)
code=textwrap.dedent(w[s:e])
import re
for name in re.findall(r"quote\\('([^']+)'\\)",code):os.environ[name]='fixture'
os.environ['RUNNER_TEMP']=${JSON.stringify(directory)}
base=pathlib.Path(${JSON.stringify(join(directory, 'base'))})
(base/'deploy/systemd').mkdir(parents=True)
(base/'deploy/systemd/vendure-file-backup-retention.py').write_text('print("base fixture")\\n')
subprocess.run(['git','init','-q',str(base)],check=True)
subprocess.run(['git','-C',str(base),'add','.'],check=True)
subprocess.run(['git','-C',str(base),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True)
os.environ['RELEASE_BASE_SHA']=subprocess.check_output(['git','-C',str(base),'rev-parse','HEAD'],text=True).strip()
code=code.replace("Path('.release-base-control')",'Path('+repr(str(base))+')')
code=code.replace("Path('deploy/install-file-retention-repair.py').read_text()",repr('import sys;sys.stdin.buffer.read();print("RETENTION_REPAIR_INSTALLED")'))
exec(compile(code,'workflow-producer','exec'))
`;
    const generated = spawnSync('python3', ['-c', producer], { cwd: root, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const command = JSON.parse(readFileSync(join(directory, 'ssm-parameters.json'))).commands[0];
    const maintenance = join(directory, 'maintenance');
    writeFileSync(maintenance, '#!/bin/bash\nprintf "MAINTENANCE_BLOCKED\\n"\nexit 1\n');
    chmodSync(maintenance, 0o755);
    const adjusted = command
        .replace('/usr/local/sbin/vendure-production-disk-maintenance', maintenance)
        .replace('mktemp /tmp/vendure-production-deploy.XXXXXX', `mktemp ${join(directory, 'deploy-XXXXXX')}`)
        .replace('sudo -H -u ubuntu env ', 'printf "DEPLOY_REACHED\\n"; true ');
    const result = spawnSync('sh', ['-c', adjusted], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /MAINTENANCE_BLOCKED/u);
    assert.ok(!result.stdout.includes('DEPLOY_REACHED'));
});
