#!/usr/bin/env python3
"""Exercise manifest digests with real sort and synthetic rows; no database access."""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = ROOT / "deploy/.memory-verification-20261012"
ARTIFACTS.mkdir(exist_ok=True)
spec = importlib.util.spec_from_file_location(
    "manifest", ROOT / "deploy/systemd/vendure-mysql-backup-manifest.py"
)
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)
REAL_POPEN = manifest.subprocess.Popen


def digest_rows(rows):
    counts = {}
    for row in rows:
        key = hashlib.sha256(row).hexdigest().encode() + b"\n"
        counts[key] = counts.get(key, 0) + 1
    result = hashlib.sha256()
    for key, count in sorted(counts.items()):
        for _ in range(count):
            result.update(key)
    return result.hexdigest()


class SyntheticSession:
    def __init__(self, count, rows):
        self.count, self.row_factory = count, rows

    def execute(self, query):
        if "TABLE_NAME, ENGINE" in query:
            return [b"fixture\tInnoDB"]
        if "information_schema.columns" in query:
            return [b"value\tvarbinary\t"]
        if query.startswith("SHOW CREATE TABLE"):
            return [b"fixture\tCREATE TABLE `fixture` (`value` varbinary(16)) ENGINE=InnoDB"]
        if query.startswith("SELECT COUNT(*)"):
            return [str(self.count).encode()]
        if "AUTO_INCREMENT" in query:
            return []
        raise AssertionError("Unexpected metadata query")

    def rows(self, query):
        if not query.startswith("SELECT HEX(`value`)"):
            raise AssertionError("Unexpected row query")
        yield from self.row_factory()


class DumpProcess:
    def __init__(self, contents, status=0):
        self.stdout, self.status = io.BytesIO(contents), status

    def wait(self):
        return self.status


class ManifestSortingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="sort-test-", dir=ARTIFACTS)
        self.environment = mock.patch.dict(os.environ, {"TMPDIR": self.directory.name})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.directory.cleanup()

    def test_snapshot_digest_preserves_duplicates_and_ignores_input_order(self):
        rows = [b"ff00", b"NULL", b"41", b"ff00", b"00", b"41"]
        expected = digest_rows(rows)
        for ordered in (rows, list(reversed(rows))):
            result = manifest.snapshot_manifest(SyntheticSession(len(rows), lambda: iter(ordered)))
            self.assertEqual(result["tables"]["fixture"]["rows"], len(rows))
            self.assertEqual(result["tables"]["fixture"]["sha256"], expected)

    def test_legacy_digest_preserves_duplicates_and_ignores_input_order(self):
        rows = [b"INSERT INTO `fixture` VALUES (X'ff00');", b"INSERT INTO `fixture` VALUES (NULL);",
                b"INSERT INTO `fixture` VALUES (X'ff00');"]
        expected = digest_rows(rows)
        for ordered in (rows, list(reversed(rows))):
            def popen(args, **kwargs):
                if args[0] == "mysqldump":
                    return DumpProcess(b"\n".join(ordered) + b"\n")
                return REAL_POPEN(args, **kwargs)
            with mock.patch.object(manifest, "query", side_effect=["fixture", str(len(rows))]), \
                 mock.patch.object(manifest, "client", return_value=[]), \
                 mock.patch.object(manifest, "environment", return_value={}), \
                 mock.patch.object(manifest.subprocess, "Popen", side_effect=popen):
                result = manifest.legacy_manifest("synthetic")
            self.assertEqual(result["tables"]["fixture"]["rows"], len(rows))
            self.assertEqual(result["tables"]["fixture"]["sha256"], expected)

    def test_large_snapshot_spills_to_disk_without_changing_digest(self):
        count = 700000  # 45.5 MB of fixed-length hashes, exceeding the 32 MiB buffer.
        def rows():
            return (f"{index % 4096:08x}".encode() for index in range(count))
        expected = digest_rows(rows())
        spill_seen = threading.Event()
        stop = threading.Event()
        def watch():
            while not stop.is_set():
                # BSD and GNU sort use different temporary-file prefixes.
                if any(path.is_file() and path.name != "rows"
                       for path in Path(self.directory.name).glob("manifest-*/*")):
                    spill_seen.set()
                time.sleep(0.001)
        observer = threading.Thread(target=watch, daemon=True)
        observer.start()
        try:
            result = manifest.snapshot_manifest(SyntheticSession(count, rows))
        finally:
            stop.set()
            observer.join()
        self.assertTrue(spill_seen.is_set(), "The real sorter must exercise external merge files")
        self.assertEqual(result["tables"]["fixture"]["rows"], count)
        self.assertEqual(result["tables"]["fixture"]["sha256"], expected)

    def test_sort_failure_cannot_produce_accepted_snapshot(self):
        with mock.patch.object(manifest.subprocess, "Popen", return_value=DumpProcess(b"partial", 9)):
            with self.assertRaisesRegex(RuntimeError, "Row digest sorting failed"):
                manifest.snapshot_manifest(SyntheticSession(1, lambda: iter([b"41"])))

    def test_sort_failure_cannot_produce_accepted_legacy_manifest(self):
        def popen(args, **_):
            return DumpProcess(b"INSERT INTO `fixture` VALUES (NULL);\n") if args[0] == "mysqldump" \
                else DumpProcess(b"partial", 9)
        with mock.patch.object(manifest, "query", side_effect=["fixture", "1"]), \
             mock.patch.object(manifest, "client", return_value=[]), \
             mock.patch.object(manifest, "environment", return_value={}), \
             mock.patch.object(manifest.subprocess, "Popen", side_effect=popen):
            with self.assertRaisesRegex(RuntimeError, "Row digest sorting failed"):
                manifest.legacy_manifest("synthetic")


if __name__ == "__main__":
    unittest.main()
