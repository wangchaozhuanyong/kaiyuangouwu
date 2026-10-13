#!/usr/bin/env python3
"""Budget peak writes before downloading a release or capturing a file backup."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

MIB = 1024 * 1024


def budget(total: int, available: int, writes: int, maximum: int = 85) -> dict[str, object]:
    if not (total > 0 and 0 <= available <= total and writes >= 0 and 1 <= maximum <= 100):
        raise ValueError("Invalid disk budget input")
    reserve = (total * (100 - maximum) + 99) // 100
    required = reserve + writes + 64 * MIB
    return {
        "status": "ok" if available > required else "insufficient",
        "totalBytes": total,
        "availableBytes": available,
        "maximumUsagePercent": maximum,
        "writeBudgetBytes": writes,
        "reserveBytes": reserve,
        "requiredBytes": required,
    }


def source_size(root: Path) -> int:
    if not root.is_absolute() or root == Path("/") or root.is_symlink() or not root.is_dir():
        raise ValueError("Invalid persistent file backup root")
    result = subprocess.run(
        ["du", "-sx", "--apparent-size", "-B1", str(root)],
        capture_output=True, text=True, check=True, timeout=120,
    )
    size = int(result.stdout.split()[0])
    if size < 0:
        raise ValueError("Invalid persistent source size")
    return size


def s3_source_size(bucket: str, prefix: str) -> int:
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket) or prefix not in {
        "avatars/v2/", "private/v1/",
    }:
        raise ValueError("Invalid customer image snapshot source")
    total = 0
    token = ""
    seen = set()
    while True:
        command = ["aws", "s3api", "list-objects-v2", "--bucket", bucket,
                   "--prefix", prefix, "--no-paginate", "--output", "json"]
        if token:
            command += ["--continuation-token", token]
        result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=120)
        page = json.loads(result.stdout)
        for item in page.get("Contents", []):
            size = item.get("Size")
            if not isinstance(size, int) or isinstance(size, bool) or size < 0:
                raise ValueError("Invalid customer image source size")
            total += size
        if not page.get("IsTruncated"):
            return total
        token = page.get("NextContinuationToken")
        if not isinstance(token, str) or not token or token in seen:
            raise ValueError("Invalid customer image source pagination")
        seen.add(token)


def calculate(arguments: argparse.Namespace) -> dict[str, object]:
    filesystem = os.statvfs(arguments.filesystem)
    total = filesystem.f_blocks * filesystem.f_frsize
    available = filesystem.f_bavail * filesystem.f_frsize
    if arguments.mode == "stage":
        writes = arguments.archive_bytes + (arguments.runtime_bytes * 110 + 99) // 100
        writes += arguments.extra_bytes
    else:
        local = sum(source_size(Path(root)) for root in arguments.source_root)
        snapshot = sum(s3_source_size(*source) for source in arguments.s3_source)
        # The snapshot and worst-case compressed archive coexist until upload
        # verification completes. Do not treat a compressed previous backup as
        # the size of today's uncompressed sources.
        writes = snapshot + ((local + snapshot) * 110 + 99) // 100
    return {"operation": arguments.mode, **budget(total, available, writes, arguments.maximum)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--filesystem", default="/")
    parser.add_argument("--maximum", type=int, default=int(os.environ.get("VENDURE_MAXIMUM_DISK_USAGE_PERCENT", "85")))
    commands = parser.add_subparsers(dest="mode", required=True)
    stage = commands.add_parser("stage")
    stage.add_argument("--archive-bytes", type=int, required=True)
    stage.add_argument("--runtime-bytes", type=int, required=True)
    stage.add_argument("--extra-bytes", type=int, default=0)
    backup = commands.add_parser("backup")
    backup.add_argument("--source-root", action="append", default=[])
    backup.add_argument("--s3-source", nargs=2, action="append", default=[])
    try:
        arguments = parser.parse_args()
        if arguments.mode == "stage" and min(arguments.archive_bytes, arguments.runtime_bytes, arguments.extra_bytes) < 0:
            raise ValueError("Negative stage write budget")
        if arguments.mode == "backup" and not (arguments.source_root or arguments.s3_source):
            raise ValueError("Persistent backup source is missing")
        result = calculate(arguments)
        print(json.dumps(result, separators=(",", ":")))
        return 0 if result["status"] == "ok" else 1
    except (ValueError, OSError, subprocess.SubprocessError, json.JSONDecodeError):
        # Never print the AWS stderr or environment data on a failed read.
        print(json.dumps({"status": "blocked", "reason": "Unable to establish a safe disk write budget"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
