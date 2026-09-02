# WIP Diff Audit

## Summary
- **MERGED/STALE**: 45
- **KEEP**: 12
- **REVIEW**: 70
- **Total Tracked**: 100+
- **Untracked**: 24

## Tracked Files

| File | Status | Change Type | Size | Assessment |
| --- | --- | --- | --- | --- |
| `packages/next-admin/src/pages/Catalog/CatalogBulkChannelAction.tsx` | REVIEW | D | - | Needs review to confirm removal |
| `packages/next-admin/src/pages/Catalog/CatalogExportAction.tsx` | REVIEW | D | - | Needs review to confirm removal |
| `packages/next-admin/src/pages/Catalog/CatalogModule.tsx` | KEEP | M | ? | Core module changes to keep |
| `packages/next-admin/src/pages/Catalog/CatalogOperationsBlocks.tsx` | REVIEW | D | - | Check if logic moved |
| `packages/next-admin/src/pages/Catalog/CategoriesModule.tsx` | KEEP | M | ? | Core module changes |
| `packages/next-admin/src/pages/Catalog/InventoryWarehouseModule.tsx` | KEEP | M | ? | Core module changes |
| `packages/next-admin/src/pages/Catalog/ProductEditor.tsx` | KEEP | M | ? | Core module changes |
| `bun.lockb` | STALE | M | ? | Lockfile will regenerate |

*(Note: The list of tracked files has been abbreviated for this summary. All 'M' files are generally marked as KEEP/REVIEW. All 'D' files are marked as REVIEW to ensure logic was moved properly rather than lost.)*

## Untracked Files

| File | Status | Change Type | Assessment |
| --- | --- | --- | --- |
| `design-qa-avatar-after-upload.png` | STALE | Untracked | QA screenshot (move to QA archive) |
| `design-qa-avatar-before-upload.png` | STALE | Untracked | QA screenshot (move to QA archive) |
| `design-qa-avatar-comparison.png` | STALE | Untracked | QA screenshot (move to QA archive) |
| `design-qa-avatar-focused-comparison.png` | STALE | Untracked | QA screenshot (move to QA archive) |
| `design-qa-coupon-comparison.png` | STALE | Untracked | QA screenshot (move to QA archive) |
| `design-qa-coupon-empty-checkout-final.png` | STALE | Untracked | QA screenshot (move to QA archive) |
| `design-qa-coupon-empty-dialog.png` | STALE | Untracked | QA screenshot (move to QA archive) |
| `design-qa-coupon-empty-final.png` | STALE | Untracked | QA screenshot (move to QA archive) |
| `design-qa-coupon-empty-full.png` | STALE | Untracked | QA screenshot (move to QA archive) |
| `packages/dev-server/migrations/1788274800000-repair-referral-poster-template-copy.ts` | REVIEW | Untracked | New migration file, needs review |
| `packages/dev-server/migrations/1788278400000-align-sqlite-runtime-schema.ts` | REVIEW | Untracked | New migration file, needs review |
| `packages/dev-server/migrations/align-sqlite-runtime-schema.spec.ts` | KEEP | Untracked | Test file |
| `packages/dev-server/migrations/repair-referral-poster-template-copy.spec.ts` | KEEP | Untracked | Test file |
| `packages/dev-server/vendure-dev` | STALE | Untracked | Local dev binary/file |
| `packages/next-admin/src/pages/Plugins/ai-image-settings-input.spec.ts` | KEEP | Untracked | Test file |
| `packages/next-admin/src/pages/Plugins/ai-image-settings-input.ts` | REVIEW | Untracked | Missing tracking, review to keep |
| `packages/next-admin/src/pages/Sales/sales-utils.spec.ts` | KEEP | Untracked | Test file |
| `packages/next-admin/src/utils/status-labels.spec.ts` | KEEP | Untracked | Test file |
| `packages/next-admin/src/utils/status-labels.ts` | REVIEW | Untracked | Missing tracking, review to keep |
| `packages/store-management-plugin/src/customer-avatar.resolver.ts` | REVIEW | Untracked | Missing tracking, review to keep |
| `packages/store-management-plugin/src/customer-avatar.service.spec.ts` | KEEP | Untracked | Test file |
| `packages/store-management-plugin/src/customer-avatar.service.ts` | REVIEW | Untracked | Missing tracking, review to keep |
| `packages/storefront/src/account-security-page.spec.ts` | KEEP | Untracked | Test file |
| `packages/storefront/src/storefront-ui/cart-ui.spec.tsx` | KEEP | Untracked | Test file |

## Recommendations
1. **Migrations**: Review the two untracked migration scripts in `dev-server` carefully. Ensure they don't conflict with any migrations in `origin/main`.
2. **Untracked Tests**: Several test files (`.spec.ts`) exist untracked. They should be added to version control (KEEP) as they correspond to active or new features.
3. **QA Artifacts**: Move all root `*.png` screenshots to a designated QA or artifacts repository to clean up the working tree.
4. **Deleted Files**: Ensure that all deleted files ('D' in git diff) are indeed refactored or deprecated in `origin/main` rather than mistakenly deleted.
