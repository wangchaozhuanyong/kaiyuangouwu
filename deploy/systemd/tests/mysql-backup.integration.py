#!/usr/bin/env python3
"""Run only against an explicitly selected local audit container with synthetic data.

python3 deploy/systemd/tests/mysql-backup.integration.py \
  --container vendure-data-audit-mysql-20260913 --output reports/nonblocking-backup-20260913
Requires the audit container's MySQL client, Python 3, GNU timeout and flock.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser()
parser.add_argument("--container", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
if not args.container.startswith("vendure-data-audit-"):
    raise SystemExit("Use a dedicated local audit container, never a production MySQL instance")
output = (ROOT / args.output).resolve()
if ROOT not in output.parents:
    raise SystemExit("Evidence must stay inside this project")
for directory in ("logs", "results", "fixtures"):
    (output / directory).mkdir(parents=True, exist_ok=True)
stamp = uuid.uuid4().hex[:12]
database = "vendure_backup_test_" + stamp
remote = "/vendure-backup-test-" + stamp
restore_database = "vendure_restore_drill_" + stamp
stage = output / "fixtures" / stamp
stage.mkdir()
for directory in ("bin", "backups", "evidence", "tmp"):
    (stage / directory).mkdir()
for name in ("vendure-mysql-backup", "vendure-mysql-restore-drill", "vendure-mysql-backup-manifest.py"):
    shutil.copy2(ROOT / "deploy/systemd" / name, stage / name)
for name in ("mysql", "mysqldump"):
    wrapper = stage / "bin" / name
    wrapper.write_text('#!/bin/bash\nunset MYSQL_PWD\nexec /usr/bin/' + name + ' "$@"\n')
    wrapper.chmod(0o755)
(stage / "fixture.env").write_text("DB_HOST=127.0.0.1\nDB_PORT=3306\nDB_USERNAME=root\n"
                                 "DB_PASSWORD=unused-synthetic-placeholder\nDB_NAME=" + database + "\n")
(stage / "setup.sql").write_text((Path(__file__).with_name("mysql-backup-fixtures.sql"))
                                 .read_text().replace("__TEST_DATABASE__", database))
env = ["PATH=" + remote + "/bin:/usr/bin:/bin", "DB_HOST=127.0.0.1", "DB_PORT=3306",
       "DB_USERNAME=root", "DB_PASSWORD=unused-synthetic-placeholder", "DB_NAME=" + database,
       "VENDURE_ENV_FILE=" + remote + "/fixture.env", "VENDURE_BACKUP_DIR=" + remote + "/backups",
       "VENDURE_READINESS_EVIDENCE_DIR=" + remote + "/evidence", "TMPDIR=" + remote + "/tmp"]
docker = ["docker", "exec", "-i"]
for value in env:
    docker += ["-e", value]
docker += [args.container]
results = []


def run(command, data=None, timeout=180):
    return subprocess.run(docker + command, input=data, capture_output=True, timeout=timeout)


def sql(statement, db=None, timeout=10):
    p = run(["mysql", "--batch", "--skip-column-names", *([db] if db else [])],
            statement.encode(), timeout)
    if p.returncode:
        raise RuntimeError(p.stderr.decode())
    return p.stdout.decode().strip()


def check(name, passed, **details):
    results.append({"case": name, "passed": bool(passed), **details})
    (output / "results" / "backup-integration.json").write_text(json.dumps(results, indent=2))
    if not passed:
        raise AssertionError(name + ": " + json.dumps(details))


def save_log(name, p):
    (output / "logs" / (name + ".log")).write_bytes(p.stdout + p.stderr)


def restore(name, backup, expected_success=True):
    sql("CREATE DATABASE `" + restore_database + "` CHARACTER SET utf8mb4")
    try:
        p = run(["bash", "-c", 'gzip -dc "$1" | mysql "$2"', "restore", backup, restore_database])
        save_log(name + "-import", p)
        check(name + "-import", p.returncode == 0, exitCode=p.returncode)
        verified = run(["python3", remote + "/vendure-mysql-backup-manifest.py", "verify",
                        restore_database, backup + ".manifest.json"])
        save_log(name, verified)
        check(name, (verified.returncode == 0) == expected_success, exitCode=verified.returncode)
        if expected_success:
            return sql("SELECT stock FROM inventory WHERE id=1; SELECT COUNT(*) FROM orders; "
                       "SELECT COUNT(*) FROM ledger; SELECT COUNT(*) FROM trigger_audit; "
                       "SELECT stock FROM stock_view WHERE id=1; CALL stored_sample();", restore_database)
    finally:
        sql("DROP DATABASE `" + restore_database + "`")


try:
    subprocess.run(["docker", "cp", str(stage), args.container + ":" + remote], check=True,
                   stdout=subprocess.DEVNULL)
    sql((stage / "setup.sql").read_text(), timeout=60)
    baseline = sql("SELECT stock FROM inventory WHERE id=1; SELECT COUNT(*) FROM orders; "
                   "SELECT COUNT(*) FROM ledger; SELECT COUNT(*) FROM trigger_audit; "
                   "SELECT stock FROM stock_view WHERE id=1; CALL stored_sample();", database)
    # Pause at the real read-view boundary, then run independent writers while the transaction is open.
    probe = """
