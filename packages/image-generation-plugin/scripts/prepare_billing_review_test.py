import copy
import importlib.util
import json
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("prepare-billing-review.py")
spec = importlib.util.spec_from_file_location("billing_review", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
REPORT = SCRIPT.resolve().parents[3] / "reports/ai-image-studio-audit-20260913"


class BillingReviewTest(unittest.TestCase):
    def setUp(self):
        # Synthetic fixtures: the tests are portable and contain no production data.
        self.audit = {
            "readOnly": True, "productionBackfillPerformed": False, "productionObservedAt": "fixture-time",
            "images": [{"eventId": 1, "supplierRequestId": "bill-1", "actualBilledUsd": "0.001000", "matchBasis": "TIME"}],
            "optimizations": [{"optimizationId": 2, "supplierRequestIds": ["bill-2"], "supplierFailureRequestIds": ["error-1"], "actualBilledUsd": "0.002000", "matchBasis": "TIME", "completeness": "EARLY_CALL_TELEMETRY_MISSING"}],
            "summary": {"combinedObservedBilledUsd": "0.003000"}, "limitations": ["No exact ID match"],
        }
        self.receipt = {"Status": "Success", "ResponseCode": 0, "StandardOutputContent": json.dumps({
            "readOnly": 1, "observedAt": "fixture-time", "records": [
                {"kind": "image", "id": 1, "actualCostMicrounits": None, "costCurrency": None},
                {"kind": "prompt", "id": 2, "actualCostMicrounits": None, "costCurrency": None},
            ],
        })}

    def test_repeatable_and_never_auto_approves(self):
        result = module.prepare(self.audit, self.receipt, "fixture:account:1")
        self.assertEqual(result, module.prepare(copy.deepcopy(self.audit), self.receipt, "fixture:account:1"))
        self.assertEqual(result["observedBilledUsd"], "0.003000")
        self.assertEqual(result["automaticallyApproved"], 0)
        self.assertEqual(result["productionWrites"], 0)
        self.assertIsNone(result["records"][0]["previousCostMicrounits"])
        self.assertIn("ERROR_RECEIPT_IS_NOT_PROOF_OF_ZERO_CHARGE", result["records"][1]["blockingReasons"])
        self.assertFalse(result["records"][1]["attemptRangeComplete"])

    def test_duplicate_supplier_bill_is_rejected(self):
        self.audit["optimizations"][0]["supplierRequestIds"] = ["bill-1"]
        with self.assertRaisesRegex(ValueError, "mapped more than once"):
            module.prepare(self.audit, self.receipt, "fixture:account:1")

    def test_different_snapshot_or_changed_total_is_rejected(self):
        self.audit["productionObservedAt"] = "different"
        with self.assertRaisesRegex(ValueError, "identity"):
            module.prepare(self.audit, self.receipt, "fixture:account:1")
        self.audit["productionObservedAt"] = "fixture-time"
        self.audit["summary"]["combinedObservedBilledUsd"] = "1.000000"
        with self.assertRaisesRegex(ValueError, "total"):
            module.prepare(self.audit, self.receipt, "fixture:account:1")


if __name__ == "__main__":
    unittest.main()
