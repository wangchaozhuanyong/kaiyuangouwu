#!/usr/bin/env python3

import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


SYSTEMD = Path(__file__).resolve().parents[1]
SCRIPT = SYSTEMD / "vendure-file-backup-retention.py"
SPEC = importlib.util.spec_from_file_location("vendure_file_backup_retention", SCRIPT)
TOOL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOL)
OUTPUT = SYSTEMD / "tests/.retention-test-output"
SETTINGS = dict(zip(TOOL.SETTING_NAMES, ("true", TOOL.OFFSITE_URI, "30")))


class FileBackupRetentionTest(unittest.TestCase):
    def setUp(self):
        OUTPUT.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="case-", dir=OUTPUT)
        self.root = Path(self.temporary.name).resolve()
        self.backups = self.root / "backups"
        self.backups.mkdir()
        self.policy = mock.Mock(return_value={"maximumRetentionDays": 30})
        self.reader = mock.Mock(side_effect=self.head)
        self.checksum = mock.Mock(side_effect=self.read_remote_checksum)

    def tearDown(self):
        self.temporary.cleanup()

    def create(self, day, complete=True):
        name = f"vendure-files-202610{day:02d}T200000Z.tar.gz"
        archive = self.backups / name
        archive.write_bytes(f"synthetic archive {day}".encode())
        if complete:
            manifest = self.backups / (name + ".manifest.json")
            manifest.write_bytes(f"synthetic manifest {day}".encode())
            checksum = self.backups / (name + ".sha256")
            checksum.write_text(
                f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n"
                f"{hashlib.sha256(manifest.read_bytes()).hexdigest()}  {manifest.name}\n"
            )
        return name

    def head(self, operation, *arguments):
        self.assertEqual(operation, "head-object")
        self.assertEqual(arguments[:2], ("--bucket", TOOL.OFFSITE_BUCKET))
        self.assertEqual(arguments[2], "--key")
        self.assertTrue(arguments[3].startswith(TOOL.OFFSITE_PREFIX))
        name = arguments[3].removeprefix(TOOL.OFFSITE_PREFIX)
        return {"ContentLength": (self.backups / name).stat().st_size,
                "ServerSideEncryption": "AES256", "VersionId": "version-" + name}

    def read_remote_checksum(self, directory, name, version):
        self.assertEqual(directory, self.backups)
        self.assertEqual(version, "version-" + name)
        return (self.backups / name).read_bytes()

    def run_retention(self, **kwargs):
        options = {"reader": self.reader, "policy_verifier": self.policy, "checksum_reader": self.checksum}
        options.update(kwargs)
        return TOOL.retain(self.backups, options.pop("settings", SETTINGS), **options)

    def existing(self):
        return {file.name: file.read_bytes() for file in self.backups.iterdir()
                if file.is_file() and file.name != ".backup.lock"}

    def test_keeps_three_newest_valid_sets_and_verifies_all_remote_objects(self):
        names = [self.create(day) for day in range(1, 6)]
        result = self.run_retention()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["protected"], list(reversed(names[2:])))
        self.assertEqual(result["removed"], [names[1], names[0]])
        self.assertGreater(result["reclaimedBytes"], 0)
        self.assertEqual(self.reader.call_count, 6)
        self.assertEqual(self.checksum.call_count, 2)
        self.policy.assert_called_once_with(TOOL.OFFSITE_URI, 30)
        for name in names[:2]:
            self.assertFalse((self.backups / name).exists())
            self.assertFalse((self.backups / (name + ".manifest.json")).exists())
            self.assertFalse((self.backups / (name + ".sha256")).exists())

    def test_three_or_fewer_sets_never_hash_payloads_or_read_aws(self):
        names = [self.create(day) for day in range(1, 4)]
        for file in self.backups.iterdir():
            os.utime(file, (time.time() - 60 * 86400,) * 2)
        before = self.existing()
        with mock.patch.object(TOOL.hashlib, "sha256", side_effect=AssertionError("Unexpected payload hash")):
            result = self.run_retention()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["protected"], list(reversed(names)))
        self.assertEqual(result["removed"], [])
        self.assertEqual(self.existing(), before)
        self.reader.assert_not_called()
        self.policy.assert_not_called()

    def test_remote_failures_preserve_all_local_files(self):
        for day in range(1, 5):
            self.create(day)
        before = self.existing()
        failures = [
            {"ContentLength": 999999}, {"ServerSideEncryption": "aws:kms"},
            {"VersionId": ""}, {"VersionId": "null"}, {"VersionId": None},
        ]
        for changed in failures:
            with self.subTest(changed=changed):
                def reader(operation, *arguments):
                    return {**self.head(operation, *arguments), **changed}
                result = self.run_retention(reader=reader)
                self.assertEqual(result["status"], "blocked")
                self.assertEqual(result["removed"], [])
                self.assertEqual(self.existing(), before)
        result = self.run_retention(checksum_reader=lambda *args: b"changed remote checksum")
        self.assertEqual(result["blocked"][0]["reason"], "offsite-checksum-mismatch")
        self.assertEqual(self.existing(), before)
        result = self.run_retention(reader=mock.Mock(side_effect=RuntimeError("UNPRINTED secret stderr")))
        self.assertEqual(self.existing(), before)
        self.assertNotIn("UNPRINTED", json.dumps(result))

    def test_unverified_cloud_policy_or_changed_settings_never_delete_archive(self):
        for day in range(1, 5):
            self.create(day)
        before = self.existing()
        for policy in (mock.Mock(side_effect=ValueError("private detail")), lambda *args: False):
            result = self.run_retention(policy_verifier=policy)
            self.assertEqual(result["blocked"][0]["reason"], "offsite-policy-unverified")
            self.assertEqual(self.existing(), before)
        for key, value in zip(TOOL.SETTING_NAMES, ("false", "s3://wrong/files", "7")):
            with self.subTest(key=key):
                result = self.run_retention(settings={**SETTINGS, key: value})
                self.assertEqual(result["status"], "blocked")
                self.assertEqual(self.existing(), before)
        self.reader.assert_not_called()

    def test_corrupt_latest_set_and_incomplete_capture_remain_protected(self):
        names = [self.create(day) for day in range(1, 6)]
        incomplete = self.create(6, complete=False)
        (self.backups / names[4]).write_bytes(b"corrupt latest complete archive")
        result = self.run_retention()
        self.assertEqual(result["protected"], list(reversed(names[1:4])))
        self.assertEqual(result["removed"], [names[0]])
        self.assertTrue((self.backups / names[4]).exists())
        self.assertTrue((self.backups / incomplete).exists())
        self.assertEqual({item["reason"] for item in result["blocked"]},
                         {"local-checksum-mismatch", "incomplete-local-set"})

    def test_orphan_sidecars_and_unknown_files_are_never_age_pruned(self):
        name = "vendure-files-20261001T200000Z.tar.gz.sha256"
        (self.backups / name).write_bytes(b"orphan checksum")
        (self.backups / "business-recovery.tar.gz").write_bytes(b"keep")
        (self.backups / "unrelated.part.failed").write_bytes(b"keep")
        for file in self.backups.iterdir():
            os.utime(file, (time.time() - 60 * 86400,) * 2)
        before = self.existing()
        result = self.run_retention(residual_days=5)
        self.assertEqual(result["blocked"][0]["reason"], "incomplete-local-set")
        self.assertEqual(self.existing(), before)

    def test_symlink_and_hardlink_backups_do_not_escape_directory(self):
        names = [self.create(day) for day in range(1, 5)]
        target = self.root / "outside"
        target.write_bytes(b"outside recovery file")
        (self.backups / names[0]).unlink()
        (self.backups / names[0]).symlink_to(target)
        result = self.run_retention()
        self.assertEqual(result["blocked"][0]["reason"], "unsafe-local-file")
        self.assertTrue((self.backups / names[0]).is_symlink())
        self.assertEqual(target.read_bytes(), b"outside recovery file")
        (self.backups / names[0]).unlink()
        os.link(target, self.backups / names[0])
        result = self.run_retention()
        self.assertEqual(result["blocked"][0]["reason"], "unsafe-local-file")
        self.assertTrue((self.backups / names[0]).exists())

    def test_changed_local_set_after_remote_verification_is_not_deleted(self):
        names = [self.create(day) for day in range(1, 5)]
        def changed_checksum(directory, name, version):
            original = self.read_remote_checksum(directory, name, version)
            archive = directory / names[0]
            metadata = archive.stat()
            archive.write_bytes(b"changed after local hashing")
            os.utime(archive, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
            return original
        result = self.run_retention(checksum_reader=changed_checksum)
        self.assertEqual(result["blocked"][0]["reason"], "local-file-changed-before-delete")
        self.assertTrue((self.backups / names[0]).exists())
        self.assertTrue((self.backups / (names[0] + ".sha256")).exists())

    def test_dry_run_makes_identical_plan_without_unlinking(self):
        names = [self.create(day) for day in range(1, 5)]
        before = self.existing()
        result = self.run_retention(apply=False)
        self.assertEqual(result["candidates"], [names[0]])
        self.assertEqual(result["removed"], [])
        self.assertEqual(result["reclaimedBytes"], 0)
        self.assertEqual(self.existing(), before)

    def test_changed_protected_recovery_floor_prevents_pruning(self):
        names = [self.create(day) for day in range(1, 5)]
        def change_protected(directory, name, version):
            original = self.read_remote_checksum(directory, name, version)
            (directory / names[3]).write_bytes(b"protected archive changed")
            return original
        result = self.run_retention(checksum_reader=change_protected)
        self.assertEqual(result["blocked"][0]["reason"], "protected-local-set-changed")
        self.assertTrue((self.backups / names[0]).exists())
        self.assertTrue((self.backups / (names[0] + ".manifest.json")).exists())

    def test_age_only_removes_strict_failed_parts_and_closed_snapshots(self):
        stale = "vendure-files-20261001T200000Z.tar.gz.part.failed"
        recent = "vendure-files-20261002T200000Z.tar.gz.part.failed"
        unfinished = "vendure-files-20261003T200000Z.tar.gz.part"
        for name in (stale, recent, unfinished):
            (self.backups / name).write_bytes(b"failed capture fixture")
        os.utime(self.backups / stale, (time.time() - 6 * 86400 - 10,) * 2)
        os.utime(self.backups / recent, (time.time() - 6 * 86400 + 120,) * 2)
        os.utime(self.backups / unfinished, (time.time() - 30 * 86400,) * 2)
        outside = self.root / "outside"
        outside.write_bytes(b"keep outside snapshot")
        snapshot = self.backups / ".s3-source-20261001T200000Z"
        snapshot.mkdir()
        (snapshot / "outside-link").symlink_to(outside)
        os.utime(snapshot, (time.time() - 6 * 86400 - 10,) * 2)
        result = self.run_retention(residual_days=5)
        self.assertEqual(set(result["removed"]), {stale, snapshot.name})
        self.assertTrue((self.backups / recent).exists())
        self.assertTrue((self.backups / unfinished).exists())
        self.assertEqual(outside.read_bytes(), b"keep outside snapshot")

    def test_rejects_directory_symlinks_traversal_and_lock_symlinks(self):
        link = self.root / "backup-link"
        link.symlink_to(self.backups, target_is_directory=True)
        with self.assertRaisesRegex(TOOL.RetentionError, "unsafe-backup-directory"):
            TOOL.retain(link, SETTINGS)
        with self.assertRaisesRegex(TOOL.RetentionError, "unsafe-backup-directory"):
            TOOL.retain(self.backups / ".." / "backups", SETTINGS)
        target = self.root / "other-lock"
        target.write_text("do not truncate")
        (self.backups / ".backup.lock").symlink_to(target)
        with self.assertRaises(OSError):
            self.run_retention()
        self.assertEqual(target.read_text(), "do not truncate")

    def test_fake_inherited_descriptor_is_rejected(self):
        (self.backups / ".backup.lock").touch()
        with (self.root / "not-the-lock").open("w") as wrong:
            with self.assertRaisesRegex(TOOL.RetentionError, "inherited-lock-does-not-match"):
                self.run_retention(inherited_fd=wrong.fileno())

    def test_inherited_lock_does_not_deadlock_or_release_parent_lock(self):
        for day in range(1, 4):
            self.create(day)
        lock_path = self.backups / ".backup.lock"
        lock_path.touch()
        with lock_path.open("r") as owner:
            fcntl.flock(owner, fcntl.LOCK_EX)
            environment = {**os.environ, **SETTINGS, "VENDURE_FILE_BACKUP_DIR": str(self.backups)}
            child = subprocess.run(
                [sys.executable, str(SCRIPT), "--dry-run", "--lock-fd", str(owner.fileno())],
                pass_fds=(owner.fileno(),), env=environment, capture_output=True, text=True, timeout=10,
            )
            self.assertEqual(child.returncode, 0, child.stdout + child.stderr)
            self.assertEqual(json.loads(child.stdout)["status"], "ok")
            with lock_path.open("r") as other:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_regular_lock_contention_fails_without_mutating_backups(self):
        name = self.create(1)
        with (self.backups / ".backup.lock").open("w") as owner:
            fcntl.flock(owner, fcntl.LOCK_EX)
            with self.assertRaisesRegex(TOOL.RetentionError, "backup-lock-busy"):
                with TOOL.backup_lock(self.backups, timeout=0.01):
                    self.fail("Acquired another process's lock")
        self.assertTrue((self.backups / name).exists())

    def test_unsafe_keep_count_or_residual_policy_rejected_before_deletion(self):
        self.create(1)
        before = self.existing()
        for options in ({"keep_count": 2}, {"keep_count": True}, {"residual_days": 4}):
            with self.assertRaises(TOOL.RetentionError):
                self.run_retention(**options)
            self.assertEqual(self.existing(), before)

    def test_read_only_environment_whitelist_and_no_shell_evaluation(self):
        envfile = self.root / ".env"
        envfile.write_text(
            "DB_PASSWORD=DO_NOT_REPORT_OR_EXECUTE\n"
            "export VENDURE_REQUIRE_OFFSITE_FILE_BACKUP='true'\n"
            f"VENDURE_FILE_BACKUP_S3_URI=\"{TOOL.OFFSITE_URI}\"\n"
            "VENDURE_FILE_BACKUP_S3_RETENTION_DAYS=30 # bound\n"
        )
        self.assertEqual(TOOL.read_settings({}, envfile), SETTINGS)
        envfile.write_text(envfile.read_text() + "VENDURE_REQUIRE_OFFSITE_FILE_BACKUP=false\n")
        with self.assertRaisesRegex(TOOL.RetentionError, "duplicate-backup-setting"):
            TOOL.read_settings({}, envfile)

    def test_remote_checksum_read_matches_verified_version_and_is_small_and_project_local(self):
        payload = b"synthetic remote checksum"
        def aws_read(command, **kwargs):
            self.assertEqual(command[:3], ["aws", "s3api", "get-object"])
            self.assertNotIn("--version-id", command)
            self.assertEqual(command[command.index("--range") + 1], "bytes=0-8191")
            output = Path(command[-3])
            self.assertEqual(output.parent, self.backups)
            output.write_bytes(payload)
            return subprocess.CompletedProcess(command, 0, b'{"VersionId":"pinned-version"}', b"")
        with mock.patch.object(TOOL.subprocess, "run", side_effect=aws_read):
            result = TOOL.remote_checksum(self.backups, "fixture.sha256", "pinned-version")
        self.assertEqual(result, payload)
        self.assertEqual(list(self.backups.glob(".retention-checksum-*")), [])

    def test_changed_or_missing_remote_checksum_version_is_rejected(self):
        for metadata in ({"VersionId": "replacement-version"}, {}, {"VersionId": None}):
            def aws_read(command, **kwargs):
                Path(command[-3]).write_bytes(b"synthetic checksum")
                return subprocess.CompletedProcess(command, 0, json.dumps(metadata).encode(), b"")
            with mock.patch.object(TOOL.subprocess, "run", side_effect=aws_read):
                with self.assertRaisesRegex(TOOL.RetentionError, "offsite-checksum-version-changed"):
                    TOOL.remote_checksum(self.backups, "fixture.sha256", "pinned-version")
            self.assertEqual(list(self.backups.glob(".retention-checksum-*")), [])

    def test_remote_checksum_permission_and_malformed_response_fail_closed(self):
        def denied(command, **kwargs):
            raise subprocess.CalledProcessError(1, command, stderr=b"PRIVATE_FIXTURE")
        def malformed(command, **kwargs):
            Path(command[-3]).write_bytes(b"synthetic checksum")
            return subprocess.CompletedProcess(command, 0, b"not-json", b"")
        for reader in (denied, malformed):
            with mock.patch.object(TOOL.subprocess, "run", side_effect=reader):
                with self.assertRaisesRegex(TOOL.RetentionError, "offsite-checksum-read-failed"):
                    TOOL.remote_checksum(self.backups, "fixture.sha256", "pinned-version")
            self.assertEqual(list(self.backups.glob(".retention-checksum-*")), [])

    def test_existing_service_wrapper_uses_configured_env_and_keeps_three(self):
        names = [self.create(day) for day in range(1, 4)]
        envfile = self.root / ".env"
        envfile.write_text("DB_PASSWORD=UNPRINTED_SECRET\n" + "\n".join(
            f"{name}={value}" for name, value in SETTINGS.items()
        ))
        environment = dict(os.environ)
        for name in TOOL.SETTING_NAMES:
            environment.pop(name, None)
        environment.update({"VENDURE_FILE_BACKUP_DIR": str(self.backups),
                            "VENDURE_ENV_FILE": str(envfile), "VENDURE_FILE_BACKUP_RETENTION_DAYS": "5"})
        child = subprocess.run(["bash", str(SYSTEMD / "vendure-file-backup-retention")],
                               env=environment, capture_output=True, text=True, timeout=10)
        self.assertEqual(child.returncode, 0, child.stdout + child.stderr)
        result = json.loads(child.stdout)
        self.assertEqual(result["mode"], "apply")
        self.assertEqual(result["protected"], list(reversed(names)))
        self.assertEqual(result["residualRetentionDays"], 5)
        self.assertNotIn("UNPRINTED_SECRET", child.stdout + child.stderr)

    def test_twenty_successful_backups_bound_growth_and_recover_after_cloud_failure(self):
        names = []
        observations = []
        for day in range(1, 21):
            names.append(self.create(day))
            before = len(list(self.backups.glob("*.tar.gz")))
            if day == 10:
                result = self.run_retention(reader=mock.Mock(side_effect=RuntimeError("cloud temporarily unavailable")))
                self.assertEqual(result["status"], "blocked")
                self.assertEqual(result["removed"], [])
                self.assertTrue((self.backups / names[6]).exists())
            else:
                result = self.run_retention()
                self.assertEqual(result["status"], "ok")
            after = len(list(self.backups.glob("*.tar.gz")))
            self.assertEqual(result["protected"], list(reversed(names[-3:])))
            if day == 10:
                self.assertEqual(after, 4)
            else:
                self.assertEqual(after, min(day, 3))
            if day == 11:
                self.assertEqual(set(result["removed"]), {names[6], names[7]})
            for archive in self.backups.glob("*.tar.gz"):
                self.assertTrue(Path(str(archive) + ".manifest.json").exists())
                self.assertTrue(Path(str(archive) + ".sha256").exists())
            observations.append({"capture": day, "beforeRetention": before, "afterRetention": after,
                                 "status": result["status"], "protected": result["protected"],
                                 "removed": result["removed"]})
        final_names = sorted(path.name for path in self.backups.glob("*.tar.gz"))
        self.assertEqual(final_names, names[-3:])
        self.assertEqual(len(self.existing()), 9)
        for call in self.policy.call_args_list:
            self.assertEqual(call.args, (TOOL.OFFSITE_URI, 30))
        evidence = {"status": "passed", "captureCount": 20, "cloudFailureCapture": 10,
                    "cloudRecoveryCapture": 11, "maxBeforeRetention": max(item["beforeRetention"] for item in observations),
                    "maxAfterRetention": max(item["afterRetention"] for item in observations),
                    "finalCompleteSets": len(final_names), "finalThreePieceFileCount": len(self.existing()),
                    "finalArchives": final_names, "observations": observations}
        (OUTPUT / "repeated-successful-backups.json").write_text(json.dumps(evidence, indent=2) + "\n")


if __name__ == "__main__":
    unittest.main()
