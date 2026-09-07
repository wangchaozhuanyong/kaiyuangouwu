#!/usr/bin/env python3
"""Fixed, secret-preserving 2FA recovery through the existing private S3 bucket.

Called only by production-operations.cjs while its production lock is held.
Plaintext stays in process memory and Linux memfd objects; it is never logged.
"""

import base64
import hashlib
import hmac
import json
import os
import pwd
import re
import shutil
import signal
import stat
import subprocess
import sys


BUCKET = "yunqiao-vendure-prod-backup-079740175286-apne1"
OWNER = "079740175286"
REGION = "ap-northeast-1"
SOURCE = "/var/www/kaiyuangouwu/packages/dev-server/.env"
KEY_NAMES = ("TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY", "ADMIN_TWO_FACTOR_ENCRYPTION_KEY")
OPERATIONS = ("plan-two-factor-backup", "backup-two-factor-reviewed", "verify-two-factor-backup")
MAX_BODY = 16384
SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"


class BackupBlocked(Exception):
    """Messages are fixed error codes, never SDK errors or secret values."""


def require(condition, code):
    if not condition:
        raise BackupBlocked(code)


def validate_keys(keys):
    require(type(keys) is dict and set(keys) == set(KEY_NAMES), "KEY_SET_INVALID")
    dashboard, admin = (keys[name] for name in KEY_NAMES)
    require(isinstance(dashboard, str) and 32 <= len(dashboard) <= 1024, "DASHBOARD_KEY_INVALID")
    require(not re.search(r"replace|example|change[-_ ]?me|development|test[-_ ]?secret", dashboard, re.I),
            "DASHBOARD_KEY_INVALID")
    require(dashboard == dashboard.strip(), "DASHBOARD_KEY_WHITESPACE")
    require(isinstance(admin, str) and re.fullmatch(r"[a-fA-F0-9]{64}", admin) is not None,
            "ADMIN_KEY_INVALID")
    require(len(set(admin.lower())) > 8, "ADMIN_KEY_INVALID")
    require(dashboard.lower() != admin.lower(), "KEYS_NOT_INDEPENDENT")
    return keys


def parse_keys(contents):
    keys = {}
    for line in contents.splitlines():
        match = re.match(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$", line)
        if not match or match[1] not in KEY_NAMES:
            continue
        name, value = match[1], match[2].strip()
        require(name not in keys, "DUPLICATE_KEY_DEFINITION")
        if value.startswith(("'", '"')):
            require(len(value) >= 2 and value[-1] == value[0], "KEY_SYNTAX_UNSUPPORTED")
            value = value[1:-1]
        # Fail closed instead of interpreting shell expressions or escapes.
        require(re.fullmatch(r"[A-Za-z0-9_.+/=-]+", value) is not None, "KEY_SYNTAX_UNSUPPORTED")
        keys[name] = value
    return validate_keys(keys)


def read_source(filename=SOURCE, allowed_uids=None):
    if allowed_uids is None:
        allowed_uids = {0, pwd.getpwnam("ubuntu").pw_uid}
    descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "SOURCE_NOT_PRIVATE_FILE")
        require(before.st_uid in allowed_uids and before.st_mode & 0o027 == 0, "SOURCE_PERMISSIONS_UNSAFE")
        require(0 < before.st_size <= 131072, "SOURCE_SIZE_INVALID")
        with os.fdopen(os.dup(descriptor), "rb") as source:
            contents = source.read(131073)
        after = os.fstat(descriptor)
        require(source_identity(before) == source_identity(after) and len(contents) <= 131072,
                "SOURCE_CHANGED_DURING_READ")
        keys = parse_keys(contents.decode("utf-8"))
        return keys, source_identity(before)
    finally:
        os.close(descriptor)


def source_identity(metadata):
    # Reading may update atime; content/ownership identity must remain stable.
    return [metadata.st_dev, metadata.st_ino, metadata.st_uid, metadata.st_gid,
            metadata.st_mode, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns]


def same_keys(left, right):
    return all(hmac.compare_digest(left[name].encode(), right[name].encode()) for name in KEY_NAMES)


def verify_runtime_keys(keys, processes):
    for name in ("vendure-api", "vendure-worker"):
        matches = [item for item in processes if item.get("name") == name]
        require(len(matches) == 1, "RUNTIME_PROCESS_AMBIGUOUS")
        environment = matches[0].get("pm2_env", {})
        require(environment.get("status") == "online", "RUNTIME_PROCESS_NOT_ONLINE")
        runtime_keys = {key: environment.get(key) for key in KEY_NAMES}
        validate_keys(runtime_keys)
        require(same_keys(keys, runtime_keys), "RUNTIME_KEYS_DIFFER_FROM_SOURCE")


def read_runtime():
    result = subprocess.run(["/usr/bin/sudo", "-n", "-H", "-u", "ubuntu", "pm2", "jlist"],
                            capture_output=True, timeout=30, check=False)
    require(result.returncode == 0 and len(result.stdout) <= 10 * 1024 * 1024, "RUNTIME_READ_FAILED")
    return json.loads(result.stdout)


