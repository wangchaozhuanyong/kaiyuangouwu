#!/usr/bin/env python3
"""Capture the current, version-pinned contents of one S3 prefix into a local tree."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
from typing import Callable


BUCKET_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")


class SnapshotError(ValueError):
    pass


def aws_json(*arguments: str) -> dict[str, object]:
    try:
        result = subprocess.run(
            ["aws", "s3api", *arguments, "--output", "json"],
            check=True,
            capture_output=True,
            text=True,
            timeout=300,
        )
        value = json.loads(result.stdout)
    except (FileNotFoundError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        raise SnapshotError("Unable to read the S3 source snapshot") from error
    if not isinstance(value, dict):
        raise SnapshotError("S3 source response is invalid")
    return value


def download_object(bucket: str, key: str, version_id: str, destination: Path) -> None:
    try:
        subprocess.run(
            [
                "aws",
                "s3api",
                "get-object",
                "--bucket",
                bucket,
                "--key",
                key,
                "--version-id",
                version_id,
                "--output",
                "json",
                str(destination),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=3600,
        )
    except (FileNotFoundError, subprocess.SubprocessError) as error:
        raise SnapshotError("Unable to download a version-pinned S3 source object") from error


def safe_relative_key(key: str, prefix: str) -> PurePosixPath | None:
    if not key.startswith(prefix):
        raise SnapshotError("S3 source returned an object outside the reviewed prefix")
    relative = key[len(prefix) :]
    if not relative:
        return None
    if any(part in {"", ".", ".."} for part in relative.split("/")):
        raise SnapshotError("S3 source contains an unsafe object key")
    path = PurePosixPath(relative)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise SnapshotError("S3 source contains an unsafe object key")
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def capture(
    bucket: str,
    prefix: str,
    target: Path,
    reader: Callable[..., dict[str, object]] = aws_json,
    downloader: Callable[[str, str, str, Path], None] = download_object,
) -> dict[str, object]:
    if not BUCKET_PATTERN.fullmatch(bucket):
        raise SnapshotError("S3 source bucket name is invalid")
    if not prefix or prefix.startswith("/") or not prefix.endswith("/"):
        raise SnapshotError("S3 source prefix must be a non-root prefix ending in slash")
    if any(part in {"", ".", ".."} for part in prefix[:-1].split("/")):
        raise SnapshotError("S3 source prefix is unsafe")
    if target.exists():
        raise SnapshotError("S3 source snapshot target already exists")
    versioning = reader("get-bucket-versioning", "--bucket", bucket)
    if versioning.get("Status") != "Enabled":
        raise SnapshotError("S3 source bucket versioning is not enabled")
    objects: list[object] = []
    continuation_token = ""
    seen_tokens: set[str] = set()
    while True:
        arguments = ["list-objects-v2", "--bucket", bucket, "--prefix", prefix, "--no-paginate"]
        if continuation_token:
            arguments.extend(["--continuation-token", continuation_token])
        listing = reader(*arguments)
        page = listing.get("Contents", [])
        if not isinstance(page, list):
            raise SnapshotError("S3 source listing is invalid")
        objects.extend(page)
        if listing.get("IsTruncated") is not True:
            break
        next_token = listing.get("NextContinuationToken")
        if (
            not isinstance(next_token, str)
            or not next_token
            or next_token in seen_tokens
            or len(seen_tokens) >= 10_000
        ):
            raise SnapshotError("S3 source listing pagination is invalid")
        seen_tokens.add(next_token)
        continuation_token = next_token

    target.mkdir(mode=0o700, parents=True)
    records: list[dict[str, object]] = []
    total_bytes = 0
    seen: set[str] = set()
    try:
        for listed in sorted(
            objects,
            key=lambda item: str(item.get("Key", "")) if isinstance(item, dict) else "",
        ):
            if not isinstance(listed, dict) or not isinstance(listed.get("Key"), str):
                raise SnapshotError("S3 source listing contains an invalid object")
            key = listed["Key"]
            if key.endswith("/"):
                if listed.get("Size", 0) != 0:
                    raise SnapshotError("S3 source contains an invalid directory marker")
                continue
            relative = safe_relative_key(key, prefix)
            if relative is None:
                continue
            relative_text = relative.as_posix()
            if relative_text == "S3_SOURCE_MANIFEST.json":
                raise SnapshotError("S3 source object conflicts with the snapshot manifest")
            if relative_text in seen:
                raise SnapshotError("S3 source listing contains duplicate object keys")
            seen.add(relative_text)
            metadata = reader("head-object", "--bucket", bucket, "--key", key)
            version_id = metadata.get("VersionId")
            content_length = metadata.get("ContentLength")
            if (
                not isinstance(version_id, str)
                or not version_id
                or version_id == "null"
                or not isinstance(content_length, int)
                or isinstance(content_length, bool)
                or content_length < 0
            ):
                raise SnapshotError("S3 source object lacks a pinned version or valid size")
            destination = target.joinpath(*relative.parts)
            if any(
                parent.exists() and not parent.is_dir()
                for parent in destination.parents
                if parent != target.parent
            ):
                raise SnapshotError("S3 source object keys conflict with a file path")
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            partial = destination.with_name(destination.name + ".part")
            downloader(bucket, key, version_id, partial)
            if not partial.is_file() or partial.is_symlink() or partial.stat().st_size != content_length:
                raise SnapshotError("Downloaded S3 source object does not match its pinned size")
            digest = sha256_file(partial)
            os.chmod(partial, 0o600)
            partial.replace(destination)
            records.append(
                {
                    "key": key,
                    "relativePath": relative_text,
                    "versionId": version_id,
                    "size": content_length,
                    "sha256": digest,
                }
            )
            total_bytes += content_length
        manifest = {
            "version": 1,
            "bucket": bucket,
            "prefix": prefix,
            "objectCount": len(records),
            "totalBytes": total_bytes,
            "objects": records,
        }
        manifest_path = target / "S3_SOURCE_MANIFEST.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
            encoding="utf8",
        )
        os.chmod(manifest_path, 0o600)
        return {"version": 1, "objectCount": len(records), "totalBytes": total_bytes}
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        raise


def verify_tree(target: Path) -> dict[str, object]:
    if not target.is_dir() or target.is_symlink():
        raise SnapshotError("S3 source restore target must be a real directory")
    manifest_path = target / "S3_SOURCE_MANIFEST.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError("S3 source restore manifest is unreadable") from error
    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        raise SnapshotError("S3 source restore manifest version is unsupported")
    bucket = manifest.get("bucket")
    prefix = manifest.get("prefix")
    objects = manifest.get("objects")
    if (
        not isinstance(bucket, str)
        or not BUCKET_PATTERN.fullmatch(bucket)
        or not isinstance(prefix, str)
        or prefix.startswith("/")
        or not prefix.endswith("/")
        or any(part in {"", ".", ".."} for part in prefix[:-1].split("/"))
        or not isinstance(objects, list)
    ):
        raise SnapshotError("S3 source restore manifest shape is invalid")
    expected = {"S3_SOURCE_MANIFEST.json"}
    total_bytes = 0
    for record in objects:
        if not isinstance(record, dict):
            raise SnapshotError("S3 source restore record is invalid")
        relative_text = record.get("relativePath")
        key = record.get("key")
        version_id = record.get("versionId")
        size = record.get("size")
        digest = record.get("sha256")
        if not isinstance(relative_text, str):
            raise SnapshotError("S3 source restore path is invalid")
        if any(part in {"", ".", ".."} for part in relative_text.split("/")):
            raise SnapshotError("S3 source restore path is unsafe")
        relative = PurePosixPath(relative_text)
        if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
            raise SnapshotError("S3 source restore path is unsafe")
        if (
            key != prefix + relative_text
            or not isinstance(version_id, str)
            or not version_id
            or not isinstance(size, int)
            or isinstance(size, bool)
            or size < 0
            or not isinstance(digest, str)
            or not re.fullmatch(r"[0-9a-f]{64}", digest)
            or relative_text in expected
        ):
            raise SnapshotError("S3 source restore record does not match its path metadata")
        restored = target.joinpath(*relative.parts)
        metadata = restored.lstat()
        if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
            raise SnapshotError("S3 source restored object is not a regular file")
        if metadata.st_size != size or sha256_file(restored) != digest:
            raise SnapshotError("S3 source restored object does not match its manifest")
        expected.add(relative_text)
        total_bytes += size
    actual = {"S3_SOURCE_MANIFEST.json"}
    for current, directory_names, file_names in os.walk(target, topdown=True, followlinks=False):
        for name in directory_names:
            metadata = (Path(current) / name).lstat()
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
                raise SnapshotError("S3 source restore contains an unsafe directory")
        for name in file_names:
            file_path = Path(current) / name
            metadata = file_path.lstat()
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
                raise SnapshotError("S3 source restore contains an unsafe file")
            actual.add(file_path.relative_to(target).as_posix())
    if actual != expected:
        raise SnapshotError("S3 source restore contains untracked or missing files")
    if manifest.get("objectCount") != len(objects) or manifest.get("totalBytes") != total_bytes:
        raise SnapshotError("S3 source restore summary does not match its records")
    return {"version": 1, "objectCount": len(objects), "totalBytes": total_bytes}


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    capture_parser = subparsers.add_parser("capture")
    capture_parser.add_argument("bucket")
    capture_parser.add_argument("prefix")
    capture_parser.add_argument("target", type=Path)
    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("target", type=Path)
    arguments = parser.parse_args()
    if arguments.command == "capture":
        result = capture(arguments.bucket, arguments.prefix, arguments.target)
    else:
        result = verify_tree(arguments.target)
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"S3 source snapshot failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
