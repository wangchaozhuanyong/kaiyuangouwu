#!/usr/bin/env python3

import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "vendure-file-backup.py"
SERVICE_SCRIPT = SCRIPT.with_name("vendure-file-backup")


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


class FileBackupServiceResumeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.backups = self.root / "backups"
        self.backups.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.state = self.root / "s3-state.json"
        self.state.write_text("{}")
        self.upload_log = self.root / "uploads.json"
        self.upload_log.write_text("[]")
        roots = {}
        for label in ("public-assets", "digital-delivery", "customer-avatars", "private-images"):
            path = self.root / label
            path.mkdir()
            (path / "sample.txt").write_text(label)
            roots[label] = path
        self.archive = self.backups / "vendure-files-20260923T091826Z.tar.gz"
        subprocess.run(
            [sys.executable, str(SCRIPT), "capture", str(self.archive),
             *(f"{label}={path}" for label, path in roots.items())],
            check=True, capture_output=True, text=True,
        )
        checksum = self.archive.with_name(self.archive.name + ".sha256")
        checksum.write_text("".join(
            f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
            for path in (self.archive, Path(str(self.archive) + ".manifest.json"))
        ))
        self.env_file = self.root / "fixture.env"
        self.env_file.write_text("\n".join((
            f"VENDURE_ASSET_UPLOAD_DIR={roots['public-assets']}",
            f"DIGITAL_DELIVERY_ROOT={roots['digital-delivery']}",
            f"CUSTOMER_AVATAR_STORAGE_ROOT={roots['customer-avatars']}",
            f"IMAGE_GENERATION_STORAGE_ROOT={roots['private-images']}",
            "CUSTOMER_IMAGE_STORAGE=local",
            "VENDURE_REQUIRE_OFFSITE_FILE_BACKUP=true",
            "VENDURE_FILE_BACKUP_S3_URI=s3://backup-test/files",
            "VENDURE_FILE_BACKUP_S3_RETENTION_DAYS=30",
        )) + "\n")
        self.write_executable("flock", "#!/bin/sh\nexit 0\n")
        self.write_executable("timeout", '#!/bin/sh\nshift 2\nexec "$@"\n')
        self.write_executable("aws", '''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
operation = args[1] if args[0] == "s3api" else args[0]
responses = {
    "get-bucket-versioning": {"Status": "Enabled"},
    "get-bucket-ownership-controls": {"OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]}},
    "get-public-access-block": {"PublicAccessBlockConfiguration": {
        "BlockPublicAcls": True, "IgnorePublicAcls": True,
        "BlockPublicPolicy": True, "RestrictPublicBuckets": True}},
    "get-bucket-encryption": {"ServerSideEncryptionConfiguration": {"Rules": [
        {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}},
    "get-bucket-lifecycle-configuration": {"Rules": [{
        "Status": "Enabled", "Filter": {"Prefix": "files/"},
        "Expiration": {"Days": 14}, "NoncurrentVersionExpiration": {"NoncurrentDays": 14},
        "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}}]},
}
state_path = Path(os.environ["FAKE_S3_STATE"])
state = json.loads(state_path.read_text())
if operation in responses:
    result = responses[operation]
elif operation == "list-objects-v2":
    key = args[args.index("--prefix") + 1]
    result = {"Contents": [{"Key": key}]} if key in state else {}
elif operation == "head-object":
    key = args[args.index("--key") + 1]
    result = state[key]
elif operation == "s3":
    assert args[1] == "cp"
    source = Path(args[2])
    key = args[3].split("/", 3)[3]
    state[key] = {"ContentLength": source.stat().st_size, "ServerSideEncryption": "AES256"}
    state_path.write_text(json.dumps(state))
    log_path = Path(os.environ["FAKE_S3_UPLOAD_LOG"])
    log = json.loads(log_path.read_text())
    log.append(key)
    log_path.write_text(json.dumps(log))
    result = None
else:
    raise SystemExit(f"Unexpected AWS operation: {operation}")
if result is not None:
    print(json.dumps(result))
''')

    def tearDown(self):
        self.temporary.cleanup()

    def write_executable(self, name, source):
        path = self.bin / name
        path.write_text(source)
        path.chmod(0o755)

    def run_service(self):
        environment = dict(os.environ)
        environment.update({
            "PATH": f"{self.bin}:{environment['PATH']}",
            "VENDURE_ENV_FILE": str(self.env_file),
            "VENDURE_FILE_BACKUP_DIR": str(self.backups),
            "FAKE_S3_STATE": str(self.state),
            "FAKE_S3_UPLOAD_LOG": str(self.upload_log),
        })
        return subprocess.run(
            ["bash", str(SERVICE_SCRIPT)], capture_output=True, text=True, env=environment,
        )

    def test_resumes_missing_offsite_objects_without_new_archive(self):
        result = self.run_service()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Resumed verified persistent file backup", result.stdout)
        self.assertEqual(len(list(self.backups.glob("*.tar.gz"))), 1)
        self.assertEqual(len(json.loads(self.upload_log.read_text())), 3)

    def test_new_capture_uploads_and_verifies_all_objects(self):
        self.archive.unlink()
        Path(str(self.archive) + ".manifest.json").unlink()
        Path(str(self.archive) + ".sha256").unlink()
        result = self.run_service()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Created verified persistent file backup", result.stdout)
        self.assertEqual(len(list(self.backups.glob("*.tar.gz"))), 1)
        self.assertEqual(len(json.loads(self.upload_log.read_text())), 3)

    def test_resume_uploads_only_missing_checksum(self):
        manifest = Path(str(self.archive) + ".manifest.json")
        self.state.write_text(json.dumps({
            f"files/{path.name}": {
                "ContentLength": path.stat().st_size,
                "ServerSideEncryption": "AES256",
            }
            for path in (self.archive, manifest)
        }))
        result = self.run_service()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(self.upload_log.read_text()),
            [f"files/{self.archive.name}.sha256"],
        )
        self.assertEqual(len(list(self.backups.glob("*.tar.gz"))), 1)

    def test_rejects_corrupt_local_archive_before_upload(self):
        with self.archive.open("ab") as output:
            output.write(b"tampered")
        result = self.run_service()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(self.upload_log.read_text()), [])

    def test_rejects_mismatched_existing_offsite_object(self):
        key = f"files/{self.archive.name}"
        self.state.write_text(json.dumps({
            key: {"ContentLength": 1, "ServerSideEncryption": "AES256"},
        }))
        result = self.run_service()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("differs from the verified local file", result.stderr)
        self.assertEqual(json.loads(self.upload_log.read_text()), [])


if __name__ == "__main__":
    unittest.main()
