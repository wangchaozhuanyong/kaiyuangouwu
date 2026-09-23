#!/usr/bin/env python3
"""Run a complete offsite file restore outside the production instance."""

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
RTO_SECONDS = 14400
MAXIMUM_BACKUP_AGE_SECONDS = 108000
DISK_RESERVE_BYTES = 1024 * 1024 * 1024
TOOLS = Path(__file__).resolve().parent / "systemd"


def load_backup_tool():
    spec = importlib.util.spec_from_file_location("vendure_file_backup", TOOLS / "vendure-file-backup.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("File backup tool is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def aws(*arguments: str) -> str:
    return subprocess.check_output(["aws", *arguments], text=True).strip()


def run(bucket: str, prefix: str, target_sha: str, run_id: str, receipt: Path) -> None:
    if not re.fullmatch(r"[a-f0-9]{40}", target_sha) or not re.fullmatch(r"[0-9]+", run_id):
        raise ValueError("Release identity is invalid")
    if not re.fullmatch(r"[a-z0-9.-]+", bucket) or not re.fullmatch(r"[A-Za-z0-9._/-]*/", prefix):
        raise ValueError("Backup bucket or prefix is invalid")
    objects = json.loads(aws("s3api", "list-objects-v2", "--bucket", bucket, "--prefix", prefix + "vendure-files-", "--output", "json"))
    checksums = [
        item for item in objects.get("Contents", [])
        if item["Key"].startswith(prefix) and BACKUP_NAME.fullmatch(item["Key"][len(prefix):].removesuffix(".sha256"))
        and item["Key"].endswith(".sha256")
    ]
    if not checksums:
        raise RuntimeError("No independently discoverable offsite file backup exists")
    latest = max(checksums, key=lambda item: item["LastModified"])
    name = latest["Key"][len(prefix):-len(".sha256")]
    backup_uri = f"s3://{bucket}/{prefix}{name}"
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="vendure-offsite-restore-") as directory:
        workspace = Path(directory)
        manifest_path = workspace / "manifest.json"
        checksum_path = workspace / "archive.sha256"
        for suffix, output in ((".manifest.json", manifest_path), (".sha256", checksum_path)):
            subprocess.run(["aws", "s3", "cp", backup_uri + suffix, str(output), "--only-show-errors"], check=True)
        checksum_entries = {}
        for line in checksum_path.read_text().splitlines():
            match = re.fullmatch(r"([a-f0-9]{64})\s+\*?(.+)", line)
            if match is None or match.group(2) in checksum_entries:
                raise ValueError("Offsite checksum sidecar is malformed")
            checksum_entries[match.group(2)] = match.group(1)
        if set(checksum_entries) != {name, name + ".manifest.json"}:
            raise ValueError("Offsite checksum sidecar does not name the selected archive and manifest")
        if hashlib.sha256(manifest_path.read_bytes()).hexdigest() != checksum_entries[name + ".manifest.json"]:
            raise ValueError("Offsite manifest checksum does not match")
        manifest = json.loads(manifest_path.read_bytes())
        tool = load_backup_tool()
        tool.validate_manifest(manifest)
        created_at = dt.datetime.fromisoformat(str(manifest["createdAt"]).replace("Z", "+00:00"))
        if created_at.tzinfo is None:
            raise ValueError("Offsite file backup has no UTC creation time")
        backup_age = (dt.datetime.now(dt.timezone.utc) - created_at).total_seconds()
        if not 0 <= backup_age <= MAXIMUM_BACKUP_AGE_SECONDS:
            raise ValueError("Offsite file backup is older than the configured recovery window")
        required = int(manifest["totalBytes"]) + DISK_RESERVE_BYTES
        free = shutil.disk_usage(workspace).free
        if free < required:
            raise RuntimeError(f"Off-host restore disk is insufficient: free={free} required={required}")
        restored = workspace / "restored"
        with tempfile.TemporaryFile() as errors:
            process = subprocess.Popen(
                ["aws", "s3", "cp", backup_uri, "-", "--only-show-errors"],
                stdout=subprocess.PIPE, stderr=errors,
            )
            try:
                assert process.stdout is not None
                archive = tool.restore_stream(process.stdout, restored, manifest_path, checksum_entries[name])
                process.stdout.close()
                if process.wait() != 0:
                    errors.seek(0)
                    raise RuntimeError("Offsite archive download failed: " + errors.read().decode(errors="replace")[-1000:])
            except Exception:
                process.kill()
                process.wait()
                raise
        for root in ("customer-avatars", "private-images"):
            source = restored / root
            if (source / "S3_SOURCE_MANIFEST.json").is_file():
                subprocess.run([sys.executable, str(TOOLS / "vendure-s3-prefix-snapshot.py"), "verify", str(source)], check=True, stdout=subprocess.DEVNULL)
        duration = int(time.monotonic() - started)
        if duration > RTO_SECONDS:
            raise RuntimeError("Complete offsite restore exceeded the recovery RTO")
        evidence = {
            "completedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "backupFile": name,
            "source": "offsite",
            "method": "offhost-full-restore",
            "archiveSha256": checksum_entries[name],
            "targetSha": target_sha,
            "runId": run_id,
            "durationSeconds": duration,
            "rtoSeconds": RTO_SECONDS,
            "archive": archive,
        }
        receipt.write_text(json.dumps(evidence, sort_keys=True, separators=(",", ":")) + "\n")
        print(f"Complete offsite file restore passed: files={archive['fileCount']} bytes={archive['totalBytes']} duration_seconds={duration}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--target-sha", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--receipt", required=True, type=Path)
    args = parser.parse_args()
    try:
        run(args.bucket, args.prefix, args.target_sha, args.run_id, args.receipt)
    except Exception as error:
        print(f"Complete offsite file restore failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
