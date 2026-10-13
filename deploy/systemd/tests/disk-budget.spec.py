import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("disk_budget", Path(__file__).resolve().parents[1] / "vendure-disk-budget.py")
disk_budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(disk_budget)


class DiskBudgetTests(unittest.TestCase):
    def test_reproduces_observed_release_disk_failure(self):
        result = disk_budget.budget(49691512 * 1024, 7716588 * 1024,
                                    152341 * 1024 + 674287 * 1024)
        self.assertEqual((result["requiredBytes"] + 1023) // 1024, 8345891)
        self.assertEqual(result["status"], "insufficient")

    def test_post_cleanup_capacity_can_stage_and_capture_one_more_full_backup(self):
        result = disk_budget.budget(49691512 * 1024, 21668548 * 1024,
                                    152341 * 1024 + 674287 * 1024 + 4 * 1024**3)
        self.assertEqual(result["status"], "ok")
        self.assertGreater(result["availableBytes"] - result["requiredBytes"], 8 * 1024**3)

    def test_snapshot_and_archive_both_count_towards_the_peak(self):
        total = 50 * 1024**3
        archive_only = disk_budget.budget(total, 14 * 1024**3, 4 * 1024**3)
        with_snapshot = disk_budget.budget(total, 14 * 1024**3, 8 * 1024**3)
        self.assertEqual(archive_only["status"], "ok")
        self.assertEqual(with_snapshot["status"], "insufficient")

    def test_does_not_accept_equal_headroom_or_invalid_inputs(self):
        sample = disk_budget.budget(50 * 1024**3, 20 * 1024**3, 1024)
        self.assertEqual(disk_budget.budget(50 * 1024**3, sample["requiredBytes"], 1024)["status"], "insufficient")
        for args in [(0, 0, 0), (100, 101, 0), (100, 10, -1), (100, 10, 0, 101)]:
            with self.assertRaises(ValueError):
                disk_budget.budget(*args)


if __name__ == "__main__":
    unittest.main()
