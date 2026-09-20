# Website business closure plan

This plan tracks whether each business capability has a complete loop rather than only a visible page. A capability is complete only when it has an entry point, validation, durable state, permission boundaries, failure recovery, audit evidence, monitoring, and verified user/admin behavior.

## Delivery status

| Priority | Domain                     | Required closure                                                                                                          | Status                                                                                       |
| -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| P0       | Data retention             | Policy, quarantine, recovery, reference checks, legal hold, due purge, retry, retained audit record                       | In progress: customer avatar flow implemented and locally verified                           |
| P0       | Data subject requests      | Customer export, correction, account closure, identity re-check, cooling-off period, legal/financial retention exceptions | In progress: export and account closure implemented and locally verified                     |
| P0       | Consent and privacy        | Versioned privacy terms, consent evidence, withdrawal, cookie/tracking controls, purpose inventory                        | In progress: registration and first-party analytics consent implemented and locally verified |
| P0       | Payment reconciliation     | Gateway/chain callback idempotency, order-payment matching, exceptions, refund reconciliation, daily close                | Implemented and locally verified; production migration and scheduler observation remain      |
| P0       | Backup and recovery        | Backup ownership, retention, encryption, restore drill, RPO/RTO evidence and alerting                                     | Operational verification required                                                            |
| P0       | Incident response          | Security-event severity, owner, evidence preservation, notification workflow and recovery review                          | Not started                                                                                  |
| P1       | Procurement                | Supplier, purchase order, receiving, variance, payable, return-to-supplier and performance score                          | Existing supplier area requires closure audit                                                |
| P1       | Inventory                  | Reservation, receiving, adjustment, transfer, return disposition, low-stock alert and reconciliation                      | Existing pieces require closure audit                                                        |
| P1       | Fulfilment and after-sales | Shipment, carrier exception, delivery proof, cancellation, return, exchange, reship and refund                            | Existing pieces require closure audit                                                        |
| P1       | Customer operations        | Customer 360, service history, segmentation, RFM/LTV, churn signal and follow-up outcome                                  | Not started                                                                                  |
| P1       | Marketing analytics        | Acquisition attribution, search terms, funnel, campaign cost, revenue, refund-adjusted ROI                                | Traffic exists; cost/attribution closure not verified                                        |
| P1       | Finance                    | Revenue, discount, tax, cost, gateway fee, refund, chargeback and profit reconciliation                                   | Existing reports require closure audit                                                       |
| P2       | Governance                 | Unified immutable audit, four-eyes approval, content/config versioning, scheduled reports and anomaly alerts              | Partial and distributed                                                                      |
| P2       | Fraud and abuse            | Account/order/payment/referral risk rules, review queue, decision evidence and appeal                                     | Partial and distributed                                                                      |

## Current P0 implementation: customer avatar retention

The active avatar is not placed in a time-based deletion queue. Only an avatar replaced or removed by its owner is quarantined for 30 days. During that period the owner can restore it. At expiry the worker checks ownership, channel boundaries, business references and legal hold before deletion. Referenced assets are blocked, technical failures are retried, and completed deletion keeps its database audit record.

## Current P0 implementation: personal-data requests and account closure

Signed-in customers can generate a JSON export after password re-authentication. The file contains profile, addresses, delivery emails, orders, payments, refunds, fulfilments, coupons, referrals, reviews, after-sales, image-studio activity and linked analytics. The server keeps only the request audit, summary and SHA-256 digest, not the exported body.

Account closure also requires password re-authentication and has a seven-day cooling-off period that the customer can cancel. The scheduled worker blocks closure while orders, withdrawals, payment reconciliation, after-sales or image jobs are unresolved. A successful closure revokes access, removes direct contact/address data, quarantines avatars, anonymizes user/authentication identifiers and plugin-owned image content, and retains transactional records required for finance, disputes and audit. Blocked and failed requests stay visible in the admin exception queue and can be retried.

## Current P0 implementation: consent and first-party analytics

Email, quick-email and first-time Google registration require an explicit unchecked consent control. The server snapshots the current terms and privacy content into append-only evidence containing the policy version, SHA-256 digest, locale, source and timestamp; network and browser evidence is stored only as keyed hashes. The unaudited built-in registration mutation is blocked so API clients cannot bypass this path.

