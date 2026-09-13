"""Prepare an offline review manifest. This tool has no production write mode."""
import argparse
import hashlib
import json
from decimal import Decimal
from pathlib import Path


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def prepare(audit, receipt, supplier_scope):
    if not audit.get("readOnly") or audit.get("productionBackfillPerformed"):
        raise ValueError("Expected the original read-only audit")
    if receipt.get("Status") != "Success" or receipt.get("ResponseCode") != 0:
        raise ValueError("Production snapshot receipt did not succeed")
    snapshot = json.loads(receipt["StandardOutputContent"])
    if snapshot.get("readOnly") != 1 or snapshot["observedAt"] != audit["productionObservedAt"]:
        raise ValueError("Snapshot identity or read-only status differs from the audit")
    previous = {}
    for row in snapshot["records"]:
        key = (row["kind"], str(row["id"]))
        if key in previous:
            raise ValueError("Duplicate production record")
        previous[key] = row
    used_bills = set()
    records = []
    for kind, entries in [("image", audit["images"]), ("prompt", audit["optimizations"])]:
        for entry in entries:
            record_id = str(entry["eventId" if kind == "image" else "optimizationId"])
            old = previous[(kind, record_id)]
            bill_ids = [entry["supplierRequestId"]] if kind == "image" else entry["supplierRequestIds"]
            for bill_id in bill_ids:
                scoped_id = (supplier_scope, bill_id)
                if not bill_id or scoped_id in used_bills:
                    raise ValueError("A supplier bill is missing an ID or mapped more than once")
                used_bills.add(scoped_id)
            amount = Decimal(entry["actualBilledUsd"])
            micros = amount * 1_000_000
            if not amount.is_finite() or amount < 0 or micros != micros.to_integral_value():
                raise ValueError("Invalid supplier amount precision")
            incomplete = entry.get("completeness") == "EARLY_CALL_TELEMETRY_MISSING"
            errors = entry.get("supplierFailureRequestIds", [])
            reasons = ["CHANNEL_REQUIRES_FRESH_VERIFICATION", "HISTORICAL_ASSOCIATION_REQUIRES_REVIEW"]
            if incomplete:
                reasons.append("EARLY_ATTEMPT_RANGE_INCOMPLETE")
            if errors:
                reasons.append("ERROR_RECEIPT_IS_NOT_PROOF_OF_ZERO_CHARGE")
            if entry.get("costEventOutcome") == "UNKNOWN":
                reasons.append("UNKNOWN_OUTCOME_REQUIRES_REVIEW")
            records.append({
                "kind": kind, "recordId": record_id, "channelId": None,
                "supplierScope": supplier_scope, "supplierRequestIds": bill_ids,
                "supplierFailureRequestIds": errors,
                "previousCostMicrounits": old["actualCostMicrounits"],
                "previousCurrency": old["costCurrency"],
                "previousStateHash": digest(old),
                "observedBilledMicrounits": int(micros), "observedCurrency": "USD",
                "matchBasis": entry["matchBasis"], "matchingStatus": "CROSS_MATCH_PENDING_REVIEW",
                "attemptRangeComplete": False if incomplete else None,
                "reviewDecision": "PENDING", "blockingReasons": reasons,
            })
    total = sum(row["observedBilledMicrounits"] for row in records)
    if Decimal(total) / 1_000_000 != Decimal(audit["summary"]["combinedObservedBilledUsd"]):
        raise ValueError("Recomputed total differs from the audited total")
    if len(records) != len(previous):
        raise ValueError("Snapshot contains records outside this review")
    return {
        "mode": "REVIEW_ONLY", "productionWrites": 0, "automaticallyApproved": 0,
        "sourceAuditHash": digest(audit), "sourceSnapshotHash": digest(snapshot),
        "snapshotObservedAt": snapshot["observedAt"], "supplierScope": supplier_scope,
        "recordCount": len(records), "billedRecordCount": len(used_bills),
        "observedBilledUsd": f"{Decimal(total) / 1_000_000:.6f}",
        "limitations": audit["limitations"], "records": records,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--supplier-scope", required=True, help="Previously verified supplier account scope; never a credential")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    output = args.output.resolve()
    if not output.is_relative_to(root) or output in [args.audit.resolve(), args.snapshot.resolve()]:
        parser.error("Output must be a separate file inside this project")
    result = prepare(json.loads(args.audit.read_text()), json.loads(args.snapshot.read_text()), args.supplier_scope)
    content = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if output.exists():
        if output.read_text() != content:
            parser.error("Output already contains a different review; use a new project file")
    else:
        with output.open("x", encoding="utf-8") as handle:
            handle.write(content)
    print(f"Prepared {result['recordCount']} records, {result['billedRecordCount']} bills, USD {result['observedBilledUsd']}; approved 0; production writes 0")


if __name__ == "__main__":
    main()