import importlib.util,signal,sys,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('backup',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
signal.signal(signal.SIGTERM,lambda *_:sys.exit(124))
original=m.read_snapshot
def boundary(session):
    original(session)
    print('SNAPSHOT_READY',flush=True)
    if not sys.stdin.readline(): raise RuntimeError('Missing test release')
m.read_snapshot=boundary
m.capture(sys.argv[2])
"""
    probe_process = subprocess.Popen(docker + ["python3", "-c", probe,
                                     remote + "/vendure-mysql-backup-manifest.py",
                                     remote + "/backups/online.sql.gz"],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    check("snapshot-created", probe_process.stdout.readline().strip() == b"SNAPSHOT_READY")
    writer_sql = ("START TRANSACTION; UPDATE inventory SET stock=stock-1 WHERE id=1; "
                  "INSERT INTO orders(qty) VALUES(1); SET @oid=LAST_INSERT_ID(); "
                  "INSERT INTO ledger(orderId,qty) VALUES(@oid,1); COMMIT;")
    # A queued schema change must not turn the backup into a business write freeze.
    ddl = subprocess.Popen(docker + ["mysql", database], stdin=subprocess.PIPE,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    ddl.stdin.write(b"SET SESSION lock_wait_timeout=1; ALTER TABLE inventory ADD COLUMN blocked INT;\n")
    ddl.stdin.close()
    latencies = []
    for _ in range(20):
        started = time.monotonic()
        sql(writer_sql, database, timeout=3)
        latencies.append((time.monotonic() - started) * 1000)
    ddl.wait(timeout=5)
    ddl_error = ddl.stderr.read()
    check("schema-change-blocked-business-writes-allowed",
          ddl.returncode != 0 and b"Lock wait timeout" in ddl_error and max(latencies) < 3000,
          writes=len(latencies), maxLatencyMs=round(max(latencies), 2))
    during_export = []
    errors = []

    def writing():
        try:
            for _ in range(50):
                if probe_process.poll() is not None:
                    break
                started = time.monotonic()
                sql(writer_sql, database, timeout=3)
                during_export.append((time.monotonic() - started) * 1000)
        except Exception as error:
            errors.append(str(error))

    worker = threading.Thread(target=writing)
    worker.start()
    probe_process.stdin.write(b"continue\n")
    probe_process.stdin.flush()
    probe_process.wait(timeout=180)
    worker.join(timeout=10)
    (output / "logs" / "concurrent-capture.log").write_bytes(probe_process.stderr.read())
    check("capture-completes-under-concurrent-writes",
          probe_process.returncode == 0 and not errors and bool(during_export),
          exitCode=probe_process.returncode, concurrentWrites=len(during_export), errors=errors,
          p50LatencyMs=round(statistics.median(during_export), 2) if during_export else None,
          maxLatencyMs=round(max(during_export), 2) if during_export else None)
    restored = restore("concurrent-snapshot-data", remote + "/backups/online.sql.gz")
    check("snapshot-cross-table-view-trigger-and-procedure-consistency", restored == baseline)
    current = sql("SELECT stock FROM inventory WHERE id=1; SELECT COUNT(*) FROM orders", database)
    check("live-data-continued-changing", current.splitlines()[0] != baseline.splitlines()[0],
          committedWrites=20 + len(during_export))

    # Corrupt only the SQL payload; preserve the independently recorded source manifest.
    for case in ("schema-only", "wrong-value", "wrong-generated-expression", "wrong-auto-increment",
                 "wrong-collation", "wrong-enum-literal", "missing-manifest"):
        mutate = r"""
from pathlib import Path
import gzip,re,shutil,sys
p=Path(sys.argv[1]);out=Path(sys.argv[2]);case=sys.argv[3]
s=gzip.decompress(p.read_bytes())
if case=='schema-only': s=b'\n'.join(x for x in s.split(b'\n') if not x.startswith(b'INSERT INTO '))
if case=='wrong-value':
    old=b"CONVERT(X'3130303030' USING utf8mb4)"
    lines=s.split(b'\n')
    matched=[i for i,line in enumerate(lines) if line.startswith(b'INSERT INTO `inventory`') and old in line]
    assert len(matched)==1
    lines[matched[0]]=lines[matched[0]].replace(old,b"CONVERT(X'3130303031' USING utf8mb4)",1)
    s=b'\n'.join(lines)
if case=='wrong-generated-expression':
    old=b"(`stock` * 2)"; assert old in s
    s=s.replace(old,b"(`stock` * 3)",1)
if case=='wrong-auto-increment':
    old=b"AUTO_INCREMENT=8001"; assert s.count(old)==2
    s=s.replace(old,b"AUTO_INCREMENT=3")
if case=='wrong-collation':
    s,count=re.subn(rb"(`label` varchar\(100\)(?: CHARACTER SET utf8mb4)? COLLATE )utf8mb4_unicode_ci",
                    rb"\1utf8mb4_bin",s)
    assert count==1
if case=='wrong-enum-literal':
    old=b"enum('a','CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')"; assert s.count(old)==1
    s=s.replace(old,b"enum('a','COLLATE utf8mb4_unicode_ci')")
out.write_bytes(gzip.compress(s))
if case!='missing-manifest': shutil.copy2(str(p)+'.manifest.json',str(out)+'.manifest.json')
"""
        p = run(["python3", "-c", mutate, remote + "/backups/online.sql.gz",
                 remote + "/backups/" + case + ".sql.gz", case])
        check(case + "-fixture", p.returncode == 0, stderr=p.stderr.decode())
        restore(case, remote + "/backups/" + case + ".sql.gz", False)

    # No fallback to long global read locks for engines with no MVCC snapshot.
    sql("CREATE TABLE unsupported_engine(id INT) ENGINE=MyISAM", database)
    p = run(["python3", remote + "/vendure-mysql-backup-manifest.py", "capture",
             remote + "/backups/non-transactional.sql.gz"])
    save_log("non-transactional-engine", p)
    check("non-transactional-engine-rejected", p.returncode != 0 and b"Non-transactional" in p.stderr)
    sql("DROP TABLE unsupported_engine", database)

    # Terminate while a read view and DDL guard are active; the configured production path uses 15m.
    timeout_probe = probe.replace("if not sys.stdin.readline(): raise RuntimeError('Missing test release')",
                                  "time.sleep(20)")
    p = run(["timeout", "--kill-after=2s", "2s", "python3", "-c", timeout_probe,
             remote + "/vendure-mysql-backup-manifest.py", remote + "/backups/timeout.sql.gz"], timeout=10)
    save_log("snapshot-timeout", p)
    check("timeout-fails-closed", p.returncode == 124, exitCode=p.returncode)
    sql("SET SESSION lock_wait_timeout=2; ALTER TABLE inventory ADD COLUMN released INT; "
        "ALTER TABLE inventory DROP COLUMN released; " + writer_sql, database, timeout=5)
    check("timeout-releases-ddl-guard-and-connections", True)

    # The MySQL client must not silently reconnect and continue without the original read view.
    disconnected_probe = probe.replace("print('SNAPSHOT_READY',flush=True)",
                                       "print(session.execute('SELECT CONNECTION_ID()')[0].decode(),flush=True)")
    disconnected = subprocess.Popen(docker + ["python3", "-c", disconnected_probe,
                                    remote + "/vendure-mysql-backup-manifest.py",
                                    remote + "/backups/disconnected.sql.gz"],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    connection_id = int(disconnected.stdout.readline().strip())
    sql("KILL CONNECTION " + str(connection_id))
    disconnected.stdin.write(b"continue\n")
    disconnected.stdin.flush()
    disconnected.wait(timeout=10)
    (output / "logs" / "disconnected-session.log").write_bytes(disconnected.stderr.read())
    check("lost-connection-does-not-reconnect-with-a-different-snapshot",
          disconnected.returncode != 0 and
          run(["test", "-e", remote + "/backups/disconnected.sql.gz.manifest.json"]).returncode != 0)
    sql("SET SESSION lock_wait_timeout=2; ALTER TABLE inventory ADD COLUMN disconnected_release INT; "
        "ALTER TABLE inventory DROP COLUMN disconnected_release", database, timeout=5)
    check("failed-export-releases-ddl-guard", True)

    # The deployed Bash caller must create checksums and complete the scheduled restore drill.
    p = run(["bash", remote + "/vendure-mysql-backup"])
    save_log("native-backup-command", p)
    check("native-backup-command", p.returncode == 0, exitCode=p.returncode)
    # Simulate a newer export that has not published its checksum completion marker.
    p = run(["python3", "-c", "from pathlib import Path; import sys; "
             "Path(sys.argv[1]).write_bytes(b'incomplete')",
             remote + "/backups/vendure-20990101T000000Z.sql.gz"])
    check("in-progress-backup-fixture", p.returncode == 0)
    p = run(["bash", remote + "/vendure-mysql-restore-drill"])
    save_log("native-restore-command", p)
    check("native-restore-command", p.returncode == 0, exitCode=p.returncode)
    held = subprocess.Popen(docker + ["bash", "-c",
                            'exec 8>"$1/.backup.lock"; flock --exclusive 8; printf "LOCKED\n"; read -r release',
                            "hold", remote + "/backups"],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        check("backup-file-lock-held", held.stdout.readline().strip() == b"LOCKED")
        p = run(["bash", remote + "/vendure-mysql-backup"])
        check("overlapping-backup-rejected", p.returncode != 0 and b"already running" in p.stderr)
    finally:
        held.stdin.write(b"release\n")
        held.stdin.flush()
        held.wait(timeout=5)
    check("temporary-restore-database-removed",
          sql("SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name="
              "'" + restore_database + "'") == "0")
finally:
    # Keep the source fixture and backups for inspection; terminate only this test's capture if necessary.
    if "probe_process" in globals() and probe_process.poll() is None:
        probe_process.stdin.close()
        probe_process.wait(timeout=10)
    subprocess.run(["docker", "cp", args.container + ":" + remote + "/.",
                    str(stage / "executed")], check=False, stdout=subprocess.DEVNULL)
    (output / "results" / "test-context.json").write_text(json.dumps({
        "container": args.container, "syntheticDatabase": database, "fixtureDirectory": str(stage),
        "allPassed": all(item["passed"] for item in results),
    }, indent=2))

print(json.dumps(results, indent=2))
