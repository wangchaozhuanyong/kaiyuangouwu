# Patch Ledger Summary

## By Domain
- **cart**: 2
- **catalog**: 17
- **ci**: 4
- **core**: 27
- **coupons**: 6
- **dashboard**: 37
- **deploy**: 20
- **i18n**: 5
- **image**: 27
- **migrations**: 5
- **next-admin**: 8
- **ops**: 2
- **promotion**: 8
- **referral**: 4
- **schema**: 4
- **storefront**: 52
- **usdt**: 2

## By Classification
- **ABSORB**: 81
- **COMPAT**: 69
- **PERMANENT**: 80

## Ledger

| Commit | Domain | Subject | Classification | Work Stream | Notes |
|---|---|---|---|---|---|
| 262db22e | next-admin | Restore legacy management workflows | PERMANENT | - | Correct fix |
| 52e883a3 | next-admin | Improve tablet workspace layout | ABSORB | storefront-shell | Needs review |
| 2330eb74 | storefront | Add desktop image studio layout (#44) | PERMANENT | - | Correct fix |
| ce7dcd25 | storefront | Differentiate referral poster skins | PERMANENT | - | Correct fix |
| 542d1a0c | storefront | Make promotion entry optional (#40) | PERMANENT | - | Correct fix |
| 19aaaca3 | deploy | Relax storefront realtime connection cap | COMPAT | - | Correct fix |
| 7475ae57 | coupons | Align ledger options with generated schema | ABSORB | storefront-css | Needs review |
| 1c1f44c8 | dashboard | Use runtime coupon ledger input | PERMANENT | - | Correct fix |
| 55dfc5d2 | storefront | Isolate coupon state per customer | PERMANENT | - | Correct fix |
| b97c1083 | storefront | Align category sidebar toolbar height | COMPAT | - | Correct fix |
| f54f69ca | next-admin | Add managed USDT payment setup | COMPAT | - | Correct fix |
| 8ac83b2e | storefront | Add customer avatars and coupon empty state | PERMANENT | - | Correct fix |
| 91b475a7 | next-admin | Align AI image settings saves | ABSORB | storefront-css | Needs review |
| 0f58578c | storefront | Align logistics status filters | ABSORB | storefront-shell | Needs review |
| 7ead33d5 | dashboard | Bypass stale dashboard asset cache | ABSORB | legacy-dashboard | Needs review |
| e80cf34a | next-admin | Unify navigation page widths | ABSORB | storefront-api | Needs review |
| d9080a0c | storefront | Align cart bar with bottom navigation | PERMANENT | - | Correct fix |
| 2b1e274a | deploy | Expose console health endpoint | COMPAT | - | Correct fix |
| 92911918 | next-admin | Compact admin data tables (#25) | PERMANENT | - | Correct fix |
| 816c255a | i18n | Ignore root collection during backfill (#24) | COMPAT | - | Correct fix |
| b0ed9cd7 | i18n | Harden customer content translation flow (#23) | PERMANENT | - | Correct fix |
| d6877950 | dashboard | Localize translation audit and add locks (#22) | ABSORB | admin-marketing | Needs review |
| 96580e0b | next-admin | Add safe catalog bulk import (#21) | PERMANENT | - | Correct fix |
| c5c99a33 | storefront | Prevent root loading header overlap (#20) | COMPAT | - | Correct fix |
| e049beb8 | dashboard | Recover from stale dashboard assets (#19) | PERMANENT | - | Correct fix |
| 8c00cc4d | next-admin | Expand product table layout (#18) | PERMANENT | - | Correct fix |
| 15ab8dc3 | dashboard | Sync shell logo with store profile (#17) | PERMANENT | - | Correct fix |
| 1694a933 | core | Preserve trailing payment audit fields (#15) | COMPAT | - | Correct fix |
| 919b9048 | core | Audit production Channel USDT wallets (#14) | PERMANENT | - | Correct fix |
| 7a15cb3b | core | Diagnose image generation residual alerts (#12) | COMPAT | - | Correct fix |
| 78808fa7 | core | Strengthen production release evidence (#11) | COMPAT | - | Correct fix |
| 95d44745 | core | Align production MySQL commerce schema | ABSORB | storefront-shell | Needs review |
| e836b596 | core | Scope saleable stock to shop API | PERMANENT | - | Correct fix |
| aff47728 | dashboard | Add extension framework and safe store cleanup (#8) | COMPAT | - | Correct fix |
| 0017757c | dashboard | Align digital variant delivery copy | COMPAT | - | Correct fix |
| d637170a | ops | Localize manual delivery workspace | ABSORB | admin-marketing | Needs review |
| fc997810 | dashboard | Sync fulfillment translations | ABSORB | storefront-shell | Needs review |
| dabd00f3 | core | Unify product fulfillment and store modes | PERMANENT | - | Correct fix |
| 07a3a80c | dashboard | Improve navigation responsiveness | PERMANENT | - | Correct fix |
| 27289736 | i18n | Add product packaging catalogs | ABSORB | backend-services | Needs review |
| f0cc1d7b | dashboard | Stabilize product workbench workflows | PERMANENT | - | Correct fix |
| 69464e24 | dashboard | Polish SKU drawer and refresh lists | ABSORB | admin-catalog | Needs review |
| 854583ba | core | Add product packaging inventory | COMPAT | - | Correct fix |
| a3af9914 | dashboard | Add theme and channel-aware dashboard | COMPAT | - | Correct fix |
| cc2c52c8 | image | Add unified prompt routing | COMPAT | - | Correct fix |
| 6edcb62c | dashboard | Serve next admin in production | COMPAT | - | Correct fix |
| ca3a8634 | dashboard | Persist 2FA accounts in database | PERMANENT | - | Correct fix |
| a4b2a0a9 | deploy | Include telemetry plugin in runtime artifact | COMPAT | - | Correct fix |
| 0d596770 | dashboard | Add audited merchant management console | PERMANENT | - | Correct fix |
| 595cc229 | storefront | Stabilize loading and refresh states | ABSORB | storefront-api | Needs review |
| c504c820 | storefront | Add smart one-line product metadata | PERMANENT | - | Correct fix |
| 2b90f863 | storefront | Refine order product card layout | ABSORB | legacy-dashboard | Needs review |
| edabe676 | storefront | Align product stock status beside price | ABSORB | backend-services | Needs review |
| 9082f523 | deploy | Validate restored backup schema | PERMANENT | - | Correct fix |
| 22692ee1 | image | Harden generation reliability | PERMANENT | - | Correct fix |
| c465a6e8 | storefront | Refine mobile authentication flow | ABSORB | admin-catalog | Needs review |
| 0440e2bb | storefront | Remove duplicate legal page headings | PERMANENT | - | Correct fix |
| ab0cba81 | ci | Stabilize database E2E checks | ABSORB | migration-governance | Needs review |
| c7994e9a | promotion | Improve desktop hero composition | ABSORB | legacy-dashboard | Needs review |
| 0341b13c | image | Localize optimized prompts by input language | ABSORB | admin-marketing | Needs review |
| d5683e88 | image | Surface generated output dimensions | COMPAT | - | Correct fix |
| aa5d2104 | storefront | Harden loading and query resilience | PERMANENT | - | Correct fix |
| a51a3fe6 | promotion | Sync storefront brand identity | ABSORB | storefront-api | Needs review |
| 751cd907 | image | Support multi-reference generation | COMPAT | - | Correct fix |
| 05329d98 | promotion | Refine Damatong promo v24 | ABSORB | admin-settings | Needs review |
| cd757530 | promotion | Preserve Damatong service landing design | PERMANENT | - | Correct fix |
| 06e7bef4 | storefront | Improve AI image generation experience | PERMANENT | - | Correct fix |
| 944059fe | migrations | Use mutable foreign key options | COMPAT | - | Correct fix |
| 4e8c7364 | ops | Schedule MySQL restore drills | ABSORB | admin-catalog | Needs review |
| 7e2d8dd9 | schema | Align announcement Channel foreign keys | ABSORB | legacy-dashboard | Needs review |
| 0daa0810 | migrations | Preserve foreign key indexes during alignment | COMPAT | - | Correct fix |
| f9796165 | storefront | Add legacy browser compatibility fallback | ABSORB | admin-marketing | Needs review |
| c7b7d19e | schema | Align Channel and USDT metadata | COMPAT | - | Correct fix |
| 985f607b | storefront | Add realtime data updates | ABSORB | storefront-api | Needs review |
| cf42b5f4 | storefront | Align auth visuals with dashboard preview | ABSORB | storefront-css | Needs review |
| 3b6f4f92 | usdt | Allow deferred refund wallet setup | PERMANENT | - | Correct fix |
| 996619da | catalog | Complete product creation workflow | PERMANENT | - | Correct fix |
| 2786f568 | storefront | Improve catalog and services headers | COMPAT | - | Correct fix |
| 9c054ae4 | catalog | Restore lossless export fields | PERMANENT | - | Correct fix |
| 55fa2fb0 | storefront | Complete channel content and USDT operations | ABSORB | admin-catalog | Needs review |
| 9a7ed4be | image | Complete studio delivery and status flow | ABSORB | backend-services | Needs review |
| c50512b5 | catalog | Parse UTF-8 CSV without BOM | COMPAT | - | Correct fix |
| 5aefbbb9 | catalog | Align supplier database schema | ABSORB | backend-services | Needs review |
| 15d1bed3 | catalog | Restore supplier GraphQL schema validity | COMPAT | - | Correct fix |
| a9bbd7e9 | image | Resolve currency helper in clean CI | ABSORB | storefront-api | Needs review |
| cb2ef032 | image | Close multi-currency billing loop | PERMANENT | - | Correct fix |
| 09c0f4d9 | image | Persist settings and guard releases | COMPAT | - | Correct fix |
| 79e836f3 | catalog | Add supplier management and audited imports | ABSORB | admin-catalog | Needs review |
| a5d61f64 | core | Use stable catalog bundle marker | PERMANENT | - | Correct fix |
| db706884 | catalog | Close product workbench release gaps | ABSORB | backend-services | Needs review |
| 55975ea6 | core | Restore verified operational fixes | ABSORB | backend-services | Needs review |
| 14443cd8 | dashboard | Expand content editing workspace | ABSORB | admin-catalog | Needs review |
| 0d185b7d | storefront | Normalize homepage module spacing | PERMANENT | - | Correct fix |
| cd525a00 | schema | Align referral poster defaults | COMPAT | - | Correct fix |
| 8e90f4ea | image | Persist model settings with service config | ABSORB | legacy-dashboard | Needs review |
| 06274e92 | storefront | Refresh service and auth experiences | ABSORB | storefront-css | Needs review |
| 0e488c66 | image | Refine provider credential workbench | PERMANENT | - | Correct fix |
| 06ef419b | referral | Refresh mobile poster templates | PERMANENT | - | Correct fix |
| 0d885bf7 | schema | Align catalog and announcement columns | ABSORB | migration-governance | Needs review |
| 2f1a2bb1 | catalog | Correct export page GraphQL contract | PERMANENT | - | Correct fix |
| cbb14798 | deploy | Stabilize production timezone and diagnostics | COMPAT | - | Correct fix |
| 42269e0c | deploy | Print candidate API diagnostics on health failure | COMPAT | - | Correct fix |
| f2e71f0b | catalog | Complete local report product workbench | PERMANENT | - | Correct fix |
| 72b71d3b | dashboard | Restore storefront design navigation | COMPAT | - | Correct fix |
| 62213e38 | dashboard | Restore CI quality gates | COMPAT | - | Correct fix |
| 22ad381e | core | Resolve workspace integration conflicts | COMPAT | - | Correct fix |
| 95f33ab9 | storefront | Preserve mobile bottom layout updates | ABSORB | admin-marketing | Needs review |
| c3986b63 | storefront | Preserve mobile bottom layout updates | COMPAT | - | Correct fix |
| 3666147a | deploy | Enable validated prompt Skill releases | ABSORB | admin-marketing | Needs review |
| c4fcec07 | image | Harden prompt Skill and key failover | PERMANENT | - | Correct fix |
| f0d860c7 | image | Keep healthy providers available | COMPAT | - | Correct fix |
| 391ff073 | deploy | Monitor production memory health | PERMANENT | - | Correct fix |
| 6adf57c3 | image | Align image usage schema defaults | ABSORB | migration-governance | Needs review |
| 2b5443c5 | dashboard | Group storefront design navigation | ABSORB | admin-marketing | Needs review |
| f44a2ee4 | deploy | Limit swap metadata tolerance | ABSORB | migration-governance | Needs review |
| b1133048 | deploy | Allow swap metadata overhead | PERMANENT | - | Correct fix |
| 3ccc26a8 | deploy | Add production memory safety net | ABSORB | admin-settings | Needs review |
| 3ef201e6 | storefront | Disable 2FA saves when storage is unavailable | ABSORB | backend-services | Needs review |
| fef2b0cc | deploy | Reduce production memory pressure | PERMANENT | - | Correct fix |
| 2d455f29 | storefront | Add session-based 2FA code tool | PERMANENT | - | Correct fix |
| 43e73064 | image | Align provider helpers with key pool | PERMANENT | - | Correct fix |
| 3576c951 | image | Add usage quotas and provider key pool | ABSORB | storefront-api | Needs review |
| 7f2c6f5e | image | Require image studio terms | ABSORB | admin-marketing | Needs review |
| c2f98887 | storefront | Honor managed quick-link icons | COMPAT | - | Correct fix |
| 7a2f7ceb | image | Show provider configuration fallbacks | COMPAT | - | Correct fix |
| c10e8e54 | image | Add native resolution pricing | PERMANENT | - | Correct fix |
| eba57e4d | catalog | Normalize blank clearing metadata | PERMANENT | - | Correct fix |
| d1da5078 | storefront | Refresh homepage service cards | ABSORB | admin-catalog | Needs review |
| c6676a93 | catalog | Add explicit blank field clearing | ABSORB | admin-settings | Needs review |
| ba4a7969 | catalog | Track inventory lot lifecycle | ABSORB | migration-governance | Needs review |
| 48c3c3ae | catalog | Align production schema without data loss | ABSORB | backend-services | Needs review |
| 1908dca9 | promotion | Refine mobile entry experience | PERMANENT | - | Correct fix |
| 111ffcce | dashboard | Compact storefront content editors | COMPAT | - | Correct fix |
| 239b9c71 | promotion | Improve entry page readability | COMPAT | - | Correct fix |
| 27725a5b | promotion | Redesign public entry page | PERMANENT | - | Correct fix |
| 86c846f8 | catalog | Harden import audit and rollback | PERMANENT | - | Correct fix |
| adde18d8 | core | Package catalog management runtime | COMPAT | - | Correct fix |
| 71228ff0 | catalog | Add import and inventory management | PERMANENT | - | Correct fix |
| 7b69e626 | storefront | Widen currency selector | PERMANENT | - | Correct fix |
| 83b7ee5d | dashboard | Add session-only 2FA tools | PERMANENT | - | Correct fix |
| 212f1eeb | promotion | Sync flash sale image with product | PERMANENT | - | Correct fix |
| 0d4c2ad4 | storefront | Refine authentication hero typography | COMPAT | - | Correct fix |
| a9b972bf | dashboard | Restore internationalization quality gate | COMPAT | - | Correct fix |
| 8f3ddb4f | core | Align product validation and homepage header | ABSORB | migration-governance | Needs review |
| 8f2a8244 | migrations | Align hardened image schema metadata | ABSORB | admin-marketing | Needs review |
| 0e3ce873 | migrations | Remove incompatible MySQL dispatch default | ABSORB | backend-services | Needs review |
| fedda811 | dashboard | Keep collapsed sidebar discoverable | PERMANENT | - | Correct fix |
| d7760875 | image | Harden generation dispatch and cost tracking | COMPAT | - | Correct fix |
| dc24ff19 | dashboard | Isolate nested detail form submissions | COMPAT | - | Correct fix |
| b0b5f7a0 | dashboard | Add hierarchical product group selector | PERMANENT | - | Correct fix |
| c82ea2da | dashboard | Guard missing facet parents | ABSORB | migration-governance | Needs review |
| 7144a3c2 | dashboard | Clean up bulk product assignment checks | PERMANENT | - | Correct fix |
| b64a3f8f | dashboard | Keep plugin catalog visible on load errors | ABSORB | migration-governance | Needs review |
| 143b3227 | dashboard | Expose specification template links | ABSORB | storefront-api | Needs review |
| 47bedcfe | image | Allow bounded customer history query | PERMANENT | - | Correct fix |
| 37f350bb | image | Enforce verified Gemini provider | ABSORB | storefront-css | Needs review |
| cdce30aa | image | Configure Gemini streaming endpoint | ABSORB | backend-services | Needs review |
| 8d07775c | image | Keep generated prompt bundle stable | PERMANENT | - | Correct fix |
| 4277913b | image | Add multi-model image catalog | COMPAT | - | Correct fix |
| 3a28519f | dashboard | Compile plugin translations for Lingui | ABSORB | admin-marketing | Needs review |
| 005f76c4 | cart | Keep login independent from cart projection | COMPAT | - | Correct fix |
| c6e32592 | core | Repair fixed-money JSON encoding | ABSORB | storefront-api | Needs review |
| 8c5bc0a3 | core | Align production schema metadata | PERMANENT | - | Correct fix |
| 139f7768 | deploy | Restore failed production rollbacks | COMPAT | - | Correct fix |
| 63ec0534 | dashboard | Remove CSP and navigation translation warnings | PERMANENT | - | Correct fix |
| 24126b6e | core | Preserve fixed-money source currency | ABSORB | backend-services | Needs review |
| 9f98e0e7 | cart | Ignore admin login events | COMPAT | - | Correct fix |
| cb457b0c | deploy | Pass migration readiness flags | COMPAT | - | Correct fix |
| 3abafa27 | deploy | Add OIDC production release path | PERMANENT | - | Correct fix |
| dab2518f | core | Reconcile production branch integrations | ABSORB | legacy-dashboard | Needs review |
| 1cb2c498 | core | Consolidate audited commerce updates | ABSORB | backend-services | Needs review |
| 1f23bc79 | core | Patch pacote security advisory | ABSORB | backend-services | Needs review |
| f31d6bcc | storefront | Publish auth visual content | ABSORB | admin-catalog | Needs review |
| 8dbfaf36 | deploy | Package image generation runtime | PERMANENT | - | Correct fix |
| bfb3360d | image | Integrate image studio for production | ABSORB | admin-catalog | Needs review |
| 21730b84 | storefront | Expose image studio entry points | ABSORB | admin-catalog | Needs review |
| 2a3325f3 | image | Add AI image generation plugin | PERMANENT | - | Correct fix |
| 540235c0 | core | Poll for manual scheduler execution | COMPAT | - | Correct fix |
| 24617afa | ci | Stabilize dashboard and SQL.js gates | PERMANENT | - | Correct fix |
| e6ce7f7d | catalog | Preserve inherited digital inventory | COMPAT | - | Correct fix |
| ad5f9b44 | catalog | Derive prices from store base currency | PERMANENT | - | Correct fix |
| 19f31a6a | storefront | Publish completed visual fixes | ABSORB | storefront-css | Needs review |
| 508f5b42 | storefront | Hide internal SKU from customers | COMPAT | - | Correct fix |
| d818ed7f | core | Configure USDT acquisition rate schedules | COMPAT | - | Correct fix |
| 20bc36d8 | storefront | Manage auth page visuals | PERMANENT | - | Correct fix |
| 21d5150c | referral | Track unique visitor devices | PERMANENT | - | Correct fix |
| 416bc7b8 | dashboard | Reflow storefront editor drawer | COMPAT | - | Correct fix |
| e022edf6 | storefront | Redesign coupon presentation | PERMANENT | - | Correct fix |
| b64bef23 | referral | Count unique visitor IPs and settled net metrics | ABSORB | legacy-dashboard | Needs review |
| c9d40a20 | usdt | Align payment schema metadata | ABSORB | storefront-shell | Needs review |
| 76871def | coupons | Read entitlement within order transaction | PERMANENT | - | Correct fix |
| 73678c60 | core | Consolidate merchant workflows | COMPAT | - | Correct fix |
| 08d6ca69 | coupons | Close customer coupon lifecycle | COMPAT | - | Correct fix |
| 8581db94 | referral | Add invitation rebate lifecycle | PERMANENT | - | Correct fix |
| c604f14a | dashboard | Refresh collection visibility switches | PERMANENT | - | Correct fix |
| 692baebc | storefront | Allow same-origin promotion telemetry | ABSORB | backend-services | Needs review |
| 5bf92813 | deploy | Allow promotion visual renderer | ABSORB | storefront-api | Needs review |
| 468e6558 | storefront | Add CNY and MYR currency switching | COMPAT | - | Correct fix |
| fbd7d15e | storefront | Complete managed commerce experience | ABSORB | admin-settings | Needs review |
| 0e7de740 | storefront | Complete managed commerce experience | COMPAT | - | Correct fix |
| 2c081ea3 | storefront | Refine desktop authentication visuals | PERMANENT | - | Correct fix |
| 87d14f39 | ci | Configure translation key for build checks | COMPAT | - | Correct fix |
| c18bfde3 | storefront | Eliminate image loading flashes | ABSORB | backend-services | Needs review |
| 3d01c945 | storefront | Manage authentication page visuals | ABSORB | backend-services | Needs review |
| b6f2de10 | dashboard | Remove empty order actions menu | PERMANENT | - | Correct fix |
| 7f84a4f5 | storefront | Enable managed legal publishing | ABSORB | storefront-css | Needs review |
| 5e55dcea | coupons | Display persisted campaigns | ABSORB | backend-services | Needs review |
| 6ad0a4a9 | storefront | Unify managed homepage and promotion workflows | ABSORB | migration-governance | Needs review |
| f4dde371 | core | Preserve reviewed English after source changes | PERMANENT | - | Correct fix |
| 4967c6a5 | storefront | Add managed CloudBridge hero carousel | COMPAT | - | Correct fix |
| e14f6d8b | dashboard | Simplify product category management | COMPAT | - | Correct fix |
| 6363c27b | core | Preserve manual English on source edits | PERMANENT | - | Correct fix |
| 8fe39d65 | core | Preserve complete product images and add upload guidance | PERMANENT | - | Correct fix |
| fc87e6c4 | storefront | Ignore lazy route preloads in update checks | ABSORB | storefront-shell | Needs review |
| 60183137 | storefront | Modularize routes and fix mobile navigation | COMPAT | - | Correct fix |
| a0cbb18e | i18n | Preserve spaces after glossary terms | ABSORB | storefront-shell | Needs review |
| a7283610 | deploy | Include translation plugin in runtime | COMPAT | - | Correct fix |
| 4d912d02 | ci | Configure translation build check | COMPAT | - | Correct fix |
| 90443466 | i18n | Automate bilingual customer content | COMPAT | - | Correct fix |
| 05c22412 | deploy | Keep TLS policy in managed Nginx config | PERMANENT | - | Correct fix |
| 11e79948 | migrations | Align after-sales and auto-card schema | PERMANENT | - | Correct fix |
| 9691e4ab | deploy | Remove duplicate TLS protocol config | COMPAT | - | Correct fix |
| e9629578 | coupons | Implement Node for ledger entries | COMPAT | - | Correct fix |
| 62369d8a | coupons | Complete claim and redemption lifecycle | PERMANENT | - | Correct fix |
| b899679c | storefront | Add managed dual-card templates | COMPAT | - | Correct fix |
| 2dc3dd50 | storefront | Support admin-created account verification | COMPAT | - | Correct fix |
| d8199515 | dashboard | Redesign product group hierarchy | ABSORB | admin-catalog | Needs review |
| 6d917f53 | core | Allow channels without tax configuration | PERMANENT | - | Correct fix |
| 28b89259 | dashboard | Localize variant interfaces | COMPAT | - | Correct fix |
| 5911108b | core | Support MariaDB channel currency updates | COMPAT | - | Correct fix |
