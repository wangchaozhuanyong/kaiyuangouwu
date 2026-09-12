#!/usr/bin/env python3
"""Record-level backup proof from one non-locking InnoDB read snapshot.

Only counts and SHA-256 digests are persisted in the manifest, never row contents.
The restore comparison uses the backup-time manifest, not the changing live database.
"""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import tempfile


def client(root=False):
    return (["--protocol=socket", "--user=root"] if root else [
        "--host=" + os.environ["DB_HOST"], "--port=" + os.environ["DB_PORT"],
        "--user=" + os.environ["DB_USERNAME"],
    ])


def environment(root=False):
    env = dict(os.environ)
    env.pop("MYSQL_PWD", None)
    if not root:
        env["MYSQL_PWD"] = os.environ["DB_PASSWORD"]
    return env


def query(database, sql, root=False):
    return subprocess.check_output(
        ["mysql", *client(root), "--batch", "--skip-column-names", database, "--execute=" + sql],
        env=environment(root), text=True,
    ).strip()


def legacy_manifest(database, root=False):
    names = query(database, "SELECT TABLE_NAME FROM information_schema.tables "
                  "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME", root)
    result = {}
    for table in names.splitlines():
        if not table or any(c in table for c in "\n\r\t"):
            raise RuntimeError("Unsupported table name")
        count = int(query(database, "SELECT COUNT(*) FROM `" + table.replace("`", "``") + "`", root))
        # One INSERT per record, including duplicates. Sort row hashes so heap-table order is irrelevant.
        with tempfile.TemporaryDirectory(prefix="manifest-", dir=os.environ.get("TMPDIR")) as temp:
            row_hashes = Path(temp) / "rows"
            with row_hashes.open("wb") as hashes:
                proc = subprocess.Popen([
                    "mysqldump", *client(root), "--no-create-info", "--skip-triggers",
                    "--skip-extended-insert", "--complete-insert", "--hex-blob",
                    "--skip-comments", "--compact", "--skip-lock-tables",
                    "--set-gtid-purged=OFF", "--no-tablespaces", database, table,
                ], env=environment(root), stdout=subprocess.PIPE)
                rows = 0
                for line in proc.stdout:
                    if line.startswith(b"INSERT INTO "):
                        hashes.write(hashlib.sha256(line.rstrip(b"\r\n")).hexdigest().encode() + b"\n")
                        rows += 1
                if proc.wait() or rows != count:
                    raise RuntimeError("Source row export mismatch for " + table)
            digest = hashlib.sha256()
            sorter = subprocess.Popen(["sort", str(row_hashes)], stdout=subprocess.PIPE,
                                      env={**os.environ, "LC_ALL": "C", "TMPDIR": temp})
            for chunk in iter(lambda: sorter.stdout.read(1024 * 1024), b""):
                digest.update(chunk)
            if sorter.wait():
                raise RuntimeError("Row digest sorting failed")
        result[table] = {"rows": count, "sha256": digest.hexdigest()}
    if not result:
        raise RuntimeError("Refusing to verify an empty schema")
    return {"version": 1, "tables": result}


