#!/usr/bin/env python3
"""Fail closed unless an S3 backup prefix has the required recovery and expiry controls."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from typing import Callable
from urllib.parse import urlparse


SAFE_URI = re.compile(r"^s3://[a-z0-9.-]+(?:/[A-Za-z0-9._/-]+)?$")


class PolicyError(ValueError):
    pass


def parse_location(uri: str) -> tuple[str, str]:
    if not SAFE_URI.fullmatch(uri):
        raise PolicyError("Backup destination must be a safe s3:// bucket prefix")
    parsed = urlparse(uri)
    if any(part in {".", ".."} for part in parsed.path.split("/")):
        raise PolicyError("Backup destination must be a safe s3:// bucket prefix")
    prefix = parsed.path.strip("/")
    return parsed.netloc, f"{prefix}/" if prefix else ""


def positive_integer(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def lifecycle_prefix(rule: dict[str, object]) -> str | None:
    legacy = rule.get("Prefix")
    if isinstance(legacy, str):
        return legacy
    filter_value = rule.get("Filter")
    if filter_value is None:
        return ""
    if not isinstance(filter_value, dict):
        return None
    if not filter_value:
        return ""
    direct = filter_value.get("Prefix")
    if isinstance(direct, str) and set(filter_value) == {"Prefix"}:
        return direct
    conjunction = filter_value.get("And")
    if (
        isinstance(conjunction, dict)
        and isinstance(conjunction.get("Prefix"), str)
        and set(filter_value) == {"And"}
        and set(conjunction) == {"Prefix"}
    ):
        return conjunction["Prefix"]
    return None


def has_bounded_lifecycle(lifecycle: dict[str, object], object_prefix: str, maximum_days: int) -> bool:
    rules = lifecycle.get("Rules")
    if not isinstance(rules, list):
        return False
    for raw_rule in rules:
        if not isinstance(raw_rule, dict) or raw_rule.get("Status") != "Enabled":
            continue
        rule_prefix = lifecycle_prefix(raw_rule)
        if rule_prefix is None or not object_prefix.startswith(rule_prefix):
            continue
        expiration = raw_rule.get("Expiration")
        noncurrent = raw_rule.get("NoncurrentVersionExpiration")
        incomplete = raw_rule.get("AbortIncompleteMultipartUpload")
        if not all(isinstance(value, dict) for value in (expiration, noncurrent, incomplete)):
            continue
        current_days = positive_integer(expiration.get("Days"))
        noncurrent_days = positive_integer(noncurrent.get("NoncurrentDays"))
        abort_days = positive_integer(incomplete.get("DaysAfterInitiation"))
        if (
            current_days is not None
            and noncurrent_days is not None
            and abort_days is not None
            and current_days + noncurrent_days <= maximum_days
            and abort_days <= 7
        ):
            return True
    return False


def aws_json(*arguments: str) -> dict[str, object]:
    try:
        result = subprocess.run(
            ["aws", "s3api", *arguments, "--output", "json"],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        value = json.loads(result.stdout)
    except (FileNotFoundError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        raise PolicyError("Unable to read required S3 backup controls") from error
    if not isinstance(value, dict):
        raise PolicyError("S3 backup control response is invalid")
    return value


def verify_policy(
    uri: str,
    maximum_days: int,
    reader: Callable[..., dict[str, object]] = aws_json,
) -> dict[str, object]:
    if maximum_days < 7 or maximum_days > 365:
        raise PolicyError("Offsite backup retention must be between 7 and 365 days")
    bucket, object_prefix = parse_location(uri)
    versioning = reader("get-bucket-versioning", "--bucket", bucket)
    if versioning.get("Status") != "Enabled":
        raise PolicyError("S3 backup bucket versioning is not enabled")
    ownership = reader("get-bucket-ownership-controls", "--bucket", bucket)
    ownership_rules = ownership.get("OwnershipControls", {}).get("Rules", [])
    if not any(
        isinstance(rule, dict) and rule.get("ObjectOwnership") == "BucketOwnerEnforced"
        for rule in ownership_rules
    ):
        raise PolicyError("S3 backup bucket ownership is not enforced")
    public_access = reader("get-public-access-block", "--bucket", bucket).get(
        "PublicAccessBlockConfiguration", {}
    )
    if not all(
        public_access.get(name) is True
        for name in (
            "BlockPublicAcls",
            "IgnorePublicAcls",
            "BlockPublicPolicy",
            "RestrictPublicBuckets",
        )
    ):
        raise PolicyError("S3 backup bucket public access is not fully blocked")
    encryption = reader("get-bucket-encryption", "--bucket", bucket)
    encryption_rules = encryption.get("ServerSideEncryptionConfiguration", {}).get("Rules", [])
    if not any(
        isinstance(rule, dict)
        and rule.get("ApplyServerSideEncryptionByDefault", {}).get("SSEAlgorithm") == "AES256"
        for rule in encryption_rules
    ):
        raise PolicyError("S3 backup bucket does not default to SSE-S3 encryption")
    lifecycle = reader("get-bucket-lifecycle-configuration", "--bucket", bucket)
    if not has_bounded_lifecycle(lifecycle, object_prefix, maximum_days):
        raise PolicyError("S3 backup prefix lacks a bounded current and noncurrent lifecycle")
    return {"bucket": bucket, "prefix": object_prefix, "maximumRetentionDays": maximum_days}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("uri")
    parser.add_argument("maximum_retention_days", type=int)
    arguments = parser.parse_args()
    result = verify_policy(arguments.uri, arguments.maximum_retention_days)
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"S3 backup policy verification failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
