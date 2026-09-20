# Website business closure plan

This plan tracks whether each business capability has a complete loop rather than only a visible page. A capability is complete only when it has an entry point, validation, durable state, permission boundaries, failure recovery, audit evidence, monitoring, and verified user/admin behavior.

## Delivery status

| Priority | Domain                     | Required closure                                                                                                          | Status                                                                                       |
| -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| P0       | Data retention             | Policy, quarantine, recovery, reference checks, legal hold, due purge, retry, retained audit record                       | In progress: customer avatar flow implemented and locally verified                           |
| P0       | Data subject requests      | Customer export, correction, account closure, identity re-check, cooling-off period, legal/financial retention exceptions | In progress: export and account closure implemented and locally verified                     |
| P0       | Consent and privacy        | Versioned privacy terms, consent evidence, withdrawal, cookie/tracking controls, purpose inventory                        | In progress: registration and first-party analytics consent implemented and locally verified |
| P0       | Payment reconciliation     | Gateway/chain callback idempotency, order-payment matching, exceptions, refund reconciliation, daily close                | Implemented and locally verified; production migration and scheduler observation remain      |
| P0       | Backup and recovery        | Backup ownership, retention, encryption, restore drill, RPO/RTO evidence and alerting                                     | Implemented and locally verified; production policy and first drill remain                   |
| P0       | Incident response          | Security-event severity, owner, evidence preservation, notification workflow and recovery review                          | Implemented and locally verified; production migration and live alert exercise remain        |
| P1       | Procurement                | Supplier, purchase order, receiving, variance, payable, return-to-supplier and performance score                          | Implemented and locally verified; production migration and browser exercise remain           |
| P1       | Inventory                  | Reservation, receiving, adjustment, transfer, return disposition, low-stock alert and reconciliation                      | Implemented and locally verified; production migration and browser exercise remain           |
| P1       | Fulfilment and after-sales | Shipment, carrier exception, delivery proof, cancellation, return, exchange, reship and refund                            | Implemented and locally verified; production migration and browser exercise remain           |
| P1       | Customer operations        | Customer 360, service history, segmentation, RFM/LTV, churn signal and follow-up outcome                                  | Implemented and locally verified; production migration and browser exercise remain           |
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

## Current P0 implementation: backup and recovery

The daily database snapshot now proves its schema and row manifest, checksum, offsite upload and SSE-S3 encryption before it can satisfy a release gate. Public assets, digital deliveries, customer avatars and private generated images have a separate daily archive with a per-file SHA-256 manifest. Local customer-image storage is captured directly; S3 customer-image storage is copied by exact source `VersionId` into a different backup bucket and keeps a restore mapping for every object.

The backup destination must be versioned, bucket-owner enforced, fully private, encrypted by default and covered by an enabled lifecycle whose current plus noncurrent retention does not exceed the declared window. Local and offsite retention are explicit and must cover the RPO. This only expires historical backup copies: an active avatar remains in live storage and is included again in each new backup, so it is not deleted by age.

Weekly database and file drills independently discover the latest completed checksum marker from S3 without relying on the host's backup catalog. They download, checksum, fully restore and validate the database row manifest, file hashes and any S3 source-object manifest in isolated targets. The measured RTO includes remote discovery, download, validation and restoration. Daily health checks enforce backup freshness, drill age, offsite source and the exact RPO/RTO declarations; scheduled monitoring also fails on the latest drill service failure.

Backup acceptance gates:

- [x] Database and all persistent file classes have separate daily, serialized snapshots.
- [x] Archives reject links, special files, traversal, duplicate paths and files changed during capture.
- [x] S3 customer images are captured from versioned source objects into a distinct backup bucket.
- [x] Backup prefixes must be private, versioned, encrypted and covered by bounded lifecycle expiry.
- [x] Local and offsite retention must be 7-365 days and cannot be shorter than the declared RPO.
- [x] Restore drills can discover the latest offsite backup after loss of the local catalog.
- [x] RTO evidence covers discovery, download, checksum, full restore and content validation.
- [x] Health and scheduled monitors fail on stale backup, bad checksum, stale drill, wrong source or exceeded RTO.
- [ ] Required S3 lifecycle and least-privilege IAM applied in the production account.
- [ ] Initial database and persistent-file backups completed against production-like data.
- [ ] Both offsite restore drills and alert delivery observed in a production-like environment.
- [ ] Release, running SHA and monitoring evidence.

## Current P0 implementation: incident response

Operational incidents are durable records independent of Telegram. Disabling or misconfiguring the notification channel can suppress delivery, but it can no longer suppress the incident ledger. Every incident records ownership, severity, occurrence count and an append-only SHA-256 evidence chain. Sensitive evidence keys are discarded and nested operational evidence is bounded and masked before persistence.

