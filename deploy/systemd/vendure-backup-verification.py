#!/usr/bin/env python3
"""Publish one receipt for the latest verified backup without rereading it in health checks."""

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time


RECEIPT = ".verified-backup.json"
PATTERNS = {
    "mysql": re.compile(r"vendure-(\d{8}T\d{6}Z)\.sql\.gz"),
    "files": re.compile(r"vendure-files-(\d{8}T\d{6}Z)\.tar\.gz"),
}
OFFSITE_URI = re.compile(r"s3://[a-z0-9.-]+(?:/[A-Za-z0-9._/-]+)?")
MAX_EVIDENCE_BYTES = 16384


class InvalidBackup(ValueError):
    def __init__(self, reason="checksum-invalid"):
        super().__init__(reason)


def trusted(metadata, predicate):
    return (
        predicate(metadata.st_mode)
        and metadata.st_uid == os.geteuid()
        and not metadata.st_mode & 0o022
    )


def fingerprint(metadata):
    if not trusted(metadata, stat.S_ISREG) or metadata.st_nlink != 1:
        raise InvalidBackup()
    return [metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns]


def file_identity(path):
    return fingerprint(path.lstat())


def backup_directory(path):
    try:
        directory = path.resolve(strict=True)
    except FileNotFoundError as error:
        raise InvalidBackup("missing-or-stale") from error
    if not trusted(directory.lstat(), stat.S_ISDIR):
        raise InvalidBackup()
    return directory


def backup_timestamp(kind, name):
    match = PATTERNS[kind].fullmatch(name)
    if not match:
        raise InvalidBackup()
    return datetime.strptime(match[1], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).timestamp()


def backup_files(archive):
    return archive, archive.with_name(archive.name + ".manifest.json"), archive.with_name(archive.name + ".sha256")


def read_regular(path, consume):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as handle:
        before = fingerprint(os.fstat(handle.fileno()))
        value = consume(handle)
        if before != fingerprint(os.fstat(handle.fileno())) or before != file_identity(path):
            raise InvalidBackup()
    return value, before


def read_evidence(path):
    data, identity = read_regular(path, lambda handle: handle.read(MAX_EVIDENCE_BYTES + 1))
    if len(data) > MAX_EVIDENCE_BYTES:
        raise InvalidBackup()
    return data, identity


