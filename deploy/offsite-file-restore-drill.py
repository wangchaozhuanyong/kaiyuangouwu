#!/usr/bin/env python3
"""Restore an exact offsite backup once and verify it for each release."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


BACKUP_NAME = re.compile(r"^vendure-files-[0-9]{8}T[0-9]{6}Z\.tar\.gz$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
RTO_SECONDS = 14400
MAXIMUM_BACKUP_AGE_SECONDS = 108000
DISK_RESERVE_BYTES = 1024 * 1024 * 1024
SCRIPT = Path(__file__).resolve()
TOOLS = SCRIPT.parent / "systemd"
RESTORE_POLICY_FILES = (
    SCRIPT, TOOLS / "vendure-file-backup.py", TOOLS / "vendure-s3-prefix-snapshot.py",
    TOOLS / "vendure-file-backup",
)


def load_backup_tool():
    spec = importlib.util.spec_from_file_location("vendure_file_backup", TOOLS / "vendure-file-backup.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("File backup tool is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def policy_sha256() -> str:
    hashes = "".join(f"{sha256_file(path)}\n" for path in RESTORE_POLICY_FILES)
    return hashlib.sha256(hashes.encode("ascii")).hexdigest()


def s3(operation: str, bucket: str, *arguments: str) -> dict:
    result = subprocess.check_output([
        "aws", "s3api", operation, "--bucket", bucket, *arguments, "--output", "json",
    ])
    return json.loads(result)


def latest_backup_name(bucket: str, prefix: str) -> str:
    objects = s3("list-objects-v2", bucket, "--prefix", prefix + "vendure-files-")
    checksums = [
        item for item in objects.get("Contents", [])
        if item["Key"].startswith(prefix) and item["Key"].endswith(".sha256")
        and BACKUP_NAME.fullmatch(item["Key"][len(prefix):-len(".sha256")])
    ]
    if not checksums:
        raise RuntimeError("No independently discoverable offsite file backup exists")
    latest = max(checksums, key=lambda item: (item["LastModified"], item["Key"]))
    return latest["Key"][len(prefix):-len(".sha256")]


def version_id(metadata: dict) -> str:
    value = metadata.get("VersionId")
    if not isinstance(value, str) or value in ("", "null"):
        raise ValueError("Offsite backup object has no immutable S3 version")
    return value


def utc_time(value: str) -> dt.datetime:
    instant = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if instant.tzinfo is None:
        raise ValueError("Offsite proof timestamp has no UTC offset")
    return instant.astimezone(dt.timezone.utc)


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def timestamp(instant: dt.datetime) -> str:
    return instant.isoformat(timespec="seconds").replace("+00:00", "Z")


def read_backup(bucket: str, key: str, workspace: Path, tool) -> tuple[dict, dict, str]:
    name = key.rsplit("/", 1)[-1]
    archive = s3("head-object", bucket, "--key", key)
    archive_version = version_id(archive)
    archive_bytes = archive["ContentLength"]
    etag = archive["ETag"]
    if type(archive_bytes) is not int or archive_bytes <= 0 or not re.fullmatch(r'"[0-9a-f-]+"', etag):
        raise ValueError("Offsite archive metadata is invalid")

    manifest_path = workspace / "manifest.json"
    checksum_path = workspace / "archive.sha256"
    manifest_version = version_id(s3(
        "get-object", bucket, "--key", key + ".manifest.json", str(manifest_path),
    ))
    checksum_version = version_id(s3(
        "get-object", bucket, "--key", key + ".sha256", str(checksum_path),
    ))
    entries = {}
    for line in checksum_path.read_text().splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})\s+\*?(.+)", line)
        if match is None or match.group(2) in entries:
            raise ValueError("Offsite checksum sidecar is malformed")
        entries[match.group(2)] = match.group(1)
    if set(entries) != {name, name + ".manifest.json"}:
        raise ValueError("Offsite checksum sidecar does not name the selected archive and manifest")
    manifest_sha = sha256_file(manifest_path)
    if manifest_sha != entries[name + ".manifest.json"]:
        raise ValueError("Offsite manifest checksum does not match")
    manifest = json.loads(manifest_path.read_bytes())
    tool.validate_manifest(manifest)
    created_at = utc_time(manifest["createdAt"])
    if not 0 <= (now() - created_at).total_seconds() <= MAXIMUM_BACKUP_AGE_SECONDS:
        raise ValueError("Offsite file backup is older than the configured recovery window")
    identity = {
        "bucket": bucket,
        "key": key,
        "versionId": archive_version,
        "archiveBytes": archive_bytes,
        "archiveSha256": entries[name],
        "manifestVersionId": manifest_version,
        "manifestSha256": manifest_sha,
        "checksumVersionId": checksum_version,
        "checksumSha256": sha256_file(checksum_path),
        "backupCreatedAt": timestamp(created_at),
        "restorePolicySha256": policy_sha256(),
    }
    return identity, manifest, etag


def reusable_receipt(path: Path, identity: dict, manifest: dict, observed_at: dt.datetime) -> dict | None:
    try:
        proof = json.loads(path.read_bytes())
        restored_at = utc_time(proof["completedAt"])
        archive = proof["archive"]
        if (
            proof["archiveIdentity"] == identity
            and proof["source"] == "offsite" and proof["method"] == "offhost-full-restore"
            and proof["backupFile"] == identity["key"].rsplit("/", 1)[-1]
            and proof["archiveSha256"] == identity["archiveSha256"]
            and re.fullmatch(r"[a-f0-9]{40}", proof["targetSha"])
            and re.fullmatch(r"[0-9]+", proof["runId"])
            and proof["rtoSeconds"] == RTO_SECONDS
            and type(proof["durationSeconds"]) is int and 0 <= proof["durationSeconds"] <= RTO_SECONDS
            and type(archive["fileCount"]) is int and archive["fileCount"] == manifest["fileCount"]
            and type(archive["totalBytes"]) is int and archive["totalBytes"] == manifest["totalBytes"]
            and utc_time(identity["backupCreatedAt"]) <= restored_at <= observed_at
        ):
            return proof
    except (FileNotFoundError, KeyError, TypeError, ValueError, AttributeError):
        pass
    return None


def full_restore(workspace: Path, identity: dict, manifest: dict, etag: str, tool) -> dict:
    required = int(manifest["totalBytes"]) + identity["archiveBytes"] + DISK_RESERVE_BYTES
    free = shutil.disk_usage(workspace).free
    if free < required:
        raise RuntimeError(f"Off-host restore disk is insufficient: free={free} required={required}")

    downloaded = workspace / "archive.tar.gz"
    # The deploy role reads current objects. If the key changes during the request,
    # If-Match rejects a changed ETag, and the response must still match VersionId.
    response = s3(
        "get-object", identity["bucket"], "--key", identity["key"], "--if-match", etag, str(downloaded),
    )
    if version_id(response) != identity["versionId"] or downloaded.stat().st_size != identity["archiveBytes"]:
        raise RuntimeError("Offsite archive changed after verification started")
    restored = workspace / "restored"
    with downloaded.open("rb") as stream:
        archive = tool.restore_stream(
            stream, restored, workspace / "manifest.json", identity["archiveSha256"],
        )
    for root in ("customer-avatars", "private-images"):
        source = restored / root
        if (source / "S3_SOURCE_MANIFEST.json").is_file():
            subprocess.run([
                sys.executable, str(TOOLS / "vendure-s3-prefix-snapshot.py"), "verify", str(source),
            ], check=True, stdout=subprocess.DEVNULL)
    return archive


def write_receipt(path: Path, receipt: dict) -> None:
    path.write_text(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n")


def run(bucket: str, prefix: str, target_sha: str, run_id: str, receipt: Path,
        prior_receipt: Path, release_receipt: Path) -> None:
    if not re.fullmatch(r"[a-f0-9]{40}", target_sha) or not re.fullmatch(r"[0-9]+", run_id):
        raise ValueError("Release identity is invalid")
    if not re.fullmatch(r"[a-z0-9.-]+", bucket) or not re.fullmatch(r"[A-Za-z0-9._/-]+/", prefix):
        raise ValueError("Backup bucket or prefix is invalid")
    if len({path.resolve() for path in (receipt, prior_receipt, release_receipt)}) != 3:
        raise ValueError("Offsite proof paths must be distinct")

    name = latest_backup_name(bucket, prefix)
    tool = load_backup_tool()
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="vendure-offsite-restore-", dir=receipt.parent) as directory:
        workspace = Path(directory)
        identity, manifest, etag = read_backup(bucket, prefix + name, workspace, tool)
        proof = reusable_receipt(prior_receipt, identity, manifest, now())
        downloaded_bytes = 0
        if proof is None:
            archive = full_restore(workspace, identity, manifest, etag, tool)
            duration = int(time.monotonic() - started)
            if duration > RTO_SECONDS:
                raise RuntimeError("Complete offsite restore exceeded the recovery RTO")
            downloaded_bytes = identity["archiveBytes"]
            proof = {
                "completedAt": timestamp(now()),
                "backupFile": name,
                "source": "offsite",
                "method": "offhost-full-restore",
                "archiveSha256": identity["archiveSha256"],
                "archiveIdentity": identity,
                "targetSha": target_sha,
                "runId": run_id,
                "durationSeconds": duration,
                "rtoSeconds": RTO_SECONDS,
                "archive": archive,
            }
        verified_at = now()
        if (verified_at - utc_time(identity["backupCreatedAt"])).total_seconds() > MAXIMUM_BACKUP_AGE_SECONDS:
            raise RuntimeError("Offsite backup expired during the restore check")
        if downloaded_bytes:
            write_receipt(receipt, proof)
        write_receipt(release_receipt, {
            "method": "offhost-file-restore-verification",
            "targetSha": target_sha,
            "runId": run_id,
            "verifiedAt": timestamp(verified_at),
            "downloadedArchiveBytes": downloaded_bytes,
            "restoreProof": proof,
        })
    print(f"Offsite restore verified: backup={name} restore_run={proof['runId']} "
          f"downloaded_archive_bytes={downloaded_bytes}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--target-sha", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--receipt", required=True, type=Path)
    parser.add_argument("--prior-receipt", required=True, type=Path)
    parser.add_argument("--release-receipt", required=True, type=Path)
    args = parser.parse_args()
    try:
        run(args.bucket, args.prefix, args.target_sha, args.run_id, args.receipt, args.prior_receipt,
            args.release_receipt)
    except Exception as error:
        print(f"Offsite file restore verification failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
