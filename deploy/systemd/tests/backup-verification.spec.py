import importlib.util
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "backup_verification", Path(__file__).resolve().parents[1] / "vendure-backup-verification.py"
)
verification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verification)


class BackupVerificationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name).resolve()
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.archive = self.directory / f"vendure-files-{timestamp}.tar.gz"
        self.archive.write_bytes(b"archive fixture")
        self.manifest = self.archive.with_name(self.archive.name + ".manifest.json")
        self.manifest.write_text("{}")
        (self.directory / ".backup.lock").touch()
        self.uri = "s3://backup-fixture/files"
        self.versions = ["archive-version", "manifest-version", "checksum-version"]

    def publish(self):
        evidence = verification.prepare("files", self.archive, existing=False)
        verification.publish("files", self.archive, evidence, self.uri, self.versions)

    def test_repeated_checks_never_open_archive_or_manifest(self):
        self.publish()
        read = verification.read_regular

        def small_files_only(path, consume):
            self.assertNotIn(path, (self.archive, self.manifest))
            return read(path, consume)

        with patch.object(verification, "read_regular", side_effect=small_files_only):
            for _ in range(3):
                verification.check("files", self.directory, 86400, self.uri)

    def test_same_size_replacement_with_same_mtime_invalidates_receipt(self):
        self.publish()
        metadata = self.archive.stat()
        replacement = self.directory / "replacement"
        replacement.write_bytes(b"content fixture")
        os.utime(replacement, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
        replacement.replace(self.archive)
        self.assertEqual(self.archive.stat().st_size, metadata.st_size)
        with self.assertRaisesRegex(verification.InvalidBackup, "checksum-invalid"):
            verification.check("files", self.directory, 86400, self.uri)

    def test_stale_and_unverified_offsite_destinations_fail(self):
        self.publish()
        with self.assertRaisesRegex(verification.InvalidBackup, "missing-or-stale"):
            verification.check("files", self.directory, 0, self.uri)
        with self.assertRaisesRegex(verification.InvalidBackup, "offsite-unverified"):
            verification.check("files", self.directory, 86400, "s3://different-fixture/files")

    def test_adopts_legacy_archive_once_without_masking_later_corruption(self):
        verification.prepare("files", self.archive, existing=False)
        with patch.object(verification, "existing_s3_versions", return_value=self.versions) as versions:
            verification.adopt("files", self.directory, 86400, self.uri)
            verification.adopt("files", self.directory, 86400, self.uri)
            versions.assert_called_once_with(self.archive, self.uri)
        receipt = json.loads((self.directory / verification.RECEIPT).read_text())
        self.assertEqual(receipt["offsite"]["versions"], self.versions)
        self.manifest.write_text("modified")
        with self.assertRaisesRegex(verification.InvalidBackup, "checksum-invalid"):
            verification.adopt("files", self.directory, 86400, self.uri)

    def test_publish_rejects_archive_changed_after_local_verification(self):
        evidence = verification.prepare("files", self.archive, existing=False)
        self.archive.write_bytes(b"changed after hashing")
        with self.assertRaisesRegex(verification.InvalidBackup, "checksum-invalid"):
            verification.publish("files", self.archive, evidence, self.uri, self.versions)
        self.assertFalse((self.directory / verification.RECEIPT).exists())


if __name__ == "__main__":
    unittest.main()
