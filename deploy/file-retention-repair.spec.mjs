import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, '.local-validation/file-retention-repair');
mkdirSync(output, { recursive: true });

function fixture(t) {
    const directory = mkdtempSync(join(output, 'case-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}

function pythonCase(t, body) {
    const directory = fixture(t);
    const source = `
import importlib.util,os,pathlib,fcntl,hashlib,stat
from unittest import mock
spec=importlib.util.spec_from_file_location('repair',${JSON.stringify(join(root, 'deploy/install-file-retention-repair.py'))})
tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
root=pathlib.Path(${JSON.stringify(directory)}).resolve()
(root/'tools').mkdir();(root/'backups').mkdir();(root/'locks').mkdir()
target=root/'tools/retention.py';deployment=root/'locks/deployment';backup=root/'locks/backup'
deployment.touch(mode=0o600);backup.touch(mode=0o600)
old=b'print("old fixture")\\n';new=b'raise RuntimeError("INSTALL_MUST_NOT_EXECUTE_CANDIDATE")\\n'
target.write_bytes(old);target.chmod(0o755)
old_hash=hashlib.sha256(old).hexdigest();new_hash=hashlib.sha256(new).hexdigest()
recovery=root/'backups/vendure/retention-script-repairs'
options=dict(destination=target,deployment_lock=deployment,backup_lock=backup,
 recovery_directory=recovery,expected_uid=os.getuid(),deployment_uid=os.getuid(),timeout=0)
def install(**kwargs):
 return tool.install_candidate(kwargs.pop('contents',new),kwargs.pop('old_hash',old_hash),
  kwargs.pop('new_hash',new_hash),**{**options,**kwargs})
def blocked(action,reason=None):
 try: action()
 except (tool.InstallError,OSError) as error:
  if reason is not None: assert str(error)==reason,str(error)
 else: raise AssertionError('Expected fail-closed refusal')
${body}
`;
    const result = spawnSync('python3', ['-c', source], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('installs atomically, retains exact old bytes, is idempotent and releases both locks', t => {
    pythonCase(
        t,
        `
before=target.stat().st_ino
report=install();assert report['status']=='updated'
assert target.read_bytes()==new and target.stat().st_ino!=before
assert stat.S_IMODE(target.stat().st_mode)==0o755
saved=recovery/report['recoveryFile'];assert saved.read_bytes()==old
assert stat.S_IMODE(saved.stat().st_mode)==0o600
files=list(recovery.iterdir());inode=target.stat().st_ino
assert install()['status']=='unchanged'
assert list(recovery.iterdir())==files and target.stat().st_ino==inode
for file in (deployment,backup):
 with file.open('rb') as handle: fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert list(target.parent.glob('.vendure-file-retention-*'))==[]
`,
    );
});

test('unknown installed modifications, invalid candidate hash and invalid Python preserve everything', t => {
    pythonCase(
        t,
        `
target.write_bytes(b'private unknown modification\\n')
blocked(install,'installed-hash-not-reviewed')
assert target.read_bytes()==b'private unknown modification\\n' and not recovery.exists()
target.write_bytes(old)
blocked(lambda:install(new_hash='a'*64),'candidate-hash-mismatch')
invalid=b'not valid python !'
blocked(lambda:install(contents=invalid,new_hash=hashlib.sha256(invalid).hexdigest()),'invalid-python-candidate')
assert target.read_bytes()==old and not recovery.exists()
`,
    );
});

test('destination symlinks, hard links, writable files and redirected parent directories are refused', t => {
    pythonCase(
        t,
        `
outside=root/'outside';outside.write_bytes(old)
target.unlink();target.symlink_to(outside)
blocked(install);assert outside.read_bytes()==old
target.unlink();os.link(outside,target)
blocked(install);assert outside.read_bytes()==old
target.unlink();target.write_bytes(old);target.chmod(0o777)
blocked(install);assert target.read_bytes()==old
target.chmod(0o755);link=root/'redirect';link.symlink_to(target.parent,target_is_directory=True)
blocked(lambda:install(destination=link/target.name))
assert target.read_bytes()==old and not recovery.exists()
`,
    );
});

test('both lock contention paths fail before mutation and deployment lock is acquired first', t => {
    pythonCase(
        t,
        `
for file in (deployment,backup):
 with file.open('rb') as handle:
  fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
  blocked(install,'lock-busy')
 assert target.read_bytes()==old and not recovery.exists()
events=[];original=tool.existing_lock
def tracked(file,uid,timeout):
 events.append(file)
 return original(file,uid,timeout)
with mock.patch.object(tool,'existing_lock',side_effect=tracked): install()
assert events==[deployment,backup]
`,
    );
});

test('missing or redirected locks and redirected recovery directories never overwrite targets', t => {
    pythonCase(
        t,
        `
deployment.unlink();blocked(install)
deployment.symlink_to(backup);blocked(install)
deployment.unlink();deployment.touch(mode=0o600)
outside=root/'outside-recovery';outside.mkdir()
recovery.parent.mkdir();recovery.symlink_to(outside,target_is_directory=True)
blocked(install)
assert target.read_bytes()==old and list(outside.iterdir())==[]
`,
    );
});

test('existing mismatched recovery copy or failed atomic replacement stops without losing installed bytes', t => {
    pythonCase(
        t,
        `
recovery.mkdir(parents=True)
saved=recovery/('vendure-file-backup-retention-'+old_hash+'.py')
saved.write_bytes(b'unrelated existing recovery material');saved.chmod(0o600)
blocked(install,'recovery-hash-mismatch')
assert saved.read_bytes()==b'unrelated existing recovery material' and target.read_bytes()==old
saved.write_bytes(old)
with mock.patch.object(tool.os,'replace',side_effect=PermissionError('fixture')): blocked(install)
assert target.read_bytes()==old and saved.read_bytes()==old
assert list(target.parent.glob('.vendure-file-retention-*'))==[]
`,
    );
});

test('a concurrent change after backup is preserved and blocks replacement', t => {
    pythonCase(
        t,
        `
original=tool.write_new
def change(parent,name,contents,mode):
 original(parent,name,contents,mode)
 if name.startswith('.vendure-file-retention-'): target.write_bytes(b'concurrent update\\n')
with mock.patch.object(tool,'write_new',side_effect=change): blocked(install,'installed-file-changed')
assert target.read_bytes()==b'concurrent update\\n'
assert len(list(recovery.iterdir()))==1
assert list(target.parent.glob('.vendure-file-retention-*'))==[]
`,
    );
});

function runtimeCommand(directory, { installerExit = 0, wrongBase = false, realInstaller = false } = {}) {
    const producer = `
import pathlib,textwrap,os,re,subprocess
workflow=pathlib.Path('.github/workflows/deploy_production_runtime.yml').read_text()
start=workflow.index('                  import base64\\n')
end=workflow.index('\\n                  PY',start)
code=textwrap.dedent(workflow[start:end])
for name in re.findall(r"quote\\('([^']+)'\\)",code):os.environ[name]='fixture'
base=pathlib.Path(${JSON.stringify(join(directory, 'base'))})
(base/'deploy/systemd').mkdir(parents=True)
(base/'deploy/systemd/vendure-file-backup-retention.py').write_text('print("base fixture")\\n')
subprocess.run(['git','init','-q',str(base)],check=True)
subprocess.run(['git','-C',str(base),'add','.'],check=True)
subprocess.run(['git','-C',str(base),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True)
os.environ['RELEASE_BASE_SHA']=subprocess.check_output(['git','-C',str(base),'rev-parse','HEAD'],text=True).strip()
${wrongBase ? "os.environ['RELEASE_BASE_SHA']='a'*40" : ''}
os.environ['RUNNER_TEMP']=${JSON.stringify(directory)}
code=code.replace("Path('.release-base-control')",'Path('+repr(str(base))+')')
stub='import sys;sys.stdin.buffer.read();print("REPAIR_ATTEMPTED");sys.exit(${installerExit})'
${realInstaller ? '' : `code=code.replace("Path('deploy/install-file-retention-repair.py').read_text()",repr(stub))`}
exec(compile(code,'workflow-producer','exec'))
`;
    return spawnSync('python3', ['-c', producer], { cwd: root, encoding: 'utf8' });
}

for (const [installerExit, maintenanceExit] of [
    [0, 0],
    [7, 0],
    [0, 9],
]) {
    test(`runtime gate sequencing: installer=${installerExit}, maintenance=${maintenanceExit}`, t => {
        const directory = fixture(t);
        const generated = runtimeCommand(directory, { installerExit });
        assert.equal(generated.status, 0, generated.stderr);
        const maintenance = join(directory, 'maintenance');
        writeFileSync(
            maintenance,
            `#!/bin/bash\nprintf 'MAINTENANCE_ATTEMPTED\\n'\nexit ${maintenanceExit}\n`,
        );
        chmodSync(maintenance, 0o755);
        const command = JSON.parse(readFileSync(join(directory, 'ssm-parameters.json'))).commands[0];
        const prefix = command.slice(0, command.indexOf('\ndeploy_script='));
        assert.ok(prefix.includes('"$disk_maintenance" --apply'));
        const result = spawnSync(
            'sh',
            [
                '-c',
                prefix.replace('/usr/local/sbin/vendure-production-disk-maintenance', maintenance) +
                    "\nprintf 'DEPLOYMENT_START\\n'\nVENDURE_DEPLOY_SCRIPT",
            ],
            { encoding: 'utf8' },
        );
        assert.equal(result.status === 0, installerExit === 0 && maintenanceExit === 0, result.stderr);
        assert.ok(result.stdout.includes('REPAIR_ATTEMPTED'));
        assert.equal(result.stdout.includes('MAINTENANCE_ATTEMPTED'), installerExit === 0);
        assert.equal(
            result.stdout.includes('DEPLOYMENT_START'),
            installerExit === 0 && maintenanceExit === 0,
        );
    });
}

test('transport rejects a checkout which is not the verified release base', t => {
    const directory = fixture(t);
    const result = runtimeCommand(directory, { wrongBase: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Retention source does not match verified release base/u);
});

test('the complete real installer and candidate fit the existing bounded SSM transport', t => {
    const directory = fixture(t);
    const generated = runtimeCommand(directory, { realInstaller: true });
    assert.equal(generated.status, 0, generated.stderr);
    const payload = readFileSync(join(directory, 'ssm-parameters.json'));
    assert.ok(payload.length <= 80_000);
    t.diagnostic(`Complete candidate SSM fixture: ${payload.length} bytes / 80000 byte limit`);
    const command = JSON.parse(payload).commands[0];
    assert.ok(command.includes('installed-hash-not-reviewed'));
    assert.ok(command.includes('/usr/local/sbin/vendure-file-backup-retention.py'));
    const syntax = spawnSync('bash', ['-n'], { input: command, encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
});

test('repair transport remains inside fixed target/base source and does not weaken the mandatory gate', () => {
    const source = readFileSync(join(root, '.github/workflows/deploy_production_runtime.yml'), 'utf8');
    assert.match(source, /ref: \$\{\{ env\.RELEASE_BASE_SHA \}\}/u);
    assert.match(source, /sparse-checkout: deploy\/systemd\/vendure-file-backup-retention\.py/u);
    assert.match(source, /'show', f'\{base_sha\}:\{retention_path\.as_posix\(\)\}'/u);
    assert.ok(source.indexOf("'  ' + repair_command") < source.indexOf('\'  "$disk_maintenance" --apply\''));
    const installer = readFileSync(join(root, 'deploy/install-file-retention-repair.py'), 'utf8');
    assert.ok(!installer.includes('subprocess') && !installer.includes('systemctl'));
});
