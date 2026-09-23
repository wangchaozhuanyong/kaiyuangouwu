#!/usr/bin/env python3
"""Create and verify restorable archives for Vendure-owned persistent files."""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tarfile
from typing import BinaryIO


MANIFEST_NAME = "BACKUP_MANIFEST.json"
MANIFEST_VERSION = 1
LABEL_PATTERN = re.compile(r"^[a-z][a-z0-9-]{1,31}$")


class HashingReader:
    def __init__(self, source: BinaryIO):
        self.source = source
        self.digest = hashlib.sha256()

    def read(self, size: int = -1) -> bytes:
        chunk = self.source.read(size)
        self.digest.update(chunk)
        return chunk


def parse_root(value: str) -> tuple[str, Path]:
    label, separator, raw_path = value.partition("=")
    if not separator or not LABEL_PATTERN.fullmatch(label):
        raise ValueError("Backup roots must use a safe label=/absolute/path value")
    path = Path(raw_path)
    if not path.is_absolute() or path == Path("/"):
        raise ValueError(f"Backup root must be an absolute non-root path: {label}")
    metadata = path.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ValueError(f"Backup root must be a real directory: {label}")
    return label, path


def directory_member(name: str, metadata: os.stat_result) -> tarfile.TarInfo:
    member = tarfile.TarInfo(name.rstrip("/") + "/")
    member.type = tarfile.DIRTYPE
    member.mode = stat.S_IMODE(metadata.st_mode)
    member.mtime = int(metadata.st_mtime)
    member.uid = 0
    member.gid = 0
    member.uname = "root"
    member.gname = "root"
    return member


def regular_member(name: str, metadata: os.stat_result) -> tarfile.TarInfo:
    member = tarfile.TarInfo(name)
    member.size = metadata.st_size
    member.mode = stat.S_IMODE(metadata.st_mode)
    member.mtime = int(metadata.st_mtime)
    member.uid = 0
    member.gid = 0
    member.uname = "root"
    member.gname = "root"
    return member


def stable_entries(root: Path):
    for current, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
        directory_names.sort()
        file_names.sort()
        current_path = Path(current)
        for name in directory_names:
            path = current_path / name
            metadata = path.lstat()
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
                raise ValueError(f"Unsupported directory entry: {path}")
            yield "directory", path, metadata
        for name in file_names:
            path = current_path / name
            metadata = path.lstat()
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
                raise ValueError(f"Unsupported file entry: {path}")
            yield "file", path, metadata