P0/P1 incidents do not close when an automated monitor first observes recovery. They enter a recovery-validation stage with explicit deadlines, then require an authenticated SuperAdmin to record the validation result, root cause, impact and one to ten corrective actions. The incident closes only after every action has a completion note. P2/P3 incidents may close automatically after observed recovery. Acknowledgement, recovery validation, review and corrective-action overdue states escalate to the executive operations owner.

Both administrator surfaces expose the workflow. The Next Admin system-operations panel supports acknowledgement, recovery validation, review and action completion. The Vendure Dashboard incident route adds the same controls plus a chronological evidence view that verifies every stored evidence hash.

Incident-response acceptance gates:

- [x] Incidents persist even when Telegram delivery is disabled.
- [x] P0 is immediately escalated and P1 acknowledgement respects its SLA.
- [x] Repeated occurrences update the durable incident and add evidence.
- [x] P0/P1 recovery requires human validation and cannot directly close the incident.
- [x] Root cause, impact and one to ten corrective actions are mandatory before closure.
- [x] Every corrective action requires a named department, due date and completion note.
- [x] Recovery validation, review and corrective-action deadlines are automatically escalated.
- [x] Evidence is bounded, secret-filtered, hash-protected and visible to SuperAdmins.
- [x] Both administrator interfaces expose the workflow.
- [x] Migration is idempotent and tested on MySQL, PostgreSQL and SQLite-shaped schemas.
- [ ] Migration applied in a production-like database.
- [ ] P0/P1 tabletop exercise, Telegram delivery and overdue escalation observed end to end.
- [ ] Release, running SHA, browser acceptance and monitoring evidence.

## Current P1 implementation: procurement and receiving

The supplier directory is now connected to a channel-scoped purchase-order ledger instead of remaining an isolated SKU attribute. A purchase order snapshots its warehouse, currency, unit cost, purchase unit and package conversion. Server-enforced states cover draft, submission, partial receiving, exact receiving, variance review, closure and cancellation; invalid or post-receipt cancellation is rejected.

Each goods receipt requires an idempotency key and records its operator, time, supplier delivery reference and line-level accepted or rejected quantities. Accepted quantities create or increment the named inventory lot, update aggregate stock and record the current variant cost in the same database transaction. Rejected quantities never enter stock and require a reason. Over-delivery or any rejection enters the variance queue and cannot close without an operator explanation.

Payables are tracked independently from physical receipt because supplier credit terms may outlive delivery. Partial and final payments require a reference, cannot exceed the net order total and append audit events. A return-to-supplier record must identify the exact accepted inventory-lot ID, provide a supplier acknowledgement and a reason, then atomically reduces lot and aggregate stock while creating the payable credit. If the credit makes an earlier payment excessive, the order automatically enters payment dispute. Disputed payments enter the same exception filter as receiving variances and overdue incomplete deliveries.

Supplier performance is calculated from the ledger rather than manually entered. The score combines on-time completion, net acceptance after returns, variance-free orders and dispute-free orders. The supplier editor exposes the component rates and score, while both administrator surfaces expose order creation, submission, receiving, return-to-supplier, payment, dispute, variance closure and the complete event timeline.

Procurement acceptance gates:

- [x] Purchase orders and all child records are isolated by active channel and use the existing supplier and warehouse boundaries.
- [x] State transitions reject receiving before submission, cancellation after receipt and closure before receiving completes.
- [x] Receipt retries are idempotent and concurrent receipt processing locks the purchase order where supported.
- [x] Accepted stock and its lot/cost evidence are committed in the same transaction as the receipt.
- [x] Rejected stock never increases inventory and requires a reason.
- [x] Over-delivery and rejection enter an explicit variance-review queue.
- [x] Partial/final payments are bounded by the net payable after return credits and keep reference/audit evidence.
- [x] Both administrator surfaces expose entry, current state, exceptions, recovery actions and audit history.
- [x] Migration is idempotent on SQLite-shaped schemas and uses portable MySQL/PostgreSQL types.
- [x] Return-to-supplier reverses a specific accepted lot with supplier acknowledgement evidence.
- [x] Return credits reduce net payable and overpayment automatically enters dispute review.
- [x] Supplier score aggregates on-time delivery, net acceptance, variance and dispute outcomes.
- [ ] Migration applied and workflow exercised in a production-like database.
- [ ] Release, running SHA and browser acceptance evidence.

## Current P1 implementation: inventory control

