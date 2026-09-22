#!/usr/bin/env python3

import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "vendure-backup-s3-guard.py"
SPEC = importlib.util.spec_from_file_location("vendure_backup_s3_guard", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def controlled_reader(lifecycle):
    responses = {
        "get-bucket-versioning": {"Status": "Enabled"},
        "get-bucket-ownership-controls": {
            "OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]}
        },
        "get-public-access-block": {
            "PublicAccessBlockConfiguration": {
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": True,
                "RestrictPublicBuckets": True,
            }
        },
        "get-bucket-encryption": {
            "ServerSideEncryptionConfiguration": {
                "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
            }
        },
        "get-bucket-lifecycle-configuration": lifecycle,
    }

    def read(command, *_arguments):
        return responses[command]

    return read


def lifecycle(prefix="mysql/", current=29, noncurrent=1):
    return {
        "Rules": [
            {
                "Status": "Enabled",
                "Filter": {"Prefix": prefix},
                "Expiration": {"Days": current},
                "NoncurrentVersionExpiration": {"NoncurrentDays": noncurrent},
                "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1},
            }
        ]
    }


class BackupS3PolicyTest(unittest.TestCase):
    def test_accepts_scoped_encrypted_versioned_bucket_with_bounded_expiry(self):
        result = MODULE.verify_policy(
            "s3://safe-backup/mysql/daily", 30, controlled_reader(lifecycle())
        )
        self.assertEqual(result["prefix"], "mysql/daily/")

    def test_rejects_retention_that_can_outlive_the_declared_window(self):
        with self.assertRaisesRegex(MODULE.PolicyError, "bounded"):
            MODULE.verify_policy(
                "s3://safe-backup/mysql", 30, controlled_reader(lifecycle(current=30, noncurrent=7))
            )

    def test_rejects_lifecycle_for_an_unrelated_prefix(self):
        with self.assertRaisesRegex(MODULE.PolicyError, "bounded"):
            MODULE.verify_policy(
                "s3://safe-backup/mysql", 30, controlled_reader(lifecycle(prefix="files/"))
            )

    def test_rejects_tag_scoped_lifecycle_that_does_not_cover_untagged_backups(self):
        tagged = lifecycle()
        tagged["Rules"][0]["Filter"] = {
            "And": {"Prefix": "mysql/", "Tags": [{"Key": "expiry", "Value": "short"}]}
        }
        with self.assertRaisesRegex(MODULE.PolicyError, "bounded"):
            MODULE.verify_policy(
                "s3://safe-backup/mysql", 30, controlled_reader(tagged)
            )

    def test_rejects_unsafe_destination_and_excessive_policy_window(self):
        with self.assertRaisesRegex(MODULE.PolicyError, "safe"):
            MODULE.verify_policy("s3://safe-backup/../mysql", 30, controlled_reader(lifecycle()))
        with self.assertRaisesRegex(MODULE.PolicyError, "between"):
            MODULE.verify_policy("s3://safe-backup/mysql", 366, controlled_reader(lifecycle()))


if __name__ == "__main__":
    unittest.main()