First-party page-view analytics now defaults off. A global choice explains the optional purpose and offers “necessary only” or “allow analytics”; the server rejects page-view writes unless the grant cookie is present. Grant and withdrawal actions are auditable, users can change the preference at any time, and declining does not block account, shopping or support flows.

## Current P0 implementation: payment reconciliation and recovery

The USDT scanner already commits solidified receipt evidence before order settlement, uses transaction and active-match uniqueness for idempotency, and routes ownership, quote, wallet-integrity and Vendure settlement failures into manual review. Manual refund records verify a solidified official USDT transfer and create a linked Vendure refund.

Manual-review cases now have an explicit server-enforced recovery path. Only transient settlement failures may be retried; the current chain transaction must still match the stored sender, recipient, amount and block snapshot. Non-retriable cases can be closed only after a full external refund is verified against the approved refund-wallet list. Both actions record the operator, reason, result and chain evidence, close the related incident, and remain visible in both administrator interfaces. Legacy review reasons are safely classified during migration where the original reason is unambiguous.

A daily scheduled reconciliation cross-checks settled intents, Vendure payments, linked orders, transaction identifiers, manual refunds and overdue review cases. Hard inconsistencies fire a P0 operational incident; overdue reviews fire a P1 incident; a healthy run resolves the daily incident. Scan limits fail closed as an alert rather than silently reporting success.

Payment acceptance gates:

- [x] A chain receipt cannot be linked to multiple payment intents.
- [x] A retry revalidates the current solidified transfer against the stored receipt snapshot.
- [x] Ownership or wallet-integrity exceptions cannot use direct settlement retry.
- [x] External resolution requires a verified full refund from an approved platform wallet.
- [x] Refund transaction identifiers are checked across receipts, ordinary refunds and reconciliation actions.
- [x] Resolution stores operator, reason, outcome and chain evidence.
- [x] Both administrator interfaces expose the exception action and evidence history.
- [x] Daily reconciliation alerts on broken intent/payment/refund links and overdue review cases.
- [x] Migration is idempotent and tested on MySQL, PostgreSQL and SQLite-shaped schemas.
- [ ] Migration applied in a production-like database.
- [ ] Daily scheduler execution and incident delivery observed in a production-like environment.
- [ ] Release, running SHA, browser acceptance and monitoring evidence.

Acceptance gates:

- [x] Replacement is atomic: a failed upload leaves the current avatar active.
- [x] Active avatars do not expire automatically.
- [x] Replaced or removed avatars are recoverable for 30 days.
- [x] Restore atomically retires the currently active avatar.
- [x] Purge checks business references and store ownership again.
- [x] Legal hold requires an administrator reason and blocks purge.
- [x] Failed or reference-blocked purges remain visible and retryable.
- [x] Customer UI explains the rule and exposes restore/remove actions.
- [x] Super-admin UI exposes queue state, failures, holds and retries.
- [x] Migration is idempotent and tested on MySQL, PostgreSQL and SQLite-shaped schemas.
- [ ] Migration applied in a production-like database.
- [ ] Worker execution observed against production-like object storage.
- [ ] Release, running SHA, browser acceptance and monitoring evidence.

## Execution order

1. Finish P0 data governance: data-subject request workflow, consent evidence, policy registry and export/deletion exceptions.
2. Close payment/refund reconciliation and operational recovery before expanding revenue-driving automation.
3. Close procurement, inventory and after-sales state machines with reconciliation and exception queues.
4. Add customer 360, attribution and refund-adjusted profitability on top of trustworthy operational data.
5. Consolidate audit, approvals, scheduled reports, alerts and fraud review across all domains.

## Definition of done for every domain

Each domain must demonstrate all of the following:

1. A user or administrator can start the workflow and see its current state.
2. The server enforces permissions, validation, idempotency and store isolation.
3. State transitions are durable and invalid transitions are rejected.
4. Side effects have retry, reconciliation and a human exception queue.
5. Sensitive or destructive actions have confirmation, reason and audit evidence.
6. Data retention, legal hold and deletion exceptions are explicit.
7. Metrics and alerts distinguish pending, failed, blocked and completed work.
8. Automated tests cover success, duplicate, unauthorized and failure paths.
9. Local checks, CI, migration, release, running SHA and browser acceptance are recorded separately.
