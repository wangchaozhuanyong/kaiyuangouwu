#!/usr/bin/env python3
"""Update one reviewed retention tool before its mandatory maintenance gate runs."""

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import stat
import sys
import time


DESTINATION = Path("/usr/local/sbin/vendure-file-backup-retention.py")
DEPLOYMENT_LOCK = Path("/run/lock/vendure-production-deploy.lock")
BACKUP_LOCK = Path("/var/backups/vendure-files/.backup.lock")
RECOVERY_DIRECTORY = Path("/var/backups/vendure-policy-repairs/retention-script-repairs")
MAXIMUM_BYTES = 128 * 1024


class InstallError(ValueError):
    """Only fixed, non-secret reason codes leave the installer."""


def require(condition, reason):
    if not condition:
        raise InstallError(reason)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def identity(metadata):
    return (metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_uid,
            metadata.st_gid, metadata.st_nlink, metadata.st_size,
            metadata.st_mtime_ns, metadata.st_ctime_ns)


def directory_fd(directory, expected_uid):
    require(directory.is_absolute() and ".." not in directory.parts, "unsafe-directory")
    require(directory.resolve(strict=True) == directory, "unsafe-directory")
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    metadata = os.fstat(descriptor)
    if metadata.st_uid != expected_uid or metadata.st_mode & 0o022:
        os.close(descriptor)
        raise InstallError("unsafe-directory-owner-or-mode")
    return descriptor


def read_regular(parent_fd, name, expected_uid):
    initial = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    require(stat.S_ISREG(initial.st_mode) and initial.st_nlink == 1
            and initial.st_uid == expected_uid and not initial.st_mode & 0o022,
            "unsafe-file")
    require(0 < initial.st_size <= MAXIMUM_BYTES, "invalid-file-size")
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
    try:
        require(identity(os.fstat(descriptor)) == identity(initial), "file-changed")
        with os.fdopen(os.dup(descriptor), "rb") as stream:
            contents = stream.read(MAXIMUM_BYTES + 1)
        require(len(contents) == initial.st_size, "file-changed")
        require(identity(os.fstat(descriptor)) == identity(initial), "file-changed")
        require(identity(os.stat(name, dir_fd=parent_fd, follow_symlinks=False))
                == identity(initial), "file-changed")
        return contents, identity(initial)
    finally:
        os.close(descriptor)


@contextmanager
def existing_lock(lock_file, expected_uid, timeout):
    # Do not recreate or change ownership of either existing production lock.
    require(lock_file.resolve(strict=True) == lock_file, "unsafe-lock-path")
    descriptor = os.open(lock_file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1
                and metadata.st_uid == expected_uid and not metadata.st_mode & 0o022,
                "unsafe-lock")
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                require(time.monotonic() < deadline, "lock-busy")
                time.sleep(0.05)
        require(identity(lock_file.lstat()) == identity(metadata), "lock-changed")
        yield
    finally:
        os.close(descriptor)


def recovery_fd(directory, expected_uid):
    # Only the two fixed recovery subdirectories may be created by the CLI.
    parent = directory.parent
    grandparent_fd = directory_fd(parent.parent, expected_uid)
    try:
        try:
            os.mkdir(parent.name, mode=0o700, dir_fd=grandparent_fd)
        except FileExistsError:
            pass
    finally:
        os.close(grandparent_fd)
    parent_fd = directory_fd(parent, expected_uid)
    try:
        try:
            os.mkdir(directory.name, mode=0o700, dir_fd=parent_fd)
        except FileExistsError:
            pass
    finally:
        os.close(parent_fd)
    return directory_fd(directory, expected_uid)


def write_new(parent_fd, name, contents, mode):
    descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         mode, dir_fd=parent_fd)
    with os.fdopen(descriptor, "wb") as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(contents)
        stream.flush()
        os.fsync(stream.fileno())


def install_candidate(contents, old_hash, new_hash, *, destination=DESTINATION,
                      deployment_lock=DEPLOYMENT_LOCK, backup_lock=BACKUP_LOCK,
                      recovery_directory=RECOVERY_DIRECTORY, expected_uid=0,
                      deployment_uid=None, timeout=300):
    require(all(re.fullmatch(r"[a-f0-9]{64}", value) for value in (old_hash, new_hash)),
            "invalid-reviewed-hash")
    require(0 < len(contents) <= MAXIMUM_BYTES, "invalid-candidate-size")
    require(digest(contents) == new_hash, "candidate-hash-mismatch")
    try:
        compile(contents, str(DESTINATION), "exec")
    except (SyntaxError, ValueError):
        raise InstallError("invalid-python-candidate") from None
    if deployment_uid is None:
        deployment_uid = pwd.getpwnam("ubuntu").pw_uid
    # Maintenance takes deployment then backup. Use the same order, and close
    # both descriptors before the caller invokes maintenance in a new process.
    with existing_lock(deployment_lock, deployment_uid, timeout):
        with existing_lock(backup_lock, expected_uid, timeout):
            parent_fd = directory_fd(destination.parent, expected_uid)
            try:
                previous, previous_identity = read_regular(parent_fd, destination.name, expected_uid)
                current_hash = digest(previous)
                require(current_hash in (old_hash, new_hash), "installed-hash-not-reviewed")
                if current_hash == new_hash:
                    return {"status": "unchanged", "installedSha256": new_hash}
                saved_fd = recovery_fd(recovery_directory, expected_uid)
                backup_name = "vendure-file-backup-retention-" + old_hash + ".py"
                try:
                    try:
                        write_new(saved_fd, backup_name, previous, 0o600)
                    except FileExistsError:
                        pass
                    saved, _ = read_regular(saved_fd, backup_name, expected_uid)
                    require(digest(saved) == old_hash, "recovery-hash-mismatch")
                    os.fsync(saved_fd)
                finally:
                    os.close(saved_fd)
                temporary = ".vendure-file-retention-" + secrets.token_hex(16)
                try:
                    write_new(parent_fd, temporary, contents, 0o755)
                    candidate, _ = read_regular(parent_fd, temporary, expected_uid)
                    require(digest(candidate) == new_hash, "candidate-hash-mismatch")
                    current, current_identity = read_regular(parent_fd, destination.name, expected_uid)
                    require(current_identity == previous_identity and digest(current) == old_hash,
                            "installed-file-changed")
                    os.replace(temporary, destination.name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
                    os.fsync(parent_fd)
                    installed, _ = read_regular(parent_fd, destination.name, expected_uid)
                    require(digest(installed) == new_hash, "installed-verification-failed")
                finally:
                    try:
                        os.unlink(temporary, dir_fd=parent_fd)
                    except FileNotFoundError:
                        pass
                return {"status": "updated", "previousSha256": old_hash,
                        "installedSha256": new_hash, "recoveryFile": backup_name}
            finally:
                os.close(parent_fd)


def main():
    require(os.geteuid() == 0, "root-required")
    require(len(sys.argv) == 3, "expected-reviewed-old-and-new-hashes")
    result = install_candidate(sys.stdin.buffer.read(MAXIMUM_BYTES + 1), sys.argv[1], sys.argv[2])
    print(json.dumps({"operation": "install-file-retention-repair", **result}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (InstallError, OSError, KeyError) as error:
        reason = str(error) if isinstance(error, InstallError) else "retention-script-install-failed"
        print(json.dumps({"status": "blocked", "reason": reason}, sort_keys=True))
        raise SystemExit(1) from None
