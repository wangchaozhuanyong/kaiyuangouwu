#!/usr/bin/env python3

import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "vendure-file-backup.py"


class FileBackupTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.assets = self.root / "assets"
        self.private = self.root / "private"
        self.assets.mkdir()
        self.private.mkdir()
        (self.assets / "nested").mkdir()
        (self.assets / "nested" / "image.webp").write_bytes(b"public-image")
        (self.private / "delivery.zip").write_bytes(b"private-delivery")
        os.chmod(self.private / "delivery.zip", 0o600)
        self.archive = self.root / "backup.tar.gz"

    def tearDown(self):
        self.temporary.cleanup()

    def run_script(self, *arguments, success=True):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *map(str, arguments)],
            capture_output=True,
            text=True,
        )
        if success and result.returncode:
            self.fail(result.stderr)
        if not success and result.returncode == 0:
            self.fail("Expected command to fail")
        return result

    def capture(self):
        result = self.run_script(
            "capture",
            self.archive,
            f"public-assets={self.assets}",
            f"private-files={self.private}",
        )
        return json.loads(result.stdout)

    def test_capture_verify_and_restore_preserve_all_files(self):
        captured = self.capture()
        self.assertEqual(captured["fileCount"], 2)
        self.assertEqual(captured["roots"], ["public-assets", "private-files"])
        self.assertTrue(Path(str(self.archive) + ".manifest.json").is_file())

        verified = json.loads(self.run_script("verify", self.archive).stdout)
        self.assertEqual(verified, captured)
        restored = self.root / "restored"
        restored_result = json.loads(self.run_script("restore", self.archive, restored).stdout)
        self.assertEqual(restored_result, captured)
        self.assertEqual(
            (restored / "public-assets/nested/image.webp").read_bytes(),
            b"public-image",
        )
        self.assertEqual(
            (restored / "private-files/delivery.zip").read_bytes(),
            b"private-delivery",
        )
        self.assertEqual((restored / "private-files/delivery.zip").stat().st_mode & 0o777, 0o600)

    def test_rejects_symlinks_and_overlapping_roots(self):
        (self.assets / "unsafe-link").symlink_to(self.private / "delivery.zip")
        result = self.run_script(
            "capture",
            self.archive,
            f"public-assets={self.assets}",
            success=False,
        )
        self.assertIn("Unsupported file entry", result.stderr)
        (self.assets / "unsafe-link").unlink()
        nested = self.assets / "nested"
        result = self.run_script(
            "capture",
            self.archive,
            f"public-assets={self.assets}",
            f"nested-assets={nested}",
            success=False,
        )
        self.assertIn("must not overlap", result.stderr)

    def test_detects_archive_payload_tampering(self):
        self.capture()
        tampered = self.root / "tampered.tar.gz"
        extract = self.root / "extract"
        extract.mkdir()
        with tarfile.open(self.archive, "r:gz") as source:
            source.extractall(extract)
        (extract / "data/public-assets/nested/image.webp").write_bytes(b"changed-image")
        with tarfile.open(tampered, "w:gz") as target:
            for path in sorted(extract.rglob("*")):
                target.add(path, path.relative_to(extract).as_posix(), recursive=False)
        result = self.run_script("verify", tampered, success=False)
        self.assertIn("does not match", result.stderr)


if __name__ == "__main__":
    unittest.main()
