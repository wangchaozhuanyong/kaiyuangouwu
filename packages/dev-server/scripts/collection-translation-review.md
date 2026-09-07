# Reviewed collection English maintenance

This one-off publisher reviews the eight fields listed in `collection-translation-review.manifest.json`, separately in each of their two existing Channels. The Chinese source and accepted old/new English are explicit preconditions. Stable Chinese and English slugs remain unchanged. Name corrections are `Premium baijiu`, `Visa & study abroad`, and `AI subscriptions`; the remaining existing English values are reviewed without rewriting content. No assets, product data, descriptions, hierarchy or filters are changed.

Use only the committed main version after its tests and production release. Inject existing `SUPERADMIN_USERNAME`, `SUPERADMIN_PASSWORD`, `VENDURE_API_ORIGIN`, `VENDURE_STOREFRONT_URL`, and `HOMEPAGE_CAROUSEL_CHANNEL_CODES` in the maintenance process. The latter must contain exactly one actual Channel code verified against the public storefront's `activeChannel`. Run separately for the two approved public origins. Credentials and Channel tokens are never logged.

1. Run `node packages/dev-server/scripts/review-collection-translations.mjs --dry-run` and inspect each field.
2. Confirm the existing database backup and previous immutable runtime are available.
3. Run the same script with `--apply --allow-remote --snapshot-file /var/backups/vendure-translation-review/unique-before.json`. The parent directory must already exist; the snapshot is created exclusively with mode 0600 before any write.
4. Independently run `--verify`, then check the Dashboard audit and each affected category in both storefront locales. Language routing uses both the query parameter and header.

The native English-only collection mutation records the supported manual lock against the current Chinese source. The publisher never unlocks fields or uses SQL updates. `UpdateCollectionInput` has no optimistic version argument: the script rechecks the complete snapshot immediately before each narrow mutation and compares the full non-version content afterwards. A simultaneous edit to the same English field during that native API window cannot be atomically excluded; stop when any drift is detected. Do not run alongside category editing.

On post-write failure, the script re-reads each attempted collection and restores only the reviewed English fields when the current content still matches its own expected write. A concurrent edit prevents automatic restoration and requires comparison with the saved snapshot. Original assets are never deleted. Restoration preserves content but does not recreate historical stale audit metadata: the native API records a new manual review. Keep the database backup for forensic recovery; never overwrite the whole database to undo a label change.

This entry is standalone maintenance and does not alter normal deployment or publisher guards. Tests: `node --test packages/dev-server/scripts/review-collection-translations.spec.mjs` plus the existing native translation, storefront, and production release checks.