def capture(output: Path, root_values: list[str]) -> dict[str, object]:
    if output.exists() or Path(str(output) + ".manifest.json").exists():
        raise ValueError("Refusing to overwrite an existing file backup")
    roots = [parse_root(value) for value in root_values]
    labels = [label for label, _ in roots]
    paths = [path.resolve() for _, path in roots]
    if len(labels) != len(set(labels)) or len(paths) != len(set(paths)):
        raise ValueError("Backup labels and root paths must be unique")
    for index, path in enumerate(paths):
        for other in paths[index + 1 :]:
            if path in other.parents or other in path.parents:
                raise ValueError("Backup roots must not overlap")

    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    files: list[dict[str, object]] = []
    directories: list[dict[str, object]] = []
    total_bytes = 0
    created_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    with output.open("xb") as raw_output:
        with gzip.GzipFile(fileobj=raw_output, mode="wb", compresslevel=6, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w|") as archive:
                for (label, root), resolved_root in zip(roots, paths):
                    root_metadata = root.lstat()
                    archive.addfile(directory_member(f"data/{label}", root_metadata))
                    directories.append(
                        {"path": label, "mode": stat.S_IMODE(root_metadata.st_mode)}
                    )
                    for kind, path, initial in stable_entries(root):
                        relative = path.relative_to(root).as_posix()
                        archive_name = f"data/{label}/{relative}"
                        if kind == "directory":
                            archive.addfile(directory_member(archive_name, initial))
                            directories.append(
                                {
                                    "path": f"{label}/{relative}",
                                    "mode": stat.S_IMODE(initial.st_mode),
                                }
                            )
                            continue
                        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                        try:
                            before = os.fstat(descriptor)
                            if not stat.S_ISREG(before.st_mode):
                                raise ValueError(f"Backup entry changed type while opening: {path}")
                            with os.fdopen(descriptor, "rb", closefd=False) as source:
                                reader = HashingReader(source)
                                archive.addfile(regular_member(archive_name, before), reader)
                            after = os.fstat(descriptor)
                        finally:
                            os.close(descriptor)
                        stable = (
                            before.st_dev,
                            before.st_ino,
                            before.st_size,
                            before.st_mtime_ns,
                        ) == (
                            after.st_dev,
                            after.st_ino,
                            after.st_size,
                            after.st_mtime_ns,
                        )
                        if not stable:
                            raise RuntimeError(f"File changed while being backed up: {path}")
                        files.append(
                            {
                                "path": f"{label}/{relative}",
                                "size": before.st_size,
                                "sha256": reader.digest.hexdigest(),
                                "mode": stat.S_IMODE(before.st_mode),
                                "mtimeNs": before.st_mtime_ns,
                            }
                        )
                        total_bytes += before.st_size
                manifest: dict[str, object] = {
                    "version": MANIFEST_VERSION,
                    "createdAt": created_at,
                    "roots": labels,
                    "fileCount": len(files),
                    "directoryCount": len(directories),
                    "totalBytes": total_bytes,
                    "directories": directories,
                    "files": files,
                }
                encoded = canonical_json(manifest)
                member = tarfile.TarInfo(MANIFEST_NAME)
                member.size = len(encoded)
                member.mode = 0o600
                member.mtime = 0
                archive.addfile(member, io.BytesIO(encoded))
    Path(str(output) + ".manifest.json").write_bytes(canonical_json(manifest) + b"\n")
    os.chmod(Path(str(output) + ".manifest.json"), 0o600)
    return summary(manifest)


def canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def read_manifest(archive: tarfile.TarFile) -> dict[str, object]:
    members = archive.getmembers()
    names = [member.name for member in members]
    if len(names) != len(set(names)):
        raise ValueError("Archive contains duplicate paths")
    for member in members:
        path = PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Archive contains an unsafe path")
        if not (member.isdir() or member.isfile()):
            raise ValueError("Archive contains a link or special file")
    try:
        member = archive.getmember(MANIFEST_NAME)
    except KeyError as error:
        raise ValueError("Archive manifest is missing") from error
    source = archive.extractfile(member)
    if source is None:
        raise ValueError("Archive manifest cannot be read")
    manifest = json.load(source)
    if not isinstance(manifest, dict) or manifest.get("version") != MANIFEST_VERSION:
        raise ValueError("Archive manifest version is unsupported")
    return manifest


def validate_manifest(manifest: dict[str, object]) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    files = manifest.get("files")
    directories = manifest.get("directories")
    roots = manifest.get("roots")
    if not isinstance(files, list) or not isinstance(directories, list) or not isinstance(roots, list):
        raise ValueError("Archive manifest shape is invalid")
    if any(not isinstance(label, str) or not LABEL_PATTERN.fullmatch(label) for label in roots):
        raise ValueError("Archive manifest root label is invalid")
    expected_paths: set[str] = set()
    for item in [*directories, *files]:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("Archive manifest entry is invalid")
        path = PurePosixPath(item["path"])
        if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] not in roots:
            raise ValueError("Archive manifest path is unsafe")
        if item["path"] in expected_paths:
            raise ValueError("Archive manifest contains duplicate paths")
        expected_paths.add(item["path"])
    return directories, files


