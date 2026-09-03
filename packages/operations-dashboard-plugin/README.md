# Operations Dashboard Plugin

This private Vendure plugin owns operational dashboard extensions and the internal Telegram notification
channel. Telegram is an internal incident and commerce signal only; it does not publish marketing content.

## Telegram runtime configuration

Configure secrets on both the Vendure API and worker processes:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_OPS_CHAT_ID=
TELEGRAM_EMERGENCY_ENABLED=false
```

`TELEGRAM_BOT_TOKEN` is never stored in the database or returned by the Admin API. The Chat ID is always
handled as a string. `TELEGRAM_OPS_CHAT_ID` overrides the optional database value. Set
`TELEGRAM_EMERGENCY_ENABLED=true` only when database-down alerts must remain active even if the saved
configuration cannot be loaded.

After running migrations and restarting both processes, open **系统运维 → Telegram 通知** in the current
React dashboard. Save the Chat ID and policy, enable notifications, test the Bot identity, and then enqueue a
test message. The identity check calls `getMe`; message test buttons write to the durable outbox.

## Delivery model

- One Bot and one private Telegram group.
- Business event subscribers only write `admin_notification_outbox`; network delivery runs in the
  `telegram-internal-notification` Vendure JobQueue.
- One-off events use a unique deduplication key. Inventory incidents use an active fingerprint, aggregate
  repeats, and edit or replace their original Telegram message when resolved.
- P0 and P1 have higher queue priority. Retry delays are 1 minute, 5 minutes, 15 minutes, 1 hour and 6 hours;
  they use a separate high-priority Vendure queue so a P3 backlog cannot occupy their worker lane. Telegram
  `retry_after` overrides the normal delay. Non-retryable authorization and request errors become dead letters
  and can be retried from the dashboard after configuration is corrected.
- The worker heartbeat and delivery counts are persisted for the API process to display.
- SuperAdmin configuration changes are written atomically with an actor-attributed audit record. Chat IDs are
  masked in the audit payload, and the Bot Token is never stored there.
- The API-process watchdog sends bounded direct alerts after two consecutive database failures, or when dead
  rows / a stale worker leave P0/P1 notifications backed up. This emergency path uses the environment or last
  in-memory Chat ID and does not carry normal commerce messages.

## Vendure event coverage

| Event family                                     | Vendure source                                               | Default routing                                |
| ------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------- |
| Order placed                                     | `OrderPlacedEvent`                                           | `SALES` with `FULFILLMENT`, `DATA_FINANCE`     |
| Payment authorized/settled/failed/proof mismatch | `PaymentStateTransitionEvent`                                | `DATA_FINANCE`, `FULFILLMENT` or `TECH`        |
| Fulfillment created/shipped/delivered/cancelled  | `FulfillmentEvent`, `FulfillmentStateTransitionEvent`        | `FULFILLMENT`                                  |
| Refund pending/settled/failed                    | `RefundStateTransitionEvent`                                 | `FULFILLMENT` with `DATA_FINANCE`              |
| Low/recovered stock                              | `StockMovementEvent` plus Vendure saleable-stock calculation | `SUPPLY`                                       |
| Database dependency                              | API-process watchdog                                         | `TECH`, immediately escalated to `EXEC` for P0 |

Platform-specific domain signals also use the same durable outbox:

- Solidified USDT transfers with an unmatched amount and USDT intents requiring manual review are P0 finance
  incidents.
- Empty automatic-card pools are P0 supply incidents; final automatic-card email failures are P1 fulfillment
  incidents. Successful allocation or delivery resolves the matching incident.
- Final manual-delivery email failures and overdue manual-delivery tasks are P1 fulfillment incidents, with
  recovery emitted when the task is published, delivered or cancelled.

CloudBridge-specific account-capacity groups, Go/Wire services, Redis checks and Ops latency-rule metrics are
not part of this Vendure plugin. Product inventory uses Vendure's existing inventory calculation instead.

## Health endpoints

- `GET /health` remains Vendure's compatibility liveness route.
- `GET /health/live` checks only that the HTTP process is alive.
- `GET /health/ready` runs a bounded database probe and returns a simplified `503` response when unavailable.

The application cannot report its own complete process or host outage. Production monitoring must probe
`/health/ready` from outside the Vendure host.