Existing order reservation, FEFO sale deduction, cancellation restock, purchasing receipts, supplier returns and low-stock alerts now feed a shared inventory-control boundary. Manual lot counts, legacy aggregate-stock counts, exact-lot warehouse transfers and reconciliation decisions create channel-scoped, append-only operations with operator, reason, reference, before/after quantities and an idempotency key.

An SKU/warehouse scope that has lots can no longer use the legacy direct aggregate adjustment. Existing lot identity is immutable, a transfer cannot target its source warehouse, and transfers are blocked until both source and target scopes reconcile. The reconciliation queue compares lot totals with Vendure aggregate stock and supports two explicit decisions: align aggregate stock to the lot ledger, or create an auditable baseline lot when aggregate stock is higher. An optimistic expected-difference check rejects stale decisions.

Both administrator surfaces now expose the discrepancy queue, paginated audit operations and reasoned reconciliation decisions, while product lot rows expose exact-lot transfers. Both the native product workspace and the Next Admin inventory surfaces require a reason for manual counts; the Next Admin physical-count action now uses the audited mutation instead of writing Vendure stock levels directly.

Inventory acceptance gates:

- [x] Manual batch and aggregate counts require a reason, operator evidence and idempotency key.
- [x] Lot-tracked SKU/warehouse scopes reject direct aggregate-stock edits.
- [x] Existing lot SKU, warehouse and lot-code identity cannot be silently changed.
- [x] Exact-lot transfers update source lot, target lot and both aggregate stock levels in one transaction.
- [x] Transfers reject insufficient stock, same-warehouse targets and unreconciled source/target scopes.
- [x] Batch-total versus platform-stock differences enter a visible reconciliation queue.
- [x] Reconciliation decisions reject stale differences and preserve before/after evidence.
- [x] Both administrator surfaces expose reconciliation, transfer and audit history and route manual counts through the audited inventory boundary.
- [x] Migration is idempotent on SQLite-shaped schemas and uses portable MySQL/PostgreSQL types.
- [ ] Migration applied and inventory workflow exercised in a production-like database.
- [ ] Release, running SHA and browser acceptance evidence.

## Current P1 implementation: fulfilment and after-sales recovery

Physical outbound fulfilment now has a durable record separate from the mutable Vendure state. Moving a physical fulfilment to shipped snapshots the carrier, tracking code, shipment time and a 14-day follow-up deadline. Digital fulfilments bypass this workflow. A physical fulfilment cannot move to delivered through the ordinary state mutation unless a delivery proof already exists.

Store operators can record a carrier exception, replace the carrier and tracking code when re-shipping, or complete delivery with a traceable proof reference. Customers can confirm receipt from the order detail page; ownership and active-channel boundaries are rechecked on the server. Every action has an idempotency key and an append-only event containing actor, carrier, tracking and proof snapshots. Exception and overdue shipments appear in the operations count, and a 30-minute reconciliation task raises or resolves durable P2 fulfilment incidents.

The Next Admin order editor and Vendure Dashboard order block expose current carrier status, deadlines, exception recovery, proof capture and recent event evidence. The storefront shows real delivery events, exception reasons and customer receipt confirmation rather than inferring delivery solely from the order state.

After-sales requests now support refund-only, return-and-refund, exchange and reship workflows. Digital products remain limited to refund-only; the server calculates refundable amounts, enforces order ownership and channel isolation, and prevents overlapping quantities from being claimed more than once. Approval records the customer-visible resolution, requires return instructions where applicable, establishes the next workflow state and starts an explicit response deadline.

Customers can submit a carrier and tracking code only while a return is awaiting shipment. Store operators then record warehouse receipt and inspect every returned line. Accepted plus rejected quantities must exactly equal the returned quantity; accepted units require an exact warehouse and return-lot identity and are restored through the append-only inventory-control boundary. That single transaction records both lot and aggregate-stock deltas under a customer-return operation linked to the after-sales request. Rejected units never increase stock.

Exchange and reship cases have a separate replacement state machine. Operators record shipment carrier and tracking, route delivery failures into the exception queue, and close delivery with a proof reference. Customers can also confirm receipt. A case cannot be marked completed until any required return is inspected, any required replacement is delivered, and any approved paid refund is linked to a real settled refund from the same order. Both administrator interfaces expose the same actions, deadlines, exception view and timeline; the storefront exposes return instructions, both tracking directions and the customer actions.

After-sales acceptance gates:

- [x] Request type, line quantities, refundable amount, customer ownership and channel boundary are server enforced.
- [x] Approval requires return instructions for return/exchange and creates explicit return/replacement states and deadlines.
- [x] Customer return-shipment submission and replacement-delivery confirmation are idempotent and state guarded.
- [x] Warehouse receipt and inspection cover every line and require accepted plus rejected quantity to match the return.
- [x] Accepted returns restore exact-lot and aggregate inventory through one audited customer-return operation.
- [x] Rejected returns do not increase inventory.
- [x] Exchange cannot ship before return inspection; reship can proceed without a return.
- [x] Replacement shipment, carrier exception and delivery proof are durable timeline events.
- [x] Completion is blocked until return inspection, replacement delivery and real settled refund evidence are complete.
- [x] Storefront, Next Admin and Vendure Dashboard expose the relevant workflow and exception state.
- [x] Migration is idempotent on SQLite-shaped schemas and uses portable MySQL/PostgreSQL types.
- [x] Unit and API tests cover the complete exchange path from approval through audited restock and receipt confirmation.
- [x] Physical shipment creates a channel-scoped carrier record and follow-up deadline while digital fulfilment is excluded.
- [x] Direct delivery transitions are blocked until a customer confirmation or administrator proof exists.
- [x] Carrier exception, re-shipment and delivery actions are state guarded, idempotent and append-only audited.
- [x] Customer receipt confirmation rechecks order ownership and completes the real fulfilment state.
- [x] Exception and overdue delivery counts are visible, and scheduled reconciliation raises or resolves durable incidents.
- [x] Storefront, Next Admin and Vendure Dashboard expose delivery state, recovery controls and event evidence.
- [x] The delivery migration is idempotent and tested on MySQL, PostgreSQL and SQLite-shaped schemas.
- [ ] Migration applied and workflow exercised in a production-like database.
- [ ] Scheduled carrier reconciliation and alert delivery observed in a production-like environment.
- [ ] Release, running SHA and browser acceptance evidence.

## Current P1 implementation: customer operations

Every customer now has a channel-scoped operational profile calculated from settled orders rather than the previously visible but unaudited recent-order total. Recency and frequency use settled purchase history; gross revenue, settled refunds, net lifetime value and average order value remain separated by currency so amounts from different currencies are never added together. The monetary score is a percentile within the paying-customer cohort for that store and currency. Explainable rules classify new leads, active, loyal, VIP, at-risk and dormant customers and retain the exact reasons and evaluation version.

The profile also records customer-history activity and after-sales totals, including currently unresolved cases. Medium- and high-risk paying customers automatically receive a follow-up task unless the customer has requested no further contact. Human-created and system-created tasks have an explicit source, priority, deadline and idempotency key; human-created tasks also retain their owner. Reschedule, result and dismissal transitions are server guarded and append an immutable event with actor, note and outcome. A no-response outcome schedules a seven-day retry, a contacted outcome schedules a 30-day review, and a do-not-contact outcome suppresses future automatic tasks.

A six-hour scheduler refreshes every store's profiles, opens or resolves churn tasks and raises a durable P2 incident when follow-ups pass their deadline. The Next Admin customer drawer and the Vendure Dashboard customer page expose the same RFM/LTV evidence and workflow controls; both operations summaries expose overdue work. Personal-data export includes the profile and follow-up history. Account closure suppresses contact and removes free-text follow-up content while retaining non-identifying operational and financial evidence.

Customer-operations acceptance gates:

- [x] Settled-order recency and frequency are channel scoped and cancelled/unsettled orders do not inflate value.
- [x] Gross revenue, refunds, net LTV and average value are calculated independently for every currency.
- [x] Monetary scoring is relative to paying customers in the same store and currency.
- [x] Segment, churn risk, reasons and calculation version are durable and refreshable.
- [x] Customer history and after-sales state contribute to the 360-degree service summary.
- [x] Medium/high churn risk creates an idempotent follow-up task with priority and deadline.
- [x] Reschedule, completion, dismissal, no-response retry and do-not-contact suppression are server enforced.
- [x] Every task transition records actor, note, outcome and append-only event evidence.
- [x] Overdue tasks appear in both administrator surfaces and scheduled reconciliation raises or resolves a durable incident.
- [x] Personal-data export and account closure cover the new profile and free-text follow-up records.
- [x] Migration is idempotent and tested on MySQL, PostgreSQL and SQLite-shaped schemas.
- [ ] Migration applied and customer workflow exercised in a production-like database.
- [ ] Six-hour reconciliation, overdue incident delivery and browser workflow observed end to end.
- [ ] Release, running SHA and monitoring evidence.

Customer-avatar acceptance gates:

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

1. Apply and exercise the completed P0 controls in a production-like environment without publishing from this worktree.
2. Apply and exercise outbound fulfilment delivery evidence, exception recovery and scheduled alerts.
3. Add acquisition attribution and refund-adjusted profitability on top of trustworthy operational and customer data.
4. Consolidate audit, approvals, scheduled reports, alerts and fraud review across all domains.

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