class AwsCli:
    def __init__(self):
        require(sys.platform == "linux" and hasattr(os, "memfd_create"), "LINUX_MEMFD_REQUIRED")
        self.executable = shutil.which("aws", path=SYSTEM_PATH)
        require(self.executable is not None, "AWS_CLI_UNAVAILABLE")

    def call(self, operation, parameters, download=False, missing_ok=False):
        # CLI parsing can reopen its input. A seekable anonymous memfd avoids both
        # pipe parser behavior and plaintext temporary files on disk.
        descriptors = []
        try:
            request_fd = os.memfd_create("vendure-key-backup-request", os.MFD_CLOEXEC)
            descriptors.append(request_fd)
            os.fchmod(request_fd, 0o600)
            request = {"Bucket": BUCKET, "ExpectedBucketOwner": OWNER, **parameters}
            os.write(request_fd, json.dumps(request).encode())
            os.lseek(request_fd, 0, os.SEEK_SET)
            command = [self.executable, "s3api", operation, "--region", REGION, "--output", "json",
                       "--cli-binary-format", "base64", "--no-cli-pager",
                       "--cli-connect-timeout", "10", "--cli-read-timeout", "30"]
            if download:
                # AWS CLI's streaming-output argument validates required options
                # before loading cli-input-json. These identifiers are not secrets.
                require(operation == "get-object" and set(parameters) == {"Key", "VersionId"},
                        "DOWNLOAD_REQUEST_INVALID")
                command.extend(["--bucket", BUCKET, "--expected-bucket-owner", OWNER,
                                "--key", parameters["Key"], "--version-id", parameters["VersionId"]])
                body_fd = os.memfd_create("vendure-key-backup-response", os.MFD_CLOEXEC)
                descriptors.append(body_fd)
                os.fchmod(body_fd, 0o600)
                command.append(f"/proc/self/fd/{body_fd}")
            else:
                command.extend(["--cli-input-json", f"file:///proc/self/fd/{request_fd}"])
            environment = {
                "PATH": SYSTEM_PATH, "HOME": "/root", "AWS_CONFIG_FILE": "/dev/null",
                "AWS_SHARED_CREDENTIALS_FILE": "/dev/null", "AWS_EC2_METADATA_DISABLED": "false",
                "AWS_MAX_ATTEMPTS": "2", "AWS_RETRY_MODE": "standard", "AWS_PAGER": "",
                "AWS_CLI_AUTO_PROMPT": "off",
            }
            result = subprocess.run(command, capture_output=True, pass_fds=descriptors,
                                    env=environment, timeout=45, check=False)
            if result.returncode != 0:
                if missing_ok and re.search(rb"\((?:404|NoSuchKey|NotFound)\)", result.stderr):
                    return None
                denied = re.search(rb"\((?:403|AccessDenied|AccessDeniedException|UnauthorizedOperation)\)", result.stderr)
                suffix = "_ACCESS_DENIED" if denied else "_FAILED"
                raise BackupBlocked("S3_" + operation.replace("-", "_").upper() + suffix)
            require(len(result.stdout) <= 65536, "S3_METADATA_OVERSIZED")
            metadata = json.loads(result.stdout or b"{}")
            if not download:
                return metadata
            require(os.fstat(body_fd).st_size <= MAX_BODY, "BACKUP_BODY_OVERSIZED")
            os.lseek(body_fd, 0, os.SEEK_SET)
            return metadata, os.read(body_fd, MAX_BODY + 1)
        finally:
            for descriptor in descriptors:
                os.close(descriptor)


def verify_bucket(client):
    versioning = client.call("get-bucket-versioning", {})
    require(versioning.get("Status") == "Enabled", "BUCKET_VERSIONING_REQUIRED")
    public = client.call("get-public-access-block", {}).get("PublicAccessBlockConfiguration", {})
    require(all(public.get(name) is True for name in (
        "BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")),
        "BUCKET_PUBLIC_ACCESS_BLOCK_REQUIRED")
    ownership = client.call("get-bucket-ownership-controls", {}).get("OwnershipControls", {}).get("Rules", [])
    require(any(rule.get("ObjectOwnership") == "BucketOwnerEnforced" for rule in ownership),
            "BUCKET_OWNER_ENFORCEMENT_REQUIRED")
    encryption = client.call("get-bucket-encryption", {}).get("ServerSideEncryptionConfiguration", {}).get("Rules", [])
    require(len(encryption) == 1 and encryption[0].get("ApplyServerSideEncryptionByDefault", {}).get("SSEAlgorithm") == "AES256",
            "BUCKET_ENCRYPTION_DIFFERS_FROM_REVIEWED_SSE_S3")


def object_version(metadata):
    version = metadata.get("VersionId")
    require(isinstance(version, str) and version != "null" and
            re.fullmatch(r"[A-Za-z0-9_.~+/=-]{1,1024}", version) is not None, "VERSION_ID_REQUIRED")
    require(metadata.get("ServerSideEncryption") == "AES256", "OBJECT_ENCRYPTION_REQUIRED")
    return version


