#!/usr/bin/env python3
"""Keep three local recovery sets; prune older sets only with verified offsite copies."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import time


DEFAULT_DIRECTORY = "/var/backups/vendure-files"
OFFSITE_URI = "s3://yunqiao-vendure-prod-backup-098208446664-apne1/files"
OFFSITE_BUCKET = "yunqiao-vendure-prod-backup-098208446664-apne1"
OFFSITE_PREFIX = "files/"
OFFSITE_DAYS = 30
KEEP_COUNT = 3
STAMP = r"[0-9]{8}T[0-9]{6}Z"
ARCHIVE = re.compile(rf"vendure-files-{STAMP}\.tar\.gz")
MEMBER = re.compile(rf"(?P<archive>vendure-files-{STAMP}\.tar\.gz)(?:\.manifest\.json|\.sha256)?")
FAILED = re.compile(rf"vendure-files-{STAMP}\.tar\.gz(?:\.part(?:\.manifest\.json)?|\.sha256\.part)\.failed")
SNAPSHOT = re.compile(rf"\.s3-source-{STAMP}")
SETTING_NAMES = (
    "VENDURE_REQUIRE_OFFSITE_FILE_BACKUP",
    "VENDURE_FILE_BACKUP_S3_URI",
    "VENDURE_FILE_BACKUP_S3_RETENTION_DAYS",
)


class RetentionError(ValueError):
    """Contains only a fixed, non-secret reason code."""


def file_identity(metadata: os.stat_result) -> tuple[int, ...]:
    return (
        metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_nlink,
        metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns,
    )


def real_directory(directory: Path) -> os.stat_result:
    if not directory.is_absolute() or directory == Path("/") or ".." in directory.parts:
        raise RetentionError("unsafe-backup-directory")
    metadata = directory.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or directory.resolve(strict=True) != directory:
        raise RetentionError("unsafe-backup-directory")
    return metadata


def unchanged_directory(directory: Path, root_fd: int) -> None:
    current = real_directory(directory)
    opened = os.fstat(root_fd)
    if (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino):
        raise RetentionError("backup-directory-changed")


def regular_file(root_fd: int, name: str) -> os.stat_result:
    metadata = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise RetentionError("unsafe-local-file")
    return metadata


@contextmanager
def backup_lock(directory: Path, inherited_fd: int | None = None, timeout: float = 300):
    real_directory(directory)
    root_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    lock_fd = None
    try:
        unchanged_directory(directory, root_fd)
        if inherited_fd is None:
            lock_fd = os.open(".backup.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=root_fd)
        else:
            lock_fd = inherited_fd
        expected = regular_file(root_fd, ".backup.lock")
        actual = os.fstat(lock_fd)
        if not stat.S_ISREG(actual.st_mode) or file_identity(actual) != file_identity(expected):
            raise RetentionError("inherited-lock-does-not-match")
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError as error:
                if inherited_fd is not None or time.monotonic() >= deadline:
                    raise RetentionError("backup-lock-busy") from error
                time.sleep(0.1)
        unchanged_directory(directory, root_fd)
        if file_identity(regular_file(root_fd, ".backup.lock")) != file_identity(os.fstat(lock_fd)):
            raise RetentionError("backup-lock-changed")
        yield root_fd
    finally:
        # Never LOCK_UN an inherited open file description: that would also
        # release the parent backup process's lock.
        if lock_fd is not None and inherited_fd is None:
            os.close(lock_fd)
        os.close(root_fd)


def checked_read(root_fd: int, name: str, *, limit: int | None = None, digest: bool = False):
    initial = regular_file(root_fd, name)
    if limit is not None and (initial.st_size <= 0 or initial.st_size > limit):
        raise RetentionError("invalid-local-file-size")
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
    try:
        if file_identity(os.fstat(fd)) != file_identity(initial):
            raise RetentionError("local-file-changed")
        result = hashlib.sha256() if digest else bytearray()
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            if digest:
                result.update(chunk)
            else:
                result.extend(chunk)
                if limit is not None and len(result) > limit:
                    raise RetentionError("invalid-local-file-size")
        if file_identity(os.fstat(fd)) != file_identity(initial):
            raise RetentionError("local-file-changed")
        if file_identity(regular_file(root_fd, name)) != file_identity(initial):
            raise RetentionError("local-file-changed")
        return result.hexdigest() if digest else bytes(result)
    finally:
        os.close(fd)


def local_set(root_fd: int, name: str, *, verify_hashes: bool = True) -> dict[str, object]:
    names = [name, name + ".manifest.json", name + ".sha256"]
    metadata = {item: regular_file(root_fd, item) for item in names}
    checksum = checked_read(root_fd, names[2], limit=8191)
    try:
        lines = checksum.decode("ascii").rstrip("\n").split("\n")
    except UnicodeDecodeError as error:
        raise RetentionError("invalid-local-checksum") from error
    expected = {}
    for line in lines:
        match = re.fullmatch(r"([a-f0-9]{64})  (.+)", line)
        if not match or match[2] not in names[:2] or match[2] in expected:
            raise RetentionError("invalid-local-checksum")
        expected[match[2]] = match[1]
    if set(expected) != set(names[:2]):
        raise RetentionError("invalid-local-checksum")
    for item in names[:2]:
        if metadata[item].st_size <= 0:
            raise RetentionError("invalid-local-file-size")
        if verify_hashes and checked_read(root_fd, item, digest=True) != expected[item]:
            raise RetentionError("local-checksum-mismatch")
    for item in names:
        if file_identity(regular_file(root_fd, item)) != file_identity(metadata[item]):
            raise RetentionError("local-file-changed")
    return {"name": name, "files": metadata, "checksum": checksum}


def aws_json(*arguments: str) -> dict[str, object]:
    try:
        result = subprocess.run(
            ["aws", "s3api", *arguments, "--output", "json"],
            check=True, capture_output=True, text=True, timeout=30,
        )
        if len(result.stdout) > 65536:
            raise RetentionError("invalid-offsite-metadata")
        value = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        raise RetentionError("offsite-read-failed") from error
    if not isinstance(value, dict):
        raise RetentionError("invalid-offsite-metadata")
    return value


def verify_policy(uri: str, days: int) -> object:
    location = Path(__file__).with_name("vendure-backup-s3-guard.py")
    specification = importlib.util.spec_from_file_location("vendure_backup_s3_guard", location)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module.verify_policy(uri, days)


def remote_checksum(directory: Path, name: str, version_id: str) -> bytes:
    # Read only the small current checksum and require the response to identify
    # the exact HEAD-verified version. A replacement during this read fails closed.
    # This uses the existing GetObject permission, not historical-version access.
    if not isinstance(version_id, str) or not version_id or version_id == "null":
        raise RetentionError("offsite-version-missing")
    fd, temporary_name = tempfile.mkstemp(prefix=".retention-checksum-", dir=directory)
    os.close(fd)
    temporary_path = Path(temporary_name)
    try:
        response = subprocess.run(
            ["aws", "s3api", "get-object", "--bucket", OFFSITE_BUCKET,
             "--key", OFFSITE_PREFIX + name,
             "--range", "bytes=0-8191", str(temporary_path), "--output", "json"],
            check=True, capture_output=True, timeout=30,
        )
        if len(response.stdout) > 65536:
            raise RetentionError("invalid-offsite-metadata")
        metadata = json.loads(response.stdout)
        if not isinstance(metadata, dict) or metadata.get("VersionId") != version_id:
            raise RetentionError("offsite-checksum-version-changed")
        root_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            return checked_read(root_fd, temporary_path.name, limit=8191)
        finally:
            os.close(root_fd)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        raise RetentionError("offsite-checksum-read-failed") from error
    finally:
        temporary_path.unlink(missing_ok=True)


def offsite_set(directory: Path, backup: dict[str, object], reader, checksum_reader) -> None:
    checksum_version = None
    for name, metadata in backup["files"].items():
        remote = reader("head-object", "--bucket", OFFSITE_BUCKET, "--key", OFFSITE_PREFIX + name)
        if remote.get("ContentLength") != metadata.st_size or remote.get("ServerSideEncryption") != "AES256":
            raise RetentionError("offsite-metadata-mismatch")
        version = remote.get("VersionId")
        if not isinstance(version, str) or not version or version == "null":
            raise RetentionError("offsite-version-missing")
        if name.endswith(".sha256"):
            checksum_version = version
    if checksum_reader(directory, backup["name"] + ".sha256", checksum_version) != backup["checksum"]:
        raise RetentionError("offsite-checksum-mismatch")


def read_settings(environment: dict[str, str], environment_file: Path) -> dict[str, str]:
    settings = {}
    if not all(name in environment for name in SETTING_NAMES):
        fd = os.open(environment_file, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            metadata = os.fstat(fd)
            if not stat.S_ISREG(metadata.st_mode) or not 0 < metadata.st_size <= 1024 * 1024:
                raise RetentionError("invalid-environment-file")
            content = os.read(fd, 1024 * 1024 + 1).decode("utf8")
        finally:
            os.close(fd)
        for line in content.splitlines():
            match = re.fullmatch(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)", line)
            if not match or match[1] not in SETTING_NAMES:
                continue
            name, raw = match.groups()
            if name in settings:
                raise RetentionError("duplicate-backup-setting")
            tokens = shlex.split(raw, comments=True)
            if len(tokens) != 1:
                raise RetentionError("invalid-backup-setting")
            settings[name] = tokens[0]
    settings.update({name: environment[name] for name in SETTING_NAMES if name in environment})
    return settings


def approved_settings(settings: dict[str, str]) -> None:
    if settings.get(SETTING_NAMES[0]) != "true":
        raise RetentionError("offsite-backup-not-required")
    if settings.get(SETTING_NAMES[1]) != OFFSITE_URI:
        raise RetentionError("offsite-destination-changed")
    if settings.get(SETTING_NAMES[2]) != str(OFFSITE_DAYS):
        raise RetentionError("offsite-retention-policy-changed")


def retain(
    directory: Path, settings: dict[str, str], *, keep_count: int = KEEP_COUNT,
    residual_days: int = 14, apply: bool = True, inherited_fd: int | None = None,
    reader=aws_json, policy_verifier=verify_policy, checksum_reader=remote_checksum,
) -> dict[str, object]:
    if isinstance(keep_count, bool) or not isinstance(keep_count, int) or keep_count < 3:
        raise RetentionError("at-least-three-local-backups-required")
    if isinstance(residual_days, bool) or not isinstance(residual_days, int) or residual_days < 5:
        raise RetentionError("residual-retention-requires-at-least-five-days")
    report = {"mode": "apply" if apply else "dry-run", "keepCount": keep_count,
              "residualRetentionDays": residual_days,
              "protected": [], "candidates": [], "removed": [], "blocked": [],
              "residualCandidates": [], "reclaimedBytes": 0}
    with backup_lock(directory, inherited_fd) as root_fd:
        names = sorted({match["archive"] for name in os.listdir(root_fd)
                        if (match := MEMBER.fullmatch(name))}, reverse=True)
        complete = []
        for name in names:
            try:
                complete.append(local_set(root_fd, name, verify_hashes=False))
            except FileNotFoundError:
                report["blocked"].append({"name": name, "reason": "incomplete-local-set"})
            except RetentionError as error:
                report["blocked"].append({"name": name, "reason": str(error)})
        # Frequent static releases have nothing to prune once only three full
        # sets remain. Do not read another ~9 GB of protected archive payloads.
        valid = complete
        if len(complete) > keep_count:
            valid = []
            for item in complete:
                try:
                    valid.append(local_set(root_fd, item["name"]))
                except RetentionError as error:
                    report["blocked"].append({"name": item["name"], "reason": str(error)})
        report["protected"] = [item["name"] for item in valid[:keep_count]]
        older = valid[keep_count:]
        policy_ready = False
        if older:
            try:
                approved_settings(settings)
                if policy_verifier(OFFSITE_URI, OFFSITE_DAYS) is False:
                    raise RetentionError("offsite-policy-unverified")
                policy_ready = True
            except Exception:
                report["blocked"].extend({"name": item["name"], "reason": "offsite-policy-unverified"}
                                         for item in older)
        for item in older if policy_ready else []:
            try:
                offsite_set(directory, item, reader, checksum_reader)
                unchanged_directory(directory, root_fd)
                # The copies providing our three-set recovery floor must still
                # be the exact files whose local hashes passed before pruning.
                for protected in valid[:keep_count]:
                    for name, metadata in protected["files"].items():
                        if file_identity(regular_file(root_fd, name)) != file_identity(metadata):
                            raise RetentionError("protected-local-set-changed")
                for name, metadata in item["files"].items():
                    if file_identity(regular_file(root_fd, name)) != file_identity(metadata):
                        raise RetentionError("local-file-changed-before-delete")
                report["candidates"].append(item["name"])
                if apply:
                    for name in item["files"]:
                        os.unlink(name, dir_fd=root_fd)
                    report["removed"].append(item["name"])
                    report["reclaimedBytes"] += sum(metadata.st_blocks * 512 for metadata in item["files"].values())
            except RetentionError as error:
                report["blocked"].append({"name": item["name"], "reason": str(error)})
            except Exception:
                report["blocked"].append({"name": item["name"], "reason": "offsite-or-local-verification-failed"})
        # Complete archives and orphan sidecars never enter an age-only deletion
        # path. Only failed capture parts and closed, strictly named snapshots do.
        cutoff = time.time() - (residual_days + 1) * 86400
        for name in sorted(os.listdir(root_fd)):
            is_failed, is_snapshot = bool(FAILED.fullmatch(name)), bool(SNAPSHOT.fullmatch(name))
            if not is_failed and not is_snapshot:
                continue
            metadata = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
            valid_type = ((is_failed and stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1)
                          or (is_snapshot and stat.S_ISDIR(metadata.st_mode) and metadata.st_dev == os.fstat(root_fd).st_dev))
            if not valid_type:
                report["blocked"].append({"name": name, "reason": "unsafe-residual-entry"})
                continue
            if metadata.st_mtime > cutoff:
                continue
            report["residualCandidates"].append(name)
            if apply:
                unchanged_directory(directory, root_fd)
                current = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
                if file_identity(current) != file_identity(metadata):
                    raise RetentionError("residual-changed-before-delete")
                if is_snapshot:
                    if not shutil.rmtree.avoids_symlink_attacks:
                        raise RetentionError("safe-snapshot-removal-unavailable")
                    shutil.rmtree(name, dir_fd=root_fd)
                else:
                    os.unlink(name, dir_fd=root_fd)
                    report["reclaimedBytes"] += metadata.st_blocks * 512
                report["removed"].append(name)
    report["status"] = "blocked" if report["blocked"] else "ok"
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    parser.add_argument("--lock-fd", type=int)
    parser.add_argument("--keep-count", type=int, default=KEEP_COUNT)
    args = parser.parse_args()
    environment = dict(os.environ)
    directory = Path(environment.get("VENDURE_FILE_BACKUP_DIR", DEFAULT_DIRECTORY))
    repository = Path(environment.get("VENDURE_REPO_DIR", "/var/www/kaiyuangouwu"))
    environment_file = Path(environment.get("VENDURE_ENV_FILE", str(repository / "packages/dev-server/.env")))
    raw_days = environment.get("VENDURE_FILE_BACKUP_RETENTION_DAYS", "14")
    if not re.fullmatch(r"[0-9]+", raw_days):
        raise RetentionError("residual-retention-requires-at-least-five-days")
    settings = read_settings(environment, environment_file)
    result = retain(directory, settings, keep_count=args.keep_count, residual_days=int(raw_days),
                    apply=not args.dry_run, inherited_fd=args.lock_fd)
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    if result["status"] == "blocked":
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except (RetentionError, OSError, ValueError) as error:
        reason = str(error) if isinstance(error, RetentionError) else "retention-inspection-failed"
        print(json.dumps({"status": "blocked", "reason": reason}, separators=(",", ":")))
        raise SystemExit(1) from error