def verify(archive_path: Path) -> dict[str, object]:
    with tarfile.open(archive_path, mode="r:gz") as archive:
        manifest = read_manifest(archive)
        directories, files = validate_manifest(manifest)
        expected_members = {MANIFEST_NAME}
        for item in directories:
            expected_members.add("data/" + str(item["path"]))
        for item in files:
            member_name = "data/" + str(item["path"])
            expected_members.add(member_name)
            try:
                member = archive.getmember(member_name)
            except KeyError as error:
                raise ValueError(f"Archive file is missing: {item['path']}") from error
            if not member.isfile() or member.size != item.get("size"):
                raise ValueError(f"Archive file metadata does not match: {item['path']}")
            source = archive.extractfile(member)
            if source is None:
                raise ValueError(f"Archive file cannot be read: {item['path']}")
            digest = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
            if digest.hexdigest() != item.get("sha256"):
                raise ValueError(f"Archive file digest does not match: {item['path']}")
        actual_members = {member.name.rstrip("/") for member in archive.getmembers()}
        if actual_members != expected_members:
            raise ValueError("Archive contains files not represented by its manifest")
    return summary(manifest)


def restore(archive_path: Path, target: Path) -> dict[str, object]:
    if target.exists() and any(target.iterdir()):
        raise ValueError("Restore target must be empty")
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tarfile.open(archive_path, mode="r:gz") as archive:
        manifest = read_manifest(archive)
        directories, files = validate_manifest(manifest)
        for item in sorted(directories, key=lambda value: len(PurePosixPath(str(value["path"])).parts)):
            destination = target.joinpath(*PurePosixPath(str(item["path"])).parts)
            destination.mkdir(mode=int(item.get("mode", 0o700)), parents=True, exist_ok=True)
        for item in files:
            destination = target.joinpath(*PurePosixPath(str(item["path"])).parts)
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            source = archive.extractfile("data/" + str(item["path"]))
            if source is None:
                raise ValueError(f"Archive file cannot be restored: {item['path']}")
            digest = hashlib.sha256()
            with destination.open("xb") as output:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    output.write(chunk)
                    digest.update(chunk)
            if destination.stat().st_size != item.get("size") or digest.hexdigest() != item.get("sha256"):
                raise ValueError(f"Restored file does not match: {item['path']}")
            os.chmod(destination, int(item.get("mode", 0o600)))
            mtime_ns = int(item.get("mtimeNs", 0))
            if mtime_ns > 0:
                os.utime(destination, ns=(mtime_ns, mtime_ns))
    return summary(manifest)