def verify_object(client, object_key, version, source_sha, keys):
    head = client.call("head-object", {"Key": object_key, "VersionId": version})
    require(object_version(head) == version, "RESTORED_VERSION_MISMATCH")
    length = head.get("ContentLength")
    require(type(length) is int and 0 < length <= MAX_BODY, "BACKUP_BODY_OVERSIZED")
    metadata, body = client.call("get-object", {"Key": object_key, "VersionId": version}, download=True)
    require(object_version(metadata) == version, "RESTORED_VERSION_MISMATCH")
    require(len(body) == length, "BACKUP_BODY_SIZE_MISMATCH")
    payload = json.loads(body)
    require(type(payload) is dict and set(payload) == {"format", "sourceSha", "keys"}, "BACKUP_SCHEMA_INVALID")
    require(payload["format"] == 1 and payload["sourceSha"] == source_sha, "BACKUP_SOURCE_MISMATCH")
    restored = validate_keys(payload["keys"])
    require(same_keys(keys, restored), "RESTORED_KEYS_MISMATCH")


def execute(operation, source_sha, expected_plan="", client=None, source_reader=read_source,
            runtime_reader=read_runtime, report=None):
    require(operation in OPERATIONS and re.fullmatch(r"[a-f0-9]{40}", source_sha) is not None, "REQUEST_INVALID")
    applying = operation == "backup-two-factor-reviewed"
    require(bool(re.fullmatch(r"[a-f0-9]{64}", expected_plan)) if applying else expected_plan == "",
            "REVIEWED_PLAN_REQUIRED")
    client = client or AwsCli()
    report = report if report is not None else {}
    object_key = f"mysql/two-factor-key-backups/{source_sha}.json"
    report.update(operation=operation, sourceSha=source_sha, bucket=BUCKET, objectKey=object_key,
                  keyNames=list(KEY_NAMES), encryption="AES256", restoreVerified=False)
    verify_bucket(client)
    keys, source_fingerprint = source_reader()
    verify_runtime_keys(keys, runtime_reader())
    existing = client.call("head-object", {"Key": object_key}, missing_ok=True)
    version = object_version(existing) if existing is not None else None
    plan = {"sourceSha": source_sha, "bucket": BUCKET, "objectKey": object_key,
            "keyNames": list(KEY_NAMES), "existingVersionId": version,
            "action": "verify-existing" if version else "create-and-verify"}
    # Bind the approval to the exact source keys without exposing their values or
    # separate fingerprints. Format checks do not prove key entropy.
    plan_hash = hashlib.sha256(json.dumps({"plan": plan, "keys": keys, "sourceFile": source_fingerprint},
                                         sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    report.update(plan=plan, planSha256=plan_hash, runtimeKeysMatch=True)
    if applying:
        require(hmac.compare_digest(expected_plan, plan_hash), "REVIEWED_PLAN_CHANGED")
    if version is None:
        if operation == "verify-two-factor-backup":
            raise BackupBlocked("BACKUP_NOT_FOUND")
        if not applying:
            report["writePerformed"] = False
            return report
        current, fingerprint = source_reader()
        require(fingerprint == source_fingerprint and same_keys(keys, current), "SOURCE_CHANGED_BEFORE_BACKUP")
        verify_runtime_keys(current, runtime_reader())
        payload = json.dumps({"format": 1, "sourceSha": source_sha, "keys": keys}, separators=(",", ":")).encode()
        metadata = client.call("put-object", {"Key": object_key, "Body": base64.b64encode(payload).decode(),
            "ContentLength": len(payload), "ContentType": "application/json", "IfNoneMatch": "*",
            "ServerSideEncryption": "AES256", "ChecksumSHA256": base64.b64encode(hashlib.sha256(payload).digest()).decode()})
        version = object_version(metadata)
        report["writePerformed"] = True
    else:
        report["writePerformed"] = False
    report["versionId"] = version
    verify_object(client, object_key, version, source_sha, keys)
    current, fingerprint = source_reader()
    require(fingerprint == source_fingerprint and same_keys(keys, current), "SOURCE_CHANGED_DURING_BACKUP")
    verify_runtime_keys(current, runtime_reader())
    report.update(restoreVerified=True, sourceUnchanged=True, runtimeKeysMatch=True)
    return report


def main():
    report = {}
    try:
        require(len(sys.argv) == 4, "REQUEST_INVALID")
        operation, source_sha, expected_plan = sys.argv[1:]
        # Finish before the parent's timeout/SSM deadline. subprocess.run kills
        # and waits for its child if this handler interrupts an AWS/PM2 request.
        def expired(_signum, _frame):
            raise BackupBlocked("BACKUP_OPERATION_TIMEOUT")
        signal.signal(signal.SIGALRM, expired)
        signal.alarm(270)
        execute(operation, source_sha, expected_plan, report=report)
        print(json.dumps(report, sort_keys=True))
        print(f"TWO_FACTOR_KEY_BACKUP_COMPLETE operation={operation}")
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, BackupBlocked) else "BACKUP_OPERATION_FAILED"
        # Never print exception repr/traceback, CLI stderr or a secret-bearing payload.
        print(json.dumps({**report, "status": "blocked", "reason": code}, sort_keys=True))
        return 1
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    sys.exit(main())
