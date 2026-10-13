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
from unittest import mock
import importlib.util


SCRIPT = Path(__file__).resolve().parents[1] / "vendure-file-backup.py"
SERVICE_SCRIPT = SCRIPT.with_name("vendure-file-backup")
OFFHOST_SCRIPT = SCRIPT.parents[1] / "offsite-file-restore-drill.py"
TEST_OUTPUT = SCRIPT.parent / "tests/.file-backup-test-output"
TEST_OUTPUT.mkdir(exist_ok=True)


class FileBackupTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=TEST_OUTPUT)
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

    def test_streamed_full_restore_checks_every_file_and_compressed_digest(self):
        captured = self.capture()
        manifest = Path(str(self.archive) + ".manifest.json")
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "restore-stream", str(self.root / "streamed"), str(manifest), digest],
            input=self.archive.read_bytes(), capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(json.loads(result.stdout), captured)
        self.assertEqual((self.root / "streamed/public-assets/nested/image.webp").read_bytes(), b"public-image")
        self.assertEqual((self.root / "streamed/private-files/delivery.zip").read_bytes(), b"private-delivery")

    def test_streamed_restore_rejects_changed_archive_and_manifest(self):
        self.capture()
        manifest = Path(str(self.archive) + ".manifest.json")
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        bad_digest = subprocess.run(
            [sys.executable, str(SCRIPT), "restore-stream", str(self.root / "changed"), str(manifest), "0" * 64],
            input=self.archive.read_bytes(), capture_output=True,
        )
        self.assertNotEqual(bad_digest.returncode, 0)
        self.assertIn(b"SHA-256 does not match", bad_digest.stderr)
        changed_manifest = self.root / "changed-manifest.json"
        data = json.loads(manifest.read_text())
        data["files"][0]["sha256"] = "0" * 64
        changed_manifest.write_text(json.dumps(data))
        bad_manifest = subprocess.run(
            [sys.executable, str(SCRIPT), "restore-stream", str(self.root / "changed-manifest"), str(changed_manifest), digest],
            input=self.archive.read_bytes(), capture_output=True,
        )
        self.assertNotEqual(bad_manifest.returncode, 0)
        self.assertIn(b"digest does not match", bad_manifest.stderr)

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


class OffhostFileRestoreTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=TEST_OUTPUT)
        self.root = Path(self.temporary.name)
        self.files = self.root / "files"
        self.files.mkdir()
        (self.files / "customer.txt").write_text("complete offsite restore")
        self.archive = self.root / "vendure-files-20260923T091826Z.tar.gz"
        subprocess.run(
            [sys.executable, str(SCRIPT), "capture", str(self.archive), f"public-assets={self.files}"],
            check=True, capture_output=True,
        )
        self.manifest = Path(str(self.archive) + ".manifest.json")
        self.checksum = Path(str(self.archive) + ".sha256")
        self.checksum.write_text(
            f"{hashlib.sha256(self.archive.read_bytes()).hexdigest()}  {self.archive.name}\n"
            f"{hashlib.sha256(self.manifest.read_bytes()).hexdigest()}  {self.archive.name}.manifest.json\n"
        )
        spec = importlib.util.spec_from_file_location("offhost_file_restore", OFFHOST_SCRIPT)
        self.tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.tool)

    def tearDown(self):
        self.temporary.cleanup()

    def run_drill(self):
        archive = self.archive
        manifest = self.manifest
        checksum = self.checksum

        def copy_sidecar(command, **kwargs):
            source = manifest if command[3].endswith(".manifest.json") else checksum
            Path(command[4]).write_bytes(source.read_bytes())
            return subprocess.CompletedProcess(command, 0)

        class Download:
            def __init__(self):
                self.stdout = archive.open("rb")

            def wait(self):
                return 0

            def kill(self):
                self.stdout.close()

        listing = json.dumps({"Contents": [{
            "Key": "files/" + archive.name + ".sha256",
            "LastModified": "2026-09-23T09:18:26Z",
        }]})
        receipt = self.root / "receipt.json"
        with mock.patch.object(self.tool, "aws", return_value=listing), \
             mock.patch.object(self.tool.subprocess, "run", side_effect=copy_sidecar), \
             mock.patch.object(self.tool.subprocess, "Popen", side_effect=lambda *args, **kwargs: Download()):
            self.tool.run("backup-test", "files/", "a" * 40, "123", receipt)
        return json.loads(receipt.read_text())

    def test_full_offhost_drill_produces_exact_release_receipt(self):
        receipt = self.run_drill()
        self.assertEqual(receipt["source"], "offsite")
        self.assertEqual(receipt["method"], "offhost-full-restore")
        self.assertEqual(receipt["archive"]["fileCount"], 1)
        self.assertEqual(receipt["targetSha"], "a" * 40)
        self.assertEqual(receipt["runId"], "123")

    def test_offhost_drill_rejects_mismatched_manifest_checksum(self):
        self.manifest.write_bytes(self.manifest.read_bytes() + b"tampered")
        with self.assertRaisesRegex(ValueError, "manifest checksum does not match"):
            self.run_drill()


class FileBackupServiceResumeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=TEST_OUTPUT)
        self.root = Path(self.temporary.name)
        self.backups = self.root / "backups"
        self.backups.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.state = self.root / "s3-state.json"
        self.state.write_text("{}")
        self.upload_log = self.root / "uploads.json"
        self.upload_log.write_text("[]")
        self.event_log = self.root / "lifecycle.json"
        self.event_log.write_text("[]")
        self.tools = self.root / "tools"
        self.tools.mkdir()
        self.service_script = self.tools / "vendure-file-backup"
        self.service_script.write_bytes(SERVICE_SCRIPT.read_bytes())
        (self.tools / "vendure-backup-s3-guard.py").write_bytes(
            SCRIPT.with_name("vendure-backup-s3-guard.py").read_bytes()
        )
        event_prelude = '''import json
import os
from pathlib import Path
import sys
log_path = Path(os.environ["FAKE_LIFECYCLE_LOG"])
events = json.loads(log_path.read_text())
'''
        (self.tools / "vendure-file-backup-retention.py").write_text(event_prelude + '''
assert sys.argv[1:] == ["--apply", "--lock-fd", "8"]
opened = os.fstat(8)
expected = (Path(os.environ["VENDURE_FILE_BACKUP_DIR"]) / ".backup.lock").stat()
assert (opened.st_dev, opened.st_ino) == (expected.st_dev, expected.st_ino)
events.append({"operation": "retention", "fd": 8})
log_path.write_text(json.dumps(events))
count = sum(item["operation"] == "retention" for item in events)
blocked = count == int(os.environ.get("FAKE_RETENTION_BLOCK_CALL", "0"))
print(json.dumps({"status": "blocked" if blocked else "ok"}))
raise SystemExit(1 if blocked else 0)
''')
        (self.tools / "vendure-disk-budget.py").write_text(event_prelude + '''
assert sys.argv[1] == "backup"
events.append({"operation": "budget", "arguments": sys.argv[1:]})
log_path.write_text(json.dumps(events))
blocked = os.environ.get("FAKE_BUDGET_BLOCK") == "1"
print(json.dumps({"status": "insufficient" if blocked else "ok"}))
raise SystemExit(1 if blocked else 0)
''')
        (self.tools / "vendure-file-backup.py").write_text(event_prelude + f'''
import runpy
events.append({{"operation": sys.argv[1]}})
log_path.write_text(json.dumps(events))
runpy.run_path({str(SCRIPT)!r}, run_name="__main__")
''')
        (self.tools / "vendure-s3-prefix-snapshot.py").write_text(event_prelude + '''
assert sys.argv[1] == "capture"
events.append({"operation": "snapshot", "arguments": sys.argv[1:]})
log_path.write_text(json.dumps(events))
destination = Path(sys.argv[4])
destination.mkdir(parents=True)
(destination / "fixture-image.bin").write_bytes(b"synthetic customer image")
''')
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
    if os.environ.get("FAKE_S3_FAIL_UPLOAD") == "1":
        raise SystemExit("Synthetic upload failure")
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

    def run_service(self, overrides=None):
        environment = dict(os.environ)
        environment.update({
            "PATH": f"{self.bin}:{environment['PATH']}",
            "VENDURE_ENV_FILE": str(self.env_file),
            "VENDURE_FILE_BACKUP_DIR": str(self.backups),
            "FAKE_S3_STATE": str(self.state),
            "FAKE_S3_UPLOAD_LOG": str(self.upload_log),
            "FAKE_LIFECYCLE_LOG": str(self.event_log),
        })
        environment.update(overrides or {})
        return subprocess.run(
            ["bash", str(self.service_script)], capture_output=True, text=True, env=environment, timeout=20,
        )

    def remove_initial_archive(self):
        for path in (self.archive, Path(str(self.archive) + ".manifest.json"), Path(str(self.archive) + ".sha256")):
            path.unlink()

    def events(self):
        return json.loads(self.event_log.read_text())

    def enable_s3_customer_images(self):
        self.env_file.write_text(self.env_file.read_text().replace("CUSTOMER_IMAGE_STORAGE=local", "CUSTOMER_IMAGE_STORAGE=s3") +
                                 "AWS_REGION=ap-northeast-1\nCUSTOMER_AVATAR_S3_BUCKET=avatar-test\n"
                                 "CUSTOMER_PRIVATE_IMAGE_S3_BUCKET=private-test\n")

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

    def test_retention_then_budget_precede_capture_and_successful_cleanup(self):
        self.remove_initial_archive()
        result = self.run_service()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.backups.stat().st_mode & 0o777, 0o700)
        self.assertEqual([item["operation"] for item in self.events()],
                         ["retention", "budget", "capture", "verify", "retention"])
        arguments = self.events()[1]["arguments"]
        self.assertEqual(arguments[0], "backup")
        sources = [arguments[index + 1] for index, arg in enumerate(arguments) if arg == "--source-root"]
        self.assertEqual(set(sources), {str(self.root / label) for label in
                                      ("public-assets", "digital-delivery", "customer-avatars", "private-images")})

    def test_blocked_pre_retention_does_not_create_archive_or_snapshot(self):
        self.remove_initial_archive()
        self.enable_s3_customer_images()
        result = self.run_service({"FAKE_RETENTION_BLOCK_CALL": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("capture blocked by unverified local retention", result.stderr)
        self.assertEqual([item["operation"] for item in self.events()], ["retention"])
        self.assertEqual({path.name for path in self.backups.iterdir()}, {".backup.lock"})
        self.assertEqual(json.loads(self.upload_log.read_text()), [])

    def test_budget_shortfall_does_not_create_archive_or_snapshot(self):
        self.remove_initial_archive()
        self.enable_s3_customer_images()
        result = self.run_service({"FAKE_BUDGET_BLOCK": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("capture blocked by insufficient or unverifiable disk budget", result.stderr)
        self.assertEqual([item["operation"] for item in self.events()], ["retention", "budget"])
        self.assertEqual({path.name for path in self.backups.iterdir()}, {".backup.lock"})

    def test_s3_budget_includes_snapshot_sources_before_download(self):
        self.remove_initial_archive()
        self.enable_s3_customer_images()
        result = self.run_service()
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.events()
        self.assertEqual([item["operation"] for item in events],
                         ["retention", "budget", "snapshot", "snapshot", "capture", "verify", "retention"])
        arguments = events[1]["arguments"]
        sources = [arguments[index + 1] for index, arg in enumerate(arguments) if arg == "--source-root"]
        self.assertEqual(sources, [str(self.root / "public-assets"), str(self.root / "digital-delivery")])
        s3_sources = [arguments[index + 1:index + 3] for index, arg in enumerate(arguments) if arg == "--s3-source"]
        self.assertEqual(s3_sources, [["avatar-test", "avatars/v2/"], ["private-test", "private/v1/"]])
        self.assertEqual(list(self.backups.glob(".s3-source-*")), [])

    def test_resume_success_runs_retention_without_budget_or_capture(self):
        result = self.run_service()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([item["operation"] for item in self.events()], ["verify", "retention"])
        self.assertIn("Resumed verified persistent file backup", result.stdout)
        self.assertEqual(len(list(self.backups.glob("*.tar.gz"))), 1)

    def test_post_capture_retention_failure_does_not_erase_success(self):
        self.remove_initial_archive()
        result = self.run_service({"FAKE_RETENTION_BLOCK_CALL": "2"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Created verified persistent file backup", result.stdout)
        self.assertIn("backup succeeded; retention is blocked", result.stderr)
        self.assertEqual(len(list(self.backups.glob("*.tar.gz"))), 1)
        self.assertEqual(len(json.loads(self.upload_log.read_text())), 3)

    def test_post_resume_retention_failure_does_not_erase_success(self):
        result = self.run_service({"FAKE_RETENTION_BLOCK_CALL": "1"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Resumed verified persistent file backup", result.stdout)
        self.assertIn("backup succeeded; retention is blocked", result.stderr)
        self.assertEqual([item["operation"] for item in self.events()], ["verify", "retention"])

    def test_failed_upload_preserves_complete_local_set_then_resumes_without_capture(self):
        self.remove_initial_archive()
        failed = self.run_service({"FAKE_S3_FAIL_UPLOAD": "1"})
        self.assertNotEqual(failed.returncode, 0)
        self.assertNotIn("Created verified persistent file backup", failed.stdout)
        archives = list(self.backups.glob("*.tar.gz"))
        self.assertEqual(len(archives), 1)
        for suffix in (".manifest.json", ".sha256"):
            self.assertTrue(Path(str(archives[0]) + suffix).exists())
        self.assertEqual([item["operation"] for item in self.events()],
                         ["retention", "budget", "capture", "verify"])
        self.event_log.write_text("[]")
        resumed = self.run_service()
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertIn("Resumed verified persistent file backup", resumed.stdout)
        self.assertEqual([item["operation"] for item in self.events()], ["verify", "retention"])
        self.assertEqual(list(self.backups.glob("*.tar.gz")), archives)

    def test_symlink_lock_is_rejected_without_truncating_its_target(self):
        target = self.root / "outside-recovery-record"
        target.write_text("keep recovery record")
        (self.backups / ".backup.lock").symlink_to(target)
        result = self.run_service()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("directory or lock is unsafe", result.stderr)
        self.assertEqual(target.read_text(), "keep recovery record")
        self.assertEqual(self.events(), [])
        self.assertEqual(json.loads(self.upload_log.read_text()), [])

    def test_hardlinked_lock_is_rejected_without_truncating_its_target(self):
        target = self.root / "outside-recovery-record"
        target.write_text("keep recovery record")
        os.link(target, self.backups / ".backup.lock")
        result = self.run_service()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("directory or lock is unsafe", result.stderr)
        self.assertEqual(target.read_text(), "keep recovery record")
        self.assertEqual(self.events(), [])


if __name__ == "__main__":
    unittest.main()
