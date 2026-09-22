#!/usr/bin/env python3

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "vendure-s3-prefix-snapshot.py"
SPEC = importlib.util.spec_from_file_location("vendure_s3_prefix_snapshot", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class S3PrefixSnapshotTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def reader(self, command, *_arguments):
        if command == "get-bucket-versioning":
            return {"Status": "Enabled"}
        if command == "list-objects-v2":
            return {
                "IsTruncated": False,
                "Contents": [
                    {"Key": "avatars/v2/customer/a.webp"},
                    {"Key": "avatars/v2/customer/b.webp"},
                ],
            }
        if command == "head-object":
            key = _arguments[-1]
            return {"VersionId": f"version-{Path(key).stem}", "ContentLength": 9}
        raise AssertionError(command)

    @staticmethod
    def downloader(_bucket, key, _version_id, destination):
        destination.write_bytes((Path(key).stem + "-content").encode())

    def test_captures_version_pinned_objects_and_a_restore_manifest(self):
        target = self.root / "snapshot"
        result = MODULE.capture(
            "customer-avatar-bucket",
            "avatars/v2/",
            target,
            self.reader,
            self.downloader,
        )
        self.assertEqual(result, {"version": 1, "objectCount": 2, "totalBytes": 18})
        manifest = json.loads((target / "S3_SOURCE_MANIFEST.json").read_text())
        self.assertEqual([item["relativePath"] for item in manifest["objects"]], [
            "customer/a.webp",
            "customer/b.webp",
        ])
        self.assertEqual((target / "customer/a.webp").read_bytes(), b"a-content")
        self.assertEqual(MODULE.verify_tree(target), result)

        (target / "customer/a.webp").write_bytes(b"tampered!")
        with self.assertRaisesRegex(MODULE.SnapshotError, "does not match"):
            MODULE.verify_tree(target)

    def test_rejects_traversal_and_removes_the_incomplete_snapshot(self):
        def reader(command, *_arguments):
            if command == "get-bucket-versioning":
                return {"Status": "Enabled"}
            return {"IsTruncated": False, "Contents": [{"Key": "avatars/v2/../private"}]}

        target = self.root / "unsafe"
        with self.assertRaisesRegex(MODULE.SnapshotError, "unsafe"):
            MODULE.capture(
                "customer-avatar-bucket",
                "avatars/v2/",
                target,
                reader,
                self.downloader,
            )
        self.assertFalse(target.exists())

    def test_rejects_unversioned_or_invalid_pagination(self):
        with self.assertRaisesRegex(MODULE.SnapshotError, "versioning"):
            MODULE.capture(
                "customer-avatar-bucket",
                "avatars/v2/",
                self.root / "unversioned",
                lambda *_arguments: {"Status": "Suspended"},
                self.downloader,
            )

        def invalid_pagination(command, *_arguments):
            if command == "get-bucket-versioning":
                return {"Status": "Enabled"}
            return {"IsTruncated": True, "Contents": [], "NextContinuationToken": ""}

        with self.assertRaisesRegex(MODULE.SnapshotError, "pagination"):
            MODULE.capture(
                "customer-avatar-bucket",
                "avatars/v2/",
                self.root / "truncated",
                invalid_pagination,
                self.downloader,
            )


if __name__ == "__main__":
    unittest.main()