class Session:
    """Keep all COUNT and data SELECT statements on the same connection and read view."""

    def __init__(self, database=None, root=False):
        self.process = subprocess.Popen([
            "mysql", *client(root), "--batch", "--raw", "--quick", "--skip-column-names",
            "--unbuffered", "--binary-mode", "--skip-reconnect", "--default-character-set=utf8mb4",
            *([database] if database else []),
        ], env=environment(root), stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        # Disconnecting rolls back the read-only transaction and releases metadata/backup locks.
        self.process.terminate()
        self.process.wait()
        self.process.stdin.close()
        self.process.stdout.close()

    def rows(self, sql):
        marker = ("vendure_end_" + secrets.token_hex(16)).encode()
        self.process.stdin.write(sql.encode() + b";\nSELECT '" + marker + b"';\n")
        self.process.stdin.flush()
        for line in self.process.stdout:
            line = line.rstrip(b"\r\n")
            if line == marker:
                return
            yield line
        raise RuntimeError("MySQL snapshot session ended before completing a query")

    def execute(self, sql):
        return list(self.rows(sql))


def identifier(value):
    if not value or any(c in value for c in "\x00\n\r\t"):
        raise RuntimeError("Unsupported database identifier")
    return "`" + value.replace("`", "``") + "`"


def literal(value):
    return "CONVERT(X'" + value.encode().hex() + "' USING utf8mb4)"


def table_columns(session, table):
    rows = session.execute(
        "SELECT COLUMN_NAME, DATA_TYPE, EXTRA FROM information_schema.columns "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = " + literal(table) + " ORDER BY ORDINAL_POSITION"
    )
    binary_types = {"binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob", "bit"}
    supported = binary_types | {
        "tinyint", "smallint", "mediumint", "int", "bigint", "decimal", "float", "double",
        "date", "datetime", "timestamp", "time", "year", "char", "varchar",
        "tinytext", "text", "mediumtext", "longtext", "enum", "set", "json",
    }
    columns = []
    for row in rows:
        name, data_type, extra = row.decode().split("\t")
        identifier(name)
        if "VIRTUAL GENERATED" in extra or "STORED GENERATED" in extra:
            continue
        if data_type not in supported:
            raise RuntimeError("Unsupported backup data type: " + data_type)
        columns.append({"name": name, "type": data_type, "binary": data_type in binary_types})
    if not columns:
        raise RuntimeError("No writable columns in " + table)
    return columns


def snapshot_manifest(session, target=None):
    """Count independently, stream every row, and hash the canonical column values."""
    tables = session.execute(
        "SELECT TABLE_NAME, ENGINE FROM information_schema.tables "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    )
    result = {}
    for item in tables:
        table, engine = item.decode().split("\t")
        if engine != "InnoDB":
            raise RuntimeError("Non-transactional backup table is not supported: " + table)
        quoted = identifier(table)
        columns = table_columns(session, table)
        definition = stable_schema(b"\n".join(session.execute("SHOW CREATE TABLE " + quoted)))
        count = int(session.execute("SELECT COUNT(*) FROM " + quoted)[0])
        expressions = [
            "HEX(" + (identifier(c["name"]) if c["binary"] else
                       "CAST(" + identifier(c["name"]) + " AS CHAR CHARACTER SET utf8mb4)") + ")"
            for c in columns
        ]
        prefix = ("INSERT INTO " + quoted + " (" + ",".join(identifier(c["name"]) for c in columns)
                  + ") VALUES (").encode()
        with tempfile.TemporaryDirectory(prefix="manifest-", dir=os.environ.get("TMPDIR")) as temp:
            row_hashes = Path(temp) / "rows"
            rows = 0
            with row_hashes.open("wb") as hashes:
                for row in session.rows("SELECT " + ",".join(expressions) + " FROM " + quoted):
                    fields = row.split(b"\t")
                    if len(fields) != len(columns):
                        raise RuntimeError("Incomplete snapshot row")
                    values = []
                    for value, column in zip(fields, columns):
                        if value == b"NULL":
                            values.append(b"NULL")
                        elif column["type"] == "bit":
                            values.append(("b'" + format(int(value, 16), "b") + "'").encode())
                        else:
                            # Decode validates framing before a value is written into executable SQL.
                            bytes.fromhex(value.decode("ascii"))
                            encoded = b"X'" + value + b"'"
                            values.append(encoded if column["binary"] else
                                          b"CONVERT(" + encoded + b" USING utf8mb4)")
                    if target:
                        target.write(prefix + b",".join(values) + b");\n")
                    hashes.write(hashlib.sha256(row).hexdigest().encode() + b"\n")
                    rows += 1
            if count != rows:
                raise RuntimeError("Snapshot row count mismatch for " + table)
            digest = hashlib.sha256()
            with row_hashes.open("rb") as source:
                sorter = subprocess.Popen(["sort"], stdin=source, stdout=subprocess.PIPE,
                                          env={**os.environ, "LC_ALL": "C", "TMPDIR": temp})
                for chunk in iter(lambda: sorter.stdout.read(1024 * 1024), b""):
                    digest.update(chunk)
                if sorter.wait():
                    raise RuntimeError("Row digest sorting failed")
            result[table] = {"rows": rows, "sha256": digest.hexdigest(), "columns": columns,
                             "definitionSha256": hashlib.sha256(definition).hexdigest()}
    if not result:
        raise RuntimeError("Refusing to verify an empty schema")
    counters = {}
    for row in session.execute("SELECT TABLE_NAME, AUTO_INCREMENT FROM information_schema.tables "
                               "WHERE TABLE_SCHEMA = DATABASE() AND AUTO_INCREMENT IS NOT NULL"):
        table, counter = row.decode().split("\t")
        counters[table] = int(counter)
    return {"version": 2, "tables": result, "autoIncrement": counters}


def read_snapshot(session):
    session.execute("SET SESSION time_zone = '+00:00'; "
                    "SET SESSION information_schema_stats_expiry = 0; "
                    "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ; "
                    "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY")


def schema_dump(database, after_data=False):
    # Native mysqldump retains indexes, constraints, generated expressions, views and stored programs.
    # Triggers are installed AFTER data, so restore does not fire them a second time.
    options = (["--no-create-info", "--routines", "--triggers", "--events"] if after_data else
               ["--skip-routines", "--skip-triggers", "--skip-events"])
    return subprocess.check_output([
        "mysqldump", *client(), "--no-data", "--skip-comments", "--set-gtid-purged=OFF",
        "--no-tablespaces", "--skip-lock-tables", *options, database,
    ], env=environment())


def stable_schema(schema):
    # INSERT can advance this counter during a valid online backup without changing table definitions.
    return re.sub(rb"(?m)(^\) ENGINE=[^\n]*?) AUTO_INCREMENT=\d+(?= |;)", rb"\1", schema)


def capture(output):
    if os.environ["DB_HOST"] not in ("localhost", "127.0.0.1", "::1"):
        raise RuntimeError("Snapshot capture requires the local MySQL source")
    database = os.environ["DB_NAME"]
    with Session(root=True) as guard, Session(database) as source:
        if guard.execute("SELECT @@server_uuid") != source.execute("SELECT @@server_uuid"):
            raise RuntimeError("Backup guard and source must connect to the same MySQL instance")
        # MySQL 8 BACKUP_ADMIN lock blocks destructive DDL, while INSERT/UPDATE/DELETE can proceed.
        guard.execute("SET SESSION lock_wait_timeout = 5; LOCK INSTANCE FOR BACKUP")
        before_schema = schema_dump(database)
        after_schema = schema_dump(database, after_data=True)
        read_snapshot(source)
        with gzip.open(output, "wb", compresslevel=6) as target:
            target.write(before_schema)
            target.write(b"\nSET NAMES utf8mb4; SET time_zone='+00:00'; "
                         b"SET foreign_key_checks=0; SET unique_checks=0; "
                         b"SET sql_mode='NO_AUTO_VALUE_ON_ZERO';\n")
            expected = snapshot_manifest(source, target)
            # Preserve the latest allocation high-water marks, including gaps from deleted/rolled-back rows.
            for table, counter in expected["autoIncrement"].items():
                target.write(("ALTER TABLE " + identifier(table) + " AUTO_INCREMENT=" + str(int(counter))
                              + ";\n").encode())
            target.write(b"SET foreign_key_checks=1; SET unique_checks=1;\n")
            target.write(after_schema)
        # Some stored-program DDL is not covered by the instance backup lock.
        if (stable_schema(before_schema) != stable_schema(schema_dump(database))
                or stable_schema(after_schema) != stable_schema(schema_dump(database, after_data=True))):
            raise RuntimeError("Database definitions changed during backup")
        source.execute("ROLLBACK")
        guard.execute("UNLOCK INSTANCE")
    Path(output + ".manifest.json").write_text(json.dumps(expected, sort_keys=True) + "\n")


def verify(database, expected_path):
    if not database.startswith("vendure_restore_drill_"):
        raise RuntimeError("Verification is restricted to a temporary restore database")
    expected = json.loads(Path(expected_path).read_text())
    if expected.get("version") == 1:
        actual = legacy_manifest(database, root=True)
    elif expected.get("version") == 2:
        with Session(database, root=True) as session:
            read_snapshot(session)
            actual = snapshot_manifest(session)
    else:
        raise RuntimeError("Unsupported backup manifest version")
    if expected != actual:
        raise RuntimeError("Restore row counts or content digests do not match the backup snapshot")
    print(json.dumps({"verifiedTables": len(actual["tables"]),
                      "verifiedRows": sum(t["rows"] for t in actual["tables"].values())}))


if __name__ == "__main__":
    # The caller additionally uses GNU timeout to terminate the entire process group.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(124))
    if sys.argv[1] == "capture":
        capture(sys.argv[2])
    elif sys.argv[1] == "verify":
        verify(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit("Expected capture or verify")
