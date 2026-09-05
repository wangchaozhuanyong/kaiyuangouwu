"""2FA backup security checks. All keys and AWS responses are local fixtures."""

import base64
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


sys.dont_write_bytecode = True
MODULE_PATH = Path(__file__).resolve().parents[3] / "deploy" / "two-factor-key-backup.py"
SPEC = importlib.util.spec_from_file_location("two_factor_key_backup", MODULE_PATH)
backup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup)

SOURCE_SHA = "a" * 40
KEYS = {
    backup.KEY_NAMES[0]: "Da7kP4s9Gn2mL6v8Xq5eJ1z3Wc0rBfYu",
    backup.KEY_NAMES[1]: "0123456789abcdef" * 4,
}
FINGERPRINT = [11, 22, 1000, 1000, 0o100600, 180, 100, 100]
VERSION = "fixture-version-1"


def payload(keys=None, source_sha=SOURCE_SHA):
    return json.dumps({"format": 1, "sourceSha": source_sha, "keys": keys or KEYS},
                      separators=(",", ":")).encode()


def processes(keys=None):
    return [{"name": name, "pm2_env": {"status": "online", **(keys or KEYS)}}
            for name in ("vendure-api", "vendure-worker")]


class FakeS3:
    def __init__(self, body=None):
        self.body = body
        self.calls = []
        self.overrides = {}
        self.fail = {}

    def call(self, operation, parameters, download=False, missing_ok=False):
        self.calls.append((operation, copy.deepcopy(parameters), download, missing_ok))
        if operation in self.fail:
            raise self.fail[operation]
        metadata = {"VersionId": VERSION, "ServerSideEncryption": "AES256",
                    "ContentLength": len(self.body or b"")}
        if operation in self.overrides:
            return copy.deepcopy(self.overrides[operation])
        if operation == "get-bucket-versioning":
            return {"Status": "Enabled"}
        if operation == "get-public-access-block":
            return {"PublicAccessBlockConfiguration": {
                "BlockPublicAcls": True, "IgnorePublicAcls": True,
                "BlockPublicPolicy": True, "RestrictPublicBuckets": True}}
        if operation == "get-bucket-ownership-controls":
            return {"OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]}}
        if operation == "get-bucket-encryption":
            return {"ServerSideEncryptionConfiguration": {"Rules": [
                {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}}
        if operation == "head-object":
            return metadata if self.body is not None else None
        if operation == "put-object":
            if self.body is not None:
                raise backup.BackupBlocked("S3_PUT_OBJECT_FAILED")
            self.body = base64.b64decode(parameters["Body"], validate=True)
            return {**metadata, "ContentLength": len(self.body)}
        if operation == "get-object":
            if self.body is None:
                raise AssertionError("Fixture object does not exist")
            return metadata, self.body
        raise AssertionError("Unexpected AWS operation: " + operation)

    def writes(self):
        return [call for call in self.calls if call[0] == "put-object"]


class BackupTests(unittest.TestCase):
    def execute(self, client, operation="plan-two-factor-backup", expected_plan="", **kwargs):
        return backup.execute(operation, SOURCE_SHA, expected_plan, client=client,
                              source_reader=kwargs.pop("source_reader", lambda: (copy.deepcopy(KEYS), FINGERPRINT[:])),
                              runtime_reader=kwargs.pop("runtime_reader", processes), **kwargs)

    def reviewed(self, client):
        return self.execute(client)["planSha256"]

    def blocked(self, code, callable_):
        with self.assertRaisesRegex(backup.BackupBlocked, "^" + code + "$"):
            callable_()

    def test_plan_is_read_only_with_exact_fixed_scope_and_no_secret_output(self):
        client = FakeS3()
        report = self.execute(client)
        self.assertEqual(client.writes(), [])
        self.assertFalse(report["writePerformed"])
        self.assertFalse(report["restoreVerified"])
        self.assertEqual(report["bucket"], backup.BUCKET)
        self.assertEqual(report["objectKey"], f"mysql/two-factor-key-backups/{SOURCE_SHA}.json")
        self.assertEqual(report["keyNames"], list(backup.KEY_NAMES))
        self.assertEqual(report["plan"]["action"], "create-and-verify")
        for secret in KEYS.values():
            self.assertNotIn(secret, json.dumps(report))

    def test_missing_or_inexact_approval_never_creates_an_object(self):
        for approval in ("", "z" * 64, "b" * 64):
            with self.subTest(approval=approval[:1]):
                client = FakeS3()
                with self.assertRaises(backup.BackupBlocked):
                    self.execute(client, "backup-two-factor-reviewed", approval)
                self.assertEqual(client.writes(), [])

    def test_read_only_modes_reject_write_approval_and_arbitrary_requests(self):
        for operation in ("plan-two-factor-backup", "verify-two-factor-backup"):
            self.blocked("REVIEWED_PLAN_REQUIRED", lambda: self.execute(FakeS3(), operation, "a" * 64))
        for operation, source in (("shell", SOURCE_SHA), ("plan-two-factor-backup", "main"),
                                  ("plan-two-factor-backup", "A" * 40)):
            self.blocked("REQUEST_INVALID", lambda: backup.execute(operation, source, client=FakeS3()))

    def test_bucket_safety_metadata_must_all_pass_before_source_is_read_or_written(self):
        cases = [
            ("get-bucket-versioning", {}, "BUCKET_VERSIONING_REQUIRED"),
            ("get-bucket-versioning", {"Status": "Suspended"}, "BUCKET_VERSIONING_REQUIRED"),
            ("get-public-access-block", {"PublicAccessBlockConfiguration": {
                "BlockPublicAcls": True, "IgnorePublicAcls": True, "BlockPublicPolicy": True,
                "RestrictPublicBuckets": False}}, "BUCKET_PUBLIC_ACCESS_BLOCK_REQUIRED"),
            ("get-bucket-ownership-controls", {"OwnershipControls": {"Rules": [
                {"ObjectOwnership": "ObjectWriter"}]}}, "BUCKET_OWNER_ENFORCEMENT_REQUIRED"),
            ("get-bucket-encryption", {"ServerSideEncryptionConfiguration": {"Rules": [
                {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}}]}},
             "BUCKET_ENCRYPTION_DIFFERS_FROM_REVIEWED_SSE_S3"),
        ]
        for operation, response, code in cases:
            with self.subTest(operation=operation):
                client = FakeS3()
                client.overrides[operation] = response
                source = mock.Mock(side_effect=AssertionError("source must remain unread"))
                self.blocked(code, lambda: self.execute(client, source_reader=source))
                source.assert_not_called()
                self.assertEqual(client.writes(), [])

    def test_bucket_metadata_access_denial_is_not_treated_as_safe_default(self):
        client = FakeS3()
        client.fail["get-bucket-versioning"] = backup.BackupBlocked("S3_GET_BUCKET_VERSIONING_FAILED")
        self.blocked("S3_GET_BUCKET_VERSIONING_FAILED", lambda: self.execute(client))
        self.assertEqual(client.writes(), [])

    def test_parser_selects_only_the_two_keys_without_executing_shell(self):
        source = "\n".join(("IGNORED=$(touch /a/path/that/must/not/be/executed)",
                             f"export {backup.KEY_NAMES[0]}='{KEYS[backup.KEY_NAMES[0]]}'",
                             f'{backup.KEY_NAMES[1]}="{KEYS[backup.KEY_NAMES[1]]}"',
                             "DB_PASSWORD=unrelated-credential"))
        self.assertEqual(backup.parse_keys(source), KEYS)

    def test_parser_rejects_duplicates_shell_syntax_missing_and_weak_keys(self):
        base = "\n".join(f"{name}={value}" for name, value in KEYS.items())
        cases = [base + f"\n{backup.KEY_NAMES[0]}={KEYS[backup.KEY_NAMES[0]]}",
                 f"{backup.KEY_NAMES[0]}=$(printf secret)\n{backup.KEY_NAMES[1]}={KEYS[backup.KEY_NAMES[1]]}",
                 f'{backup.KEY_NAMES[0]}="unclosed\n{backup.KEY_NAMES[1]}={KEYS[backup.KEY_NAMES[1]]}',
                 f"{backup.KEY_NAMES[0]}=a`id`\n{backup.KEY_NAMES[1]}={KEYS[backup.KEY_NAMES[1]]}",
                 f"{backup.KEY_NAMES[0]}={'a' * 32};id\n{backup.KEY_NAMES[1]}={KEYS[backup.KEY_NAMES[1]]}",
                 f"{backup.KEY_NAMES[0]}={'a' * 32} # comment\n{backup.KEY_NAMES[1]}={KEYS[backup.KEY_NAMES[1]]}",
                 f"{backup.KEY_NAMES[0]}={KEYS[backup.KEY_NAMES[0]]}"]
        for source in cases:
            with self.subTest(source=source[:20]):
                with self.assertRaises(backup.BackupBlocked):
                    backup.parse_keys(source)
        for changed in ({backup.KEY_NAMES[0]: "replace-with-a-long-enough-placeholder"},
                        {backup.KEY_NAMES[1]: "a" * 64},
                        {backup.KEY_NAMES[1]: "z" * 64},
                        {backup.KEY_NAMES[0]: KEYS[backup.KEY_NAMES[1]]}):
            with self.assertRaises(backup.BackupBlocked):
                backup.validate_keys({**KEYS, **changed})
        with self.assertRaises(backup.BackupBlocked):
            backup.validate_keys({**KEYS, "DB_PASSWORD": "not-allowed"})

    def test_source_file_permissions_type_owner_and_links_are_checked(self):
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root) / ".env"
            filename.write_text("\n".join(f"{name}={value}" for name, value in KEYS.items()))
            for mode in (0o600, 0o640):
                filename.chmod(mode)
                self.assertEqual(backup.read_source(str(filename), {os.getuid()})[0], KEYS)
            for mode in (0o644, 0o660, 0o602):
                filename.chmod(mode)
                self.blocked("SOURCE_PERMISSIONS_UNSAFE", lambda: backup.read_source(str(filename), {os.getuid()}))
            filename.chmod(0o600)
            self.blocked("SOURCE_PERMISSIONS_UNSAFE", lambda: backup.read_source(str(filename), {os.getuid() + 1}))
            alias = Path(root) / "link"
            alias.symlink_to(filename)
            with self.assertRaises((OSError, backup.BackupBlocked)):
                backup.read_source(str(alias), {os.getuid()})
            alias.unlink()
            os.link(filename, alias)
            self.blocked("SOURCE_NOT_PRIVATE_FILE", lambda: backup.read_source(str(filename), {os.getuid()}))

    def test_source_file_size_is_bounded(self):
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root) / ".env"
            filename.touch(mode=0o600)
            for value in ("", "a" * 131073):
                filename.write_text(value)
                self.blocked("SOURCE_SIZE_INVALID", lambda: backup.read_source(str(filename), {os.getuid()}))

    def test_source_identity_ignores_access_time_but_binds_content_and_permission_changes(self):
        before = dict(st_dev=1, st_ino=2, st_uid=1000, st_gid=1000, st_mode=0o100600,
                      st_size=180, st_mtime_ns=10, st_ctime_ns=11, st_atime_ns=12)
        identity = backup.source_identity(SimpleNamespace(**before))
        self.assertEqual(identity, backup.source_identity(SimpleNamespace(**{**before, "st_atime_ns": 99})))
        for name in ("st_ino", "st_uid", "st_gid", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns"):
            self.assertNotEqual(identity, backup.source_identity(SimpleNamespace(**{**before, name: 9999})))

    def test_both_runtime_processes_must_be_unique_online_and_match_source_keys(self):
        variants = [[], processes()[:1], processes() + [processes()[0]]]
        stopped = processes()
        stopped[1]["pm2_env"]["status"] = "stopped"
        variants.append(stopped)
        mismatch = processes()
        mismatch[1]["pm2_env"][backup.KEY_NAMES[0]] = "Other-valid-fixture-key-which-is-long-enough"
        variants.append(mismatch)
        missing = processes()
        del missing[0]["pm2_env"][backup.KEY_NAMES[1]]
        variants.append(missing)
        for runtime in variants:
            with self.subTest(runtime_count=len(runtime)):
                client = FakeS3()
                with self.assertRaises(backup.BackupBlocked):
                    self.execute(client, runtime_reader=lambda: runtime)
                self.assertEqual(client.writes(), [])

    def test_exact_approval_creates_checksum_protected_object_and_recovers_exact_version(self):
        client = FakeS3()
        approval = self.reviewed(client)
        report = self.execute(client, "backup-two-factor-reviewed", approval)
        self.assertTrue(report["writePerformed"])
        self.assertTrue(report["restoreVerified"])
        self.assertTrue(report["sourceUnchanged"])
        self.assertEqual(report["versionId"], VERSION)
        self.assertEqual(len(client.writes()), 1)
        put = client.writes()[0][1]
        self.assertEqual(put["IfNoneMatch"], "*")
        self.assertEqual(put["ServerSideEncryption"], "AES256")
        body = base64.b64decode(put["Body"], validate=True)
        self.assertEqual(put["ContentLength"], len(body))
        self.assertEqual(put["ChecksumSHA256"], base64.b64encode(hashlib.sha256(body).digest()).decode())
        self.assertEqual(json.loads(body), {"format": 1, "sourceSha": SOURCE_SHA, "keys": KEYS})
        get = [call for call in client.calls if call[0] == "get-object"]
        self.assertEqual(len(get), 1)
        self.assertEqual(get[0][1]["VersionId"], VERSION)
        self.assertTrue(get[0][2])
        version_heads = [call for call in client.calls if call[0] == "head-object" and "VersionId" in call[1]]
        self.assertEqual(len(version_heads), 1)
        self.assertEqual(version_heads[0][1]["VersionId"], VERSION)
        self.assertLess(client.calls.index(version_heads[0]), client.calls.index(get[0]))

    def test_existing_backup_is_verified_without_overwriting(self):
        client = FakeS3(payload())
        report = self.execute(client)
        self.assertEqual(report["plan"]["action"], "verify-existing")
        self.assertTrue(report["restoreVerified"])
        self.assertEqual(client.writes(), [])
        self.assertTrue(self.execute(client, "verify-two-factor-backup")["restoreVerified"])
        self.assertEqual(client.writes(), [])

    def test_verify_missing_object_never_creates_it(self):
        client = FakeS3()
        self.blocked("BACKUP_NOT_FOUND", lambda: self.execute(client, "verify-two-factor-backup"))
        self.assertEqual(client.writes(), [])

    def test_approval_is_invalidated_by_source_keys_file_or_existing_version_changes(self):
        client = FakeS3()
        approval = self.reviewed(client)
        changed = {**KEYS, backup.KEY_NAMES[0]: "Other-valid-fixture-key-which-is-long-enough"}
        cases = [dict(source_reader=lambda: (changed, FINGERPRINT[:]), runtime_reader=lambda: processes(changed)),
                 dict(source_reader=lambda: (copy.deepcopy(KEYS), FINGERPRINT[:-1] + [999]))]
        for changes in cases:
            self.blocked("REVIEWED_PLAN_CHANGED", lambda: self.execute(client, "backup-two-factor-reviewed", approval, **changes))
        client.body = payload()
        self.blocked("REVIEWED_PLAN_CHANGED", lambda: self.execute(client, "backup-two-factor-reviewed", approval))
        self.assertEqual(client.writes(), [])

    def test_source_change_before_put_blocks_without_writing(self):
        client = FakeS3()
        approval = self.reviewed(client)
        source = mock.Mock(side_effect=[(copy.deepcopy(KEYS), FINGERPRINT[:]),
                                        (copy.deepcopy(KEYS), FINGERPRINT[:-1] + [999])])
        self.blocked("SOURCE_CHANGED_BEFORE_BACKUP", lambda: self.execute(client, "backup-two-factor-reviewed", approval, source_reader=source))
        self.assertEqual(client.writes(), [])

    def test_source_change_after_upload_keeps_backup_and_reports_no_false_success(self):
        client = FakeS3()
        approval = self.reviewed(client)
        source = mock.Mock(side_effect=[(copy.deepcopy(KEYS), FINGERPRINT[:]),
                                        (copy.deepcopy(KEYS), FINGERPRINT[:]),
                                        (copy.deepcopy(KEYS), FINGERPRINT[:-1] + [999])])
        report = {}
        self.blocked("SOURCE_CHANGED_DURING_BACKUP", lambda: self.execute(client, "backup-two-factor-reviewed", approval, source_reader=source, report=report))
        self.assertEqual(len(client.writes()), 1)
        self.assertFalse(report["restoreVerified"])
        self.assertIsNotNone(client.body)
        self.assertNotIn("delete-object", [call[0] for call in client.calls])

    def test_conflicting_existing_backup_is_not_overwritten(self):
        changed = {**KEYS, backup.KEY_NAMES[0]: "Other-valid-fixture-key-which-is-long-enough"}
        client = FakeS3(payload(changed))
        self.blocked("RESTORED_KEYS_MISMATCH", lambda: self.execute(client))
        self.assertEqual(client.writes(), [])

    def test_object_appearing_during_upload_causes_conditional_failure_not_overwrite(self):
        client = FakeS3()
        approval = self.reviewed(client)
        client.fail["put-object"] = backup.BackupBlocked("S3_PUT_OBJECT_FAILED")
        self.blocked("S3_PUT_OBJECT_FAILED", lambda: self.execute(client, "backup-two-factor-reviewed", approval))
        self.assertEqual(len(client.writes()), 1)
        self.assertEqual(client.writes()[0][1]["IfNoneMatch"], "*")
        self.assertNotIn("get-object", [call[0] for call in client.calls])

    def test_unversioned_or_wrongly_encrypted_objects_fail_closed(self):
        for metadata in ({"ServerSideEncryption": "AES256"},
                         {"VersionId": "null", "ServerSideEncryption": "AES256"},
                         {"VersionId": VERSION, "ServerSideEncryption": "aws:kms"}):
            client = FakeS3(payload())
            client.overrides["head-object"] = metadata
            with self.assertRaises(backup.BackupBlocked):
                self.execute(client)
            self.assertEqual(client.writes(), [])

    def test_restored_metadata_and_payload_must_match_exact_scope(self):
        cases = [({"format": 1, "sourceSha": "b" * 40, "keys": KEYS}, "BACKUP_SOURCE_MISMATCH"),
                 ({"format": 1, "sourceSha": SOURCE_SHA, "keys": KEYS, "other": 1}, "BACKUP_SCHEMA_INVALID"),
                 ({"format": 1, "sourceSha": SOURCE_SHA, "keys": {**KEYS, "COOKIE_SECRET": "extra"}}, "KEY_SET_INVALID")]
        for value, code in cases:
            client = FakeS3(json.dumps(value).encode())
            self.blocked(code, lambda: self.execute(client))
        client = FakeS3(payload())
        client.overrides["get-object"] = ({"VersionId": "wrong-version", "ServerSideEncryption": "AES256"}, payload())
        self.blocked("RESTORED_VERSION_MISMATCH", lambda: self.execute(client))

    def test_version_head_bounds_download_before_get_and_requires_exact_body_size(self):
        for length in (0, -1, backup.MAX_BODY + 1, "180", True):
            client = FakeS3(payload())
            client.overrides["head-object"] = {"VersionId": VERSION, "ServerSideEncryption": "AES256",
                                                "ContentLength": length}
            self.blocked("BACKUP_BODY_OVERSIZED", lambda: self.execute(client))
            self.assertNotIn("get-object", [call[0] for call in client.calls])
        client = FakeS3(payload())
        client.overrides["get-object"] = ({"VersionId": VERSION, "ServerSideEncryption": "AES256"}, payload() + b" ")
        self.blocked("BACKUP_BODY_SIZE_MISMATCH", lambda: self.execute(client))

    def test_runtime_change_after_upload_does_not_report_recovery_success(self):
        client = FakeS3()
        approval = self.reviewed(client)
        stopped = processes()
        stopped[1]["pm2_env"]["status"] = "stopped"
        runtime = mock.Mock(side_effect=[processes(), processes(), stopped])
        report = {}
        self.blocked("RUNTIME_PROCESS_NOT_ONLINE", lambda: self.execute(
            client, "backup-two-factor-reviewed", approval, runtime_reader=runtime, report=report))
        self.assertEqual(len(client.writes()), 1)
        self.assertFalse(report["restoreVerified"])

    def test_main_redacts_unexpected_exceptions_and_does_not_emit_completion(self):
        secret = KEYS[backup.KEY_NAMES[0]]
        stdout = io.StringIO()
        stderr = io.StringIO()
        with mock.patch.object(sys, "argv", [str(MODULE_PATH), "plan-two-factor-backup", SOURCE_SHA, ""]), \
                mock.patch.object(backup, "execute", side_effect=RuntimeError(secret)), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            self.assertEqual(backup.main(), 1)
        result = stdout.getvalue() + stderr.getvalue()
        self.assertNotIn(secret, result)
        self.assertNotIn(base64.b64encode(secret.encode()).decode(), result)
        self.assertNotIn("Traceback", result)
        self.assertNotIn("TWO_FACTOR_KEY_BACKUP_COMPLETE", result)
        self.assertEqual(json.loads(stdout.getvalue())["reason"], "BACKUP_OPERATION_FAILED")

    @unittest.skipUnless(sys.platform == "linux" and hasattr(os, "memfd_create"), "Linux memfd boundary")
    def test_aws_cli_uses_anonymous_memory_and_discards_secret_stderr(self):
        client = backup.AwsCli.__new__(backup.AwsCli)
        client.executable = "/fixture/aws"
        secret = KEYS[backup.KEY_NAMES[0]]
        captured = {}

        def fake_run(command, **kwargs):
            captured["command"] = command
            captured["environment"] = kwargs["env"]
            self.assertNotIn(secret, " ".join(command))
            self.assertNotIn(secret, json.dumps(kwargs["env"]))
            request_fd = kwargs["pass_fds"][0]
            self.assertEqual(os.fstat(request_fd).st_nlink, 0)
            self.assertEqual(os.fstat(request_fd).st_mode & 0o777, 0o600)
            request = json.loads(os.read(request_fd, 65536))
            self.assertEqual(request["Bucket"], backup.BUCKET)
            self.assertEqual(request["ExpectedBucketOwner"], backup.OWNER)
            self.assertEqual(request["Body"], base64.b64encode(secret.encode()).decode())
            return subprocess.CompletedProcess(command, 1, b"", secret.encode())

        with mock.patch.object(backup.subprocess, "run", side_effect=fake_run):
            self.blocked("S3_PUT_OBJECT_FAILED", lambda: client.call("put-object", {
                "Key": "fixed-fixture", "Body": base64.b64encode(secret.encode()).decode()}))
        self.assertEqual(captured["environment"]["AWS_CONFIG_FILE"], "/dev/null")
        self.assertEqual(captured["environment"]["AWS_SHARED_CREDENTIALS_FILE"], "/dev/null")
        self.assertNotIn("AWS_ACCESS_KEY_ID", captured["environment"])

    @unittest.skipUnless(sys.platform == "linux" and hasattr(os, "memfd_create"), "Linux memfd boundary")
    def test_aws_cli_download_uses_anonymous_memory_and_closes_descriptors(self):
        client = backup.AwsCli.__new__(backup.AwsCli)
        client.executable = "/fixture/aws"
        inherited = []

        def fake_run(command, **kwargs):
            inherited.extend(kwargs["pass_fds"])
            request_fd, body_fd = kwargs["pass_fds"]
            request = json.loads(os.read(request_fd, 65536))
            self.assertEqual(request["VersionId"], VERSION)
            self.assertEqual(os.fstat(body_fd).st_nlink, 0)
            self.assertEqual(os.fstat(body_fd).st_mode & 0o777, 0o600)
            self.assertEqual(command[-1], f"/proc/self/fd/{body_fd}")
            os.write(body_fd, payload())
            return subprocess.CompletedProcess(command, 0, json.dumps({
                "VersionId": VERSION, "ServerSideEncryption": "AES256"}).encode(), b"")

        with mock.patch.object(backup.subprocess, "run", side_effect=fake_run):
            metadata, body = client.call("get-object", {"Key": "fixed-fixture", "VersionId": VERSION}, download=True)
        self.assertEqual(metadata["VersionId"], VERSION)
        self.assertEqual(body, payload())
        for descriptor in inherited:
            with self.assertRaises(OSError):
                os.fstat(descriptor)

    @unittest.skipUnless(sys.platform == "linux" and hasattr(os, "memfd_create"), "Linux memfd boundary")
    def test_aws_cli_only_treats_definite_missing_object_as_absent(self):
        client = backup.AwsCli.__new__(backup.AwsCli)
        client.executable = "/fixture/aws"
        for error in (b"An error occurred (404)", b"An error occurred (NoSuchKey)"):
            with mock.patch.object(backup.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, b"", error)):
                self.assertIsNone(client.call("head-object", {"Key": "fixture"}, missing_ok=True))
        with mock.patch.object(backup.subprocess, "run", return_value=subprocess.CompletedProcess(
                [], 1, b"", b"An error occurred (403) AccessDenied")):
            self.blocked("S3_HEAD_OBJECT_ACCESS_DENIED", lambda: client.call("head-object", {"Key": "fixture"}, missing_ok=True))


if __name__ == "__main__":
    unittest.main(verbosity=2)