def restore_stream(source: BinaryIO, target: Path, manifest_path: Path, expected_sha256: str) -> dict[str, object]:
    """Restore every member while reading a compressed archive only once from stdin."""
    if not re.fullmatch(r"[a-f0-9]{64}", expected_sha256):
        raise ValueError("Archive SHA-256 is invalid")
    if target.exists() and any(target.iterdir()):
        raise ValueError("Restore target must be empty")
    manifest = json.loads(manifest_path.read_bytes())
    if not isinstance(manifest, dict) or manifest.get("version") != MANIFEST_VERSION:
        raise ValueError("External manifest version is unsupported")
    directories, files = validate_manifest(manifest)
    if (
        manifest.get("fileCount") != len(files)
        or manifest.get("directoryCount") != len(directories)
        or manifest.get("totalBytes") != sum(int(item.get("size", -1)) for item in files)
    ):
        raise ValueError("External manifest totals are inconsistent")
    expected_directories = {"data/" + str(item["path"]): item for item in directories}
    expected_files = {"data/" + str(item["path"]): item for item in files}
    expected_names = {*expected_directories, *expected_files, MANIFEST_NAME}
    if len(expected_names) != len(directories) + len(files) + 1:
        raise ValueError("External manifest contains duplicate archive entries")

    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    reader = HashingReader(source)
    seen: set[str] = set()
    internal_manifest: object = None
    with tarfile.open(fileobj=reader, mode="r|gz") as archive:
        for member in archive:
            name = member.name.rstrip("/")
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or name in seen or name not in expected_names:
                raise ValueError("Archive contains an unsafe, duplicate, or unexpected path")
            seen.add(name)
            if name == MANIFEST_NAME:
                if not member.isfile():
                    raise ValueError("Archive manifest is not a regular file")
                embedded = archive.extractfile(member)
                if embedded is None:
                    raise ValueError("Archive manifest cannot be read")
                internal_manifest = json.load(embedded)
                continue
            destination = target.joinpath(*PurePosixPath(name.removeprefix("data/")).parts)
            if name in expected_directories:
                if not member.isdir():
                    raise ValueError(f"Archive directory changed type: {name}")
                destination.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            item = expected_files[name]
            if not member.isfile() or member.size != item.get("size") or not destination.parent.is_dir():
                raise ValueError(f"Archive file metadata does not match: {name}")
            embedded = archive.extractfile(member)
            if embedded is None:
                raise ValueError(f"Archive file cannot be restored: {name}")
            digest = hashlib.sha256()
            with destination.open("xb") as output:
                for chunk in iter(lambda: embedded.read(1024 * 1024), b""):
                    output.write(chunk)
                    digest.update(chunk)
            if digest.hexdigest() != item.get("sha256"):
                raise ValueError(f"Restored file digest does not match: {name}")
            os.chmod(destination, int(item.get("mode", 0o600)))
            mtime_ns = int(item.get("mtimeNs", 0))
            if mtime_ns > 0:
                os.utime(destination, ns=(mtime_ns, mtime_ns))
    for chunk in iter(lambda: reader.read(1024 * 1024), b""):
        pass
    if reader.digest.hexdigest() != expected_sha256:
        raise ValueError("Compressed archive SHA-256 does not match")
    if seen != expected_names or canonical_json(internal_manifest) != canonical_json(manifest):
        raise ValueError("Restored archive does not match its complete manifest")
    for name, item in sorted(expected_directories.items(), key=lambda entry: len(PurePosixPath(entry[0]).parts), reverse=True):
        destination = target.joinpath(*PurePosixPath(name.removeprefix("data/")).parts)
        os.chmod(destination, int(item.get("mode", 0o700)))
    return summary(manifest)


def summary(manifest: dict[str, object]) -> dict[str, object]:
    return {
        "version": manifest.get("version"),
        "createdAt": manifest.get("createdAt"),
        "roots": manifest.get("roots"),
        "fileCount": manifest.get("fileCount"),
        "directoryCount": manifest.get("directoryCount"),
        "totalBytes": manifest.get("totalBytes"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    capture_parser = subparsers.add_parser("capture")
    capture_parser.add_argument("archive", type=Path)
    capture_parser.add_argument("roots", nargs="+")
    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("archive", type=Path)
    restore_parser = subparsers.add_parser("restore")
    restore_parser.add_argument("archive", type=Path)
    restore_parser.add_argument("target", type=Path)
    stream_parser = subparsers.add_parser("restore-stream")
    stream_parser.add_argument("target", type=Path)
    stream_parser.add_argument("manifest", type=Path)
    stream_parser.add_argument("sha256")
    arguments = parser.parse_args()
    try:
        if arguments.command == "capture":
            result = capture(arguments.archive, arguments.roots)
        elif arguments.command == "verify":
            result = verify(arguments.archive)
        elif arguments.command == "restore-stream":
            result = restore_stream(sys.stdin.buffer, arguments.target, arguments.manifest, arguments.sha256)
        else:
            result = restore(arguments.archive, arguments.target)
    except Exception:
        if arguments.command == "capture":
            arguments.archive.unlink(missing_ok=True)
            Path(str(arguments.archive) + ".manifest.json").unlink(missing_ok=True)
        raise
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"File backup failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