def atomic_write(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".backup-verification-", delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
            os.replace(temporary, path)
            directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            temporary.unlink(missing_ok=True)


def checksum(handle):
    digest = hashlib.sha256()
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def read_checksums(sidecar, expected_names):
    data, identity = read_evidence(sidecar)
    hashes = {}
    for line in data.decode("ascii").splitlines():
        match = re.fullmatch(r"([a-f0-9]{64}) [ *]([^/]+)", line)
        if not match or match[2] in hashes:
            raise InvalidBackup()
        hashes[match[2]] = match[1]
    if set(hashes) != set(expected_names):
        raise InvalidBackup()
    return hashes, identity


def prepare(kind, archive, existing):
    backup_timestamp(kind, archive.name)
    archive, manifest, sidecar = backup_files(archive)
    hashes, identities = {}, {}
    for path in (archive, manifest):
        hashes[path.name], identities[path.name] = read_regular(path, checksum)
        if identities[path.name][2] == 0:
            raise InvalidBackup()
    if not existing:
        if sidecar.exists() or sidecar.is_symlink():
            raise InvalidBackup()
        atomic_write(sidecar, "".join(f"{digest}  {name}\n" for name, digest in hashes.items()).encode("ascii"))
    recorded, identities[sidecar.name] = read_checksums(sidecar, hashes)
    if hashes != recorded:
        raise InvalidBackup()
    return {"kind": kind, "archive": archive.name, "files": identities, "sha256": hashes}


def confirm_local(kind, archive, evidence):
    if evidence.get("kind") != kind or evidence.get("archive") != archive.name:
        raise InvalidBackup()
    files = backup_files(archive)
    if evidence.get("files") != {path.name: file_identity(path) for path in files}:
        raise InvalidBackup()
    hashes, sidecar_identity = read_checksums(files[2], (path.name for path in files[:2]))
    if evidence.get("sha256") != hashes or evidence["files"][files[2].name] != sidecar_identity:
        raise InvalidBackup()


def offsite_evidence(uri, versions):
    if not uri and not versions:
        return None
    if (
        not OFFSITE_URI.fullmatch(uri)
        or len(versions) != 3
        or any(
            not isinstance(version, str) or not 0 < len(version) <= 1024
            or version == "null" or not version.isprintable()
            for version in versions
        )
    ):
        raise InvalidBackup("offsite-unverified")
    return {"uri": uri.rstrip("/"), "versions": versions}


def publish(kind, archive, evidence, uri, versions):
    confirm_local(kind, archive, evidence)
    receipt = {**evidence, "format": 1, "offsite": offsite_evidence(uri, versions)}
    atomic_write(archive.parent / RECEIPT, (json.dumps(receipt, sort_keys=True) + "\n").encode())


def require_recent(kind, name, maximum_age):
    age = time.time() - backup_timestamp(kind, name)
    if not 0 <= age <= maximum_age:
        raise InvalidBackup("missing-or-stale")


def check(kind, directory, maximum_age, uri):
    try:
        raw, _ = read_evidence(directory / RECEIPT)
    except FileNotFoundError as error:
        raise InvalidBackup("missing-or-stale") from error
    receipt = json.loads(raw)
    if not isinstance(receipt, dict) or receipt.get("format") != 1 or not isinstance(receipt.get("archive"), str):
        raise InvalidBackup()
    name = receipt["archive"]
    require_recent(kind, name, maximum_age)
    confirm_local(kind, directory / name, receipt)
    stored = receipt.get("offsite")
    versions = stored.get("versions", []) if isinstance(stored, dict) else []
    if not isinstance(versions, list) or stored != offsite_evidence(uri, versions):
        raise InvalidBackup("offsite-unverified")


def existing_s3_versions(archive, uri):
    if not uri:
        return []
    if not OFFSITE_URI.fullmatch(uri):
        raise InvalidBackup("offsite-unverified")
    bucket, _, prefix = uri.rstrip("/").removeprefix("s3://").partition("/")
    versions = []
    for source in backup_files(archive):
        key = f"{prefix}/{source.name}" if prefix else source.name
        try:
            response = subprocess.run(
                ["aws", "s3api", "head-object", "--bucket", bucket, "--key", key,
                 "--output", "json", "--cli-connect-timeout", "5", "--cli-read-timeout", "15"],
                check=True, capture_output=True, text=True, timeout=25,
            )
            metadata = json.loads(response.stdout)
            if (
                not isinstance(metadata, dict)
                or metadata.get("ContentLength") != source.stat().st_size
                or metadata.get("ServerSideEncryption") != "AES256"
            ):
                raise InvalidBackup("offsite-unverified")
            versions.append(metadata.get("VersionId"))
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            raise InvalidBackup("offsite-unverified") from error
    return versions


def adopt(kind, directory, maximum_age, uri):
    receipt = directory / RECEIPT
    if receipt.exists() or receipt.is_symlink():
        check(kind, directory, maximum_age, uri)
        return
    # Both existing backup writers use this same lock and publish their receipt only on success.
    fd = os.open(directory / ".backup.lock", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as lock:
        fingerprint(os.fstat(lock.fileno()))
        fcntl.flock(lock, fcntl.LOCK_EX)
        if receipt.exists() or receipt.is_symlink():
            check(kind, directory, maximum_age, uri)
            return
        name = max(
            (path.name[:-7] for path in directory.iterdir()
             if path.name.endswith(".sha256") and PATTERNS[kind].fullmatch(path.name[:-7])),
            default=None,
        )
        if name is None:
            raise InvalidBackup("missing-or-stale")
        require_recent(kind, name, maximum_age)
        archive = directory / name
        evidence = prepare(kind, archive, existing=True)
        publish(kind, archive, evidence, uri, existing_s3_versions(archive, uri))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "publish", "check", "adopt"))
    parser.add_argument("kind", choices=PATTERNS)
    parser.add_argument("path", type=Path)
    parser.add_argument("--existing", action="store_true")
    parser.add_argument("--offsite-uri", default="")
    parser.add_argument("--version", action="append", default=[])
    parser.add_argument("--max-age", type=int, default=108000)
    args = parser.parse_args()
    try:
        if args.operation in ("prepare", "publish"):
            archive = backup_directory(args.path.parent) / args.path.name
            backup_timestamp(args.kind, archive.name)
            if args.operation == "prepare":
                print(json.dumps(prepare(args.kind, archive, args.existing)))
            else:
                evidence = json.loads(sys.stdin.buffer.read(MAX_EVIDENCE_BYTES + 1))
                if not isinstance(evidence, dict):
                    raise InvalidBackup()
                publish(args.kind, archive, evidence, args.offsite_uri, args.version)
        else:
            operation = check if args.operation == "check" else adopt
            operation(args.kind, backup_directory(args.path), args.max_age, args.offsite_uri)
    except (OSError, ValueError) as error:
        reason = str(error) if isinstance(error, InvalidBackup) else "checksum-invalid"
        print(reason, file=sys.stdout if args.operation == "check" else sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
