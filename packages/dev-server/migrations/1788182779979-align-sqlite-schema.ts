/* eslint-disable max-len -- generated SQLite schema SQL must remain byte-for-byte reviewable */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignSqliteSchema1788182779979 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        if (!this.isSqlite(queryRunner)) return;

        await queryRunner.query(`DROP INDEX "IDX_6e420052844edf3a5506d863ce"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_e38dca0d82fd64c7cf8aac8b8e"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_0e6f516053cf982b537836e21c"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_product_variant" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "sku" varchar NOT NULL, "outOfStockThreshold" integer NOT NULL DEFAULT (0), "useGlobalOutOfStockThreshold" boolean NOT NULL DEFAULT (1), "trackInventory" varchar NOT NULL DEFAULT ('INHERIT'), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "taxCategoryId" integer, "productId" integer, "customFieldsFulfillmenttype" varchar(255) DEFAULT ('physical'), "customFieldsDigitaldeliverymode" varchar(255) DEFAULT ('manual_service'), "customFieldsDigitalstockpolicy" varchar(255) NOT NULL DEFAULT ('limited'), CONSTRAINT "FK_6e420052844edf3a5506d863ce6" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_e38dca0d82fd64c7cf8aac8b8ef" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e6f516053cf982b537836e21cf" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_product_variant"("createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId", "customFieldsFulfillmenttype", "customFieldsDigitaldeliverymode", "customFieldsDigitalstockpolicy") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId", "customFieldsFulfillmenttype", "customFieldsDigitaldeliverymode", "customFieldsDigitalstockpolicy" FROM "product_variant"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "product_variant"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_product_variant" RENAME TO "product_variant"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_6e420052844edf3a5506d863ce" ON "product_variant" ("productId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_e38dca0d82fd64c7cf8aac8b8e" ON "product_variant" ("taxCategoryId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_0e6f516053cf982b537836e21c" ON "product_variant" ("featuredAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_state_sequence"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_fingerprint"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_sequence"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_auto_card_pool_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(16) NOT NULL DEFAULT ('AVAILABLE'), "sequence" int NOT NULL, "encryptedPayload" text NOT NULL, "fingerprint" varchar(64) NOT NULL, "assignedAt" datetime, "disabledReason" text, "configId" integer NOT NULL, "deliveryId" integer, "encryptedRawPayload" text, CONSTRAINT "FK_auto_card_pool_config" FOREIGN KEY ("configId") REFERENCES "auto_card_config" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_pool_delivery" FOREIGN KEY ("deliveryId") REFERENCES "auto_card_delivery" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_auto_card_pool_item"("id", "createdAt", "updatedAt", "state", "sequence", "encryptedPayload", "fingerprint", "assignedAt", "disabledReason", "configId", "deliveryId", "encryptedRawPayload") SELECT "id", "createdAt", "updatedAt", "state", "sequence", "encryptedPayload", "fingerprint", "assignedAt", "disabledReason", "configId", "deliveryId", "encryptedRawPayload" FROM "auto_card_pool_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "auto_card_pool_item"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_auto_card_pool_item" RENAME TO "auto_card_pool_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_auto_card_pool_config_state_sequence" ON "auto_card_pool_item" ("configId", "state", "sequence") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_pool_config_fingerprint" ON "auto_card_pool_item" ("configId", "fingerprint") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_pool_config_sequence" ON "auto_card_pool_item" ("configId", "sequence") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_auto_card_config_channel_variant"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_auto_card_config" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (true), "formatName" varchar(80) NOT NULL, "delimiter" varchar(16) NOT NULL DEFAULT ('----'), "fieldsJson" text NOT NULL, "instructions" text NOT NULL, "lowStockThreshold" int NOT NULL DEFAULT (5), "channelId" integer NOT NULL, "productVariantId" integer NOT NULL, "instructionsZh" text, "instructionsEn" text, CONSTRAINT "FK_auto_card_config_variant" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_auto_card_config"("id", "createdAt", "updatedAt", "enabled", "formatName", "delimiter", "fieldsJson", "instructions", "lowStockThreshold", "channelId", "productVariantId", "instructionsZh", "instructionsEn") SELECT "id", "createdAt", "updatedAt", "enabled", "formatName", "delimiter", "fieldsJson", "instructions", "lowStockThreshold", "channelId", "productVariantId", "instructionsZh", "instructionsEn" FROM "auto_card_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "auto_card_config"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_auto_card_config" RENAME TO "auto_card_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_config_channel_variant" ON "auto_card_config" ("channelId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_package_variant"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_unit_variant"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_product"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_product_packaging_rule" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (true), "autoUnpack" boolean NOT NULL DEFAULT (true), "unitLabel" varchar(32) NOT NULL, "packageLabel" varchar(32) NOT NULL, "unitsPerPackage" int NOT NULL, "channelId" integer NOT NULL, "productId" integer NOT NULL, "unitVariantId" integer NOT NULL, "packageVariantId" integer NOT NULL, CONSTRAINT "FK_product_packaging_rule_package_variant" FOREIGN KEY ("packageVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_unit_variant" FOREIGN KEY ("unitVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_product" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_product_packaging_rule"("id", "createdAt", "updatedAt", "enabled", "autoUnpack", "unitLabel", "packageLabel", "unitsPerPackage", "channelId", "productId", "unitVariantId", "packageVariantId") SELECT "id", "createdAt", "updatedAt", "enabled", "autoUnpack", "unitLabel", "packageLabel", "unitsPerPackage", "channelId", "productId", "unitVariantId", "packageVariantId" FROM "product_packaging_rule"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "product_packaging_rule"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_product_packaging_rule" RENAME TO "product_packaging_rule"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_package_variant" ON "product_packaging_rule" ("channelId", "packageVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_unit_variant" ON "product_packaging_rule" ("channelId", "unitVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_product" ON "product_packaging_rule" ("channelId", "productId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_prompt_skill_hash"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_prompt_skill_release" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "bundleVersion" int NOT NULL, "sourceHash" varchar(64) NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('INACTIVE'), "bundle" text NOT NULL, "activatedAt" datetime)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_prompt_skill_release"("createdAt", "updatedAt", "id", "bundleVersion", "sourceHash", "status", "bundle", "activatedAt") SELECT "createdAt", "updatedAt", "id", "bundleVersion", "sourceHash", "status", "bundle", "activatedAt" FROM "image_prompt_skill_release"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_prompt_skill_release"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_prompt_skill_release" RENAME TO "image_prompt_skill_release"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_prompt_skill_hash" ON "image_prompt_skill_release" ("sourceHash") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_withdrawal_channel_status_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_withdrawal_code"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_withdrawal" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "walletId" integer NOT NULL, "customerId" integer NOT NULL, "code" varchar(32) NOT NULL, "currencyCode" varchar(3) NOT NULL, "amount" int NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "payoutMethod" varchar(32) NOT NULL, "payoutAccountMasked" varchar(160) NOT NULL, "externalReference" varchar(160), "note" varchar(500), "requestedByAdministratorId" integer, "processedByAdministratorId" integer, "approvedAt" datetime, "paidAt" datetime, "rejectedAt" datetime, "cancelledAt" datetime, CONSTRAINT "FK_referral_withdrawal_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_withdrawal_wallet" FOREIGN KEY ("walletId") REFERENCES "referral_wallet" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_withdrawal_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_withdrawal"("id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "code", "currencyCode", "amount", "status", "payoutMethod", "payoutAccountMasked", "externalReference", "note", "requestedByAdministratorId", "processedByAdministratorId", "approvedAt", "paidAt", "rejectedAt", "cancelledAt") SELECT "id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "code", "currencyCode", "amount", "status", "payoutMethod", "payoutAccountMasked", "externalReference", "note", "requestedByAdministratorId", "processedByAdministratorId", "approvedAt", "paidAt", "rejectedAt", "cancelledAt" FROM "referral_withdrawal"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "referral_withdrawal"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_referral_withdrawal" RENAME TO "referral_withdrawal"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_withdrawal_channel_status_created" ON "referral_withdrawal" ("channelId", "status", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_withdrawal_code" ON "referral_withdrawal" ("code") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_store_profile_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_profile_public_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_profile_logo_asset"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_store_profile" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "status" varchar(20) NOT NULL DEFAULT ('DRAFT'), "isPublished" boolean NOT NULL DEFAULT (0), "sortOrder" int NOT NULL DEFAULT (0), "descriptionZh" text NOT NULL, "descriptionEn" text NOT NULL, "logoAssetId" integer, "internalNote" text, CONSTRAINT "FK_store_profile_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_store_profile_logo_asset" FOREIGN KEY ("logoAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_store_profile"("id", "createdAt", "updatedAt", "channelId", "status", "isPublished", "sortOrder", "descriptionZh", "descriptionEn", "logoAssetId", "internalNote") SELECT "id", "createdAt", "updatedAt", "channelId", "status", "isPublished", "sortOrder", "descriptionZh", "descriptionEn", "logoAssetId", "internalNote" FROM "store_profile"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "store_profile"`, undefined);
        await queryRunner.query(`ALTER TABLE "temporary_store_profile" RENAME TO "store_profile"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_profile_channel" ON "store_profile" ("channelId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_profile_public_order" ON "store_profile" ("status", "isPublished", "sortOrder") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_profile_logo_asset" ON "store_profile" ("logoAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_status_expiry"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_transaction"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_match_key"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_quote"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_usdt_payment_intent" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "orderId" integer NOT NULL, "quoteId" integer NOT NULL, "paymentId" integer, "network" varchar(16) NOT NULL, "tokenContractAddress" varchar(64) NOT NULL, "receivingAddress" varchar(64) NOT NULL, "receivingAddressFingerprint" varchar(64) NOT NULL, "matchKey" varchar(64) NOT NULL, "baseUsdtAmount" decimal(24,6) NOT NULL, "expectedUsdtAmount" decimal(24,6) NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "transactionId" varchar(80), "senderAddress" varchar(64), "receivedUsdtAmount" decimal(24,6), "blockNumber" int, "blockTimestamp" datetime, "lastCheckedAt" datetime, "settledAt" datetime, "failureReason" varchar(500), "expiresAt" datetime NOT NULL, CONSTRAINT "FK_storefront_usdt_intent_payment" FOREIGN KEY ("paymentId") REFERENCES "payment" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_quote" FOREIGN KEY ("quoteId") REFERENCES "storefront_usdt_checkout_quote" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_usdt_payment_intent"("createdAt", "updatedAt", "id", "channelId", "orderId", "quoteId", "paymentId", "network", "tokenContractAddress", "receivingAddress", "receivingAddressFingerprint", "matchKey", "baseUsdtAmount", "expectedUsdtAmount", "status", "transactionId", "senderAddress", "receivedUsdtAmount", "blockNumber", "blockTimestamp", "lastCheckedAt", "settledAt", "failureReason", "expiresAt") SELECT "createdAt", "updatedAt", "id", "channelId", "orderId", "quoteId", "paymentId", "network", "tokenContractAddress", "receivingAddress", "receivingAddressFingerprint", "matchKey", "baseUsdtAmount", "expectedUsdtAmount", "status", "transactionId", "senderAddress", "receivedUsdtAmount", "blockNumber", "blockTimestamp", "lastCheckedAt", "settledAt", "failureReason", "expiresAt" FROM "storefront_usdt_payment_intent"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_usdt_payment_intent"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_usdt_payment_intent" RENAME TO "storefront_usdt_payment_intent"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_usdt_intent_status_expiry" ON "storefront_usdt_payment_intent" ("status", "expiresAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_transaction" ON "storefront_usdt_payment_intent" ("transactionId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_match_key" ON "storefront_usdt_payment_intent" ("matchKey") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_quote" ON "storefront_usdt_payment_intent" ("quoteId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_idempotency"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_campaign_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_coupon_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_channel_created"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_coupon_ledger_entry" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "customerCouponId" integer NOT NULL, "promotionId" integer NOT NULL, "customerId" integer NOT NULL, "orderId" integer, "refundId" integer, "eventType" varchar(24) NOT NULL, "actorType" varchar(16) NOT NULL, "idempotencyKey" varchar(255), "discountAmount" int, "note" varchar(500), "metadata" text, CONSTRAINT "FK_coupon_ledger_refund" FOREIGN KEY ("refundId") REFERENCES "refund" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_promotion" FOREIGN KEY ("promotionId") REFERENCES "promotion" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_coupon" FOREIGN KEY ("customerCouponId") REFERENCES "customer_coupon" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_coupon_ledger_entry"("id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "eventType", "actorType", "idempotencyKey", "discountAmount", "note", "metadata") SELECT "id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "eventType", "actorType", "idempotencyKey", "discountAmount", "note", "metadata" FROM "coupon_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "coupon_ledger_entry"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_coupon_ledger_entry" RENAME TO "coupon_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_coupon_ledger_idempotency" ON "coupon_ledger_entry" ("idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_campaign_created" ON "coupon_ledger_entry" ("promotionId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_coupon_created" ON "coupon_ledger_entry" ("customerCouponId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_channel_created" ON "coupon_ledger_entry" ("channelId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_daily_visitor_channel_date"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_daily_visitor_identity"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_daily_visitor" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "customerId" integer, "businessDate" varchar(10) NOT NULL, "visitorKeyHash" varchar(64) NOT NULL, "firstSeenAt" datetime NOT NULL, "lastSeenAt" datetime NOT NULL, "visitCount" int NOT NULL DEFAULT (1), CONSTRAINT "FK_storefront_daily_visitor_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_daily_visitor_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_daily_visitor"("id", "createdAt", "updatedAt", "channelId", "customerId", "businessDate", "visitorKeyHash", "firstSeenAt", "lastSeenAt", "visitCount") SELECT "id", "createdAt", "updatedAt", "channelId", "customerId", "businessDate", "visitorKeyHash", "firstSeenAt", "lastSeenAt", "visitCount" FROM "storefront_daily_visitor"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_daily_visitor"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_daily_visitor" RENAME TO "storefront_daily_visitor"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_daily_visitor_channel_date" ON "storefront_daily_visitor" ("channelId", "businessDate") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_daily_visitor_identity" ON "storefront_daily_visitor" ("channelId", "businessDate", "visitorKeyHash") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_item_image_asset"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_item_block_position"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_content_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (1), "position" int NOT NULL DEFAULT (0), "imageUrl" varchar(2048), "targetType" varchar(32) NOT NULL DEFAULT ('NONE'), "targetValue" varchar(2048), "blockId" integer NOT NULL, "settings" text, "imageAssetId" integer, CONSTRAINT "FK_storefront_content_item_image_asset" FOREIGN KEY ("imageAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_content_item_block" FOREIGN KEY ("blockId") REFERENCES "storefront_content_block" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_content_item"("id", "createdAt", "updatedAt", "enabled", "position", "imageUrl", "targetType", "targetValue", "blockId", "settings", "imageAssetId") SELECT "id", "createdAt", "updatedAt", "enabled", "position", "imageUrl", "targetType", "targetValue", "blockId", "settings", "imageAssetId" FROM "storefront_content_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_content_item"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_content_item" RENAME TO "storefront_content_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_item_image_asset" ON "storefront_content_item" ("imageAssetId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_item_block_position" ON "storefront_content_item" ("blockId", "position") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_image_asset"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel_position"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel_code"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_content_block" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "code" varchar(64) NOT NULL, "type" varchar(32) NOT NULL, "enabled" boolean NOT NULL DEFAULT (1), "position" int NOT NULL DEFAULT (0), "startsAt" datetime, "endsAt" datetime, "imageUrl" varchar(2048), "backgroundColor" varchar(32), "textColor" varchar(32), "targetType" varchar(32) NOT NULL DEFAULT ('NONE'), "targetValue" varchar(2048), "channelId" integer NOT NULL, "internalName" varchar(128) NOT NULL DEFAULT (''), "layoutVariant" varchar(32) NOT NULL DEFAULT ('AUTO'), "settings" text, "imageAssetId" integer, CONSTRAINT "FK_storefront_content_block_image_asset" FOREIGN KEY ("imageAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_content_block_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_content_block"("id", "createdAt", "updatedAt", "code", "type", "enabled", "position", "startsAt", "endsAt", "imageUrl", "backgroundColor", "textColor", "targetType", "targetValue", "channelId", "internalName", "layoutVariant", "settings", "imageAssetId") SELECT "id", "createdAt", "updatedAt", "code", "type", "enabled", "position", "startsAt", "endsAt", "imageUrl", "backgroundColor", "textColor", "targetType", "targetValue", "channelId", "internalName", "layoutVariant", "settings", "imageAssetId" FROM "storefront_content_block"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_content_block"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_content_block" RENAME TO "storefront_content_block"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_image_asset" ON "storefront_content_block" ("imageAssetId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_channel" ON "storefront_content_block" ("channelId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_channel_position" ON "storefront_content_block" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_block_channel_code" ON "storefront_content_block" ("channelId", "code") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_settings_channel"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_content_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "heroAutoplayIntervalSeconds" int NOT NULL DEFAULT (5), "channelId" integer NOT NULL, CONSTRAINT "FK_storefront_content_settings_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_content_settings"("id", "createdAt", "updatedAt", "heroAutoplayIntervalSeconds", "channelId") SELECT "id", "createdAt", "updatedAt", "heroAutoplayIntervalSeconds", "channelId" FROM "storefront_content_settings"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_content_settings"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_content_settings" RENAME TO "storefront_content_settings"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_settings_channel" ON "storefront_content_settings" ("channelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_line_order_line"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_line_variant"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_cart_line" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "cartId" integer NOT NULL, "productVariantId" integer NOT NULL, "quantity" int NOT NULL, "selected" boolean NOT NULL DEFAULT (1), "orderLineId" integer, CONSTRAINT "FK_4b16092e25690ed973fca613970" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_fc4ebb77880b9f16355ba97e94f" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_a7dfef03af017cd8d3303d139ac" FOREIGN KEY ("cartId") REFERENCES "storefront_cart" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_cart_line"("id", "createdAt", "updatedAt", "cartId", "productVariantId", "quantity", "selected", "orderLineId") SELECT "id", "createdAt", "updatedAt", "cartId", "productVariantId", "quantity", "selected", "orderLineId" FROM "storefront_cart_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_cart_line"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_cart_line" RENAME TO "storefront_cart_line"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_line_order_line" ON "storefront_cart_line" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_line_variant" ON "storefront_cart_line" ("cartId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_checkout_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_checkout_cart"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_cart_checkout" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "cartId" integer NOT NULL, "orderId" integer NOT NULL, "cartRevision" int NOT NULL, "state" varchar(20) NOT NULL DEFAULT ('PREPARED'), "completedAt" datetime, CONSTRAINT "FK_62eae4cd2000102e470884e62c4" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_999b72b6d264f393ce623c1fa16" FOREIGN KEY ("cartId") REFERENCES "storefront_cart" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_cart_checkout"("id", "createdAt", "updatedAt", "cartId", "orderId", "cartRevision", "state", "completedAt") SELECT "id", "createdAt", "updatedAt", "cartId", "orderId", "cartRevision", "state", "completedAt" FROM "storefront_cart_checkout"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_cart_checkout"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_cart_checkout" RENAME TO "storefront_cart_checkout"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_checkout_order" ON "storefront_cart_checkout" ("orderId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_cart_checkout_cart" ON "storefront_cart_checkout" ("cartId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_checkout_line_cart_line"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_checkout_line_variant"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_cart_checkout_line" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "checkoutId" integer NOT NULL, "cartLineId" integer, "productVariantId" integer NOT NULL, "quantity" int NOT NULL, CONSTRAINT "FK_50b17e57a4ee983399032f33b82" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_06fd288a0681d32056b3982af96" FOREIGN KEY ("cartLineId") REFERENCES "storefront_cart_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_eb781b4c2e8d587fb9d4c250e8b" FOREIGN KEY ("checkoutId") REFERENCES "storefront_cart_checkout" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_cart_checkout_line"("id", "createdAt", "updatedAt", "checkoutId", "cartLineId", "productVariantId", "quantity") SELECT "id", "createdAt", "updatedAt", "checkoutId", "cartLineId", "productVariantId", "quantity" FROM "storefront_cart_checkout_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_cart_checkout_line"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_cart_checkout_line" RENAME TO "storefront_cart_checkout_line"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_checkout_line_cart_line" ON "storefront_cart_checkout_line" ("cartLineId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_checkout_line_variant" ON "storefront_cart_checkout_line" ("checkoutId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_order_line"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_product_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_channel_state_created"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_review" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(16) NOT NULL DEFAULT ('PENDING'), "rating" int NOT NULL, "title" varchar(120) NOT NULL, "body" text NOT NULL, "customerName" varchar(120) NOT NULL, "productName" varchar(255) NOT NULL, "sku" varchar(255) NOT NULL, "merchantResponse" text, "moderatedAt" datetime, "channelId" integer NOT NULL, "customerId" integer, "orderId" integer, "orderLineId" integer, "productId" integer, "productVariantId" integer, "merchantResponseZh" text, "merchantResponseEn" text, CONSTRAINT "FK_storefront_review_product_variant" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_product" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_review"("id", "createdAt", "updatedAt", "state", "rating", "title", "body", "customerName", "productName", "sku", "merchantResponse", "moderatedAt", "channelId", "customerId", "orderId", "orderLineId", "productId", "productVariantId", "merchantResponseZh", "merchantResponseEn") SELECT "id", "createdAt", "updatedAt", "state", "rating", "title", "body", "customerName", "productName", "sku", "merchantResponse", "moderatedAt", "channelId", "customerId", "orderId", "orderLineId", "productId", "productVariantId", "merchantResponseZh", "merchantResponseEn" FROM "storefront_review"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_review"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_review" RENAME TO "storefront_review"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_review_order_line" ON "storefront_review" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_customer_created" ON "storefront_review" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_product_state_created" ON "storefront_review" ("productId", "state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_channel_state_created" ON "storefront_review" ("channelId", "state", "createdAt") `,
            undefined,
        );
        if (!(await queryRunner.hasTable('manual_digital_delivery_event'))) {
            await queryRunner.query(
                `CREATE TABLE "manual_digital_delivery_event" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "type" varchar(24) NOT NULL, "actorType" varchar(16) NOT NULL, "actorId" varchar(64), "note" text NOT NULL, "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "deliveryId" integer NOT NULL)`,
                undefined,
            );
            await queryRunner.query(
                `CREATE INDEX "IDX_manual_delivery_event_delivery_created" ON "manual_digital_delivery_event" ("deliveryId", "createdAt") `,
                undefined,
            );
        }
        await queryRunner.query(`DROP INDEX "IDX_7dbc75cb4e8b002620c4dbfdac"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_f4a2ec16ba86d277b6faa0b67b"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_product_translation" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "languageCode" varchar NOT NULL, "name" varchar NOT NULL, "slug" varchar NOT NULL, "description" text NOT NULL, "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "baseId" integer, CONSTRAINT "FK_7dbc75cb4e8b002620c4dbfdac5" FOREIGN KEY ("baseId") REFERENCES "product" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_product_translation"("createdAt", "updatedAt", "languageCode", "name", "slug", "description", "id", "baseId") SELECT "createdAt", "updatedAt", "languageCode", "name", "slug", "description", "id", "baseId" FROM "product_translation"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "product_translation"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_product_translation" RENAME TO "product_translation"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_7dbc75cb4e8b002620c4dbfdac" ON "product_translation" ("baseId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_f4a2ec16ba86d277b6faa0b67b" ON "product_translation" ("slug") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_91a19e6613534949a4ce6e76ff"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_product" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "customFieldsFulfillmenttype" varchar(255) NOT NULL DEFAULT ('digital'), "customFieldsRefundpolicy" varchar(255) NOT NULL DEFAULT ('MERCHANT_REVIEW'), "customFieldsManualdeliveryslaminutes" int NOT NULL DEFAULT (1440), CONSTRAINT "FK_91a19e6613534949a4ce6e76ff8" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_product"("createdAt", "updatedAt", "deletedAt", "enabled", "id", "featuredAssetId", "customFieldsFulfillmenttype", "customFieldsRefundpolicy", "customFieldsManualdeliveryslaminutes") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "id", "featuredAssetId", "customFieldsFulfillmenttype", "customFieldsRefundpolicy", "customFieldsManualdeliveryslaminutes" FROM "product"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "product"`, undefined);
        await queryRunner.query(`ALTER TABLE "temporary_product" RENAME TO "product"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_91a19e6613534949a4ce6e76ff" ON "product" ("featuredAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_system_announcement_schedule"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_system_announcement" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (1), "priority" int NOT NULL DEFAULT (0), "titleZh" varchar(120) NOT NULL, "titleEn" varchar(120) NOT NULL DEFAULT (''), "contentZh" text NOT NULL, "contentEn" text NOT NULL, "linkUrl" varchar(500), "startsAt" datetime, "endsAt" datetime)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_system_announcement"("id", "createdAt", "updatedAt", "enabled", "priority", "titleZh", "titleEn", "contentZh", "contentEn", "linkUrl", "startsAt", "endsAt") SELECT "id", "createdAt", "updatedAt", "enabled", "priority", "titleZh", "titleEn", "contentZh", "contentEn", "linkUrl", "startsAt", "endsAt" FROM "system_announcement"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "system_announcement"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_system_announcement" RENAME TO "system_announcement"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_system_announcement_schedule" ON "system_announcement" ("enabled", "startsAt", "endsAt", "priority") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_poster_template_channel_position"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_poster_template" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "name" varchar(128) NOT NULL, "enabled" boolean NOT NULL DEFAULT (1), "position" int NOT NULL DEFAULT (0), "layoutVariant" varchar(32) NOT NULL DEFAULT ('STANDARD_CENTER'), "posterBackgroundAssetId" integer, "shareBackgroundAssetId" integer, "titleZh" varchar(80) NOT NULL DEFAULT ('好友邀请函'), "titleEn" varchar(80) NOT NULL DEFAULT ('Invitation for friends'), "headlineZh" varchar(180) NOT NULL DEFAULT ('发现好东西，一起分享'), "headlineEn" varchar(180) NOT NULL DEFAULT ('Discover something worth sharing'), "rewardTextZh" varchar(220) NOT NULL DEFAULT ('好友成功消费，可获得 {rewardRate}% 奖励用于消费抵扣'), "rewardTextEn" varchar(220) NOT NULL DEFAULT ('Earn {rewardRate}% in rewards when a friend makes a purchase'), "siteIntroZh" varchar(260) NOT NULL DEFAULT (''), "siteIntroEn" varchar(260) NOT NULL DEFAULT (''), "serviceTextZh" varchar(260) NOT NULL DEFAULT ('好物严选 · 便捷消费 · 售后服务'), "serviceTextEn" varchar(260) NOT NULL DEFAULT ('Curated products · Easy shopping · Customer support'), "foregroundColor" varchar(16) NOT NULL DEFAULT ('#FFFFFF'), "accentColor" varchar(16) NOT NULL DEFAULT ('#FF4D4F'), "overlayOpacity" int NOT NULL DEFAULT (28), CONSTRAINT "FK_referral_poster_template_share_asset" FOREIGN KEY ("shareBackgroundAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_referral_poster_template_poster_asset" FOREIGN KEY ("posterBackgroundAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_referral_poster_template_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_poster_template"("createdAt", "updatedAt", "id", "channelId", "name", "enabled", "position", "layoutVariant", "posterBackgroundAssetId", "shareBackgroundAssetId", "titleZh", "titleEn", "headlineZh", "headlineEn", "rewardTextZh", "rewardTextEn", "siteIntroZh", "siteIntroEn", "serviceTextZh", "serviceTextEn", "foregroundColor", "accentColor", "overlayOpacity") SELECT "createdAt", "updatedAt", "id", "channelId", "name", "enabled", "position", "layoutVariant", "posterBackgroundAssetId", "shareBackgroundAssetId", "titleZh", "titleEn", "headlineZh", "headlineEn", "rewardTextZh", "rewardTextEn", "siteIntroZh", "siteIntroEn", "serviceTextZh", "serviceTextEn", "foregroundColor", "accentColor", "overlayOpacity" FROM "referral_poster_template"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "referral_poster_template"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_referral_poster_template" RENAME TO "referral_poster_template"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_poster_template_channel_position" ON "referral_poster_template" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_model_config_channel_position"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_model_config_channel_code"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_model_config" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "code" varchar(48) NOT NULL, "enabled" boolean NOT NULL DEFAULT (0), "displayNameZh" varchar(120) NOT NULL, "displayNameEn" varchar(120) NOT NULL, "officialModelId" varchar(160) NOT NULL, "providerModelId" varchar(160) NOT NULL, "protocol" varchar(32) NOT NULL, "unitPrice" int NOT NULL DEFAULT (0), "currencyCode" varchar(3) NOT NULL, "position" int NOT NULL DEFAULT (0), "isDefault" boolean NOT NULL DEFAULT (0), "healthStatus" varchar(24) NOT NULL DEFAULT ('UNTESTED'), "descriptionZh" varchar(500) NOT NULL, "descriptionEn" varchar(500) NOT NULL, "healthMessage" varchar(500), "lastTestedAt" datetime, CONSTRAINT "FK_image_model_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_model_config"("createdAt", "updatedAt", "id", "channelId", "code", "enabled", "displayNameZh", "displayNameEn", "officialModelId", "providerModelId", "protocol", "unitPrice", "currencyCode", "position", "isDefault", "healthStatus") SELECT "createdAt", "updatedAt", "id", "channelId", "code", "enabled", "displayNameZh", "displayNameEn", "officialModelId", "providerModelId", "protocol", "unitPrice", "currencyCode", "position", "isDefault", "healthStatus" FROM "image_model_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_model_config"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_model_config" RENAME TO "image_model_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_model_config_channel_position" ON "image_model_config" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_model_config_channel_code" ON "image_model_config" ("channelId", "code") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_reward_inviter_available"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_reward_channel_order"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_reward" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "inviterCustomerId" integer NOT NULL, "inviteeCustomerId" integer NOT NULL, "orderId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "rewardRateBps" int NOT NULL, "eligibleAmount" int NOT NULL, "rewardAmount" int NOT NULL, "releasedAmount" int NOT NULL DEFAULT (0), "clawedBackAmount" int NOT NULL DEFAULT (0), "settledRefundTotal" int NOT NULL DEFAULT (0), "orderTotalWithTax" int NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "earnedAt" datetime NOT NULL, "availableAt" datetime NOT NULL, "releasedAt" datetime, "settledEligibleRefundTotal" integer NOT NULL DEFAULT (0), CONSTRAINT "FK_referral_reward_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_invitee" FOREIGN KEY ("inviteeCustomerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_inviter" FOREIGN KEY ("inviterCustomerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_reward"("id", "createdAt", "updatedAt", "channelId", "inviterCustomerId", "inviteeCustomerId", "orderId", "currencyCode", "rewardRateBps", "eligibleAmount", "rewardAmount", "releasedAmount", "clawedBackAmount", "settledRefundTotal", "orderTotalWithTax", "status", "earnedAt", "availableAt", "releasedAt") SELECT "id", "createdAt", "updatedAt", "channelId", "inviterCustomerId", "inviteeCustomerId", "orderId", "currencyCode", "rewardRateBps", "eligibleAmount", "rewardAmount", "releasedAmount", "clawedBackAmount", "settledRefundTotal", "orderTotalWithTax", "status", "earnedAt", "availableAt", "releasedAt" FROM "referral_reward"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "referral_reward"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_referral_reward" RENAME TO "referral_reward"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_reward_inviter_available" ON "referral_reward" ("inviterCustomerId", "availableAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_reward_channel_order" ON "referral_reward" ("channelId", "orderId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_91a19e6613534949a4ce6e76ff"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_product" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "customFieldsFulfillmenttype" varchar(255) DEFAULT ('digital'), "customFieldsRefundpolicy" varchar(255) DEFAULT ('MERCHANT_REVIEW'), "customFieldsManualdeliveryslaminutes" integer DEFAULT (1440), CONSTRAINT "FK_91a19e6613534949a4ce6e76ff8" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_product"("createdAt", "updatedAt", "deletedAt", "enabled", "id", "featuredAssetId", "customFieldsFulfillmenttype", "customFieldsRefundpolicy", "customFieldsManualdeliveryslaminutes") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "id", "featuredAssetId", "customFieldsFulfillmenttype", "customFieldsRefundpolicy", "customFieldsManualdeliveryslaminutes" FROM "product"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "product"`, undefined);
        await queryRunner.query(`ALTER TABLE "temporary_product" RENAME TO "product"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_91a19e6613534949a4ce6e76ff" ON "product" ("featuredAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_6901d8715f5ebadd764466f7bd"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_dc9ac68b47da7b62249886affb"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_cbcd22193eda94668e84d33f18"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_77be94ce9ec650446617946227"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_9f065453910ea77d4be8e92618"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_239cfca2a55b98b90b6bef2e44"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_order_line" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "quantity" integer NOT NULL, "orderPlacedQuantity" integer NOT NULL DEFAULT (0), "listPriceIncludesTax" boolean NOT NULL, "adjustments" text NOT NULL, "taxLines" text NOT NULL, "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sellerChannelId" integer, "shippingLineId" integer, "productVariantId" integer NOT NULL, "taxCategoryId" integer, "initialListPrice" integer, "listPrice" integer NOT NULL, "featuredAssetId" integer, "orderId" integer, "customFieldsFulfillmenttypesnapshot" varchar(255) DEFAULT ('physical'), "customFieldsDigitaldeliverymodesnapshot" varchar(255) DEFAULT ('manual_service'), "customFieldsRefundpolicysnapshot" varchar(255) DEFAULT ('MERCHANT_REVIEW'), "customFieldsManualdeliveryslaminutessnapshot" integer DEFAULT (1440), CONSTRAINT "FK_6901d8715f5ebadd764466f7bde" FOREIGN KEY ("sellerChannelId") REFERENCES "channel" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_dc9ac68b47da7b62249886affba" FOREIGN KEY ("shippingLineId") REFERENCES "shipping_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_cbcd22193eda94668e84d33f185" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_77be94ce9ec6504466179462275" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_9f065453910ea77d4be8e92618f" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_239cfca2a55b98b90b6bef2e44f" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_order_line"("createdAt", "updatedAt", "quantity", "orderPlacedQuantity", "listPriceIncludesTax", "adjustments", "taxLines", "id", "sellerChannelId", "shippingLineId", "productVariantId", "taxCategoryId", "initialListPrice", "listPrice", "featuredAssetId", "orderId", "customFieldsFulfillmenttypesnapshot", "customFieldsDigitaldeliverymodesnapshot", "customFieldsRefundpolicysnapshot", "customFieldsManualdeliveryslaminutessnapshot") SELECT "createdAt", "updatedAt", "quantity", "orderPlacedQuantity", "listPriceIncludesTax", "adjustments", "taxLines", "id", "sellerChannelId", "shippingLineId", "productVariantId", "taxCategoryId", "initialListPrice", "listPrice", "featuredAssetId", "orderId", "customFieldsFulfillmenttypesnapshot", "customFieldsDigitaldeliverymodesnapshot", "customFieldsRefundpolicysnapshot", "customFieldsManualdeliveryslaminutessnapshot" FROM "order_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "order_line"`, undefined);
        await queryRunner.query(`ALTER TABLE "temporary_order_line" RENAME TO "order_line"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_6901d8715f5ebadd764466f7bd" ON "order_line" ("sellerChannelId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_dc9ac68b47da7b62249886affb" ON "order_line" ("shippingLineId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_cbcd22193eda94668e84d33f18" ON "order_line" ("productVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_77be94ce9ec650446617946227" ON "order_line" ("taxCategoryId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_9f065453910ea77d4be8e92618" ON "order_line" ("featuredAssetId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_239cfca2a55b98b90b6bef2e44" ON "order_line" ("orderId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_6e420052844edf3a5506d863ce"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_e38dca0d82fd64c7cf8aac8b8e"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_0e6f516053cf982b537836e21c"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_product_variant" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "sku" varchar NOT NULL, "outOfStockThreshold" integer NOT NULL DEFAULT (0), "useGlobalOutOfStockThreshold" boolean NOT NULL DEFAULT (1), "trackInventory" varchar NOT NULL DEFAULT ('INHERIT'), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "taxCategoryId" integer, "productId" integer, "customFieldsFulfillmenttype" varchar(255) DEFAULT ('digital'), "customFieldsDigitaldeliverymode" varchar(255) DEFAULT ('manual_service'), "customFieldsDigitalstockpolicy" varchar(255) DEFAULT ('limited'), CONSTRAINT "FK_6e420052844edf3a5506d863ce6" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_e38dca0d82fd64c7cf8aac8b8ef" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e6f516053cf982b537836e21cf" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_product_variant"("createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId", "customFieldsFulfillmenttype", "customFieldsDigitaldeliverymode", "customFieldsDigitalstockpolicy") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId", "customFieldsFulfillmenttype", "customFieldsDigitaldeliverymode", "customFieldsDigitalstockpolicy" FROM "product_variant"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "product_variant"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_product_variant" RENAME TO "product_variant"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_6e420052844edf3a5506d863ce" ON "product_variant" ("productId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_e38dca0d82fd64c7cf8aac8b8e" ON "product_variant" ("taxCategoryId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_0e6f516053cf982b537836e21c" ON "product_variant" ("featuredAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_c9ca2f58d4517460435cbd8b4c"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_afe9f917a1c82b9e9e69f7c612"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_af2116c7e176b6b88dceceeb74"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_channel" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "code" varchar NOT NULL, "token" varchar NOT NULL, "description" varchar DEFAULT (''), "defaultLanguageCode" varchar NOT NULL, "availableLanguageCodes" text, "defaultCurrencyCode" varchar NOT NULL, "availableCurrencyCodes" text, "trackInventory" boolean NOT NULL DEFAULT (1), "outOfStockThreshold" integer NOT NULL DEFAULT (0), "pricesIncludeTax" boolean NOT NULL, "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sellerId" integer, "defaultTaxZoneId" integer, "defaultShippingZoneId" integer, "customFieldsStorefrontnamezh" varchar(32) NOT NULL DEFAULT ('云桥Ai'), "customFieldsStorefrontnameen" varchar(32) NOT NULL DEFAULT ('Yunqiao Ai'), "customFieldsIsstoreprovisioningtemplate" boolean NOT NULL DEFAULT (0), "customFieldsCurrencyselectorenabled" boolean NOT NULL DEFAULT (1), "customFieldsCurrencyratemode" varchar(16) NOT NULL DEFAULT ('AUTO'), "customFieldsCnytomyrrate" double precision, "customFieldsCurrencyratemarkupbps" integer NOT NULL DEFAULT (0), "customFieldsCurrencyroundingmode" varchar(16) NOT NULL DEFAULT ('CENT'), "customFieldsCurrencyratesource" varchar(120), "customFieldsCurrencyrateupdatedat" datetime(6), "customFieldsCurrencypricesupdatedat" datetime(6), "customFieldsCurrencysyncedpricecount" integer NOT NULL DEFAULT (0), "customFieldsUsdtdisplayenabled" boolean NOT NULL DEFAULT (1), "customFieldsUsdtratemarkupbps" integer NOT NULL DEFAULT (0), "customFieldsCnyperusdtrate" double precision, "customFieldsUsdtratesource" varchar(120), "customFieldsUsdtrateupdatedat" datetime(6), "customFieldsUsdtrateschedulemode" varchar(16) NOT NULL DEFAULT ('INTERVAL'), "customFieldsUsdtrateintervalminutes" integer NOT NULL DEFAULT (5), "customFieldsUsdtratedailytime" varchar(5) NOT NULL DEFAULT ('10:00'), "customFieldsCommercemode" varchar(255) DEFAULT ('DIGITAL_ONLY'), CONSTRAINT "UQ_842699fce4f3470a7d06d89de88" UNIQUE ("token"), CONSTRAINT "UQ_06127ac6c6d913f4320759971db" UNIQUE ("code"), CONSTRAINT "FK_c9ca2f58d4517460435cbd8b4c9" FOREIGN KEY ("defaultShippingZoneId") REFERENCES "zone" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_afe9f917a1c82b9e9e69f7c6129" FOREIGN KEY ("defaultTaxZoneId") REFERENCES "zone" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_af2116c7e176b6b88dceceeb74b" FOREIGN KEY ("sellerId") REFERENCES "seller" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_channel"("createdAt", "updatedAt", "code", "token", "description", "defaultLanguageCode", "availableLanguageCodes", "defaultCurrencyCode", "availableCurrencyCodes", "trackInventory", "outOfStockThreshold", "pricesIncludeTax", "id", "sellerId", "defaultTaxZoneId", "defaultShippingZoneId", "customFieldsStorefrontnamezh", "customFieldsStorefrontnameen", "customFieldsIsstoreprovisioningtemplate", "customFieldsCurrencyselectorenabled", "customFieldsCurrencyratemode", "customFieldsCnytomyrrate", "customFieldsCurrencyratemarkupbps", "customFieldsCurrencyroundingmode", "customFieldsCurrencyratesource", "customFieldsCurrencyrateupdatedat", "customFieldsCurrencypricesupdatedat", "customFieldsCurrencysyncedpricecount", "customFieldsUsdtdisplayenabled", "customFieldsUsdtratemarkupbps", "customFieldsCnyperusdtrate", "customFieldsUsdtratesource", "customFieldsUsdtrateupdatedat", "customFieldsUsdtrateschedulemode", "customFieldsUsdtrateintervalminutes", "customFieldsUsdtratedailytime", "customFieldsCommercemode") SELECT "createdAt", "updatedAt", "code", "token", "description", "defaultLanguageCode", "availableLanguageCodes", "defaultCurrencyCode", "availableCurrencyCodes", "trackInventory", "outOfStockThreshold", "pricesIncludeTax", "id", "sellerId", "defaultTaxZoneId", "defaultShippingZoneId", "customFieldsStorefrontnamezh", "customFieldsStorefrontnameen", "customFieldsIsstoreprovisioningtemplate", "customFieldsCurrencyselectorenabled", "customFieldsCurrencyratemode", "customFieldsCnytomyrrate", "customFieldsCurrencyratemarkupbps", "customFieldsCurrencyroundingmode", "customFieldsCurrencyratesource", "customFieldsCurrencyrateupdatedat", "customFieldsCurrencypricesupdatedat", "customFieldsCurrencysyncedpricecount", "customFieldsUsdtdisplayenabled", "customFieldsUsdtratemarkupbps", "customFieldsCnyperusdtrate", "customFieldsUsdtratesource", "customFieldsUsdtrateupdatedat", "customFieldsUsdtrateschedulemode", "customFieldsUsdtrateintervalminutes", "customFieldsUsdtratedailytime", "customFieldsCommercemode" FROM "channel"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "channel"`, undefined);
        await queryRunner.query(`ALTER TABLE "temporary_channel" RENAME TO "channel"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_c9ca2f58d4517460435cbd8b4c" ON "channel" ("defaultShippingZoneId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_afe9f917a1c82b9e9e69f7c612" ON "channel" ("defaultTaxZoneId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_af2116c7e176b6b88dceceeb74" ON "channel" ("sellerId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_6fb55742e13e8082954d0436dc"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_d8791f444a8bf23fe4c1bc020c"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_9a5a6a556f75c4ac7bfdd03410"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_search_index_item" ("languageCode" varchar NOT NULL, "enabled" boolean NOT NULL, "productName" varchar NOT NULL, "productVariantName" varchar NOT NULL, "description" text NOT NULL, "slug" varchar NOT NULL, "sku" varchar NOT NULL, "facetIds" text NOT NULL, "facetValueIds" text NOT NULL, "collectionIds" text NOT NULL, "collectionSlugs" text NOT NULL, "channelIds" text NOT NULL, "productPreview" varchar NOT NULL, "productPreviewFocalPoint" text, "productVariantPreview" varchar NOT NULL, "productVariantPreviewFocalPoint" text, "productVariantId" integer NOT NULL, "channelId" integer NOT NULL, "productId" integer NOT NULL, "productAssetId" integer, "productVariantAssetId" integer, "price" integer NOT NULL, "priceWithTax" integer NOT NULL, "inStock" boolean NOT NULL DEFAULT (1), "productInStock" boolean NOT NULL DEFAULT (1), PRIMARY KEY ("languageCode", "productVariantId", "channelId"))`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_search_index_item"("languageCode", "enabled", "productName", "productVariantName", "description", "slug", "sku", "facetIds", "facetValueIds", "collectionIds", "collectionSlugs", "channelIds", "productPreview", "productPreviewFocalPoint", "productVariantPreview", "productVariantPreviewFocalPoint", "productVariantId", "channelId", "productId", "productAssetId", "productVariantAssetId", "price", "priceWithTax", "inStock", "productInStock") SELECT "languageCode", "enabled", "productName", "productVariantName", "description", "slug", "sku", "facetIds", "facetValueIds", "collectionIds", "collectionSlugs", "channelIds", "productPreview", "productPreviewFocalPoint", "productVariantPreview", "productVariantPreviewFocalPoint", "productVariantId", "channelId", "productId", "productAssetId", "productVariantAssetId", "price", "priceWithTax", "inStock", "productInStock" FROM "search_index_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "search_index_item"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_search_index_item" RENAME TO "search_index_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_6fb55742e13e8082954d0436dc" ON "search_index_item" ("productName") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_d8791f444a8bf23fe4c1bc020c" ON "search_index_item" ("productVariantName") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_9a5a6a556f75c4ac7bfdd03410" ON "search_index_item" ("description") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_content_translation_state_audit"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_content_translation_state_key"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_content_translation_state" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "stateKey" varchar(64) NOT NULL, "channelId" varchar(64), "entityType" varchar(64) NOT NULL, "entityId" varchar(64) NOT NULL, "fieldPath" varchar(128) NOT NULL, "sourceLanguageCode" varchar(20) NOT NULL DEFAULT ('zh_Hans'), "targetLanguageCode" varchar(20) NOT NULL DEFAULT ('en'), "sourceHash" varchar(64) NOT NULL, "translatedHash" varchar(64), "status" varchar(24) NOT NULL DEFAULT ('MISSING'), "origin" varchar(12) NOT NULL DEFAULT ('AUTO'), "locked" boolean NOT NULL DEFAULT (0), "error" text)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_content_translation_state"("id", "createdAt", "updatedAt", "stateKey", "channelId", "entityType", "entityId", "fieldPath", "sourceLanguageCode", "targetLanguageCode", "sourceHash", "translatedHash", "status", "origin", "locked", "error") SELECT "id", "createdAt", "updatedAt", "stateKey", "channelId", "entityType", "entityId", "fieldPath", "sourceLanguageCode", "targetLanguageCode", "sourceHash", "translatedHash", "status", "origin", "locked", "error" FROM "content_translation_state"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "content_translation_state"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_content_translation_state" RENAME TO "content_translation_state"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_content_translation_state_audit" ON "content_translation_state" ("channelId", "entityType", "status") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_content_translation_state_key" ON "content_translation_state" ("stateKey") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_after_sales_item_request"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_after_sales_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "requestId" integer NOT NULL, "orderLineId" integer, "quantity" integer NOT NULL, "unitPriceWithTax" integer NOT NULL, "lineAmountWithTax" integer NOT NULL, "productName" varchar(255) NOT NULL, "sku" varchar(255) NOT NULL, "fulfillmentType" varchar(16) NOT NULL, CONSTRAINT "FK_after_sales_item_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_after_sales_item_request" FOREIGN KEY ("requestId") REFERENCES "after_sales_request" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_after_sales_item"("id", "createdAt", "updatedAt", "requestId", "orderLineId", "quantity", "unitPriceWithTax", "lineAmountWithTax", "productName", "sku", "fulfillmentType") SELECT "id", "createdAt", "updatedAt", "requestId", "orderLineId", "quantity", "unitPriceWithTax", "lineAmountWithTax", "productName", "sku", "fulfillmentType" FROM "after_sales_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "after_sales_item"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_after_sales_item" RENAME TO "after_sales_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_after_sales_item_request" ON "after_sales_item" ("requestId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_after_sales_request_refund"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_after_sales_request_code"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_after_sales_request_channel_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_after_sales_request_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_after_sales_request_order"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_after_sales_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "code" varchar(32) NOT NULL, "type" varchar(32) NOT NULL, "state" varchar(24) NOT NULL DEFAULT ('PENDING'), "reason" varchar(40) NOT NULL, "description" text NOT NULL, "currencyCode" varchar(3) NOT NULL, "requestedAmount" integer NOT NULL, "approvedAmount" integer, "resolution" text, "customerName" varchar(200) NOT NULL, "customerEmail" varchar(254) NOT NULL, "respondedAt" datetime, "completedAt" datetime, "cancelledAt" datetime, "channelId" integer NOT NULL, "customerId" integer NOT NULL, "orderId" integer NOT NULL, "resolutionZh" text, "resolutionEn" text, "refundId" integer, "refundedAt" datetime, CONSTRAINT "FK_after_sales_request_refund" FOREIGN KEY ("refundId") REFERENCES "refund" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_after_sales_request_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_after_sales_request_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_after_sales_request_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_after_sales_request"("id", "createdAt", "updatedAt", "code", "type", "state", "reason", "description", "currencyCode", "requestedAmount", "approvedAmount", "resolution", "customerName", "customerEmail", "respondedAt", "completedAt", "cancelledAt", "channelId", "customerId", "orderId", "resolutionZh", "resolutionEn", "refundId", "refundedAt") SELECT "id", "createdAt", "updatedAt", "code", "type", "state", "reason", "description", "currencyCode", "requestedAmount", "approvedAmount", "resolution", "customerName", "customerEmail", "respondedAt", "completedAt", "cancelledAt", "channelId", "customerId", "orderId", "resolutionZh", "resolutionEn", "refundId", "refundedAt" FROM "after_sales_request"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "after_sales_request"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_after_sales_request" RENAME TO "after_sales_request"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_after_sales_request_refund" ON "after_sales_request" ("refundId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_after_sales_request_code" ON "after_sales_request" ("code") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_after_sales_request_channel_state_created" ON "after_sales_request" ("channelId", "state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_after_sales_request_customer_created" ON "after_sales_request" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_after_sales_request_order" ON "after_sales_request" ("orderId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_state_sequence"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_sequence"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_fingerprint"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_auto_card_pool_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(16) NOT NULL DEFAULT ('AVAILABLE'), "sequence" integer NOT NULL, "encryptedPayload" text NOT NULL, "fingerprint" varchar(64) NOT NULL, "assignedAt" datetime, "disabledReason" text, "configId" integer NOT NULL, "deliveryId" integer, "encryptedRawPayload" text, CONSTRAINT "FK_auto_card_pool_config" FOREIGN KEY ("configId") REFERENCES "auto_card_config" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_pool_delivery" FOREIGN KEY ("deliveryId") REFERENCES "auto_card_delivery" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_auto_card_pool_item"("id", "createdAt", "updatedAt", "state", "sequence", "encryptedPayload", "fingerprint", "assignedAt", "disabledReason", "configId", "deliveryId", "encryptedRawPayload") SELECT "id", "createdAt", "updatedAt", "state", "sequence", "encryptedPayload", "fingerprint", "assignedAt", "disabledReason", "configId", "deliveryId", "encryptedRawPayload" FROM "auto_card_pool_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "auto_card_pool_item"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_auto_card_pool_item" RENAME TO "auto_card_pool_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_pool_config_fingerprint" ON "auto_card_pool_item" ("configId", "fingerprint") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_auto_card_delivery_config_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_delivery_channel_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_delivery_order_line"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_auto_card_delivery" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(24) NOT NULL DEFAULT ('WAITING_STOCK'), "recipientEmail" varchar(254) NOT NULL, "languageCode" varchar(16) NOT NULL, "productName" varchar(255) NOT NULL, "sku" varchar(255) NOT NULL, "quantity" integer NOT NULL, "schemaSnapshot" text NOT NULL, "instructionsSnapshot" text NOT NULL, "attemptCount" integer NOT NULL DEFAULT (0), "lastError" text, "lastDispatchedAt" datetime, "sentAt" datetime, "fulfillmentId" varchar(64), "channelId" integer NOT NULL, "orderId" integer NOT NULL, "orderLineId" integer NOT NULL, "configId" integer NOT NULL, CONSTRAINT "FK_auto_card_delivery_config" FOREIGN KEY ("configId") REFERENCES "auto_card_config" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_delivery_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_delivery_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_delivery_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_auto_card_delivery"("id", "createdAt", "updatedAt", "state", "recipientEmail", "languageCode", "productName", "sku", "quantity", "schemaSnapshot", "instructionsSnapshot", "attemptCount", "lastError", "lastDispatchedAt", "sentAt", "fulfillmentId", "channelId", "orderId", "orderLineId", "configId") SELECT "id", "createdAt", "updatedAt", "state", "recipientEmail", "languageCode", "productName", "sku", "quantity", "schemaSnapshot", "instructionsSnapshot", "attemptCount", "lastError", "lastDispatchedAt", "sentAt", "fulfillmentId", "channelId", "orderId", "orderLineId", "configId" FROM "auto_card_delivery"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "auto_card_delivery"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_auto_card_delivery" RENAME TO "auto_card_delivery"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_auto_card_delivery_config_created" ON "auto_card_delivery" ("configId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_auto_card_delivery_channel_state_created" ON "auto_card_delivery" ("channelId", "state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_delivery_order_line" ON "auto_card_delivery" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_auto_card_config_channel_variant"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_auto_card_config" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (1), "formatName" varchar(80) NOT NULL, "delimiter" varchar(16) NOT NULL DEFAULT ('----'), "fieldsJson" text NOT NULL, "instructions" text NOT NULL, "lowStockThreshold" integer NOT NULL DEFAULT (5), "channelId" integer NOT NULL, "productVariantId" integer NOT NULL, "instructionsZh" text, "instructionsEn" text, CONSTRAINT "FK_auto_card_config_variant" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_auto_card_config"("id", "createdAt", "updatedAt", "enabled", "formatName", "delimiter", "fieldsJson", "instructions", "lowStockThreshold", "channelId", "productVariantId", "instructionsZh", "instructionsEn") SELECT "id", "createdAt", "updatedAt", "enabled", "formatName", "delimiter", "fieldsJson", "instructions", "lowStockThreshold", "channelId", "productVariantId", "instructionsZh", "instructionsEn" FROM "auto_card_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "auto_card_config"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_auto_card_config" RENAME TO "auto_card_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_config_channel_variant" ON "auto_card_config" ("channelId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_packaging_unpack_event_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_packaging_unpack_event_rule_created"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_packaging_unpack_event" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "reason" varchar(24) NOT NULL, "packagesOpened" integer NOT NULL, "unitsCreated" integer NOT NULL, "packageStockBefore" integer NOT NULL, "packageStockAfter" integer NOT NULL, "unitStockBefore" integer NOT NULL, "unitStockAfter" integer NOT NULL, "ruleId" integer NOT NULL, "channelId" integer NOT NULL, "stockLocationId" integer NOT NULL, "orderId" integer, CONSTRAINT "FK_packaging_unpack_event_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_packaging_unpack_event_stock_location" FOREIGN KEY ("stockLocationId") REFERENCES "stock_location" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_packaging_unpack_event_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_packaging_unpack_event_rule" FOREIGN KEY ("ruleId") REFERENCES "product_packaging_rule" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_packaging_unpack_event"("id", "createdAt", "updatedAt", "reason", "packagesOpened", "unitsCreated", "packageStockBefore", "packageStockAfter", "unitStockBefore", "unitStockAfter", "ruleId", "channelId", "stockLocationId", "orderId") SELECT "id", "createdAt", "updatedAt", "reason", "packagesOpened", "unitsCreated", "packageStockBefore", "packageStockAfter", "unitStockBefore", "unitStockAfter", "ruleId", "channelId", "stockLocationId", "orderId" FROM "packaging_unpack_event"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "packaging_unpack_event"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_packaging_unpack_event" RENAME TO "packaging_unpack_event"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_packaging_unpack_event_order" ON "packaging_unpack_event" ("orderId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_packaging_unpack_event_rule_created" ON "packaging_unpack_event" ("ruleId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_package_variant"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_unit_variant"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_product"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_product_packaging_rule" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (1), "autoUnpack" boolean NOT NULL DEFAULT (1), "unitLabel" varchar(32) NOT NULL, "packageLabel" varchar(32) NOT NULL, "unitsPerPackage" integer NOT NULL, "channelId" integer NOT NULL, "productId" integer NOT NULL, "unitVariantId" integer NOT NULL, "packageVariantId" integer NOT NULL, CONSTRAINT "FK_product_packaging_rule_package_variant" FOREIGN KEY ("packageVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_unit_variant" FOREIGN KEY ("unitVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_product" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_product_packaging_rule"("id", "createdAt", "updatedAt", "enabled", "autoUnpack", "unitLabel", "packageLabel", "unitsPerPackage", "channelId", "productId", "unitVariantId", "packageVariantId") SELECT "id", "createdAt", "updatedAt", "enabled", "autoUnpack", "unitLabel", "packageLabel", "unitsPerPackage", "channelId", "productId", "unitVariantId", "packageVariantId" FROM "product_packaging_rule"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "product_packaging_rule"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_product_packaging_rule" RENAME TO "product_packaging_rule"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_package_variant" ON "product_packaging_rule" ("channelId", "packageVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_unit_variant" ON "product_packaging_rule" ("channelId", "unitVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_product" ON "product_packaging_rule" ("channelId", "productId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_manual_digital_delivery_channel_state_expected"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_manual_digital_delivery_order_line"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_manual_digital_delivery" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(24) NOT NULL DEFAULT ('WAITING_PROCESSING'), "recipientEmail" varchar(254) NOT NULL, "languageCode" varchar(16) NOT NULL, "productName" varchar(255) NOT NULL, "sku" varchar(255) NOT NULL, "quantity" integer NOT NULL, "expectedAt" datetime NOT NULL, "encryptedPackages" text, "attachmentAssetIdsJson" text NOT NULL, "attemptCount" integer NOT NULL DEFAULT (0), "lastError" text, "lastDispatchedAt" datetime, "sentAt" datetime, "fulfillmentId" varchar(64), "channelId" integer NOT NULL, "orderId" integer NOT NULL, "orderLineId" integer NOT NULL, CONSTRAINT "FK_manual_delivery_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_manual_delivery_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_manual_delivery_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_manual_digital_delivery"("id", "createdAt", "updatedAt", "state", "recipientEmail", "languageCode", "productName", "sku", "quantity", "expectedAt", "encryptedPackages", "attachmentAssetIdsJson", "attemptCount", "lastError", "lastDispatchedAt", "sentAt", "fulfillmentId", "channelId", "orderId", "orderLineId") SELECT "id", "createdAt", "updatedAt", "state", "recipientEmail", "languageCode", "productName", "sku", "quantity", "expectedAt", "encryptedPackages", "attachmentAssetIdsJson", "attemptCount", "lastError", "lastDispatchedAt", "sentAt", "fulfillmentId", "channelId", "orderId", "orderLineId" FROM "manual_digital_delivery"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "manual_digital_delivery"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_manual_digital_delivery" RENAME TO "manual_digital_delivery"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_manual_digital_delivery_channel_state_expected" ON "manual_digital_delivery" ("channelId", "state", "expectedAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_manual_digital_delivery_order_line" ON "manual_digital_delivery" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_customer_delivery_email_default"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_customer_delivery_email_unique"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_customer_delivery_email" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "emailAddress" varchar(254) NOT NULL, "normalizedEmail" varchar(254) NOT NULL, "label" varchar(80) NOT NULL DEFAULT (''), "isDefault" boolean NOT NULL DEFAULT (0), "confirmedAt" datetime NOT NULL, "channelId" integer NOT NULL, "customerId" integer NOT NULL, CONSTRAINT "FK_delivery_email_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_delivery_email_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_customer_delivery_email"("id", "createdAt", "updatedAt", "emailAddress", "normalizedEmail", "label", "isDefault", "confirmedAt", "channelId", "customerId") SELECT "id", "createdAt", "updatedAt", "emailAddress", "normalizedEmail", "label", "isDefault", "confirmedAt", "channelId", "customerId" FROM "customer_delivery_email"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "customer_delivery_email"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_customer_delivery_email" RENAME TO "customer_delivery_email"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_customer_delivery_email_unique" ON "customer_delivery_email" ("channelId", "customerId", "normalizedEmail") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_config_channel"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_config" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "enabled" boolean NOT NULL DEFAULT (0), "promptOptimizationEnabled" boolean NOT NULL DEFAULT (1), "defaultModelCode" varchar(48) NOT NULL DEFAULT ('OPENAI_HIGH_QUALITY'), "termsVersion" varchar(32) NOT NULL DEFAULT ('2026-08-27'), "termsZh" text NOT NULL, "termsEn" text NOT NULL, CONSTRAINT "FK_image_generation_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_config"("createdAt", "updatedAt", "id", "channelId", "enabled", "promptOptimizationEnabled", "defaultModelCode", "termsVersion", "termsZh", "termsEn") SELECT "createdAt", "updatedAt", "id", "channelId", "enabled", "promptOptimizationEnabled", "defaultModelCode", "termsVersion", "termsZh", "termsEn" FROM "image_generation_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_generation_config"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_generation_config" RENAME TO "image_generation_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_config_channel" ON "image_generation_config" ("channelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_private_asset_expiry"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_private_asset_owner_created"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_private_asset" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "customerId" integer NOT NULL, "kind" varchar(16) NOT NULL, "storageKey" varchar(255) NOT NULL, "originalName" varchar(80) NOT NULL, "mimeType" varchar(64) NOT NULL, "byteSize" integer NOT NULL, "width" integer NOT NULL, "height" integer NOT NULL, "sha256" varchar(64) NOT NULL, "expiresAt" datetime NOT NULL, "deletedAt" datetime, "providerMetadata" text, CONSTRAINT "UQ_1fc089a5d1f00e49613178fd263" UNIQUE ("storageKey"), CONSTRAINT "FK_image_private_asset_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_image_private_asset_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_private_asset"("createdAt", "updatedAt", "id", "channelId", "customerId", "kind", "storageKey", "originalName", "mimeType", "byteSize", "width", "height", "sha256", "expiresAt", "deletedAt", "providerMetadata") SELECT "createdAt", "updatedAt", "id", "channelId", "customerId", "kind", "storageKey", "originalName", "mimeType", "byteSize", "width", "height", "sha256", "expiresAt", "deletedAt", "providerMetadata" FROM "image_private_asset"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_private_asset"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_private_asset" RENAME TO "image_private_asset"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_private_asset_expiry" ON "image_private_asset" ("expiresAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_private_asset_owner_created" ON "image_private_asset" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_output_job_index"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_output_state_updated"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_output" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "jobId" integer NOT NULL, "outputIndex" integer NOT NULL, "state" varchar(24) NOT NULL DEFAULT ('QUEUED'), "attemptCount" integer NOT NULL DEFAULT (0), "providerIdempotencyKey" varchar(160) NOT NULL, "providerRequestId" varchar(200), "assetId" integer, "errorMessage" varchar(500), "unknownAt" datetime, "completedAt" datetime, "walletSettled" boolean NOT NULL DEFAULT (0), "refundedAt" datetime, "version" integer NOT NULL, CONSTRAINT "FK_image_generation_output_asset" FOREIGN KEY ("assetId") REFERENCES "image_private_asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_output_job" FOREIGN KEY ("jobId") REFERENCES "image_generation_job" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_output"("createdAt", "updatedAt", "id", "jobId", "outputIndex", "state", "attemptCount", "providerIdempotencyKey", "providerRequestId", "assetId", "errorMessage", "unknownAt", "completedAt", "walletSettled", "refundedAt", "version") SELECT "createdAt", "updatedAt", "id", "jobId", "outputIndex", "state", "attemptCount", "providerIdempotencyKey", "providerRequestId", "assetId", "errorMessage", "unknownAt", "completedAt", "walletSettled", "refundedAt", "version" FROM "image_generation_output"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_generation_output"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_generation_output" RENAME TO "image_generation_output"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_generation_output_state_updated" ON "image_generation_output" ("state", "updatedAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_model_config_channel_position"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_model_config_channel_code"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_model_config" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "code" varchar(48) NOT NULL, "enabled" boolean NOT NULL DEFAULT (0), "displayNameZh" varchar(120) NOT NULL, "displayNameEn" varchar(120) NOT NULL, "officialModelId" varchar(160) NOT NULL, "providerModelId" varchar(160) NOT NULL, "protocol" varchar(32) NOT NULL, "unitPrice" integer NOT NULL DEFAULT (0), "currencyCode" varchar(3) NOT NULL, "position" integer NOT NULL DEFAULT (0), "isDefault" boolean NOT NULL DEFAULT (0), "healthStatus" varchar(24) NOT NULL DEFAULT ('UNTESTED'), "descriptionZh" varchar(500) NOT NULL, "descriptionEn" varchar(500) NOT NULL, "healthMessage" varchar(500), "lastTestedAt" datetime, CONSTRAINT "FK_image_model_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_model_config"("createdAt", "updatedAt", "id", "channelId", "code", "enabled", "displayNameZh", "displayNameEn", "officialModelId", "providerModelId", "protocol", "unitPrice", "currencyCode", "position", "isDefault", "healthStatus", "descriptionZh", "descriptionEn", "healthMessage", "lastTestedAt") SELECT "createdAt", "updatedAt", "id", "channelId", "code", "enabled", "displayNameZh", "displayNameEn", "officialModelId", "providerModelId", "protocol", "unitPrice", "currencyCode", "position", "isDefault", "healthStatus", "descriptionZh", "descriptionEn", "healthMessage", "lastTestedAt" FROM "image_model_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_model_config"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_model_config" RENAME TO "image_model_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_model_config_channel_code" ON "image_model_config" ("channelId", "code") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_job_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_job_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_job_idempotency"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_job" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "customerId" integer NOT NULL, "modelConfigId" integer NOT NULL, "referenceAssetId" integer, "idempotencyKey" varchar(64) NOT NULL, "modelCodeSnapshot" varchar(48) NOT NULL, "modelNameSnapshot" varchar(120) NOT NULL, "officialModelIdSnapshot" varchar(160) NOT NULL, "providerModelIdSnapshot" varchar(160) NOT NULL, "protocolSnapshot" varchar(32) NOT NULL, "originalPrompt" text NOT NULL, "finalPrompt" text NOT NULL, "promptSpec" text, "promptSkillHash" varchar(64) NOT NULL, "referenceMode" varchar(24) NOT NULL DEFAULT ('NONE'), "aspectRatio" varchar(8) NOT NULL, "quantity" integer NOT NULL, "unitPriceSnapshot" integer NOT NULL, "reservedAmount" integer NOT NULL, "capturedAmount" integer NOT NULL DEFAULT (0), "releasedAmount" integer NOT NULL DEFAULT (0), "currencyCode" varchar(3) NOT NULL, "walletUsageId" integer, "state" varchar(24) NOT NULL DEFAULT ('QUEUED'), "termsVersion" varchar(32) NOT NULL, "termsAcceptedAt" datetime NOT NULL, "errorMessage" varchar(500), "completedAt" datetime, "version" integer NOT NULL, CONSTRAINT "FK_image_generation_job_reference" FOREIGN KEY ("referenceAssetId") REFERENCES "image_private_asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_job_model" FOREIGN KEY ("modelConfigId") REFERENCES "image_model_config" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_job_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_job_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_job"("createdAt", "updatedAt", "id", "channelId", "customerId", "modelConfigId", "referenceAssetId", "idempotencyKey", "modelCodeSnapshot", "modelNameSnapshot", "officialModelIdSnapshot", "providerModelIdSnapshot", "protocolSnapshot", "originalPrompt", "finalPrompt", "promptSpec", "promptSkillHash", "referenceMode", "aspectRatio", "quantity", "unitPriceSnapshot", "reservedAmount", "capturedAmount", "releasedAmount", "currencyCode", "walletUsageId", "state", "termsVersion", "termsAcceptedAt", "errorMessage", "completedAt", "version") SELECT "createdAt", "updatedAt", "id", "channelId", "customerId", "modelConfigId", "referenceAssetId", "idempotencyKey", "modelCodeSnapshot", "modelNameSnapshot", "officialModelIdSnapshot", "providerModelIdSnapshot", "protocolSnapshot", "originalPrompt", "finalPrompt", "promptSpec", "promptSkillHash", "referenceMode", "aspectRatio", "quantity", "unitPriceSnapshot", "reservedAmount", "capturedAmount", "releasedAmount", "currencyCode", "walletUsageId", "state", "termsVersion", "termsAcceptedAt", "errorMessage", "completedAt", "version" FROM "image_generation_job"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_generation_job"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_generation_job" RENAME TO "image_generation_job"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_generation_job_state_created" ON "image_generation_job" ("state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_generation_job_customer_created" ON "image_generation_job" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_job_idempotency" ON "image_generation_job" ("channelId", "customerId", "idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_prompt_skill_hash"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_prompt_skill_release" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "bundleVersion" integer NOT NULL, "sourceHash" varchar(64) NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('INACTIVE'), "bundle" text NOT NULL, "activatedAt" datetime)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_prompt_skill_release"("createdAt", "updatedAt", "id", "bundleVersion", "sourceHash", "status", "bundle", "activatedAt") SELECT "createdAt", "updatedAt", "id", "bundleVersion", "sourceHash", "status", "bundle", "activatedAt" FROM "image_prompt_skill_release"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_prompt_skill_release"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_prompt_skill_release" RENAME TO "image_prompt_skill_release"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_prompt_skill_hash" ON "image_prompt_skill_release" ("sourceHash") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_wallet_channel_customer"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_wallet_account_currency"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_wallet" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "referralAccountId" integer NOT NULL, "customerId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "availableBalance" integer NOT NULL DEFAULT (0), "pendingBalance" integer NOT NULL DEFAULT (0), "reservedBalance" integer NOT NULL DEFAULT (0), "version" integer NOT NULL, CONSTRAINT "FK_referral_wallet_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_wallet_account" FOREIGN KEY ("referralAccountId") REFERENCES "referral_account" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_wallet_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_wallet"("id", "createdAt", "updatedAt", "channelId", "referralAccountId", "customerId", "currencyCode", "availableBalance", "pendingBalance", "reservedBalance", "version") SELECT "id", "createdAt", "updatedAt", "channelId", "referralAccountId", "customerId", "currencyCode", "availableBalance", "pendingBalance", "reservedBalance", "version" FROM "referral_wallet"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "referral_wallet"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_referral_wallet" RENAME TO "referral_wallet"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_wallet_channel_customer" ON "referral_wallet" ("channelId", "customerId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_wallet_account_currency" ON "referral_wallet" ("referralAccountId", "currencyCode") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_ledger_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_ledger_channel_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_ledger_idempotency"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_ledger_entry" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "walletId" integer NOT NULL, "customerId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "eventType" varchar(32) NOT NULL, "availableDelta" integer NOT NULL DEFAULT (0), "pendingDelta" integer NOT NULL DEFAULT (0), "reservedDelta" integer NOT NULL DEFAULT (0), "availableAfter" integer NOT NULL, "pendingAfter" integer NOT NULL, "reservedAfter" integer NOT NULL, "idempotencyKey" varchar(255) NOT NULL, "orderId" integer, "refundId" integer, "withdrawalId" integer, "actorId" integer, "actorType" varchar(16) NOT NULL DEFAULT ('SYSTEM'), "note" varchar(500), "metadata" text, CONSTRAINT "FK_referral_ledger_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_ledger_wallet" FOREIGN KEY ("walletId") REFERENCES "referral_wallet" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_ledger_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_ledger_entry"("id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "currencyCode", "eventType", "availableDelta", "pendingDelta", "reservedDelta", "availableAfter", "pendingAfter", "reservedAfter", "idempotencyKey", "orderId", "refundId", "withdrawalId", "actorId", "actorType", "note", "metadata") SELECT "id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "currencyCode", "eventType", "availableDelta", "pendingDelta", "reservedDelta", "availableAfter", "pendingAfter", "reservedAfter", "idempotencyKey", "orderId", "refundId", "withdrawalId", "actorId", "actorType", "note", "metadata" FROM "referral_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "referral_ledger_entry"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_referral_ledger_entry" RENAME TO "referral_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_ledger_customer_created" ON "referral_ledger_entry" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_ledger_channel_created" ON "referral_ledger_entry" ("channelId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_ledger_idempotency" ON "referral_ledger_entry" ("idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_program_config_channel"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_program_config" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "enabled" boolean NOT NULL DEFAULT (0), "rewardRateBps" integer NOT NULL DEFAULT (500), "releaseDelayDays" integer NOT NULL DEFAULT (7), "minimumOrderAmount" integer NOT NULL DEFAULT (0), "maxRewardPerOrder" integer, "allowBalanceSpend" boolean NOT NULL DEFAULT (1), "attributionWindowDays" integer NOT NULL DEFAULT (30), "defaultPosterTemplate" varchar(64) NOT NULL DEFAULT ('BRAND_MINIMAL'), CONSTRAINT "FK_referral_program_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_program_config"("id", "createdAt", "updatedAt", "channelId", "enabled", "rewardRateBps", "releaseDelayDays", "minimumOrderAmount", "maxRewardPerOrder", "allowBalanceSpend", "attributionWindowDays", "defaultPosterTemplate") SELECT "id", "createdAt", "updatedAt", "channelId", "enabled", "rewardRateBps", "releaseDelayDays", "minimumOrderAmount", "maxRewardPerOrder", "allowBalanceSpend", "attributionWindowDays", "defaultPosterTemplate" FROM "referral_program_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "referral_program_config"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_referral_program_config" RENAME TO "referral_program_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_program_config_channel" ON "referral_program_config" ("channelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_reward_inviter_available"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_reward_channel_order"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_reward" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "inviterCustomerId" integer NOT NULL, "inviteeCustomerId" integer NOT NULL, "orderId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "rewardRateBps" integer NOT NULL, "eligibleAmount" integer NOT NULL, "rewardAmount" integer NOT NULL, "releasedAmount" integer NOT NULL DEFAULT (0), "clawedBackAmount" integer NOT NULL DEFAULT (0), "settledRefundTotal" integer NOT NULL DEFAULT (0), "orderTotalWithTax" integer NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "earnedAt" datetime NOT NULL, "availableAt" datetime NOT NULL, "releasedAt" datetime, "settledEligibleRefundTotal" integer NOT NULL DEFAULT (0), CONSTRAINT "FK_referral_reward_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_invitee" FOREIGN KEY ("inviteeCustomerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_inviter" FOREIGN KEY ("inviterCustomerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_reward"("id", "createdAt", "updatedAt", "channelId", "inviterCustomerId", "inviteeCustomerId", "orderId", "currencyCode", "rewardRateBps", "eligibleAmount", "rewardAmount", "releasedAmount", "clawedBackAmount", "settledRefundTotal", "orderTotalWithTax", "status", "earnedAt", "availableAt", "releasedAt", "settledEligibleRefundTotal") SELECT "id", "createdAt", "updatedAt", "channelId", "inviterCustomerId", "inviteeCustomerId", "orderId", "currencyCode", "rewardRateBps", "eligibleAmount", "rewardAmount", "releasedAmount", "clawedBackAmount", "settledRefundTotal", "orderTotalWithTax", "status", "earnedAt", "availableAt", "releasedAt", "settledEligibleRefundTotal" FROM "referral_reward"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "referral_reward"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_referral_reward" RENAME TO "referral_reward"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_reward_inviter_available" ON "referral_reward" ("inviterCustomerId", "availableAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_reward_channel_order" ON "referral_reward" ("channelId", "orderId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_wallet_usage_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_wallet_usage_resource"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_wallet_usage_idempotency"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_wallet_usage" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "walletId" integer NOT NULL, "customerId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "resourceType" varchar(48) NOT NULL, "resourceId" varchar(128) NOT NULL, "idempotencyKey" varchar(255) NOT NULL, "amount" integer NOT NULL, "capturedAmount" integer NOT NULL DEFAULT (0), "releasedAmount" integer NOT NULL DEFAULT (0), "status" varchar(24) NOT NULL DEFAULT ('RESERVED'), "reservedAt" datetime NOT NULL, "settledAt" datetime, "metadata" text, "version" integer NOT NULL, CONSTRAINT "FK_referral_wallet_usage_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_wallet_usage_wallet" FOREIGN KEY ("walletId") REFERENCES "referral_wallet" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_wallet_usage_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_wallet_usage"("createdAt", "updatedAt", "id", "channelId", "walletId", "customerId", "currencyCode", "resourceType", "resourceId", "idempotencyKey", "amount", "capturedAmount", "releasedAmount", "status", "reservedAt", "settledAt", "metadata", "version") SELECT "createdAt", "updatedAt", "id", "channelId", "walletId", "customerId", "currencyCode", "resourceType", "resourceId", "idempotencyKey", "amount", "capturedAmount", "releasedAmount", "status", "reservedAt", "settledAt", "metadata", "version" FROM "referral_wallet_usage"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "referral_wallet_usage"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_referral_wallet_usage" RENAME TO "referral_wallet_usage"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_wallet_usage_customer_created" ON "referral_wallet_usage" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_wallet_usage_resource" ON "referral_wallet_usage" ("channelId", "resourceType", "resourceId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_wallet_usage_idempotency" ON "referral_wallet_usage" ("idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_withdrawal_channel_status_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_withdrawal_code"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_withdrawal" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "walletId" integer NOT NULL, "customerId" integer NOT NULL, "code" varchar(32) NOT NULL, "currencyCode" varchar(3) NOT NULL, "amount" integer NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "payoutMethod" varchar(32) NOT NULL, "payoutAccountMasked" varchar(160) NOT NULL, "externalReference" varchar(160), "note" varchar(500), "requestedByAdministratorId" integer, "processedByAdministratorId" integer, "approvedAt" datetime, "paidAt" datetime, "rejectedAt" datetime, "cancelledAt" datetime, CONSTRAINT "FK_referral_withdrawal_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_withdrawal_wallet" FOREIGN KEY ("walletId") REFERENCES "referral_wallet" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_withdrawal_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_withdrawal"("id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "code", "currencyCode", "amount", "status", "payoutMethod", "payoutAccountMasked", "externalReference", "note", "requestedByAdministratorId", "processedByAdministratorId", "approvedAt", "paidAt", "rejectedAt", "cancelledAt") SELECT "id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "code", "currencyCode", "amount", "status", "payoutMethod", "payoutAccountMasked", "externalReference", "note", "requestedByAdministratorId", "processedByAdministratorId", "approvedAt", "paidAt", "rejectedAt", "cancelledAt" FROM "referral_withdrawal"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "referral_withdrawal"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_referral_withdrawal" RENAME TO "referral_withdrawal"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_withdrawal_channel_status_created" ON "referral_withdrawal" ("channelId", "status", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_withdrawal_code" ON "referral_withdrawal" ("code") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_store_administrator_access_user"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_administrator_access_administrator"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_store_administrator_access" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "administratorId" integer NOT NULL, "userId" integer NOT NULL, "mustChangePassword" boolean NOT NULL DEFAULT (1), CONSTRAINT "FK_store_administrator_access_administrator" FOREIGN KEY ("administratorId") REFERENCES "administrator" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_store_administrator_access"("id", "createdAt", "updatedAt", "administratorId", "userId", "mustChangePassword") SELECT "id", "createdAt", "updatedAt", "administratorId", "userId", "mustChangePassword" FROM "store_administrator_access"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "store_administrator_access"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_store_administrator_access" RENAME TO "store_administrator_access"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_administrator_access_user" ON "store_administrator_access" ("userId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_administrator_access_administrator" ON "store_administrator_access" ("administratorId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_store_profile_public_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_profile_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_profile_logo_asset"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_store_profile" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "status" varchar(20) NOT NULL DEFAULT ('DRAFT'), "isPublished" boolean NOT NULL DEFAULT (0), "sortOrder" integer NOT NULL DEFAULT (0), "descriptionZh" text NOT NULL, "descriptionEn" text NOT NULL, "logoAssetId" integer, "internalNote" text, CONSTRAINT "FK_store_profile_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_store_profile_logo_asset" FOREIGN KEY ("logoAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_store_profile"("id", "createdAt", "updatedAt", "channelId", "status", "isPublished", "sortOrder", "descriptionZh", "descriptionEn", "logoAssetId", "internalNote") SELECT "id", "createdAt", "updatedAt", "channelId", "status", "isPublished", "sortOrder", "descriptionZh", "descriptionEn", "logoAssetId", "internalNote" FROM "store_profile"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "store_profile"`, undefined);
        await queryRunner.query(`ALTER TABLE "temporary_store_profile" RENAME TO "store_profile"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_profile_channel" ON "store_profile" ("channelId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_profile_logo_asset" ON "store_profile" ("logoAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_promotion_page_channel"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_promotion_page" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "contentType" varchar(16) NOT NULL DEFAULT ('HTML'), "draftSource" text, "publishedContentType" varchar(16) NOT NULL DEFAULT ('HTML'), "publishedSource" text, "isCustomized" boolean NOT NULL DEFAULT (0), "defaultTemplateVersion" integer NOT NULL DEFAULT (1), "publishedVersion" integer NOT NULL DEFAULT (0), "publishedAt" datetime, CONSTRAINT "FK_storefront_promotion_page_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_promotion_page"("id", "createdAt", "updatedAt", "channelId", "contentType", "draftSource", "publishedContentType", "publishedSource", "isCustomized", "defaultTemplateVersion", "publishedVersion", "publishedAt") SELECT "id", "createdAt", "updatedAt", "channelId", "contentType", "draftSource", "publishedContentType", "publishedSource", "isCustomized", "defaultTemplateVersion", "publishedVersion", "publishedAt" FROM "storefront_promotion_page"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_promotion_page"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_promotion_page" RENAME TO "storefront_promotion_page"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_promotion_page_channel" ON "storefront_promotion_page" ("channelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_quote_order_expiry"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_usdt_checkout_quote" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "orderId" integer NOT NULL, "fiatCurrencyCode" varchar(3) NOT NULL, "fiatAmount" integer NOT NULL, "fiatPerUsdtRate" float NOT NULL, "markupBps" integer NOT NULL DEFAULT (0), "usdtAmount" decimal(24,6) NOT NULL, "source" varchar(120) NOT NULL, "expiresAt" datetime NOT NULL, CONSTRAINT "FK_storefront_usdt_quote_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_quote_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_usdt_checkout_quote"("createdAt", "updatedAt", "id", "channelId", "orderId", "fiatCurrencyCode", "fiatAmount", "fiatPerUsdtRate", "markupBps", "usdtAmount", "source", "expiresAt") SELECT "createdAt", "updatedAt", "id", "channelId", "orderId", "fiatCurrencyCode", "fiatAmount", "fiatPerUsdtRate", "markupBps", "usdtAmount", "source", "expiresAt" FROM "storefront_usdt_checkout_quote"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_usdt_checkout_quote"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_usdt_checkout_quote" RENAME TO "storefront_usdt_checkout_quote"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_usdt_quote_order_expiry" ON "storefront_usdt_checkout_quote" ("orderId", "expiresAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_status_expiry"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_transaction"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_match_key"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_quote"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_usdt_payment_intent" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "orderId" integer NOT NULL, "quoteId" integer NOT NULL, "paymentId" integer, "network" varchar(16) NOT NULL, "tokenContractAddress" varchar(64) NOT NULL, "receivingAddress" varchar(64) NOT NULL, "receivingAddressFingerprint" varchar(64) NOT NULL, "matchKey" varchar(64) NOT NULL, "baseUsdtAmount" decimal(24,6) NOT NULL, "expectedUsdtAmount" decimal(24,6) NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "transactionId" varchar(80), "senderAddress" varchar(64), "receivedUsdtAmount" decimal(24,6), "blockNumber" integer, "blockTimestamp" datetime, "lastCheckedAt" datetime, "settledAt" datetime, "failureReason" varchar(500), "expiresAt" datetime NOT NULL, CONSTRAINT "FK_storefront_usdt_intent_payment" FOREIGN KEY ("paymentId") REFERENCES "payment" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_quote" FOREIGN KEY ("quoteId") REFERENCES "storefront_usdt_checkout_quote" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_usdt_payment_intent"("createdAt", "updatedAt", "id", "channelId", "orderId", "quoteId", "paymentId", "network", "tokenContractAddress", "receivingAddress", "receivingAddressFingerprint", "matchKey", "baseUsdtAmount", "expectedUsdtAmount", "status", "transactionId", "senderAddress", "receivedUsdtAmount", "blockNumber", "blockTimestamp", "lastCheckedAt", "settledAt", "failureReason", "expiresAt") SELECT "createdAt", "updatedAt", "id", "channelId", "orderId", "quoteId", "paymentId", "network", "tokenContractAddress", "receivingAddress", "receivingAddressFingerprint", "matchKey", "baseUsdtAmount", "expectedUsdtAmount", "status", "transactionId", "senderAddress", "receivedUsdtAmount", "blockNumber", "blockTimestamp", "lastCheckedAt", "settledAt", "failureReason", "expiresAt" FROM "storefront_usdt_payment_intent"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_usdt_payment_intent"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_usdt_payment_intent" RENAME TO "storefront_usdt_payment_intent"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_usdt_intent_status_expiry" ON "storefront_usdt_payment_intent" ("status", "expiresAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_transaction" ON "storefront_usdt_payment_intent" ("transactionId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_match_key" ON "storefront_usdt_payment_intent" ("matchKey") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_quote" ON "storefront_usdt_payment_intent" ("quoteId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_system_announcement_schedule"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_system_announcement" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (1), "priority" integer NOT NULL DEFAULT (0), "titleZh" varchar(120) NOT NULL, "titleEn" varchar(120) NOT NULL DEFAULT (''), "contentZh" text NOT NULL, "contentEn" text NOT NULL, "linkUrl" varchar(500), "startsAt" datetime, "endsAt" datetime)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_system_announcement"("id", "createdAt", "updatedAt", "enabled", "priority", "titleZh", "titleEn", "contentZh", "contentEn", "linkUrl", "startsAt", "endsAt") SELECT "id", "createdAt", "updatedAt", "enabled", "priority", "titleZh", "titleEn", "contentZh", "contentEn", "linkUrl", "startsAt", "endsAt" FROM "system_announcement"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "system_announcement"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_system_announcement" RENAME TO "system_announcement"`,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_store_coupon_campaign_config_channel_claim"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_coupon_campaign_config_promotion"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_store_coupon_campaign_config" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "promotionId" integer NOT NULL, "claimStartsAt" datetime, "claimEndsAt" datetime, "validityDays" integer, "issueLimit" integer, "perCustomerClaimLimit" integer NOT NULL DEFAULT (1), "stackPolicy" varchar(16) NOT NULL DEFAULT ('EXCLUSIVE'), "returnOnCancellation" boolean NOT NULL DEFAULT (1), "returnOnFullRefund" boolean NOT NULL DEFAULT (1), CONSTRAINT "FK_store_coupon_config_promotion" FOREIGN KEY ("promotionId") REFERENCES "promotion" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_store_coupon_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_store_coupon_campaign_config"("id", "createdAt", "updatedAt", "channelId", "promotionId", "claimStartsAt", "claimEndsAt", "validityDays", "issueLimit", "perCustomerClaimLimit", "stackPolicy", "returnOnCancellation", "returnOnFullRefund") SELECT "id", "createdAt", "updatedAt", "channelId", "promotionId", "claimStartsAt", "claimEndsAt", "validityDays", "issueLimit", "perCustomerClaimLimit", "stackPolicy", "returnOnCancellation", "returnOnFullRefund" FROM "store_coupon_campaign_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "store_coupon_campaign_config"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_store_coupon_campaign_config" RENAME TO "store_coupon_campaign_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_coupon_campaign_config_channel_claim" ON "store_coupon_campaign_config" ("channelId", "claimStartsAt", "claimEndsAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_coupon_campaign_config_promotion" ON "store_coupon_campaign_config" ("promotionId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_used_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_locked_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_customer_status_valid"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_campaign_customer"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_customer_coupon" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "campaignConfigId" integer NOT NULL, "promotionId" integer NOT NULL, "customerId" integer NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('AVAILABLE'), "campaignName" varchar(120) NOT NULL, "campaignKind" varchar(32) NOT NULL, "minimumSpend" integer NOT NULL DEFAULT (0), "discountAmount" integer, "discountRate" float, "claimedAt" datetime NOT NULL, "validFrom" datetime NOT NULL, "validUntil" datetime, "lockedAt" datetime, "lockExpiresAt" datetime, "lockedOrderId" integer, "usedAt" datetime, "usedOrderId" integer, "returnedAt" datetime, "expiredAt" datetime, "revokedAt" datetime, "returnCount" integer NOT NULL DEFAULT (0), "version" integer NOT NULL, CONSTRAINT "FK_customer_coupon_used_order" FOREIGN KEY ("usedOrderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_locked_order" FOREIGN KEY ("lockedOrderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_promotion" FOREIGN KEY ("promotionId") REFERENCES "promotion" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_config" FOREIGN KEY ("campaignConfigId") REFERENCES "store_coupon_campaign_config" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_customer_coupon"("id", "createdAt", "updatedAt", "channelId", "campaignConfigId", "promotionId", "customerId", "status", "campaignName", "campaignKind", "minimumSpend", "discountAmount", "discountRate", "claimedAt", "validFrom", "validUntil", "lockedAt", "lockExpiresAt", "lockedOrderId", "usedAt", "usedOrderId", "returnedAt", "expiredAt", "revokedAt", "returnCount", "version") SELECT "id", "createdAt", "updatedAt", "channelId", "campaignConfigId", "promotionId", "customerId", "status", "campaignName", "campaignKind", "minimumSpend", "discountAmount", "discountRate", "claimedAt", "validFrom", "validUntil", "lockedAt", "lockExpiresAt", "lockedOrderId", "usedAt", "usedOrderId", "returnedAt", "expiredAt", "revokedAt", "returnCount", "version" FROM "customer_coupon"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "customer_coupon"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_customer_coupon" RENAME TO "customer_coupon"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_customer_coupon_used_order" ON "customer_coupon" ("usedOrderId", "status") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_customer_coupon_locked_order" ON "customer_coupon" ("lockedOrderId", "status") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_customer_coupon_customer_status_valid" ON "customer_coupon" ("customerId", "status", "validUntil") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_customer_coupon_campaign_customer" ON "customer_coupon" ("promotionId", "customerId", "claimedAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_idempotency"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_campaign_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_coupon_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_channel_created"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_coupon_ledger_entry" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "customerCouponId" integer NOT NULL, "promotionId" integer NOT NULL, "customerId" integer NOT NULL, "orderId" integer, "refundId" integer, "eventType" varchar(24) NOT NULL, "actorType" varchar(16) NOT NULL, "idempotencyKey" varchar(255), "discountAmount" integer, "note" varchar(500), "metadata" text, CONSTRAINT "FK_coupon_ledger_refund" FOREIGN KEY ("refundId") REFERENCES "refund" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_promotion" FOREIGN KEY ("promotionId") REFERENCES "promotion" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_coupon" FOREIGN KEY ("customerCouponId") REFERENCES "customer_coupon" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_coupon_ledger_entry"("id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "eventType", "actorType", "idempotencyKey", "discountAmount", "note", "metadata") SELECT "id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "eventType", "actorType", "idempotencyKey", "discountAmount", "note", "metadata" FROM "coupon_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "coupon_ledger_entry"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_coupon_ledger_entry" RENAME TO "coupon_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_coupon_ledger_idempotency" ON "coupon_ledger_entry" ("idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_campaign_created" ON "coupon_ledger_entry" ("promotionId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_coupon_created" ON "coupon_ledger_entry" ("customerCouponId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_channel_created" ON "coupon_ledger_entry" ("channelId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_coupon_allocation_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_allocation_campaign_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_allocation_order_coupon"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_coupon_order_allocation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "customerCouponId" integer NOT NULL, "promotionId" integer NOT NULL, "customerId" integer NOT NULL, "orderId" integer NOT NULL, "refundId" integer, "status" varchar(16) NOT NULL DEFAULT ('LOCKED'), "campaignName" varchar(120) NOT NULL, "currencyCode" varchar(3) NOT NULL, "discountAmount" integer NOT NULL DEFAULT (0), "discountAmountWithTax" integer NOT NULL DEFAULT (0), "refundedAmount" integer NOT NULL DEFAULT (0), "orderTotalWithTax" integer NOT NULL DEFAULT (0), "lineAllocations" text, "appliedAt" datetime NOT NULL, "usedAt" datetime, "releasedAt" datetime, "refundedAt" datetime, CONSTRAINT "FK_coupon_allocation_refund" FOREIGN KEY ("refundId") REFERENCES "refund" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_allocation_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_allocation_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_allocation_promotion" FOREIGN KEY ("promotionId") REFERENCES "promotion" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_allocation_coupon" FOREIGN KEY ("customerCouponId") REFERENCES "customer_coupon" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_allocation_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_coupon_order_allocation"("id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "status", "campaignName", "currencyCode", "discountAmount", "discountAmountWithTax", "refundedAmount", "orderTotalWithTax", "lineAllocations", "appliedAt", "usedAt", "releasedAt", "refundedAt") SELECT "id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "status", "campaignName", "currencyCode", "discountAmount", "discountAmountWithTax", "refundedAmount", "orderTotalWithTax", "lineAllocations", "appliedAt", "usedAt", "releasedAt", "refundedAt" FROM "coupon_order_allocation"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "coupon_order_allocation"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_coupon_order_allocation" RENAME TO "coupon_order_allocation"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_allocation_customer_created" ON "coupon_order_allocation" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_allocation_campaign_created" ON "coupon_order_allocation" ("promotionId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_coupon_allocation_order_coupon" ON "coupon_order_allocation" ("orderId", "customerCouponId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_balance_use_channel_order"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_balance_use" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "walletId" integer NOT NULL, "customerId" integer NOT NULL, "orderId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "amount" integer NOT NULL, "refundedAmount" integer NOT NULL DEFAULT (0), "status" varchar(24) NOT NULL DEFAULT ('RESERVED'), "reservedAt" datetime NOT NULL, "capturedAt" datetime, "releasedAt" datetime, CONSTRAINT "FK_referral_balance_use_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_balance_use_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_balance_use_wallet" FOREIGN KEY ("walletId") REFERENCES "referral_wallet" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_balance_use_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_balance_use"("id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "orderId", "currencyCode", "amount", "refundedAmount", "status", "reservedAt", "capturedAt", "releasedAt") SELECT "id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "orderId", "currencyCode", "amount", "refundedAmount", "status", "reservedAt", "capturedAt", "releasedAt" FROM "referral_balance_use"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "referral_balance_use"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_referral_balance_use" RENAME TO "referral_balance_use"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_balance_use_channel_order" ON "referral_balance_use" ("channelId", "orderId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_poster_template_channel_position"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_poster_template" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "name" varchar(128) NOT NULL, "enabled" boolean NOT NULL DEFAULT (1), "position" integer NOT NULL DEFAULT (0), "layoutVariant" varchar(32) NOT NULL DEFAULT ('STANDARD_CENTER'), "posterBackgroundAssetId" integer, "shareBackgroundAssetId" integer, "titleZh" varchar(80) NOT NULL DEFAULT ('好友邀请函'), "titleEn" varchar(80) NOT NULL DEFAULT ('Invitation for friends'), "headlineZh" varchar(180) NOT NULL DEFAULT ('发现好东西，一起分享'), "headlineEn" varchar(180) NOT NULL DEFAULT ('Discover something worth sharing'), "rewardTextZh" varchar(220) NOT NULL DEFAULT ('好友成功消费，可获得 {rewardRate}% 奖励用于消费抵扣'), "rewardTextEn" varchar(220) NOT NULL DEFAULT ('Earn {rewardRate}% in rewards when a friend makes a purchase'), "siteIntroZh" varchar(260) NOT NULL DEFAULT (''), "siteIntroEn" varchar(260) NOT NULL DEFAULT (''), "serviceTextZh" varchar(260) NOT NULL DEFAULT ('好物严选 · 便捷消费 · 售后服务'), "serviceTextEn" varchar(260) NOT NULL DEFAULT ('Curated products · Easy shopping · Customer support'), "foregroundColor" varchar(16) NOT NULL DEFAULT ('#FFFFFF'), "accentColor" varchar(16) NOT NULL DEFAULT ('#FF4D4F'), "overlayOpacity" integer NOT NULL DEFAULT (28), CONSTRAINT "FK_referral_poster_template_share_asset" FOREIGN KEY ("shareBackgroundAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_referral_poster_template_poster_asset" FOREIGN KEY ("posterBackgroundAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_referral_poster_template_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_poster_template"("createdAt", "updatedAt", "id", "channelId", "name", "enabled", "position", "layoutVariant", "posterBackgroundAssetId", "shareBackgroundAssetId", "titleZh", "titleEn", "headlineZh", "headlineEn", "rewardTextZh", "rewardTextEn", "siteIntroZh", "siteIntroEn", "serviceTextZh", "serviceTextEn", "foregroundColor", "accentColor", "overlayOpacity") SELECT "createdAt", "updatedAt", "id", "channelId", "name", "enabled", "position", "layoutVariant", "posterBackgroundAssetId", "shareBackgroundAssetId", "titleZh", "titleEn", "headlineZh", "headlineEn", "rewardTextZh", "rewardTextEn", "siteIntroZh", "siteIntroEn", "serviceTextZh", "serviceTextEn", "foregroundColor", "accentColor", "overlayOpacity" FROM "referral_poster_template"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "referral_poster_template"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_referral_poster_template" RENAME TO "referral_poster_template"`,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_daily_visitor_channel_date"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_daily_visitor_identity"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_daily_visitor" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "customerId" integer, "businessDate" varchar(10) NOT NULL, "visitorKeyHash" varchar(64) NOT NULL, "firstSeenAt" datetime NOT NULL, "lastSeenAt" datetime NOT NULL, "visitCount" integer NOT NULL DEFAULT (1), CONSTRAINT "FK_storefront_daily_visitor_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_daily_visitor_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_daily_visitor"("id", "createdAt", "updatedAt", "channelId", "customerId", "businessDate", "visitorKeyHash", "firstSeenAt", "lastSeenAt", "visitCount") SELECT "id", "createdAt", "updatedAt", "channelId", "customerId", "businessDate", "visitorKeyHash", "firstSeenAt", "lastSeenAt", "visitCount" FROM "storefront_daily_visitor"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_daily_visitor"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_daily_visitor" RENAME TO "storefront_daily_visitor"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_daily_visitor_channel_date" ON "storefront_daily_visitor" ("channelId", "businessDate") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_daily_visitor_identity" ON "storefront_daily_visitor" ("channelId", "businessDate", "visitorKeyHash") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_translation_language"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_content_block_translation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "languageCode" varchar(16) NOT NULL, "title" varchar(255) NOT NULL DEFAULT (''), "subtitle" varchar(500) NOT NULL DEFAULT (''), "body" text NOT NULL, "ctaLabel" varchar(120) NOT NULL DEFAULT (''), "baseId" integer NOT NULL, CONSTRAINT "FK_storefront_content_block_translation_base" FOREIGN KEY ("baseId") REFERENCES "storefront_content_block" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_content_block_translation"("id", "createdAt", "updatedAt", "languageCode", "title", "subtitle", "body", "ctaLabel", "baseId") SELECT "id", "createdAt", "updatedAt", "languageCode", "title", "subtitle", "body", "ctaLabel", "baseId" FROM "storefront_content_block_translation"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_content_block_translation"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_content_block_translation" RENAME TO "storefront_content_block_translation"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_block_translation_language" ON "storefront_content_block_translation" ("baseId", "languageCode") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_item_translation_language"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_content_item_translation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "languageCode" varchar(16) NOT NULL, "label" varchar(255) NOT NULL DEFAULT (''), "description" text NOT NULL, "baseId" integer NOT NULL, CONSTRAINT "FK_storefront_content_item_translation_base" FOREIGN KEY ("baseId") REFERENCES "storefront_content_item" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_content_item_translation"("id", "createdAt", "updatedAt", "languageCode", "label", "description", "baseId") SELECT "id", "createdAt", "updatedAt", "languageCode", "label", "description", "baseId" FROM "storefront_content_item_translation"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_content_item_translation"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_content_item_translation" RENAME TO "storefront_content_item_translation"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_item_translation_language" ON "storefront_content_item_translation" ("baseId", "languageCode") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_item_block_position"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_item_image_asset"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_content_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (1), "position" integer NOT NULL DEFAULT (0), "imageUrl" varchar(2048), "targetType" varchar(32) NOT NULL DEFAULT ('NONE'), "targetValue" varchar(2048), "blockId" integer NOT NULL, "settings" text, "imageAssetId" integer, CONSTRAINT "FK_storefront_content_item_image_asset" FOREIGN KEY ("imageAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_content_item_block" FOREIGN KEY ("blockId") REFERENCES "storefront_content_block" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_content_item"("id", "createdAt", "updatedAt", "enabled", "position", "imageUrl", "targetType", "targetValue", "blockId", "settings", "imageAssetId") SELECT "id", "createdAt", "updatedAt", "enabled", "position", "imageUrl", "targetType", "targetValue", "blockId", "settings", "imageAssetId" FROM "storefront_content_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_content_item"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_content_item" RENAME TO "storefront_content_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_item_image_asset" ON "storefront_content_item" ("imageAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel_position"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_image_asset"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel_code"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_content_block" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "code" varchar(64) NOT NULL, "type" varchar(32) NOT NULL, "enabled" boolean NOT NULL DEFAULT (1), "position" integer NOT NULL DEFAULT (0), "startsAt" datetime, "endsAt" datetime, "imageUrl" varchar(2048), "backgroundColor" varchar(32), "textColor" varchar(32), "targetType" varchar(32) NOT NULL DEFAULT ('NONE'), "targetValue" varchar(2048), "channelId" integer NOT NULL, "internalName" varchar(128) NOT NULL DEFAULT (''), "layoutVariant" varchar(32) NOT NULL DEFAULT ('AUTO'), "settings" text, "imageAssetId" integer, CONSTRAINT "FK_storefront_content_block_image_asset" FOREIGN KEY ("imageAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_content_block_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_content_block"("id", "createdAt", "updatedAt", "code", "type", "enabled", "position", "startsAt", "endsAt", "imageUrl", "backgroundColor", "textColor", "targetType", "targetValue", "channelId", "internalName", "layoutVariant", "settings", "imageAssetId") SELECT "id", "createdAt", "updatedAt", "code", "type", "enabled", "position", "startsAt", "endsAt", "imageUrl", "backgroundColor", "textColor", "targetType", "targetValue", "channelId", "internalName", "layoutVariant", "settings", "imageAssetId" FROM "storefront_content_block"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_content_block"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_content_block" RENAME TO "storefront_content_block"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_image_asset" ON "storefront_content_block" ("imageAssetId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_channel" ON "storefront_content_block" ("channelId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_block_channel_code" ON "storefront_content_block" ("channelId", "code") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_settings_channel"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_content_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "heroAutoplayIntervalSeconds" integer NOT NULL DEFAULT (5), "channelId" integer NOT NULL, CONSTRAINT "FK_storefront_content_settings_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_content_settings"("id", "createdAt", "updatedAt", "heroAutoplayIntervalSeconds", "channelId") SELECT "id", "createdAt", "updatedAt", "heroAutoplayIntervalSeconds", "channelId" FROM "storefront_content_settings"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_content_settings"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_content_settings" RENAME TO "storefront_content_settings"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_settings_channel" ON "storefront_content_settings" ("channelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_line_order_line"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_line_variant"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_cart_line" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "cartId" integer NOT NULL, "productVariantId" integer NOT NULL, "quantity" integer NOT NULL, "selected" boolean NOT NULL DEFAULT (1), "orderLineId" integer, CONSTRAINT "FK_4b16092e25690ed973fca613970" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_fc4ebb77880b9f16355ba97e94f" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_a7dfef03af017cd8d3303d139ac" FOREIGN KEY ("cartId") REFERENCES "storefront_cart" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_cart_line"("id", "createdAt", "updatedAt", "cartId", "productVariantId", "quantity", "selected", "orderLineId") SELECT "id", "createdAt", "updatedAt", "cartId", "productVariantId", "quantity", "selected", "orderLineId" FROM "storefront_cart_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_cart_line"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_cart_line" RENAME TO "storefront_cart_line"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_line_order_line" ON "storefront_cart_line" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_line_variant" ON "storefront_cart_line" ("cartId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_activity"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_active_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_owner"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_cart" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "ownerType" varchar(16) NOT NULL, "ownerId" integer NOT NULL, "revision" integer NOT NULL DEFAULT (0), "state" varchar(24) NOT NULL DEFAULT ('OPEN'), "checkoutOrderId" integer, "projectedRevision" integer, "initialized" boolean NOT NULL DEFAULT (0), "lastActivityAt" datetime NOT NULL, CONSTRAINT "FK_dd8fecf032261059620774538b4" FOREIGN KEY ("checkoutOrderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_1fc82434cf72cc2f2331dc7ae92" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_cart"("id", "createdAt", "updatedAt", "channelId", "ownerType", "ownerId", "revision", "state", "checkoutOrderId", "projectedRevision", "initialized", "lastActivityAt") SELECT "id", "createdAt", "updatedAt", "channelId", "ownerType", "ownerId", "revision", "state", "checkoutOrderId", "projectedRevision", "initialized", "lastActivityAt" FROM "storefront_cart"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_cart"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_cart" RENAME TO "storefront_cart"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_cart_activity" ON "storefront_cart" ("lastActivityAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_active_order" ON "storefront_cart" ("checkoutOrderId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_owner" ON "storefront_cart" ("channelId", "ownerType", "ownerId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_checkout_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_checkout_cart"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_cart_checkout" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "cartId" integer NOT NULL, "orderId" integer NOT NULL, "cartRevision" integer NOT NULL, "state" varchar(20) NOT NULL DEFAULT ('PREPARED'), "completedAt" datetime, CONSTRAINT "FK_62eae4cd2000102e470884e62c4" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_999b72b6d264f393ce623c1fa16" FOREIGN KEY ("cartId") REFERENCES "storefront_cart" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_cart_checkout"("id", "createdAt", "updatedAt", "cartId", "orderId", "cartRevision", "state", "completedAt") SELECT "id", "createdAt", "updatedAt", "cartId", "orderId", "cartRevision", "state", "completedAt" FROM "storefront_cart_checkout"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_cart_checkout"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_cart_checkout" RENAME TO "storefront_cart_checkout"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_checkout_order" ON "storefront_cart_checkout" ("orderId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_cart_checkout_cart" ON "storefront_cart_checkout" ("cartId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_checkout_line_cart_line"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_checkout_line_variant"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_cart_checkout_line" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "checkoutId" integer NOT NULL, "cartLineId" integer, "productVariantId" integer NOT NULL, "quantity" integer NOT NULL, CONSTRAINT "FK_50b17e57a4ee983399032f33b82" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_06fd288a0681d32056b3982af96" FOREIGN KEY ("cartLineId") REFERENCES "storefront_cart_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_eb781b4c2e8d587fb9d4c250e8b" FOREIGN KEY ("checkoutId") REFERENCES "storefront_cart_checkout" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_cart_checkout_line"("id", "createdAt", "updatedAt", "checkoutId", "cartLineId", "productVariantId", "quantity") SELECT "id", "createdAt", "updatedAt", "checkoutId", "cartLineId", "productVariantId", "quantity" FROM "storefront_cart_checkout_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_cart_checkout_line"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_cart_checkout_line" RENAME TO "storefront_cart_checkout_line"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_checkout_line_cart_line" ON "storefront_cart_checkout_line" ("cartLineId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_checkout_line_variant" ON "storefront_cart_checkout_line" ("checkoutId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_order_line"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_product_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_channel_state_created"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_storefront_review" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(16) NOT NULL DEFAULT ('PENDING'), "rating" integer NOT NULL, "title" varchar(120) NOT NULL, "body" text NOT NULL, "customerName" varchar(120) NOT NULL, "productName" varchar(255) NOT NULL, "sku" varchar(255) NOT NULL, "merchantResponse" text, "moderatedAt" datetime, "channelId" integer NOT NULL, "customerId" integer, "orderId" integer, "orderLineId" integer, "productId" integer, "productVariantId" integer, "merchantResponseZh" text, "merchantResponseEn" text, CONSTRAINT "FK_storefront_review_product_variant" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_product" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_storefront_review"("id", "createdAt", "updatedAt", "state", "rating", "title", "body", "customerName", "productName", "sku", "merchantResponse", "moderatedAt", "channelId", "customerId", "orderId", "orderLineId", "productId", "productVariantId", "merchantResponseZh", "merchantResponseEn") SELECT "id", "createdAt", "updatedAt", "state", "rating", "title", "body", "customerName", "productName", "sku", "merchantResponse", "moderatedAt", "channelId", "customerId", "orderId", "orderLineId", "productId", "productVariantId", "merchantResponseZh", "merchantResponseEn" FROM "storefront_review"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "storefront_review"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_storefront_review" RENAME TO "storefront_review"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_review_order_line" ON "storefront_review" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_customer_created" ON "storefront_review" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_product_state_created" ON "storefront_review" ("productId", "state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_channel_state_created" ON "storefront_review" ("channelId", "state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_pool_config_sequence" ON "auto_card_pool_item" ("configId", "sequence") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_auto_card_pool_config_state_sequence" ON "auto_card_pool_item" ("configId", "state", "sequence") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_customer_delivery_email_default" ON "customer_delivery_email" ("channelId", "customerId", "isDefault") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_output_job_index" ON "image_generation_output" ("jobId", "outputIndex") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_model_config_channel_position" ON "image_model_config" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_profile_public_order" ON "store_profile" ("status", "isPublished", "sortOrder") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_system_announcement_schedule" ON "system_announcement" ("enabled", "startsAt", "endsAt", "priority") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_poster_template_channel_position" ON "referral_poster_template" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_item_block_position" ON "storefront_content_item" ("blockId", "position") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_channel_position" ON "storefront_content_block" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_manual_delivery_event_delivery_created"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_manual_digital_delivery_event" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "type" varchar(24) NOT NULL, "actorType" varchar(16) NOT NULL, "actorId" varchar(64), "note" text NOT NULL, "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "deliveryId" integer NOT NULL, CONSTRAINT "FK_manual_delivery_event_delivery" FOREIGN KEY ("deliveryId") REFERENCES "manual_digital_delivery" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_manual_digital_delivery_event"("createdAt", "updatedAt", "type", "actorType", "actorId", "note", "id", "deliveryId") SELECT "createdAt", "updatedAt", "type", "actorType", "actorId", "note", "id", "deliveryId" FROM "manual_digital_delivery_event"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "manual_digital_delivery_event"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_manual_digital_delivery_event" RENAME TO "manual_digital_delivery_event"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_manual_delivery_event_delivery_created" ON "manual_digital_delivery_event" ("deliveryId", "createdAt") `,
            undefined,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        if (!this.isSqlite(queryRunner)) return;

        await queryRunner.query(`DROP INDEX "IDX_manual_delivery_event_delivery_created"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "manual_digital_delivery_event" RENAME TO "temporary_manual_digital_delivery_event"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "manual_digital_delivery_event" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "type" varchar(24) NOT NULL, "actorType" varchar(16) NOT NULL, "actorId" varchar(64), "note" text NOT NULL, "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "deliveryId" integer NOT NULL)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "manual_digital_delivery_event"("createdAt", "updatedAt", "type", "actorType", "actorId", "note", "id", "deliveryId") SELECT "createdAt", "updatedAt", "type", "actorType", "actorId", "note", "id", "deliveryId" FROM "temporary_manual_digital_delivery_event"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_manual_digital_delivery_event"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_manual_delivery_event_delivery_created" ON "manual_digital_delivery_event" ("deliveryId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel_position"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_item_block_position"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_poster_template_channel_position"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_system_announcement_schedule"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_profile_public_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_model_config_channel_position"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_output_job_index"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_customer_delivery_email_default"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_state_sequence"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_sequence"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_channel_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_product_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_order_line"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_review" RENAME TO "temporary_storefront_review"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_review" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(16) NOT NULL DEFAULT ('PENDING'), "rating" int NOT NULL, "title" varchar(120) NOT NULL, "body" text NOT NULL, "customerName" varchar(120) NOT NULL, "productName" varchar(255) NOT NULL, "sku" varchar(255) NOT NULL, "merchantResponse" text, "moderatedAt" datetime, "channelId" integer NOT NULL, "customerId" integer, "orderId" integer, "orderLineId" integer, "productId" integer, "productVariantId" integer, "merchantResponseZh" text, "merchantResponseEn" text, CONSTRAINT "FK_storefront_review_product_variant" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_product" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_review"("id", "createdAt", "updatedAt", "state", "rating", "title", "body", "customerName", "productName", "sku", "merchantResponse", "moderatedAt", "channelId", "customerId", "orderId", "orderLineId", "productId", "productVariantId", "merchantResponseZh", "merchantResponseEn") SELECT "id", "createdAt", "updatedAt", "state", "rating", "title", "body", "customerName", "productName", "sku", "merchantResponse", "moderatedAt", "channelId", "customerId", "orderId", "orderLineId", "productId", "productVariantId", "merchantResponseZh", "merchantResponseEn" FROM "temporary_storefront_review"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_review"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_channel_state_created" ON "storefront_review" ("channelId", "state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_product_state_created" ON "storefront_review" ("productId", "state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_customer_created" ON "storefront_review" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_review_order_line" ON "storefront_review" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_checkout_line_variant"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_checkout_line_cart_line"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_cart_checkout_line" RENAME TO "temporary_storefront_cart_checkout_line"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_cart_checkout_line" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "checkoutId" integer NOT NULL, "cartLineId" integer, "productVariantId" integer NOT NULL, "quantity" int NOT NULL, CONSTRAINT "FK_50b17e57a4ee983399032f33b82" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_06fd288a0681d32056b3982af96" FOREIGN KEY ("cartLineId") REFERENCES "storefront_cart_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_eb781b4c2e8d587fb9d4c250e8b" FOREIGN KEY ("checkoutId") REFERENCES "storefront_cart_checkout" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_cart_checkout_line"("id", "createdAt", "updatedAt", "checkoutId", "cartLineId", "productVariantId", "quantity") SELECT "id", "createdAt", "updatedAt", "checkoutId", "cartLineId", "productVariantId", "quantity" FROM "temporary_storefront_cart_checkout_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_cart_checkout_line"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_checkout_line_variant" ON "storefront_cart_checkout_line" ("checkoutId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_checkout_line_cart_line" ON "storefront_cart_checkout_line" ("cartLineId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_checkout_cart"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_checkout_order"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_cart_checkout" RENAME TO "temporary_storefront_cart_checkout"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_cart_checkout" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "cartId" integer NOT NULL, "orderId" integer NOT NULL, "cartRevision" int NOT NULL, "state" varchar(20) NOT NULL DEFAULT ('PREPARED'), "completedAt" datetime, CONSTRAINT "FK_62eae4cd2000102e470884e62c4" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_999b72b6d264f393ce623c1fa16" FOREIGN KEY ("cartId") REFERENCES "storefront_cart" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_cart_checkout"("id", "createdAt", "updatedAt", "cartId", "orderId", "cartRevision", "state", "completedAt") SELECT "id", "createdAt", "updatedAt", "cartId", "orderId", "cartRevision", "state", "completedAt" FROM "temporary_storefront_cart_checkout"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_cart_checkout"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_cart_checkout_cart" ON "storefront_cart_checkout" ("cartId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_checkout_order" ON "storefront_cart_checkout" ("orderId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_owner"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_active_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_activity"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_cart" RENAME TO "temporary_storefront_cart"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_cart" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "ownerType" varchar(16) NOT NULL, "ownerId" integer NOT NULL, "revision" int NOT NULL DEFAULT (0), "state" varchar(24) NOT NULL DEFAULT ('OPEN'), "checkoutOrderId" integer, "projectedRevision" int, "initialized" boolean NOT NULL DEFAULT (0), "lastActivityAt" datetime NOT NULL, CONSTRAINT "FK_dd8fecf032261059620774538b4" FOREIGN KEY ("checkoutOrderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_1fc82434cf72cc2f2331dc7ae92" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_cart"("id", "createdAt", "updatedAt", "channelId", "ownerType", "ownerId", "revision", "state", "checkoutOrderId", "projectedRevision", "initialized", "lastActivityAt") SELECT "id", "createdAt", "updatedAt", "channelId", "ownerType", "ownerId", "revision", "state", "checkoutOrderId", "projectedRevision", "initialized", "lastActivityAt" FROM "temporary_storefront_cart"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_cart"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_owner" ON "storefront_cart" ("channelId", "ownerType", "ownerId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_active_order" ON "storefront_cart" ("checkoutOrderId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_cart_activity" ON "storefront_cart" ("lastActivityAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_line_variant"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_line_order_line"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_cart_line" RENAME TO "temporary_storefront_cart_line"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_cart_line" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "cartId" integer NOT NULL, "productVariantId" integer NOT NULL, "quantity" int NOT NULL, "selected" boolean NOT NULL DEFAULT (1), "orderLineId" integer, CONSTRAINT "FK_4b16092e25690ed973fca613970" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_fc4ebb77880b9f16355ba97e94f" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_a7dfef03af017cd8d3303d139ac" FOREIGN KEY ("cartId") REFERENCES "storefront_cart" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_cart_line"("id", "createdAt", "updatedAt", "cartId", "productVariantId", "quantity", "selected", "orderLineId") SELECT "id", "createdAt", "updatedAt", "cartId", "productVariantId", "quantity", "selected", "orderLineId" FROM "temporary_storefront_cart_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_cart_line"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_line_variant" ON "storefront_cart_line" ("cartId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_line_order_line" ON "storefront_cart_line" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_settings_channel"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_content_settings" RENAME TO "temporary_storefront_content_settings"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_content_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "heroAutoplayIntervalSeconds" int NOT NULL DEFAULT (5), "channelId" integer NOT NULL, CONSTRAINT "FK_storefront_content_settings_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_content_settings"("id", "createdAt", "updatedAt", "heroAutoplayIntervalSeconds", "channelId") SELECT "id", "createdAt", "updatedAt", "heroAutoplayIntervalSeconds", "channelId" FROM "temporary_storefront_content_settings"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_content_settings"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_settings_channel" ON "storefront_content_settings" ("channelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel_code"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_image_asset"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_content_block" RENAME TO "temporary_storefront_content_block"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_content_block" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "code" varchar(64) NOT NULL, "type" varchar(32) NOT NULL, "enabled" boolean NOT NULL DEFAULT (1), "position" int NOT NULL DEFAULT (0), "startsAt" datetime, "endsAt" datetime, "imageUrl" varchar(2048), "backgroundColor" varchar(32), "textColor" varchar(32), "targetType" varchar(32) NOT NULL DEFAULT ('NONE'), "targetValue" varchar(2048), "channelId" integer NOT NULL, "internalName" varchar(128) NOT NULL DEFAULT (''), "layoutVariant" varchar(32) NOT NULL DEFAULT ('AUTO'), "settings" text, "imageAssetId" integer, CONSTRAINT "FK_storefront_content_block_image_asset" FOREIGN KEY ("imageAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_content_block_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_content_block"("id", "createdAt", "updatedAt", "code", "type", "enabled", "position", "startsAt", "endsAt", "imageUrl", "backgroundColor", "textColor", "targetType", "targetValue", "channelId", "internalName", "layoutVariant", "settings", "imageAssetId") SELECT "id", "createdAt", "updatedAt", "code", "type", "enabled", "position", "startsAt", "endsAt", "imageUrl", "backgroundColor", "textColor", "targetType", "targetValue", "channelId", "internalName", "layoutVariant", "settings", "imageAssetId" FROM "temporary_storefront_content_block"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_content_block"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_block_channel_code" ON "storefront_content_block" ("channelId", "code") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_channel" ON "storefront_content_block" ("channelId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_image_asset" ON "storefront_content_block" ("imageAssetId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_channel_position" ON "storefront_content_block" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_item_image_asset"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_content_item" RENAME TO "temporary_storefront_content_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_content_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (1), "position" int NOT NULL DEFAULT (0), "imageUrl" varchar(2048), "targetType" varchar(32) NOT NULL DEFAULT ('NONE'), "targetValue" varchar(2048), "blockId" integer NOT NULL, "settings" text, "imageAssetId" integer, CONSTRAINT "FK_storefront_content_item_image_asset" FOREIGN KEY ("imageAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_content_item_block" FOREIGN KEY ("blockId") REFERENCES "storefront_content_block" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_content_item"("id", "createdAt", "updatedAt", "enabled", "position", "imageUrl", "targetType", "targetValue", "blockId", "settings", "imageAssetId") SELECT "id", "createdAt", "updatedAt", "enabled", "position", "imageUrl", "targetType", "targetValue", "blockId", "settings", "imageAssetId" FROM "temporary_storefront_content_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_content_item"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_item_image_asset" ON "storefront_content_item" ("imageAssetId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_item_block_position" ON "storefront_content_item" ("blockId", "position") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_item_translation_language"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_content_item_translation" RENAME TO "temporary_storefront_content_item_translation"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_content_item_translation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "languageCode" varchar(16) NOT NULL, "label" varchar(255) NOT NULL DEFAULT (''), "description" text NOT NULL DEFAULT (''), "baseId" integer NOT NULL, CONSTRAINT "FK_storefront_content_item_translation_base" FOREIGN KEY ("baseId") REFERENCES "storefront_content_item" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_content_item_translation"("id", "createdAt", "updatedAt", "languageCode", "label", "description", "baseId") SELECT "id", "createdAt", "updatedAt", "languageCode", "label", "description", "baseId" FROM "temporary_storefront_content_item_translation"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_content_item_translation"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_item_translation_language" ON "storefront_content_item_translation" ("baseId", "languageCode") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_translation_language"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_content_block_translation" RENAME TO "temporary_storefront_content_block_translation"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_content_block_translation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "languageCode" varchar(16) NOT NULL, "title" varchar(255) NOT NULL DEFAULT (''), "subtitle" varchar(500) NOT NULL DEFAULT (''), "body" text NOT NULL DEFAULT (''), "ctaLabel" varchar(120) NOT NULL DEFAULT (''), "baseId" integer NOT NULL, CONSTRAINT "FK_storefront_content_block_translation_base" FOREIGN KEY ("baseId") REFERENCES "storefront_content_block" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_content_block_translation"("id", "createdAt", "updatedAt", "languageCode", "title", "subtitle", "body", "ctaLabel", "baseId") SELECT "id", "createdAt", "updatedAt", "languageCode", "title", "subtitle", "body", "ctaLabel", "baseId" FROM "temporary_storefront_content_block_translation"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_content_block_translation"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_block_translation_language" ON "storefront_content_block_translation" ("baseId", "languageCode") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_daily_visitor_identity"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_daily_visitor_channel_date"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_daily_visitor" RENAME TO "temporary_storefront_daily_visitor"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_daily_visitor" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "customerId" integer, "businessDate" varchar(10) NOT NULL, "visitorKeyHash" varchar(64) NOT NULL, "firstSeenAt" datetime NOT NULL, "lastSeenAt" datetime NOT NULL, "visitCount" int NOT NULL DEFAULT (1), CONSTRAINT "FK_storefront_daily_visitor_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_daily_visitor_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_daily_visitor"("id", "createdAt", "updatedAt", "channelId", "customerId", "businessDate", "visitorKeyHash", "firstSeenAt", "lastSeenAt", "visitCount") SELECT "id", "createdAt", "updatedAt", "channelId", "customerId", "businessDate", "visitorKeyHash", "firstSeenAt", "lastSeenAt", "visitCount" FROM "temporary_storefront_daily_visitor"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_daily_visitor"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_daily_visitor_identity" ON "storefront_daily_visitor" ("channelId", "businessDate", "visitorKeyHash") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_daily_visitor_channel_date" ON "storefront_daily_visitor" ("channelId", "businessDate") `,
            undefined,
        );
        await queryRunner.query(
            `ALTER TABLE "referral_poster_template" RENAME TO "temporary_referral_poster_template"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "referral_poster_template" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "name" varchar(128) NOT NULL, "enabled" boolean NOT NULL DEFAULT (1), "position" int NOT NULL DEFAULT (0), "layoutVariant" varchar(32) NOT NULL DEFAULT ('STANDARD_CENTER'), "posterBackgroundAssetId" integer, "shareBackgroundAssetId" integer, "titleZh" varchar(80) NOT NULL DEFAULT ('好友邀请函'), "titleEn" varchar(80) NOT NULL DEFAULT ('Invitation for friends'), "headlineZh" varchar(180) NOT NULL DEFAULT ('发现好东西，一起分享'), "headlineEn" varchar(180) NOT NULL DEFAULT ('Discover something worth sharing'), "rewardTextZh" varchar(220) NOT NULL DEFAULT ('好友成功消费，可获得 {rewardRate}% 奖励用于消费抵扣'), "rewardTextEn" varchar(220) NOT NULL DEFAULT ('Earn {rewardRate}% in rewards when a friend makes a purchase'), "siteIntroZh" varchar(260) NOT NULL DEFAULT (''), "siteIntroEn" varchar(260) NOT NULL DEFAULT (''), "serviceTextZh" varchar(260) NOT NULL DEFAULT ('好物严选 · 便捷消费 · 售后服务'), "serviceTextEn" varchar(260) NOT NULL DEFAULT ('Curated products · Easy shopping · Customer support'), "foregroundColor" varchar(16) NOT NULL DEFAULT ('#FFFFFF'), "accentColor" varchar(16) NOT NULL DEFAULT ('#FF4D4F'), "overlayOpacity" int NOT NULL DEFAULT (28), CONSTRAINT "FK_referral_poster_template_share_asset" FOREIGN KEY ("shareBackgroundAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_referral_poster_template_poster_asset" FOREIGN KEY ("posterBackgroundAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_referral_poster_template_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "referral_poster_template"("createdAt", "updatedAt", "id", "channelId", "name", "enabled", "position", "layoutVariant", "posterBackgroundAssetId", "shareBackgroundAssetId", "titleZh", "titleEn", "headlineZh", "headlineEn", "rewardTextZh", "rewardTextEn", "siteIntroZh", "siteIntroEn", "serviceTextZh", "serviceTextEn", "foregroundColor", "accentColor", "overlayOpacity") SELECT "createdAt", "updatedAt", "id", "channelId", "name", "enabled", "position", "layoutVariant", "posterBackgroundAssetId", "shareBackgroundAssetId", "titleZh", "titleEn", "headlineZh", "headlineEn", "rewardTextZh", "rewardTextEn", "siteIntroZh", "siteIntroEn", "serviceTextZh", "serviceTextEn", "foregroundColor", "accentColor", "overlayOpacity" FROM "temporary_referral_poster_template"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_referral_poster_template"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_poster_template_channel_position" ON "referral_poster_template" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_balance_use_channel_order"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "referral_balance_use" RENAME TO "temporary_referral_balance_use"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "referral_balance_use" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "walletId" integer NOT NULL, "customerId" integer NOT NULL, "orderId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "amount" int NOT NULL, "refundedAmount" int NOT NULL DEFAULT (0), "status" varchar(24) NOT NULL DEFAULT ('RESERVED'), "reservedAt" datetime NOT NULL, "capturedAt" datetime, "releasedAt" datetime, CONSTRAINT "FK_referral_balance_use_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_balance_use_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_balance_use_wallet" FOREIGN KEY ("walletId") REFERENCES "referral_wallet" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_balance_use_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "referral_balance_use"("id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "orderId", "currencyCode", "amount", "refundedAmount", "status", "reservedAt", "capturedAt", "releasedAt") SELECT "id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "orderId", "currencyCode", "amount", "refundedAmount", "status", "reservedAt", "capturedAt", "releasedAt" FROM "temporary_referral_balance_use"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_referral_balance_use"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_balance_use_channel_order" ON "referral_balance_use" ("channelId", "orderId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_coupon_allocation_order_coupon"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_allocation_campaign_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_allocation_customer_created"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "coupon_order_allocation" RENAME TO "temporary_coupon_order_allocation"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "coupon_order_allocation" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "customerCouponId" integer NOT NULL, "promotionId" integer NOT NULL, "customerId" integer NOT NULL, "orderId" integer NOT NULL, "refundId" integer, "status" varchar(16) NOT NULL DEFAULT ('LOCKED'), "campaignName" varchar(120) NOT NULL, "currencyCode" varchar(3) NOT NULL, "discountAmount" int NOT NULL DEFAULT (0), "discountAmountWithTax" int NOT NULL DEFAULT (0), "refundedAmount" int NOT NULL DEFAULT (0), "orderTotalWithTax" int NOT NULL DEFAULT (0), "lineAllocations" text, "appliedAt" datetime NOT NULL, "usedAt" datetime, "releasedAt" datetime, "refundedAt" datetime, CONSTRAINT "FK_coupon_allocation_refund" FOREIGN KEY ("refundId") REFERENCES "refund" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_allocation_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_allocation_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_allocation_promotion" FOREIGN KEY ("promotionId") REFERENCES "promotion" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_allocation_coupon" FOREIGN KEY ("customerCouponId") REFERENCES "customer_coupon" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_allocation_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "coupon_order_allocation"("id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "status", "campaignName", "currencyCode", "discountAmount", "discountAmountWithTax", "refundedAmount", "orderTotalWithTax", "lineAllocations", "appliedAt", "usedAt", "releasedAt", "refundedAt") SELECT "id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "status", "campaignName", "currencyCode", "discountAmount", "discountAmountWithTax", "refundedAmount", "orderTotalWithTax", "lineAllocations", "appliedAt", "usedAt", "releasedAt", "refundedAt" FROM "temporary_coupon_order_allocation"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_coupon_order_allocation"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_coupon_allocation_order_coupon" ON "coupon_order_allocation" ("orderId", "customerCouponId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_allocation_campaign_created" ON "coupon_order_allocation" ("promotionId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_allocation_customer_created" ON "coupon_order_allocation" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_channel_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_coupon_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_campaign_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_idempotency"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "coupon_ledger_entry" RENAME TO "temporary_coupon_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "coupon_ledger_entry" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "customerCouponId" integer NOT NULL, "promotionId" integer NOT NULL, "customerId" integer NOT NULL, "orderId" integer, "refundId" integer, "eventType" varchar(24) NOT NULL, "actorType" varchar(16) NOT NULL, "idempotencyKey" varchar(255), "discountAmount" int, "note" varchar(500), "metadata" text, CONSTRAINT "FK_coupon_ledger_refund" FOREIGN KEY ("refundId") REFERENCES "refund" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_promotion" FOREIGN KEY ("promotionId") REFERENCES "promotion" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_coupon" FOREIGN KEY ("customerCouponId") REFERENCES "customer_coupon" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "coupon_ledger_entry"("id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "eventType", "actorType", "idempotencyKey", "discountAmount", "note", "metadata") SELECT "id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "eventType", "actorType", "idempotencyKey", "discountAmount", "note", "metadata" FROM "temporary_coupon_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_coupon_ledger_entry"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_channel_created" ON "coupon_ledger_entry" ("channelId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_coupon_created" ON "coupon_ledger_entry" ("customerCouponId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_campaign_created" ON "coupon_ledger_entry" ("promotionId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_coupon_ledger_idempotency" ON "coupon_ledger_entry" ("idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_campaign_customer"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_customer_status_valid"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_locked_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_used_order"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "customer_coupon" RENAME TO "temporary_customer_coupon"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "customer_coupon" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "campaignConfigId" integer NOT NULL, "promotionId" integer NOT NULL, "customerId" integer NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('AVAILABLE'), "campaignName" varchar(120) NOT NULL, "campaignKind" varchar(32) NOT NULL, "minimumSpend" int NOT NULL DEFAULT (0), "discountAmount" int, "discountRate" float, "claimedAt" datetime NOT NULL, "validFrom" datetime NOT NULL, "validUntil" datetime, "lockedAt" datetime, "lockExpiresAt" datetime, "lockedOrderId" integer, "usedAt" datetime, "usedOrderId" integer, "returnedAt" datetime, "expiredAt" datetime, "revokedAt" datetime, "returnCount" int NOT NULL DEFAULT (0), "version" int NOT NULL, CONSTRAINT "FK_customer_coupon_used_order" FOREIGN KEY ("usedOrderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_locked_order" FOREIGN KEY ("lockedOrderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_promotion" FOREIGN KEY ("promotionId") REFERENCES "promotion" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_config" FOREIGN KEY ("campaignConfigId") REFERENCES "store_coupon_campaign_config" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "customer_coupon"("id", "createdAt", "updatedAt", "channelId", "campaignConfigId", "promotionId", "customerId", "status", "campaignName", "campaignKind", "minimumSpend", "discountAmount", "discountRate", "claimedAt", "validFrom", "validUntil", "lockedAt", "lockExpiresAt", "lockedOrderId", "usedAt", "usedOrderId", "returnedAt", "expiredAt", "revokedAt", "returnCount", "version") SELECT "id", "createdAt", "updatedAt", "channelId", "campaignConfigId", "promotionId", "customerId", "status", "campaignName", "campaignKind", "minimumSpend", "discountAmount", "discountRate", "claimedAt", "validFrom", "validUntil", "lockedAt", "lockExpiresAt", "lockedOrderId", "usedAt", "usedOrderId", "returnedAt", "expiredAt", "revokedAt", "returnCount", "version" FROM "temporary_customer_coupon"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_customer_coupon"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_customer_coupon_campaign_customer" ON "customer_coupon" ("promotionId", "customerId", "claimedAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_customer_coupon_customer_status_valid" ON "customer_coupon" ("customerId", "status", "validUntil") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_customer_coupon_locked_order" ON "customer_coupon" ("lockedOrderId", "status") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_customer_coupon_used_order" ON "customer_coupon" ("usedOrderId", "status") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_store_coupon_campaign_config_promotion"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_coupon_campaign_config_channel_claim"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "store_coupon_campaign_config" RENAME TO "temporary_store_coupon_campaign_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "store_coupon_campaign_config" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "promotionId" integer NOT NULL, "claimStartsAt" datetime, "claimEndsAt" datetime, "validityDays" int, "issueLimit" int, "perCustomerClaimLimit" int NOT NULL DEFAULT (1), "stackPolicy" varchar(16) NOT NULL DEFAULT ('EXCLUSIVE'), "returnOnCancellation" boolean NOT NULL DEFAULT (1), "returnOnFullRefund" boolean NOT NULL DEFAULT (1), CONSTRAINT "FK_store_coupon_config_promotion" FOREIGN KEY ("promotionId") REFERENCES "promotion" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_store_coupon_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "store_coupon_campaign_config"("id", "createdAt", "updatedAt", "channelId", "promotionId", "claimStartsAt", "claimEndsAt", "validityDays", "issueLimit", "perCustomerClaimLimit", "stackPolicy", "returnOnCancellation", "returnOnFullRefund") SELECT "id", "createdAt", "updatedAt", "channelId", "promotionId", "claimStartsAt", "claimEndsAt", "validityDays", "issueLimit", "perCustomerClaimLimit", "stackPolicy", "returnOnCancellation", "returnOnFullRefund" FROM "temporary_store_coupon_campaign_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_store_coupon_campaign_config"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_coupon_campaign_config_promotion" ON "store_coupon_campaign_config" ("promotionId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_coupon_campaign_config_channel_claim" ON "store_coupon_campaign_config" ("channelId", "claimStartsAt", "claimEndsAt") `,
            undefined,
        );
        await queryRunner.query(
            `ALTER TABLE "system_announcement" RENAME TO "temporary_system_announcement"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "system_announcement" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (1), "priority" int NOT NULL DEFAULT (0), "titleZh" varchar(120) NOT NULL, "titleEn" varchar(120) NOT NULL DEFAULT (''), "contentZh" text NOT NULL, "contentEn" text NOT NULL, "linkUrl" varchar(500), "startsAt" datetime, "endsAt" datetime)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "system_announcement"("id", "createdAt", "updatedAt", "enabled", "priority", "titleZh", "titleEn", "contentZh", "contentEn", "linkUrl", "startsAt", "endsAt") SELECT "id", "createdAt", "updatedAt", "enabled", "priority", "titleZh", "titleEn", "contentZh", "contentEn", "linkUrl", "startsAt", "endsAt" FROM "temporary_system_announcement"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_system_announcement"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_system_announcement_schedule" ON "system_announcement" ("enabled", "startsAt", "endsAt", "priority") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_quote"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_match_key"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_transaction"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_status_expiry"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_usdt_payment_intent" RENAME TO "temporary_storefront_usdt_payment_intent"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_usdt_payment_intent" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "orderId" integer NOT NULL, "quoteId" integer NOT NULL, "paymentId" integer, "network" varchar(16) NOT NULL, "tokenContractAddress" varchar(64) NOT NULL, "receivingAddress" varchar(64) NOT NULL, "receivingAddressFingerprint" varchar(64) NOT NULL, "matchKey" varchar(64) NOT NULL, "baseUsdtAmount" decimal(24,6) NOT NULL, "expectedUsdtAmount" decimal(24,6) NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "transactionId" varchar(80), "senderAddress" varchar(64), "receivedUsdtAmount" decimal(24,6), "blockNumber" int, "blockTimestamp" datetime, "lastCheckedAt" datetime, "settledAt" datetime, "failureReason" varchar(500), "expiresAt" datetime NOT NULL, CONSTRAINT "FK_storefront_usdt_intent_payment" FOREIGN KEY ("paymentId") REFERENCES "payment" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_quote" FOREIGN KEY ("quoteId") REFERENCES "storefront_usdt_checkout_quote" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_usdt_payment_intent"("createdAt", "updatedAt", "id", "channelId", "orderId", "quoteId", "paymentId", "network", "tokenContractAddress", "receivingAddress", "receivingAddressFingerprint", "matchKey", "baseUsdtAmount", "expectedUsdtAmount", "status", "transactionId", "senderAddress", "receivedUsdtAmount", "blockNumber", "blockTimestamp", "lastCheckedAt", "settledAt", "failureReason", "expiresAt") SELECT "createdAt", "updatedAt", "id", "channelId", "orderId", "quoteId", "paymentId", "network", "tokenContractAddress", "receivingAddress", "receivingAddressFingerprint", "matchKey", "baseUsdtAmount", "expectedUsdtAmount", "status", "transactionId", "senderAddress", "receivedUsdtAmount", "blockNumber", "blockTimestamp", "lastCheckedAt", "settledAt", "failureReason", "expiresAt" FROM "temporary_storefront_usdt_payment_intent"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_usdt_payment_intent"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_quote" ON "storefront_usdt_payment_intent" ("quoteId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_match_key" ON "storefront_usdt_payment_intent" ("matchKey") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_transaction" ON "storefront_usdt_payment_intent" ("transactionId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_usdt_intent_status_expiry" ON "storefront_usdt_payment_intent" ("status", "expiresAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_quote_order_expiry"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_usdt_checkout_quote" RENAME TO "temporary_storefront_usdt_checkout_quote"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_usdt_checkout_quote" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "orderId" integer NOT NULL, "fiatCurrencyCode" varchar(3) NOT NULL, "fiatAmount" int NOT NULL, "fiatPerUsdtRate" float NOT NULL, "markupBps" int NOT NULL DEFAULT (0), "usdtAmount" decimal(24,6) NOT NULL, "source" varchar(120) NOT NULL, "expiresAt" datetime NOT NULL, CONSTRAINT "FK_storefront_usdt_quote_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_quote_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_usdt_checkout_quote"("createdAt", "updatedAt", "id", "channelId", "orderId", "fiatCurrencyCode", "fiatAmount", "fiatPerUsdtRate", "markupBps", "usdtAmount", "source", "expiresAt") SELECT "createdAt", "updatedAt", "id", "channelId", "orderId", "fiatCurrencyCode", "fiatAmount", "fiatPerUsdtRate", "markupBps", "usdtAmount", "source", "expiresAt" FROM "temporary_storefront_usdt_checkout_quote"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_usdt_checkout_quote"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_usdt_quote_order_expiry" ON "storefront_usdt_checkout_quote" ("orderId", "expiresAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_promotion_page_channel"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_promotion_page" RENAME TO "temporary_storefront_promotion_page"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_promotion_page" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "contentType" varchar(16) NOT NULL DEFAULT ('HTML'), "draftSource" text, "publishedContentType" varchar(16) NOT NULL DEFAULT ('HTML'), "publishedSource" text, "isCustomized" boolean NOT NULL DEFAULT (0), "defaultTemplateVersion" int NOT NULL DEFAULT (1), "publishedVersion" int NOT NULL DEFAULT (0), "publishedAt" datetime, CONSTRAINT "FK_storefront_promotion_page_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_promotion_page"("id", "createdAt", "updatedAt", "channelId", "contentType", "draftSource", "publishedContentType", "publishedSource", "isCustomized", "defaultTemplateVersion", "publishedVersion", "publishedAt") SELECT "id", "createdAt", "updatedAt", "channelId", "contentType", "draftSource", "publishedContentType", "publishedSource", "isCustomized", "defaultTemplateVersion", "publishedVersion", "publishedAt" FROM "temporary_storefront_promotion_page"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_promotion_page"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_promotion_page_channel" ON "storefront_promotion_page" ("channelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_store_profile_logo_asset"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_profile_channel"`, undefined);
        await queryRunner.query(`ALTER TABLE "store_profile" RENAME TO "temporary_store_profile"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "store_profile" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "status" varchar(20) NOT NULL DEFAULT ('DRAFT'), "isPublished" boolean NOT NULL DEFAULT (0), "sortOrder" int NOT NULL DEFAULT (0), "descriptionZh" text NOT NULL, "descriptionEn" text NOT NULL, "logoAssetId" integer, "internalNote" text, CONSTRAINT "FK_store_profile_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_store_profile_logo_asset" FOREIGN KEY ("logoAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "store_profile"("id", "createdAt", "updatedAt", "channelId", "status", "isPublished", "sortOrder", "descriptionZh", "descriptionEn", "logoAssetId", "internalNote") SELECT "id", "createdAt", "updatedAt", "channelId", "status", "isPublished", "sortOrder", "descriptionZh", "descriptionEn", "logoAssetId", "internalNote" FROM "temporary_store_profile"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_store_profile"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_store_profile_logo_asset" ON "store_profile" ("logoAssetId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_profile_channel" ON "store_profile" ("channelId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_profile_public_order" ON "store_profile" ("status", "isPublished", "sortOrder") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_store_administrator_access_administrator"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_administrator_access_user"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "store_administrator_access" RENAME TO "temporary_store_administrator_access"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "store_administrator_access" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "administratorId" integer NOT NULL, "userId" integer NOT NULL, "mustChangePassword" boolean NOT NULL DEFAULT (true), CONSTRAINT "FK_store_administrator_access_administrator" FOREIGN KEY ("administratorId") REFERENCES "administrator" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "store_administrator_access"("id", "createdAt", "updatedAt", "administratorId", "userId", "mustChangePassword") SELECT "id", "createdAt", "updatedAt", "administratorId", "userId", "mustChangePassword" FROM "temporary_store_administrator_access"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_store_administrator_access"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_administrator_access_administrator" ON "store_administrator_access" ("administratorId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_administrator_access_user" ON "store_administrator_access" ("userId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_withdrawal_code"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_withdrawal_channel_status_created"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "referral_withdrawal" RENAME TO "temporary_referral_withdrawal"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "referral_withdrawal" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "walletId" integer NOT NULL, "customerId" integer NOT NULL, "code" varchar(32) NOT NULL, "currencyCode" varchar(3) NOT NULL, "amount" int NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "payoutMethod" varchar(32) NOT NULL, "payoutAccountMasked" varchar(160) NOT NULL, "externalReference" varchar(160), "note" varchar(500), "requestedByAdministratorId" integer, "processedByAdministratorId" integer, "approvedAt" datetime, "paidAt" datetime, "rejectedAt" datetime, "cancelledAt" datetime, CONSTRAINT "FK_referral_withdrawal_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_withdrawal_wallet" FOREIGN KEY ("walletId") REFERENCES "referral_wallet" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_withdrawal_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "referral_withdrawal"("id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "code", "currencyCode", "amount", "status", "payoutMethod", "payoutAccountMasked", "externalReference", "note", "requestedByAdministratorId", "processedByAdministratorId", "approvedAt", "paidAt", "rejectedAt", "cancelledAt") SELECT "id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "code", "currencyCode", "amount", "status", "payoutMethod", "payoutAccountMasked", "externalReference", "note", "requestedByAdministratorId", "processedByAdministratorId", "approvedAt", "paidAt", "rejectedAt", "cancelledAt" FROM "temporary_referral_withdrawal"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_referral_withdrawal"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_withdrawal_code" ON "referral_withdrawal" ("code") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_withdrawal_channel_status_created" ON "referral_withdrawal" ("channelId", "status", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_wallet_usage_idempotency"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_wallet_usage_resource"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_wallet_usage_customer_created"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "referral_wallet_usage" RENAME TO "temporary_referral_wallet_usage"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "referral_wallet_usage" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "walletId" integer NOT NULL, "customerId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "resourceType" varchar(48) NOT NULL, "resourceId" varchar(128) NOT NULL, "idempotencyKey" varchar(255) NOT NULL, "amount" int NOT NULL, "capturedAmount" int NOT NULL DEFAULT (0), "releasedAmount" int NOT NULL DEFAULT (0), "status" varchar(24) NOT NULL DEFAULT ('RESERVED'), "reservedAt" datetime NOT NULL, "settledAt" datetime, "metadata" text, "version" int NOT NULL DEFAULT (1), CONSTRAINT "FK_referral_wallet_usage_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_wallet_usage_wallet" FOREIGN KEY ("walletId") REFERENCES "referral_wallet" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_wallet_usage_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "referral_wallet_usage"("createdAt", "updatedAt", "id", "channelId", "walletId", "customerId", "currencyCode", "resourceType", "resourceId", "idempotencyKey", "amount", "capturedAmount", "releasedAmount", "status", "reservedAt", "settledAt", "metadata", "version") SELECT "createdAt", "updatedAt", "id", "channelId", "walletId", "customerId", "currencyCode", "resourceType", "resourceId", "idempotencyKey", "amount", "capturedAmount", "releasedAmount", "status", "reservedAt", "settledAt", "metadata", "version" FROM "temporary_referral_wallet_usage"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_referral_wallet_usage"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_wallet_usage_idempotency" ON "referral_wallet_usage" ("idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_wallet_usage_resource" ON "referral_wallet_usage" ("channelId", "resourceType", "resourceId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_wallet_usage_customer_created" ON "referral_wallet_usage" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_reward_channel_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_reward_inviter_available"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "referral_reward" RENAME TO "temporary_referral_reward"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "referral_reward" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "inviterCustomerId" integer NOT NULL, "inviteeCustomerId" integer NOT NULL, "orderId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "rewardRateBps" int NOT NULL, "eligibleAmount" int NOT NULL, "rewardAmount" int NOT NULL, "releasedAmount" int NOT NULL DEFAULT (0), "clawedBackAmount" int NOT NULL DEFAULT (0), "settledRefundTotal" int NOT NULL DEFAULT (0), "orderTotalWithTax" int NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "earnedAt" datetime NOT NULL, "availableAt" datetime NOT NULL, "releasedAt" datetime, "settledEligibleRefundTotal" integer NOT NULL DEFAULT (0), CONSTRAINT "FK_referral_reward_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_invitee" FOREIGN KEY ("inviteeCustomerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_inviter" FOREIGN KEY ("inviterCustomerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "referral_reward"("id", "createdAt", "updatedAt", "channelId", "inviterCustomerId", "inviteeCustomerId", "orderId", "currencyCode", "rewardRateBps", "eligibleAmount", "rewardAmount", "releasedAmount", "clawedBackAmount", "settledRefundTotal", "orderTotalWithTax", "status", "earnedAt", "availableAt", "releasedAt", "settledEligibleRefundTotal") SELECT "id", "createdAt", "updatedAt", "channelId", "inviterCustomerId", "inviteeCustomerId", "orderId", "currencyCode", "rewardRateBps", "eligibleAmount", "rewardAmount", "releasedAmount", "clawedBackAmount", "settledRefundTotal", "orderTotalWithTax", "status", "earnedAt", "availableAt", "releasedAt", "settledEligibleRefundTotal" FROM "temporary_referral_reward"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_referral_reward"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_reward_channel_order" ON "referral_reward" ("channelId", "orderId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_reward_inviter_available" ON "referral_reward" ("inviterCustomerId", "availableAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_program_config_channel"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "referral_program_config" RENAME TO "temporary_referral_program_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "referral_program_config" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "enabled" boolean NOT NULL DEFAULT (0), "rewardRateBps" int NOT NULL DEFAULT (500), "releaseDelayDays" int NOT NULL DEFAULT (7), "minimumOrderAmount" int NOT NULL DEFAULT (0), "maxRewardPerOrder" int, "allowBalanceSpend" boolean NOT NULL DEFAULT (1), "attributionWindowDays" int NOT NULL DEFAULT (30), "defaultPosterTemplate" varchar(64) NOT NULL DEFAULT ('BRAND_MINIMAL'), CONSTRAINT "FK_referral_program_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "referral_program_config"("id", "createdAt", "updatedAt", "channelId", "enabled", "rewardRateBps", "releaseDelayDays", "minimumOrderAmount", "maxRewardPerOrder", "allowBalanceSpend", "attributionWindowDays", "defaultPosterTemplate") SELECT "id", "createdAt", "updatedAt", "channelId", "enabled", "rewardRateBps", "releaseDelayDays", "minimumOrderAmount", "maxRewardPerOrder", "allowBalanceSpend", "attributionWindowDays", "defaultPosterTemplate" FROM "temporary_referral_program_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_referral_program_config"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_program_config_channel" ON "referral_program_config" ("channelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_ledger_idempotency"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_ledger_channel_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_ledger_customer_created"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "referral_ledger_entry" RENAME TO "temporary_referral_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "referral_ledger_entry" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "walletId" integer NOT NULL, "customerId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "eventType" varchar(32) NOT NULL, "availableDelta" int NOT NULL DEFAULT (0), "pendingDelta" int NOT NULL DEFAULT (0), "reservedDelta" int NOT NULL DEFAULT (0), "availableAfter" int NOT NULL, "pendingAfter" int NOT NULL, "reservedAfter" int NOT NULL, "idempotencyKey" varchar(255) NOT NULL, "orderId" integer, "refundId" integer, "withdrawalId" integer, "actorId" integer, "actorType" varchar(16) NOT NULL DEFAULT ('SYSTEM'), "note" varchar(500), "metadata" text, CONSTRAINT "FK_referral_ledger_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_ledger_wallet" FOREIGN KEY ("walletId") REFERENCES "referral_wallet" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_ledger_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "referral_ledger_entry"("id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "currencyCode", "eventType", "availableDelta", "pendingDelta", "reservedDelta", "availableAfter", "pendingAfter", "reservedAfter", "idempotencyKey", "orderId", "refundId", "withdrawalId", "actorId", "actorType", "note", "metadata") SELECT "id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "currencyCode", "eventType", "availableDelta", "pendingDelta", "reservedDelta", "availableAfter", "pendingAfter", "reservedAfter", "idempotencyKey", "orderId", "refundId", "withdrawalId", "actorId", "actorType", "note", "metadata" FROM "temporary_referral_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_referral_ledger_entry"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_ledger_idempotency" ON "referral_ledger_entry" ("idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_ledger_channel_created" ON "referral_ledger_entry" ("channelId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_ledger_customer_created" ON "referral_ledger_entry" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_wallet_account_currency"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_wallet_channel_customer"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "referral_wallet" RENAME TO "temporary_referral_wallet"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "referral_wallet" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "referralAccountId" integer NOT NULL, "customerId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "availableBalance" int NOT NULL DEFAULT (0), "pendingBalance" int NOT NULL DEFAULT (0), "reservedBalance" int NOT NULL DEFAULT (0), "version" int NOT NULL, CONSTRAINT "FK_referral_wallet_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_wallet_account" FOREIGN KEY ("referralAccountId") REFERENCES "referral_account" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_wallet_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "referral_wallet"("id", "createdAt", "updatedAt", "channelId", "referralAccountId", "customerId", "currencyCode", "availableBalance", "pendingBalance", "reservedBalance", "version") SELECT "id", "createdAt", "updatedAt", "channelId", "referralAccountId", "customerId", "currencyCode", "availableBalance", "pendingBalance", "reservedBalance", "version" FROM "temporary_referral_wallet"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_referral_wallet"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_wallet_account_currency" ON "referral_wallet" ("referralAccountId", "currencyCode") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_wallet_channel_customer" ON "referral_wallet" ("channelId", "customerId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_prompt_skill_hash"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "image_prompt_skill_release" RENAME TO "temporary_image_prompt_skill_release"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "image_prompt_skill_release" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "bundleVersion" int NOT NULL, "sourceHash" varchar(64) NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('INACTIVE'), "bundle" text NOT NULL, "activatedAt" datetime)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "image_prompt_skill_release"("createdAt", "updatedAt", "id", "bundleVersion", "sourceHash", "status", "bundle", "activatedAt") SELECT "createdAt", "updatedAt", "id", "bundleVersion", "sourceHash", "status", "bundle", "activatedAt" FROM "temporary_image_prompt_skill_release"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_image_prompt_skill_release"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_prompt_skill_hash" ON "image_prompt_skill_release" ("sourceHash") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_job_idempotency"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_job_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_job_state_created"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "image_generation_job" RENAME TO "temporary_image_generation_job"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "image_generation_job" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "customerId" integer NOT NULL, "modelConfigId" integer NOT NULL, "referenceAssetId" integer, "idempotencyKey" varchar(64) NOT NULL, "modelCodeSnapshot" varchar(48) NOT NULL, "modelNameSnapshot" varchar(120) NOT NULL, "officialModelIdSnapshot" varchar(160) NOT NULL, "providerModelIdSnapshot" varchar(160) NOT NULL, "protocolSnapshot" varchar(32) NOT NULL, "originalPrompt" text NOT NULL, "finalPrompt" text NOT NULL, "promptSpec" text, "promptSkillHash" varchar(64) NOT NULL, "referenceMode" varchar(24) NOT NULL DEFAULT ('NONE'), "aspectRatio" varchar(8) NOT NULL, "quantity" int NOT NULL, "unitPriceSnapshot" int NOT NULL, "reservedAmount" int NOT NULL, "capturedAmount" int NOT NULL DEFAULT (0), "releasedAmount" int NOT NULL DEFAULT (0), "currencyCode" varchar(3) NOT NULL, "walletUsageId" integer, "state" varchar(24) NOT NULL DEFAULT ('QUEUED'), "termsVersion" varchar(32) NOT NULL, "termsAcceptedAt" datetime NOT NULL, "errorMessage" varchar(500), "completedAt" datetime, "version" int NOT NULL DEFAULT (1), CONSTRAINT "FK_image_generation_job_reference" FOREIGN KEY ("referenceAssetId") REFERENCES "image_private_asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_job_model" FOREIGN KEY ("modelConfigId") REFERENCES "image_model_config" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_job_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_job_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "image_generation_job"("createdAt", "updatedAt", "id", "channelId", "customerId", "modelConfigId", "referenceAssetId", "idempotencyKey", "modelCodeSnapshot", "modelNameSnapshot", "officialModelIdSnapshot", "providerModelIdSnapshot", "protocolSnapshot", "originalPrompt", "finalPrompt", "promptSpec", "promptSkillHash", "referenceMode", "aspectRatio", "quantity", "unitPriceSnapshot", "reservedAmount", "capturedAmount", "releasedAmount", "currencyCode", "walletUsageId", "state", "termsVersion", "termsAcceptedAt", "errorMessage", "completedAt", "version") SELECT "createdAt", "updatedAt", "id", "channelId", "customerId", "modelConfigId", "referenceAssetId", "idempotencyKey", "modelCodeSnapshot", "modelNameSnapshot", "officialModelIdSnapshot", "providerModelIdSnapshot", "protocolSnapshot", "originalPrompt", "finalPrompt", "promptSpec", "promptSkillHash", "referenceMode", "aspectRatio", "quantity", "unitPriceSnapshot", "reservedAmount", "capturedAmount", "releasedAmount", "currencyCode", "walletUsageId", "state", "termsVersion", "termsAcceptedAt", "errorMessage", "completedAt", "version" FROM "temporary_image_generation_job"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_image_generation_job"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_job_idempotency" ON "image_generation_job" ("channelId", "customerId", "idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_generation_job_customer_created" ON "image_generation_job" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_generation_job_state_created" ON "image_generation_job" ("state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_model_config_channel_code"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "image_model_config" RENAME TO "temporary_image_model_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "image_model_config" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "code" varchar(48) NOT NULL, "enabled" boolean NOT NULL DEFAULT (0), "displayNameZh" varchar(120) NOT NULL, "displayNameEn" varchar(120) NOT NULL, "officialModelId" varchar(160) NOT NULL, "providerModelId" varchar(160) NOT NULL, "protocol" varchar(32) NOT NULL, "unitPrice" int NOT NULL DEFAULT (0), "currencyCode" varchar(3) NOT NULL, "position" int NOT NULL DEFAULT (0), "isDefault" boolean NOT NULL DEFAULT (0), "healthStatus" varchar(24) NOT NULL DEFAULT ('UNTESTED'), "descriptionZh" varchar(500) NOT NULL, "descriptionEn" varchar(500) NOT NULL, "healthMessage" varchar(500), "lastTestedAt" datetime, CONSTRAINT "FK_image_model_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "image_model_config"("createdAt", "updatedAt", "id", "channelId", "code", "enabled", "displayNameZh", "displayNameEn", "officialModelId", "providerModelId", "protocol", "unitPrice", "currencyCode", "position", "isDefault", "healthStatus", "descriptionZh", "descriptionEn", "healthMessage", "lastTestedAt") SELECT "createdAt", "updatedAt", "id", "channelId", "code", "enabled", "displayNameZh", "displayNameEn", "officialModelId", "providerModelId", "protocol", "unitPrice", "currencyCode", "position", "isDefault", "healthStatus", "descriptionZh", "descriptionEn", "healthMessage", "lastTestedAt" FROM "temporary_image_model_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_image_model_config"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_model_config_channel_code" ON "image_model_config" ("channelId", "code") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_model_config_channel_position" ON "image_model_config" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_output_state_updated"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "image_generation_output" RENAME TO "temporary_image_generation_output"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "image_generation_output" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "jobId" integer NOT NULL, "outputIndex" int NOT NULL, "state" varchar(24) NOT NULL DEFAULT ('QUEUED'), "attemptCount" int NOT NULL DEFAULT (0), "providerIdempotencyKey" varchar(160) NOT NULL, "providerRequestId" varchar(200), "assetId" integer, "errorMessage" varchar(500), "unknownAt" datetime, "completedAt" datetime, "walletSettled" boolean NOT NULL DEFAULT (0), "refundedAt" datetime, "version" int NOT NULL DEFAULT (1), CONSTRAINT "FK_image_generation_output_asset" FOREIGN KEY ("assetId") REFERENCES "image_private_asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_output_job" FOREIGN KEY ("jobId") REFERENCES "image_generation_job" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "image_generation_output"("createdAt", "updatedAt", "id", "jobId", "outputIndex", "state", "attemptCount", "providerIdempotencyKey", "providerRequestId", "assetId", "errorMessage", "unknownAt", "completedAt", "walletSettled", "refundedAt", "version") SELECT "createdAt", "updatedAt", "id", "jobId", "outputIndex", "state", "attemptCount", "providerIdempotencyKey", "providerRequestId", "assetId", "errorMessage", "unknownAt", "completedAt", "walletSettled", "refundedAt", "version" FROM "temporary_image_generation_output"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_image_generation_output"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_image_generation_output_state_updated" ON "image_generation_output" ("state", "updatedAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_output_job_index" ON "image_generation_output" ("jobId", "outputIndex") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_private_asset_owner_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_private_asset_expiry"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "image_private_asset" RENAME TO "temporary_image_private_asset"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "image_private_asset" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "customerId" integer NOT NULL, "kind" varchar(16) NOT NULL, "storageKey" varchar(255) NOT NULL, "originalName" varchar(80) NOT NULL, "mimeType" varchar(64) NOT NULL, "byteSize" int NOT NULL, "width" int NOT NULL, "height" int NOT NULL, "sha256" varchar(64) NOT NULL, "expiresAt" datetime NOT NULL, "deletedAt" datetime, "providerMetadata" text, CONSTRAINT "UQ_1fc089a5d1f00e49613178fd263" UNIQUE ("storageKey"), CONSTRAINT "FK_image_private_asset_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_image_private_asset_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "image_private_asset"("createdAt", "updatedAt", "id", "channelId", "customerId", "kind", "storageKey", "originalName", "mimeType", "byteSize", "width", "height", "sha256", "expiresAt", "deletedAt", "providerMetadata") SELECT "createdAt", "updatedAt", "id", "channelId", "customerId", "kind", "storageKey", "originalName", "mimeType", "byteSize", "width", "height", "sha256", "expiresAt", "deletedAt", "providerMetadata" FROM "temporary_image_private_asset"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_image_private_asset"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_image_private_asset_owner_created" ON "image_private_asset" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_private_asset_expiry" ON "image_private_asset" ("expiresAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_config_channel"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "image_generation_config" RENAME TO "temporary_image_generation_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "image_generation_config" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "enabled" boolean NOT NULL DEFAULT (0), "promptOptimizationEnabled" boolean NOT NULL DEFAULT (1), "defaultModelCode" varchar(48) NOT NULL DEFAULT ('GEMINI_FLASH'), "termsVersion" varchar(32) NOT NULL DEFAULT ('2026-08-27'), "termsZh" text NOT NULL, "termsEn" text NOT NULL, CONSTRAINT "FK_image_generation_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "image_generation_config"("createdAt", "updatedAt", "id", "channelId", "enabled", "promptOptimizationEnabled", "defaultModelCode", "termsVersion", "termsZh", "termsEn") SELECT "createdAt", "updatedAt", "id", "channelId", "enabled", "promptOptimizationEnabled", "defaultModelCode", "termsVersion", "termsZh", "termsEn" FROM "temporary_image_generation_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_image_generation_config"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_config_channel" ON "image_generation_config" ("channelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_customer_delivery_email_unique"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "customer_delivery_email" RENAME TO "temporary_customer_delivery_email"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "customer_delivery_email" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "emailAddress" varchar(254) NOT NULL, "normalizedEmail" varchar(254) NOT NULL, "label" varchar(80) NOT NULL DEFAULT (''), "isDefault" boolean NOT NULL DEFAULT (false), "confirmedAt" datetime NOT NULL, "channelId" integer NOT NULL, "customerId" integer NOT NULL, CONSTRAINT "FK_delivery_email_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_delivery_email_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "customer_delivery_email"("id", "createdAt", "updatedAt", "emailAddress", "normalizedEmail", "label", "isDefault", "confirmedAt", "channelId", "customerId") SELECT "id", "createdAt", "updatedAt", "emailAddress", "normalizedEmail", "label", "isDefault", "confirmedAt", "channelId", "customerId" FROM "temporary_customer_delivery_email"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_customer_delivery_email"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_customer_delivery_email_unique" ON "customer_delivery_email" ("channelId", "customerId", "normalizedEmail") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_customer_delivery_email_default" ON "customer_delivery_email" ("channelId", "customerId", "isDefault") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_manual_digital_delivery_order_line"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_manual_digital_delivery_channel_state_expected"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "manual_digital_delivery" RENAME TO "temporary_manual_digital_delivery"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "manual_digital_delivery" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(24) NOT NULL DEFAULT ('WAITING_PROCESSING'), "recipientEmail" varchar(254) NOT NULL, "languageCode" varchar(16) NOT NULL, "productName" varchar(255) NOT NULL, "sku" varchar(255) NOT NULL, "quantity" int NOT NULL, "expectedAt" datetime NOT NULL, "encryptedPackages" text, "attachmentAssetIdsJson" text NOT NULL DEFAULT ('[]'), "attemptCount" int NOT NULL DEFAULT (0), "lastError" text, "lastDispatchedAt" datetime, "sentAt" datetime, "fulfillmentId" varchar(64), "channelId" integer NOT NULL, "orderId" integer NOT NULL, "orderLineId" integer NOT NULL, CONSTRAINT "FK_manual_delivery_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_manual_delivery_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_manual_delivery_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "manual_digital_delivery"("id", "createdAt", "updatedAt", "state", "recipientEmail", "languageCode", "productName", "sku", "quantity", "expectedAt", "encryptedPackages", "attachmentAssetIdsJson", "attemptCount", "lastError", "lastDispatchedAt", "sentAt", "fulfillmentId", "channelId", "orderId", "orderLineId") SELECT "id", "createdAt", "updatedAt", "state", "recipientEmail", "languageCode", "productName", "sku", "quantity", "expectedAt", "encryptedPackages", "attachmentAssetIdsJson", "attemptCount", "lastError", "lastDispatchedAt", "sentAt", "fulfillmentId", "channelId", "orderId", "orderLineId" FROM "temporary_manual_digital_delivery"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_manual_digital_delivery"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_manual_digital_delivery_order_line" ON "manual_digital_delivery" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_manual_digital_delivery_channel_state_expected" ON "manual_digital_delivery" ("channelId", "state", "expectedAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_product"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_unit_variant"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_package_variant"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "product_packaging_rule" RENAME TO "temporary_product_packaging_rule"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "product_packaging_rule" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (true), "autoUnpack" boolean NOT NULL DEFAULT (true), "unitLabel" varchar(32) NOT NULL, "packageLabel" varchar(32) NOT NULL, "unitsPerPackage" int NOT NULL, "channelId" integer NOT NULL, "productId" integer NOT NULL, "unitVariantId" integer NOT NULL, "packageVariantId" integer NOT NULL, CONSTRAINT "FK_product_packaging_rule_package_variant" FOREIGN KEY ("packageVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_unit_variant" FOREIGN KEY ("unitVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_product" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "product_packaging_rule"("id", "createdAt", "updatedAt", "enabled", "autoUnpack", "unitLabel", "packageLabel", "unitsPerPackage", "channelId", "productId", "unitVariantId", "packageVariantId") SELECT "id", "createdAt", "updatedAt", "enabled", "autoUnpack", "unitLabel", "packageLabel", "unitsPerPackage", "channelId", "productId", "unitVariantId", "packageVariantId" FROM "temporary_product_packaging_rule"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_product_packaging_rule"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_product" ON "product_packaging_rule" ("channelId", "productId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_unit_variant" ON "product_packaging_rule" ("channelId", "unitVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_package_variant" ON "product_packaging_rule" ("channelId", "packageVariantId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_packaging_unpack_event_rule_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_packaging_unpack_event_order"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "packaging_unpack_event" RENAME TO "temporary_packaging_unpack_event"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "packaging_unpack_event" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "reason" varchar(24) NOT NULL, "packagesOpened" int NOT NULL, "unitsCreated" int NOT NULL, "packageStockBefore" int NOT NULL, "packageStockAfter" int NOT NULL, "unitStockBefore" int NOT NULL, "unitStockAfter" int NOT NULL, "ruleId" integer NOT NULL, "channelId" integer NOT NULL, "stockLocationId" integer NOT NULL, "orderId" integer, CONSTRAINT "FK_packaging_unpack_event_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_packaging_unpack_event_stock_location" FOREIGN KEY ("stockLocationId") REFERENCES "stock_location" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_packaging_unpack_event_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_packaging_unpack_event_rule" FOREIGN KEY ("ruleId") REFERENCES "product_packaging_rule" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "packaging_unpack_event"("id", "createdAt", "updatedAt", "reason", "packagesOpened", "unitsCreated", "packageStockBefore", "packageStockAfter", "unitStockBefore", "unitStockAfter", "ruleId", "channelId", "stockLocationId", "orderId") SELECT "id", "createdAt", "updatedAt", "reason", "packagesOpened", "unitsCreated", "packageStockBefore", "packageStockAfter", "unitStockBefore", "unitStockAfter", "ruleId", "channelId", "stockLocationId", "orderId" FROM "temporary_packaging_unpack_event"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_packaging_unpack_event"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_packaging_unpack_event_rule_created" ON "packaging_unpack_event" ("ruleId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_packaging_unpack_event_order" ON "packaging_unpack_event" ("orderId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_auto_card_config_channel_variant"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "auto_card_config" RENAME TO "temporary_auto_card_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "auto_card_config" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (true), "formatName" varchar(80) NOT NULL, "delimiter" varchar(16) NOT NULL DEFAULT ('----'), "fieldsJson" text NOT NULL, "instructions" text NOT NULL, "lowStockThreshold" int NOT NULL DEFAULT (5), "channelId" integer NOT NULL, "productVariantId" integer NOT NULL, "instructionsZh" text, "instructionsEn" text, CONSTRAINT "FK_auto_card_config_variant" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "auto_card_config"("id", "createdAt", "updatedAt", "enabled", "formatName", "delimiter", "fieldsJson", "instructions", "lowStockThreshold", "channelId", "productVariantId", "instructionsZh", "instructionsEn") SELECT "id", "createdAt", "updatedAt", "enabled", "formatName", "delimiter", "fieldsJson", "instructions", "lowStockThreshold", "channelId", "productVariantId", "instructionsZh", "instructionsEn" FROM "temporary_auto_card_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_auto_card_config"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_config_channel_variant" ON "auto_card_config" ("channelId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_auto_card_delivery_order_line"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_delivery_channel_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_delivery_config_created"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "auto_card_delivery" RENAME TO "temporary_auto_card_delivery"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "auto_card_delivery" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(24) NOT NULL DEFAULT ('WAITING_STOCK'), "recipientEmail" varchar(254) NOT NULL, "languageCode" varchar(16) NOT NULL, "productName" varchar(255) NOT NULL, "sku" varchar(255) NOT NULL, "quantity" int NOT NULL, "schemaSnapshot" text NOT NULL, "instructionsSnapshot" text NOT NULL, "attemptCount" int NOT NULL DEFAULT (0), "lastError" text, "lastDispatchedAt" datetime, "sentAt" datetime, "fulfillmentId" varchar(64), "channelId" integer NOT NULL, "orderId" integer NOT NULL, "orderLineId" integer NOT NULL, "configId" integer NOT NULL, CONSTRAINT "FK_auto_card_delivery_config" FOREIGN KEY ("configId") REFERENCES "auto_card_config" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_delivery_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_delivery_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_delivery_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "auto_card_delivery"("id", "createdAt", "updatedAt", "state", "recipientEmail", "languageCode", "productName", "sku", "quantity", "schemaSnapshot", "instructionsSnapshot", "attemptCount", "lastError", "lastDispatchedAt", "sentAt", "fulfillmentId", "channelId", "orderId", "orderLineId", "configId") SELECT "id", "createdAt", "updatedAt", "state", "recipientEmail", "languageCode", "productName", "sku", "quantity", "schemaSnapshot", "instructionsSnapshot", "attemptCount", "lastError", "lastDispatchedAt", "sentAt", "fulfillmentId", "channelId", "orderId", "orderLineId", "configId" FROM "temporary_auto_card_delivery"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_auto_card_delivery"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_delivery_order_line" ON "auto_card_delivery" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_auto_card_delivery_channel_state_created" ON "auto_card_delivery" ("channelId", "state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_auto_card_delivery_config_created" ON "auto_card_delivery" ("configId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_fingerprint"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "auto_card_pool_item" RENAME TO "temporary_auto_card_pool_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "auto_card_pool_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(16) NOT NULL DEFAULT ('AVAILABLE'), "sequence" int NOT NULL, "encryptedPayload" text NOT NULL, "fingerprint" varchar(64) NOT NULL, "assignedAt" datetime, "disabledReason" text, "configId" integer NOT NULL, "deliveryId" integer, "encryptedRawPayload" text, CONSTRAINT "FK_auto_card_pool_config" FOREIGN KEY ("configId") REFERENCES "auto_card_config" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_pool_delivery" FOREIGN KEY ("deliveryId") REFERENCES "auto_card_delivery" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "auto_card_pool_item"("id", "createdAt", "updatedAt", "state", "sequence", "encryptedPayload", "fingerprint", "assignedAt", "disabledReason", "configId", "deliveryId", "encryptedRawPayload") SELECT "id", "createdAt", "updatedAt", "state", "sequence", "encryptedPayload", "fingerprint", "assignedAt", "disabledReason", "configId", "deliveryId", "encryptedRawPayload" FROM "temporary_auto_card_pool_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_auto_card_pool_item"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_pool_config_fingerprint" ON "auto_card_pool_item" ("configId", "fingerprint") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_pool_config_sequence" ON "auto_card_pool_item" ("configId", "sequence") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_auto_card_pool_config_state_sequence" ON "auto_card_pool_item" ("configId", "state", "sequence") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_after_sales_request_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_after_sales_request_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_after_sales_request_channel_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_after_sales_request_code"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_after_sales_request_refund"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "after_sales_request" RENAME TO "temporary_after_sales_request"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "after_sales_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "code" varchar(32) NOT NULL, "type" varchar(32) NOT NULL, "state" varchar(24) NOT NULL DEFAULT ('PENDING'), "reason" varchar(40) NOT NULL, "description" text NOT NULL, "currencyCode" varchar(3) NOT NULL, "requestedAmount" int NOT NULL, "approvedAmount" int, "resolution" text, "customerName" varchar(200) NOT NULL, "customerEmail" varchar(254) NOT NULL, "respondedAt" datetime, "completedAt" datetime, "cancelledAt" datetime, "channelId" integer NOT NULL, "customerId" integer NOT NULL, "orderId" integer NOT NULL, "resolutionZh" text, "resolutionEn" text, "refundId" integer, "refundedAt" datetime, CONSTRAINT "FK_after_sales_request_refund" FOREIGN KEY ("refundId") REFERENCES "refund" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_after_sales_request_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_after_sales_request_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_after_sales_request_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "after_sales_request"("id", "createdAt", "updatedAt", "code", "type", "state", "reason", "description", "currencyCode", "requestedAmount", "approvedAmount", "resolution", "customerName", "customerEmail", "respondedAt", "completedAt", "cancelledAt", "channelId", "customerId", "orderId", "resolutionZh", "resolutionEn", "refundId", "refundedAt") SELECT "id", "createdAt", "updatedAt", "code", "type", "state", "reason", "description", "currencyCode", "requestedAmount", "approvedAmount", "resolution", "customerName", "customerEmail", "respondedAt", "completedAt", "cancelledAt", "channelId", "customerId", "orderId", "resolutionZh", "resolutionEn", "refundId", "refundedAt" FROM "temporary_after_sales_request"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_after_sales_request"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_after_sales_request_order" ON "after_sales_request" ("orderId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_after_sales_request_customer_created" ON "after_sales_request" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_after_sales_request_channel_state_created" ON "after_sales_request" ("channelId", "state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_after_sales_request_code" ON "after_sales_request" ("code") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_after_sales_request_refund" ON "after_sales_request" ("refundId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_after_sales_item_request"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "after_sales_item" RENAME TO "temporary_after_sales_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "after_sales_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "requestId" integer NOT NULL, "orderLineId" integer, "quantity" int NOT NULL, "unitPriceWithTax" int NOT NULL, "lineAmountWithTax" int NOT NULL, "productName" varchar(255) NOT NULL, "sku" varchar(255) NOT NULL, "fulfillmentType" varchar(16) NOT NULL, CONSTRAINT "FK_after_sales_item_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_after_sales_item_request" FOREIGN KEY ("requestId") REFERENCES "after_sales_request" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "after_sales_item"("id", "createdAt", "updatedAt", "requestId", "orderLineId", "quantity", "unitPriceWithTax", "lineAmountWithTax", "productName", "sku", "fulfillmentType") SELECT "id", "createdAt", "updatedAt", "requestId", "orderLineId", "quantity", "unitPriceWithTax", "lineAmountWithTax", "productName", "sku", "fulfillmentType" FROM "temporary_after_sales_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_after_sales_item"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_after_sales_item_request" ON "after_sales_item" ("requestId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_content_translation_state_key"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_content_translation_state_audit"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "content_translation_state" RENAME TO "temporary_content_translation_state"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "content_translation_state" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "stateKey" varchar(64) NOT NULL, "channelId" varchar(64), "entityType" varchar(64) NOT NULL, "entityId" varchar(64) NOT NULL, "fieldPath" varchar(128) NOT NULL, "sourceLanguageCode" varchar(20) NOT NULL DEFAULT ('zh_Hans'), "targetLanguageCode" varchar(20) NOT NULL DEFAULT ('en'), "sourceHash" varchar(64) NOT NULL, "translatedHash" varchar(64), "status" varchar(24) NOT NULL DEFAULT ('MISSING'), "origin" varchar(12) NOT NULL DEFAULT ('AUTO'), "locked" boolean NOT NULL DEFAULT (false), "error" text)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "content_translation_state"("id", "createdAt", "updatedAt", "stateKey", "channelId", "entityType", "entityId", "fieldPath", "sourceLanguageCode", "targetLanguageCode", "sourceHash", "translatedHash", "status", "origin", "locked", "error") SELECT "id", "createdAt", "updatedAt", "stateKey", "channelId", "entityType", "entityId", "fieldPath", "sourceLanguageCode", "targetLanguageCode", "sourceHash", "translatedHash", "status", "origin", "locked", "error" FROM "temporary_content_translation_state"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_content_translation_state"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_content_translation_state_key" ON "content_translation_state" ("stateKey") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_content_translation_state_audit" ON "content_translation_state" ("channelId", "entityType", "status") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_9a5a6a556f75c4ac7bfdd03410"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_d8791f444a8bf23fe4c1bc020c"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_6fb55742e13e8082954d0436dc"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "search_index_item" RENAME TO "temporary_search_index_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "search_index_item" ("languageCode" varchar NOT NULL, "enabled" boolean NOT NULL, "productName" varchar NOT NULL, "productVariantName" varchar NOT NULL, "description" text NOT NULL, "slug" varchar NOT NULL, "sku" varchar NOT NULL, "facetIds" text NOT NULL, "facetValueIds" text NOT NULL, "collectionIds" text NOT NULL, "collectionSlugs" text NOT NULL, "channelIds" text NOT NULL, "productPreview" varchar NOT NULL, "productPreviewFocalPoint" text, "productVariantPreview" varchar NOT NULL, "productVariantPreviewFocalPoint" text, "productVariantId" integer NOT NULL, "channelId" integer NOT NULL, "productId" integer NOT NULL, "productAssetId" integer, "productVariantAssetId" integer, "price" integer NOT NULL, "priceWithTax" integer NOT NULL, "inStock" boolean NOT NULL DEFAULT (true), "productInStock" boolean NOT NULL DEFAULT (true), PRIMARY KEY ("languageCode", "productVariantId", "channelId"))`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "search_index_item"("languageCode", "enabled", "productName", "productVariantName", "description", "slug", "sku", "facetIds", "facetValueIds", "collectionIds", "collectionSlugs", "channelIds", "productPreview", "productPreviewFocalPoint", "productVariantPreview", "productVariantPreviewFocalPoint", "productVariantId", "channelId", "productId", "productAssetId", "productVariantAssetId", "price", "priceWithTax", "inStock", "productInStock") SELECT "languageCode", "enabled", "productName", "productVariantName", "description", "slug", "sku", "facetIds", "facetValueIds", "collectionIds", "collectionSlugs", "channelIds", "productPreview", "productPreviewFocalPoint", "productVariantPreview", "productVariantPreviewFocalPoint", "productVariantId", "channelId", "productId", "productAssetId", "productVariantAssetId", "price", "priceWithTax", "inStock", "productInStock" FROM "temporary_search_index_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_search_index_item"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_9a5a6a556f75c4ac7bfdd03410" ON "search_index_item" ("description") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_d8791f444a8bf23fe4c1bc020c" ON "search_index_item" ("productVariantName") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_6fb55742e13e8082954d0436dc" ON "search_index_item" ("productName") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_af2116c7e176b6b88dceceeb74"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_afe9f917a1c82b9e9e69f7c612"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_c9ca2f58d4517460435cbd8b4c"`, undefined);
        await queryRunner.query(`ALTER TABLE "channel" RENAME TO "temporary_channel"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "channel" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "code" varchar NOT NULL, "token" varchar NOT NULL, "description" varchar DEFAULT (''), "defaultLanguageCode" varchar NOT NULL, "availableLanguageCodes" text, "defaultCurrencyCode" varchar NOT NULL, "availableCurrencyCodes" text, "trackInventory" boolean NOT NULL DEFAULT (1), "outOfStockThreshold" integer NOT NULL DEFAULT (0), "pricesIncludeTax" boolean NOT NULL, "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sellerId" integer, "defaultTaxZoneId" integer, "defaultShippingZoneId" integer, "customFieldsStorefrontnamezh" varchar(32) NOT NULL DEFAULT ('云桥Ai'), "customFieldsStorefrontnameen" varchar(32) NOT NULL DEFAULT ('Yunqiao Ai'), "customFieldsIsstoreprovisioningtemplate" boolean NOT NULL DEFAULT (0), "customFieldsCurrencyselectorenabled" boolean NOT NULL DEFAULT (1), "customFieldsCurrencyratemode" varchar(16) NOT NULL DEFAULT ('AUTO'), "customFieldsCnytomyrrate" float, "customFieldsCurrencyratemarkupbps" int NOT NULL DEFAULT (0), "customFieldsCurrencyroundingmode" varchar(16) NOT NULL DEFAULT ('CENT'), "customFieldsCurrencyratesource" varchar(120), "customFieldsCurrencyrateupdatedat" datetime, "customFieldsCurrencypricesupdatedat" datetime, "customFieldsCurrencysyncedpricecount" int NOT NULL DEFAULT (0), "customFieldsUsdtdisplayenabled" boolean NOT NULL DEFAULT (1), "customFieldsUsdtratemarkupbps" int NOT NULL DEFAULT (0), "customFieldsCnyperusdtrate" float, "customFieldsUsdtratesource" varchar(120), "customFieldsUsdtrateupdatedat" datetime, "customFieldsUsdtrateschedulemode" varchar(16) NOT NULL DEFAULT ('INTERVAL'), "customFieldsUsdtrateintervalminutes" int NOT NULL DEFAULT (5), "customFieldsUsdtratedailytime" varchar(5) NOT NULL DEFAULT ('10:00'), "customFieldsCommercemode" varchar(255) NOT NULL DEFAULT ('DIGITAL_ONLY'), CONSTRAINT "UQ_842699fce4f3470a7d06d89de88" UNIQUE ("token"), CONSTRAINT "UQ_06127ac6c6d913f4320759971db" UNIQUE ("code"), CONSTRAINT "FK_c9ca2f58d4517460435cbd8b4c9" FOREIGN KEY ("defaultShippingZoneId") REFERENCES "zone" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_afe9f917a1c82b9e9e69f7c6129" FOREIGN KEY ("defaultTaxZoneId") REFERENCES "zone" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_af2116c7e176b6b88dceceeb74b" FOREIGN KEY ("sellerId") REFERENCES "seller" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "channel"("createdAt", "updatedAt", "code", "token", "description", "defaultLanguageCode", "availableLanguageCodes", "defaultCurrencyCode", "availableCurrencyCodes", "trackInventory", "outOfStockThreshold", "pricesIncludeTax", "id", "sellerId", "defaultTaxZoneId", "defaultShippingZoneId", "customFieldsStorefrontnamezh", "customFieldsStorefrontnameen", "customFieldsIsstoreprovisioningtemplate", "customFieldsCurrencyselectorenabled", "customFieldsCurrencyratemode", "customFieldsCnytomyrrate", "customFieldsCurrencyratemarkupbps", "customFieldsCurrencyroundingmode", "customFieldsCurrencyratesource", "customFieldsCurrencyrateupdatedat", "customFieldsCurrencypricesupdatedat", "customFieldsCurrencysyncedpricecount", "customFieldsUsdtdisplayenabled", "customFieldsUsdtratemarkupbps", "customFieldsCnyperusdtrate", "customFieldsUsdtratesource", "customFieldsUsdtrateupdatedat", "customFieldsUsdtrateschedulemode", "customFieldsUsdtrateintervalminutes", "customFieldsUsdtratedailytime", "customFieldsCommercemode") SELECT "createdAt", "updatedAt", "code", "token", "description", "defaultLanguageCode", "availableLanguageCodes", "defaultCurrencyCode", "availableCurrencyCodes", "trackInventory", "outOfStockThreshold", "pricesIncludeTax", "id", "sellerId", "defaultTaxZoneId", "defaultShippingZoneId", "customFieldsStorefrontnamezh", "customFieldsStorefrontnameen", "customFieldsIsstoreprovisioningtemplate", "customFieldsCurrencyselectorenabled", "customFieldsCurrencyratemode", "customFieldsCnytomyrrate", "customFieldsCurrencyratemarkupbps", "customFieldsCurrencyroundingmode", "customFieldsCurrencyratesource", "customFieldsCurrencyrateupdatedat", "customFieldsCurrencypricesupdatedat", "customFieldsCurrencysyncedpricecount", "customFieldsUsdtdisplayenabled", "customFieldsUsdtratemarkupbps", "customFieldsCnyperusdtrate", "customFieldsUsdtratesource", "customFieldsUsdtrateupdatedat", "customFieldsUsdtrateschedulemode", "customFieldsUsdtrateintervalminutes", "customFieldsUsdtratedailytime", "customFieldsCommercemode" FROM "temporary_channel"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_channel"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_af2116c7e176b6b88dceceeb74" ON "channel" ("sellerId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_afe9f917a1c82b9e9e69f7c612" ON "channel" ("defaultTaxZoneId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_c9ca2f58d4517460435cbd8b4c" ON "channel" ("defaultShippingZoneId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_0e6f516053cf982b537836e21c"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_e38dca0d82fd64c7cf8aac8b8e"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_6e420052844edf3a5506d863ce"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "product_variant" RENAME TO "temporary_product_variant"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "product_variant" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "sku" varchar NOT NULL, "outOfStockThreshold" integer NOT NULL DEFAULT (0), "useGlobalOutOfStockThreshold" boolean NOT NULL DEFAULT (1), "trackInventory" varchar NOT NULL DEFAULT ('INHERIT'), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "taxCategoryId" integer, "productId" integer, "customFieldsFulfillmenttype" varchar(255) DEFAULT ('physical'), "customFieldsDigitaldeliverymode" varchar(255) DEFAULT ('manual_service'), "customFieldsDigitalstockpolicy" varchar(255) NOT NULL DEFAULT ('limited'), CONSTRAINT "FK_6e420052844edf3a5506d863ce6" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_e38dca0d82fd64c7cf8aac8b8ef" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e6f516053cf982b537836e21cf" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "product_variant"("createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId", "customFieldsFulfillmenttype", "customFieldsDigitaldeliverymode", "customFieldsDigitalstockpolicy") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId", "customFieldsFulfillmenttype", "customFieldsDigitaldeliverymode", "customFieldsDigitalstockpolicy" FROM "temporary_product_variant"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_product_variant"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_0e6f516053cf982b537836e21c" ON "product_variant" ("featuredAssetId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_e38dca0d82fd64c7cf8aac8b8e" ON "product_variant" ("taxCategoryId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_6e420052844edf3a5506d863ce" ON "product_variant" ("productId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_239cfca2a55b98b90b6bef2e44"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_9f065453910ea77d4be8e92618"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_77be94ce9ec650446617946227"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_cbcd22193eda94668e84d33f18"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_dc9ac68b47da7b62249886affb"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_6901d8715f5ebadd764466f7bd"`, undefined);
        await queryRunner.query(`ALTER TABLE "order_line" RENAME TO "temporary_order_line"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "order_line" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "quantity" integer NOT NULL, "orderPlacedQuantity" integer NOT NULL DEFAULT (0), "listPriceIncludesTax" boolean NOT NULL, "adjustments" text NOT NULL, "taxLines" text NOT NULL, "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sellerChannelId" integer, "shippingLineId" integer, "productVariantId" integer NOT NULL, "taxCategoryId" integer, "initialListPrice" integer, "listPrice" integer NOT NULL, "featuredAssetId" integer, "orderId" integer, "customFieldsFulfillmenttypesnapshot" varchar(255) DEFAULT ('physical'), "customFieldsDigitaldeliverymodesnapshot" varchar(255) DEFAULT ('manual_service'), "customFieldsRefundpolicysnapshot" varchar(255) NOT NULL DEFAULT ('MERCHANT_REVIEW'), "customFieldsManualdeliveryslaminutessnapshot" int NOT NULL DEFAULT (1440), CONSTRAINT "FK_6901d8715f5ebadd764466f7bde" FOREIGN KEY ("sellerChannelId") REFERENCES "channel" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_dc9ac68b47da7b62249886affba" FOREIGN KEY ("shippingLineId") REFERENCES "shipping_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_cbcd22193eda94668e84d33f185" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_77be94ce9ec6504466179462275" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_9f065453910ea77d4be8e92618f" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_239cfca2a55b98b90b6bef2e44f" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "order_line"("createdAt", "updatedAt", "quantity", "orderPlacedQuantity", "listPriceIncludesTax", "adjustments", "taxLines", "id", "sellerChannelId", "shippingLineId", "productVariantId", "taxCategoryId", "initialListPrice", "listPrice", "featuredAssetId", "orderId", "customFieldsFulfillmenttypesnapshot", "customFieldsDigitaldeliverymodesnapshot", "customFieldsRefundpolicysnapshot", "customFieldsManualdeliveryslaminutessnapshot") SELECT "createdAt", "updatedAt", "quantity", "orderPlacedQuantity", "listPriceIncludesTax", "adjustments", "taxLines", "id", "sellerChannelId", "shippingLineId", "productVariantId", "taxCategoryId", "initialListPrice", "listPrice", "featuredAssetId", "orderId", "customFieldsFulfillmenttypesnapshot", "customFieldsDigitaldeliverymodesnapshot", "customFieldsRefundpolicysnapshot", "customFieldsManualdeliveryslaminutessnapshot" FROM "temporary_order_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_order_line"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_239cfca2a55b98b90b6bef2e44" ON "order_line" ("orderId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_9f065453910ea77d4be8e92618" ON "order_line" ("featuredAssetId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_77be94ce9ec650446617946227" ON "order_line" ("taxCategoryId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_cbcd22193eda94668e84d33f18" ON "order_line" ("productVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_dc9ac68b47da7b62249886affb" ON "order_line" ("shippingLineId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_6901d8715f5ebadd764466f7bd" ON "order_line" ("sellerChannelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_91a19e6613534949a4ce6e76ff"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" RENAME TO "temporary_product"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "product" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "customFieldsFulfillmenttype" varchar(255) NOT NULL DEFAULT ('digital'), "customFieldsRefundpolicy" varchar(255) NOT NULL DEFAULT ('MERCHANT_REVIEW'), "customFieldsManualdeliveryslaminutes" int NOT NULL DEFAULT (1440), CONSTRAINT "FK_91a19e6613534949a4ce6e76ff8" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "product"("createdAt", "updatedAt", "deletedAt", "enabled", "id", "featuredAssetId", "customFieldsFulfillmenttype", "customFieldsRefundpolicy", "customFieldsManualdeliveryslaminutes") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "id", "featuredAssetId", "customFieldsFulfillmenttype", "customFieldsRefundpolicy", "customFieldsManualdeliveryslaminutes" FROM "temporary_product"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_product"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_91a19e6613534949a4ce6e76ff" ON "product" ("featuredAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_reward_channel_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_reward_inviter_available"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "referral_reward" RENAME TO "temporary_referral_reward"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "referral_reward" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "inviterCustomerId" integer NOT NULL, "inviteeCustomerId" integer NOT NULL, "orderId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "rewardRateBps" int NOT NULL, "eligibleAmount" int NOT NULL, "rewardAmount" int NOT NULL, "releasedAmount" int NOT NULL DEFAULT (0), "clawedBackAmount" int NOT NULL DEFAULT (0), "settledRefundTotal" int NOT NULL DEFAULT (0), "orderTotalWithTax" int NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "earnedAt" datetime NOT NULL, "availableAt" datetime NOT NULL, "releasedAt" datetime, CONSTRAINT "FK_referral_reward_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_invitee" FOREIGN KEY ("inviteeCustomerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_inviter" FOREIGN KEY ("inviterCustomerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_reward_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "referral_reward"("id", "createdAt", "updatedAt", "channelId", "inviterCustomerId", "inviteeCustomerId", "orderId", "currencyCode", "rewardRateBps", "eligibleAmount", "rewardAmount", "releasedAmount", "clawedBackAmount", "settledRefundTotal", "orderTotalWithTax", "status", "earnedAt", "availableAt", "releasedAt") SELECT "id", "createdAt", "updatedAt", "channelId", "inviterCustomerId", "inviteeCustomerId", "orderId", "currencyCode", "rewardRateBps", "eligibleAmount", "rewardAmount", "releasedAmount", "clawedBackAmount", "settledRefundTotal", "orderTotalWithTax", "status", "earnedAt", "availableAt", "releasedAt" FROM "temporary_referral_reward"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_referral_reward"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_reward_channel_order" ON "referral_reward" ("channelId", "orderId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_reward_inviter_available" ON "referral_reward" ("inviterCustomerId", "availableAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_model_config_channel_code"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_model_config_channel_position"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "image_model_config" RENAME TO "temporary_image_model_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "image_model_config" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "code" varchar(48) NOT NULL, "enabled" boolean NOT NULL DEFAULT (0), "displayNameZh" varchar(120) NOT NULL, "displayNameEn" varchar(120) NOT NULL, "officialModelId" varchar(160) NOT NULL, "providerModelId" varchar(160) NOT NULL, "protocol" varchar(32) NOT NULL, "unitPrice" int NOT NULL DEFAULT (0), "currencyCode" varchar(3) NOT NULL, "position" int NOT NULL DEFAULT (0), "isDefault" boolean NOT NULL DEFAULT (0), "healthStatus" varchar(24) NOT NULL DEFAULT ('UNTESTED'), CONSTRAINT "FK_image_model_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "image_model_config"("createdAt", "updatedAt", "id", "channelId", "code", "enabled", "displayNameZh", "displayNameEn", "officialModelId", "providerModelId", "protocol", "unitPrice", "currencyCode", "position", "isDefault", "healthStatus") SELECT "createdAt", "updatedAt", "id", "channelId", "code", "enabled", "displayNameZh", "displayNameEn", "officialModelId", "providerModelId", "protocol", "unitPrice", "currencyCode", "position", "isDefault", "healthStatus" FROM "temporary_image_model_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_image_model_config"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_model_config_channel_code" ON "image_model_config" ("channelId", "code") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_model_config_channel_position" ON "image_model_config" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_poster_template_channel_position"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "referral_poster_template" RENAME TO "temporary_referral_poster_template"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "referral_poster_template" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "name" varchar(128) NOT NULL, "enabled" boolean NOT NULL DEFAULT (1), "position" int NOT NULL DEFAULT (0), "layoutVariant" varchar(32) NOT NULL DEFAULT ('STANDARD_CENTER'), "posterBackgroundAssetId" integer, "shareBackgroundAssetId" integer, "titleZh" varchar(80) NOT NULL DEFAULT ('好友邀请函'), "titleEn" varchar(80) NOT NULL DEFAULT ('Invitation for friends'), "headlineZh" varchar(180) NOT NULL DEFAULT ('发现好东西，一起分享'), "headlineEn" varchar(180) NOT NULL DEFAULT ('Discover something worth sharing'), "rewardTextZh" varchar(220) NOT NULL DEFAULT ('好友成功消费，可获得 {rewardRate}% 奖励用于消费抵扣'), "rewardTextEn" varchar(220) NOT NULL DEFAULT ('Earn {rewardRate}% in rewards when a friend makes a purchase'), "siteIntroZh" varchar(260) NOT NULL DEFAULT (''), "siteIntroEn" varchar(260) NOT NULL DEFAULT (''), "serviceTextZh" varchar(260) NOT NULL DEFAULT ('好物严选 · 便捷消费 · 售后服务'), "serviceTextEn" varchar(260) NOT NULL DEFAULT ('Curated products · Easy shopping · Customer support'), "foregroundColor" varchar(16) NOT NULL DEFAULT ('#FFFFFF'), "accentColor" varchar(16) NOT NULL DEFAULT ('#FF4D4F'), "overlayOpacity" int NOT NULL DEFAULT (28), "featureOneTitleZh" varchar(100) NOT NULL DEFAULT ('热门工具汇集'), "featureOneTitleEn" varchar(100) NOT NULL DEFAULT ('精选 AI tools'), "featureOneTextZh" varchar(160) NOT NULL DEFAULT ('多种 AI 工具任你选'), "featureOneTextEn" varchar(160) NOT NULL DEFAULT ('A curated set of AI tools'), "featureTwoTitleZh" varchar(100) NOT NULL DEFAULT ('便捷开通服务'), "featureTwoTitleEn" varchar(100) NOT NULL DEFAULT ('Fast activation'), "featureTwoTextZh" varchar(160) NOT NULL DEFAULT ('快速开通 省时省心'), "featureTwoTextEn" varchar(160) NOT NULL DEFAULT ('Get started in a few clicks'), "featureThreeTitleZh" varchar(100) NOT NULL DEFAULT ('专属售后支持'), "featureThreeTitleEn" varchar(100) NOT NULL DEFAULT ('Dedicated support'), "featureThreeTextZh" varchar(160) NOT NULL DEFAULT ('专业客服 贴心服务'), "featureThreeTextEn" varchar(160) NOT NULL DEFAULT ('Friendly help when you need it'), "qrEyebrowZh" varchar(100) NOT NULL DEFAULT ('扫码访问云桥 AI'), "qrEyebrowEn" varchar(100) NOT NULL DEFAULT ('Scan CloudBridge AI'), "qrTitleZh" varchar(140) NOT NULL DEFAULT ('发现更多实用 AI 服务'), "qrTitleEn" varchar(140) NOT NULL DEFAULT ('Discover practical AI services'), "qrDescriptionZh" varchar(140) NOT NULL DEFAULT ('满足多种 AI 使用场景'), "qrDescriptionEn" varchar(140) NOT NULL DEFAULT ('Tools for work, creativity, learning and code'), "sceneOneZh" varchar(48) NOT NULL DEFAULT ('办公提效'), "sceneOneEn" varchar(48) NOT NULL DEFAULT ('Work'), "sceneTwoZh" varchar(48) NOT NULL DEFAULT ('内容创作'), "sceneTwoEn" varchar(48) NOT NULL DEFAULT ('Create'), "sceneThreeZh" varchar(48) NOT NULL DEFAULT ('学习辅助'), "sceneThreeEn" varchar(48) NOT NULL DEFAULT ('Learn'), "sceneFourZh" varchar(48) NOT NULL DEFAULT ('智能编程'), "sceneFourEn" varchar(48) NOT NULL DEFAULT ('Code'), "ctaTextZh" varchar(140) NOT NULL DEFAULT ('长按识别二维码，立即进入云桥 AI'), "ctaTextEn" varchar(140) NOT NULL DEFAULT ('Press and hold to enter CloudBridge AI'), "footerTitleZh" varchar(160) NOT NULL DEFAULT ('让好用的 AI，真正为你所用'), "footerTitleEn" varchar(160) NOT NULL DEFAULT ('AI that works for you'), "footerTextZh" varchar(220) NOT NULL DEFAULT ('热门 AI 工具与数字服务一站式平台'), "footerTextEn" varchar(220) NOT NULL DEFAULT ('One-stop platform for AI tools and digital services'), CONSTRAINT "FK_referral_poster_template_share_asset" FOREIGN KEY ("shareBackgroundAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_referral_poster_template_poster_asset" FOREIGN KEY ("posterBackgroundAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_referral_poster_template_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "referral_poster_template"("createdAt", "updatedAt", "id", "channelId", "name", "enabled", "position", "layoutVariant", "posterBackgroundAssetId", "shareBackgroundAssetId", "titleZh", "titleEn", "headlineZh", "headlineEn", "rewardTextZh", "rewardTextEn", "siteIntroZh", "siteIntroEn", "serviceTextZh", "serviceTextEn", "foregroundColor", "accentColor", "overlayOpacity") SELECT "createdAt", "updatedAt", "id", "channelId", "name", "enabled", "position", "layoutVariant", "posterBackgroundAssetId", "shareBackgroundAssetId", "titleZh", "titleEn", "headlineZh", "headlineEn", "rewardTextZh", "rewardTextEn", "siteIntroZh", "siteIntroEn", "serviceTextZh", "serviceTextEn", "foregroundColor", "accentColor", "overlayOpacity" FROM "temporary_referral_poster_template"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_referral_poster_template"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_poster_template_channel_position" ON "referral_poster_template" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_system_announcement_schedule"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "system_announcement" RENAME TO "temporary_system_announcement"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "system_announcement" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (1), "priority" int NOT NULL DEFAULT (0), "titleZh" varchar(120) NOT NULL, "titleEn" varchar(120) NOT NULL DEFAULT (''), "contentZh" text NOT NULL, "contentEn" text NOT NULL, "linkUrl" varchar(500), "startsAt" datetime, "endsAt" datetime, "targetMode" varchar(16) NOT NULL DEFAULT ('ALL'))`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "system_announcement"("id", "createdAt", "updatedAt", "enabled", "priority", "titleZh", "titleEn", "contentZh", "contentEn", "linkUrl", "startsAt", "endsAt") SELECT "id", "createdAt", "updatedAt", "enabled", "priority", "titleZh", "titleEn", "contentZh", "contentEn", "linkUrl", "startsAt", "endsAt" FROM "temporary_system_announcement"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_system_announcement"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_system_announcement_schedule" ON "system_announcement" ("enabled", "startsAt", "endsAt", "priority") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_91a19e6613534949a4ce6e76ff"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" RENAME TO "temporary_product"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "product" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "customFields__fix_relational_custom_fields__" boolean, "customFieldsFulfillmenttype" varchar(255) NOT NULL DEFAULT ('digital'), "customFieldsRefundpolicy" varchar(255) NOT NULL DEFAULT ('MERCHANT_REVIEW'), "customFieldsManualdeliveryslaminutes" int NOT NULL DEFAULT (1440), CONSTRAINT "FK_91a19e6613534949a4ce6e76ff8" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "product"("createdAt", "updatedAt", "deletedAt", "enabled", "id", "featuredAssetId", "customFieldsFulfillmenttype", "customFieldsRefundpolicy", "customFieldsManualdeliveryslaminutes") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "id", "featuredAssetId", "customFieldsFulfillmenttype", "customFieldsRefundpolicy", "customFieldsManualdeliveryslaminutes" FROM "temporary_product"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_product"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_91a19e6613534949a4ce6e76ff" ON "product" ("featuredAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_f4a2ec16ba86d277b6faa0b67b"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_7dbc75cb4e8b002620c4dbfdac"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "product_translation" RENAME TO "temporary_product_translation"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "product_translation" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "languageCode" varchar NOT NULL, "name" varchar NOT NULL, "slug" varchar NOT NULL, "description" text NOT NULL, "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "baseId" integer, "customFields__fix_relational_custom_fields__" boolean, CONSTRAINT "FK_7dbc75cb4e8b002620c4dbfdac5" FOREIGN KEY ("baseId") REFERENCES "product" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "product_translation"("createdAt", "updatedAt", "languageCode", "name", "slug", "description", "id", "baseId") SELECT "createdAt", "updatedAt", "languageCode", "name", "slug", "description", "id", "baseId" FROM "temporary_product_translation"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_product_translation"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_f4a2ec16ba86d277b6faa0b67b" ON "product_translation" ("slug") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_7dbc75cb4e8b002620c4dbfdac" ON "product_translation" ("baseId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_channel_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_product_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_review_order_line"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_review" RENAME TO "temporary_storefront_review"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_review" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(16) NOT NULL DEFAULT ('PENDING'), "rating" int NOT NULL, "title" varchar(120) NOT NULL, "body" text NOT NULL, "customerName" varchar(120) NOT NULL, "productName" varchar(255) NOT NULL, "sku" varchar(255) NOT NULL, "merchantResponse" text, "moderatedAt" datetime, "channelId" integer NOT NULL, "customerId" integer, "orderId" integer, "orderLineId" integer, "productId" integer, "productVariantId" integer, "merchantResponseZh" text, "merchantResponseEn" text, CONSTRAINT "FK_storefront_review_product_variant" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_product" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_review_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_review"("id", "createdAt", "updatedAt", "state", "rating", "title", "body", "customerName", "productName", "sku", "merchantResponse", "moderatedAt", "channelId", "customerId", "orderId", "orderLineId", "productId", "productVariantId", "merchantResponseZh", "merchantResponseEn") SELECT "id", "createdAt", "updatedAt", "state", "rating", "title", "body", "customerName", "productName", "sku", "merchantResponse", "moderatedAt", "channelId", "customerId", "orderId", "orderLineId", "productId", "productVariantId", "merchantResponseZh", "merchantResponseEn" FROM "temporary_storefront_review"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_review"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_channel_state_created" ON "storefront_review" ("channelId", "state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_product_state_created" ON "storefront_review" ("productId", "state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_review_customer_created" ON "storefront_review" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_review_order_line" ON "storefront_review" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_checkout_line_variant"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_checkout_line_cart_line"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_cart_checkout_line" RENAME TO "temporary_storefront_cart_checkout_line"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_cart_checkout_line" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "checkoutId" integer NOT NULL, "cartLineId" integer, "productVariantId" integer NOT NULL, "quantity" int NOT NULL, CONSTRAINT "FK_50b17e57a4ee983399032f33b82" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_06fd288a0681d32056b3982af96" FOREIGN KEY ("cartLineId") REFERENCES "storefront_cart_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_eb781b4c2e8d587fb9d4c250e8b" FOREIGN KEY ("checkoutId") REFERENCES "storefront_cart_checkout" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_cart_checkout_line"("id", "createdAt", "updatedAt", "checkoutId", "cartLineId", "productVariantId", "quantity") SELECT "id", "createdAt", "updatedAt", "checkoutId", "cartLineId", "productVariantId", "quantity" FROM "temporary_storefront_cart_checkout_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_cart_checkout_line"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_checkout_line_variant" ON "storefront_cart_checkout_line" ("checkoutId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_checkout_line_cart_line" ON "storefront_cart_checkout_line" ("cartLineId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_checkout_cart"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_checkout_order"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_cart_checkout" RENAME TO "temporary_storefront_cart_checkout"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_cart_checkout" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "cartId" integer NOT NULL, "orderId" integer NOT NULL, "cartRevision" int NOT NULL, "state" varchar(20) NOT NULL DEFAULT ('PREPARED'), "completedAt" datetime, CONSTRAINT "FK_62eae4cd2000102e470884e62c4" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_999b72b6d264f393ce623c1fa16" FOREIGN KEY ("cartId") REFERENCES "storefront_cart" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_cart_checkout"("id", "createdAt", "updatedAt", "cartId", "orderId", "cartRevision", "state", "completedAt") SELECT "id", "createdAt", "updatedAt", "cartId", "orderId", "cartRevision", "state", "completedAt" FROM "temporary_storefront_cart_checkout"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_cart_checkout"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_cart_checkout_cart" ON "storefront_cart_checkout" ("cartId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_checkout_order" ON "storefront_cart_checkout" ("orderId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_line_variant"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_cart_line_order_line"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_cart_line" RENAME TO "temporary_storefront_cart_line"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_cart_line" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "cartId" integer NOT NULL, "productVariantId" integer NOT NULL, "quantity" int NOT NULL, "selected" boolean NOT NULL DEFAULT (1), "orderLineId" integer, CONSTRAINT "FK_4b16092e25690ed973fca613970" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_fc4ebb77880b9f16355ba97e94f" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_a7dfef03af017cd8d3303d139ac" FOREIGN KEY ("cartId") REFERENCES "storefront_cart" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_cart_line"("id", "createdAt", "updatedAt", "cartId", "productVariantId", "quantity", "selected", "orderLineId") SELECT "id", "createdAt", "updatedAt", "cartId", "productVariantId", "quantity", "selected", "orderLineId" FROM "temporary_storefront_cart_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_cart_line"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_line_variant" ON "storefront_cart_line" ("cartId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_cart_line_order_line" ON "storefront_cart_line" ("orderLineId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_settings_channel"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_content_settings" RENAME TO "temporary_storefront_content_settings"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_content_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "heroAutoplayIntervalSeconds" int NOT NULL DEFAULT (5), "channelId" integer NOT NULL, CONSTRAINT "FK_storefront_content_settings_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_content_settings"("id", "createdAt", "updatedAt", "heroAutoplayIntervalSeconds", "channelId") SELECT "id", "createdAt", "updatedAt", "heroAutoplayIntervalSeconds", "channelId" FROM "temporary_storefront_content_settings"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_content_settings"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_settings_channel" ON "storefront_content_settings" ("channelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel_code"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel_position"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_channel"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_block_image_asset"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_content_block" RENAME TO "temporary_storefront_content_block"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_content_block" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "code" varchar(64) NOT NULL, "type" varchar(32) NOT NULL, "enabled" boolean NOT NULL DEFAULT (1), "position" int NOT NULL DEFAULT (0), "startsAt" datetime, "endsAt" datetime, "imageUrl" varchar(2048), "backgroundColor" varchar(32), "textColor" varchar(32), "targetType" varchar(32) NOT NULL DEFAULT ('NONE'), "targetValue" varchar(2048), "channelId" integer NOT NULL, "internalName" varchar(128) NOT NULL DEFAULT (''), "layoutVariant" varchar(32) NOT NULL DEFAULT ('AUTO'), "settings" text, "imageAssetId" integer, CONSTRAINT "FK_storefront_content_block_image_asset" FOREIGN KEY ("imageAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_content_block_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_content_block"("id", "createdAt", "updatedAt", "code", "type", "enabled", "position", "startsAt", "endsAt", "imageUrl", "backgroundColor", "textColor", "targetType", "targetValue", "channelId", "internalName", "layoutVariant", "settings", "imageAssetId") SELECT "id", "createdAt", "updatedAt", "code", "type", "enabled", "position", "startsAt", "endsAt", "imageUrl", "backgroundColor", "textColor", "targetType", "targetValue", "channelId", "internalName", "layoutVariant", "settings", "imageAssetId" FROM "temporary_storefront_content_block"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_content_block"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_content_block_channel_code" ON "storefront_content_block" ("channelId", "code") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_channel_position" ON "storefront_content_block" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_channel" ON "storefront_content_block" ("channelId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_block_image_asset" ON "storefront_content_block" ("imageAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_item_block_position"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_content_item_image_asset"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_content_item" RENAME TO "temporary_storefront_content_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_content_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (1), "position" int NOT NULL DEFAULT (0), "imageUrl" varchar(2048), "targetType" varchar(32) NOT NULL DEFAULT ('NONE'), "targetValue" varchar(2048), "blockId" integer NOT NULL, "settings" text, "imageAssetId" integer, CONSTRAINT "FK_storefront_content_item_image_asset" FOREIGN KEY ("imageAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_content_item_block" FOREIGN KEY ("blockId") REFERENCES "storefront_content_block" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_content_item"("id", "createdAt", "updatedAt", "enabled", "position", "imageUrl", "targetType", "targetValue", "blockId", "settings", "imageAssetId") SELECT "id", "createdAt", "updatedAt", "enabled", "position", "imageUrl", "targetType", "targetValue", "blockId", "settings", "imageAssetId" FROM "temporary_storefront_content_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_content_item"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_item_block_position" ON "storefront_content_item" ("blockId", "position") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_content_item_image_asset" ON "storefront_content_item" ("imageAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_daily_visitor_identity"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_daily_visitor_channel_date"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_daily_visitor" RENAME TO "temporary_storefront_daily_visitor"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_daily_visitor" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "customerId" integer, "businessDate" varchar(10) NOT NULL, "visitorKeyHash" varchar(64) NOT NULL, "firstSeenAt" datetime NOT NULL, "lastSeenAt" datetime NOT NULL, "visitCount" int NOT NULL DEFAULT (1), CONSTRAINT "FK_storefront_daily_visitor_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_daily_visitor_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_daily_visitor"("id", "createdAt", "updatedAt", "channelId", "customerId", "businessDate", "visitorKeyHash", "firstSeenAt", "lastSeenAt", "visitCount") SELECT "id", "createdAt", "updatedAt", "channelId", "customerId", "businessDate", "visitorKeyHash", "firstSeenAt", "lastSeenAt", "visitCount" FROM "temporary_storefront_daily_visitor"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_daily_visitor"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_daily_visitor_identity" ON "storefront_daily_visitor" ("channelId", "businessDate", "visitorKeyHash") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_daily_visitor_channel_date" ON "storefront_daily_visitor" ("channelId", "businessDate") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_channel_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_coupon_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_campaign_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_coupon_ledger_idempotency"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "coupon_ledger_entry" RENAME TO "temporary_coupon_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "coupon_ledger_entry" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "customerCouponId" integer NOT NULL, "promotionId" integer NOT NULL, "customerId" integer NOT NULL, "orderId" integer, "refundId" integer, "eventType" varchar(24) NOT NULL, "actorType" varchar(16) NOT NULL, "idempotencyKey" varchar(255), "discountAmount" int, "note" varchar(500), "metadata" text, CONSTRAINT "FK_coupon_ledger_refund" FOREIGN KEY ("refundId") REFERENCES "refund" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_promotion" FOREIGN KEY ("promotionId") REFERENCES "promotion" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_coupon" FOREIGN KEY ("customerCouponId") REFERENCES "customer_coupon" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_coupon_ledger_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "coupon_ledger_entry"("id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "eventType", "actorType", "idempotencyKey", "discountAmount", "note", "metadata") SELECT "id", "createdAt", "updatedAt", "channelId", "customerCouponId", "promotionId", "customerId", "orderId", "refundId", "eventType", "actorType", "idempotencyKey", "discountAmount", "note", "metadata" FROM "temporary_coupon_ledger_entry"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_coupon_ledger_entry"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_channel_created" ON "coupon_ledger_entry" ("channelId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_coupon_created" ON "coupon_ledger_entry" ("customerCouponId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_coupon_ledger_campaign_created" ON "coupon_ledger_entry" ("promotionId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_coupon_ledger_idempotency" ON "coupon_ledger_entry" ("idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_quote"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_match_key"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_transaction"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_storefront_usdt_intent_status_expiry"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "storefront_usdt_payment_intent" RENAME TO "temporary_storefront_usdt_payment_intent"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "storefront_usdt_payment_intent" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "orderId" integer NOT NULL, "quoteId" integer NOT NULL, "paymentId" integer, "network" varchar(16) NOT NULL, "tokenContractAddress" varchar(64) NOT NULL, "receivingAddress" varchar(64) NOT NULL, "receivingAddressFingerprint" varchar(64) NOT NULL, "matchKey" varchar(64) NOT NULL, "baseUsdtAmount" decimal(24,6) NOT NULL, "expectedUsdtAmount" decimal(24,6) NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "transactionId" varchar(80), "senderAddress" varchar(64), "receivedUsdtAmount" decimal(24,6), "blockNumber" int, "blockTimestamp" datetime, "lastCheckedAt" datetime, "settledAt" datetime, "failureReason" varchar(500), "expiresAt" datetime NOT NULL, CONSTRAINT "FK_storefront_usdt_intent_payment" FOREIGN KEY ("paymentId") REFERENCES "payment" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_quote" FOREIGN KEY ("quoteId") REFERENCES "storefront_usdt_checkout_quote" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_storefront_usdt_intent_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "storefront_usdt_payment_intent"("createdAt", "updatedAt", "id", "channelId", "orderId", "quoteId", "paymentId", "network", "tokenContractAddress", "receivingAddress", "receivingAddressFingerprint", "matchKey", "baseUsdtAmount", "expectedUsdtAmount", "status", "transactionId", "senderAddress", "receivedUsdtAmount", "blockNumber", "blockTimestamp", "lastCheckedAt", "settledAt", "failureReason", "expiresAt") SELECT "createdAt", "updatedAt", "id", "channelId", "orderId", "quoteId", "paymentId", "network", "tokenContractAddress", "receivingAddress", "receivingAddressFingerprint", "matchKey", "baseUsdtAmount", "expectedUsdtAmount", "status", "transactionId", "senderAddress", "receivedUsdtAmount", "blockNumber", "blockTimestamp", "lastCheckedAt", "settledAt", "failureReason", "expiresAt" FROM "temporary_storefront_usdt_payment_intent"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_storefront_usdt_payment_intent"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_quote" ON "storefront_usdt_payment_intent" ("quoteId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_match_key" ON "storefront_usdt_payment_intent" ("matchKey") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_storefront_usdt_intent_transaction" ON "storefront_usdt_payment_intent" ("transactionId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_storefront_usdt_intent_status_expiry" ON "storefront_usdt_payment_intent" ("status", "expiresAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_store_profile_logo_asset"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_profile_public_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_profile_channel"`, undefined);
        await queryRunner.query(`ALTER TABLE "store_profile" RENAME TO "temporary_store_profile"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "store_profile" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "status" varchar(20) NOT NULL DEFAULT ('DRAFT'), "isPublished" boolean NOT NULL DEFAULT (0), "sortOrder" int NOT NULL DEFAULT (0), "descriptionZh" text NOT NULL, "descriptionEn" text NOT NULL, "logoAssetId" integer, "internalNote" text, CONSTRAINT "FK_store_profile_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_store_profile_logo_asset" FOREIGN KEY ("logoAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "store_profile"("id", "createdAt", "updatedAt", "channelId", "status", "isPublished", "sortOrder", "descriptionZh", "descriptionEn", "logoAssetId", "internalNote") SELECT "id", "createdAt", "updatedAt", "channelId", "status", "isPublished", "sortOrder", "descriptionZh", "descriptionEn", "logoAssetId", "internalNote" FROM "temporary_store_profile"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_store_profile"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_store_profile_logo_asset" ON "store_profile" ("logoAssetId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_profile_public_order" ON "store_profile" ("status", "isPublished", "sortOrder") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_profile_channel" ON "store_profile" ("channelId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_withdrawal_code"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_referral_withdrawal_channel_status_created"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "referral_withdrawal" RENAME TO "temporary_referral_withdrawal"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "referral_withdrawal" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "walletId" integer NOT NULL, "customerId" integer NOT NULL, "code" varchar(32) NOT NULL, "currencyCode" varchar(3) NOT NULL, "amount" int NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('PENDING'), "payoutMethod" varchar(32) NOT NULL, "payoutAccountMasked" varchar(160) NOT NULL, "externalReference" varchar(160), "note" varchar(500), "requestedByAdministratorId" integer, "processedByAdministratorId" integer, "approvedAt" datetime, "paidAt" datetime, "rejectedAt" datetime, "cancelledAt" datetime, CONSTRAINT "FK_referral_withdrawal_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_withdrawal_wallet" FOREIGN KEY ("walletId") REFERENCES "referral_wallet" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_referral_withdrawal_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "referral_withdrawal"("id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "code", "currencyCode", "amount", "status", "payoutMethod", "payoutAccountMasked", "externalReference", "note", "requestedByAdministratorId", "processedByAdministratorId", "approvedAt", "paidAt", "rejectedAt", "cancelledAt") SELECT "id", "createdAt", "updatedAt", "channelId", "walletId", "customerId", "code", "currencyCode", "amount", "status", "payoutMethod", "payoutAccountMasked", "externalReference", "note", "requestedByAdministratorId", "processedByAdministratorId", "approvedAt", "paidAt", "rejectedAt", "cancelledAt" FROM "temporary_referral_withdrawal"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_referral_withdrawal"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_referral_withdrawal_code" ON "referral_withdrawal" ("code") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_referral_withdrawal_channel_status_created" ON "referral_withdrawal" ("channelId", "status", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_prompt_skill_hash"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "image_prompt_skill_release" RENAME TO "temporary_image_prompt_skill_release"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "image_prompt_skill_release" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "bundleVersion" int NOT NULL, "sourceHash" varchar(64) NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('INACTIVE'), "bundle" text NOT NULL, "activatedAt" datetime)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "image_prompt_skill_release"("createdAt", "updatedAt", "id", "bundleVersion", "sourceHash", "status", "bundle", "activatedAt") SELECT "createdAt", "updatedAt", "id", "bundleVersion", "sourceHash", "status", "bundle", "activatedAt" FROM "temporary_image_prompt_skill_release"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_image_prompt_skill_release"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_prompt_skill_hash" ON "image_prompt_skill_release" ("sourceHash") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_product"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_unit_variant"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_product_packaging_rule_channel_package_variant"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "product_packaging_rule" RENAME TO "temporary_product_packaging_rule"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "product_packaging_rule" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (true), "autoUnpack" boolean NOT NULL DEFAULT (true), "unitLabel" varchar(32) NOT NULL, "packageLabel" varchar(32) NOT NULL, "unitsPerPackage" int NOT NULL, "channelId" integer NOT NULL, "productId" integer NOT NULL, "unitVariantId" integer NOT NULL, "packageVariantId" integer NOT NULL, CONSTRAINT "FK_product_packaging_rule_package_variant" FOREIGN KEY ("packageVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_unit_variant" FOREIGN KEY ("unitVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_product" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_product_packaging_rule_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "product_packaging_rule"("id", "createdAt", "updatedAt", "enabled", "autoUnpack", "unitLabel", "packageLabel", "unitsPerPackage", "channelId", "productId", "unitVariantId", "packageVariantId") SELECT "id", "createdAt", "updatedAt", "enabled", "autoUnpack", "unitLabel", "packageLabel", "unitsPerPackage", "channelId", "productId", "unitVariantId", "packageVariantId" FROM "temporary_product_packaging_rule"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_product_packaging_rule"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_product" ON "product_packaging_rule" ("channelId", "productId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_unit_variant" ON "product_packaging_rule" ("channelId", "unitVariantId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_product_packaging_rule_channel_package_variant" ON "product_packaging_rule" ("channelId", "packageVariantId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_auto_card_config_channel_variant"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "auto_card_config" RENAME TO "temporary_auto_card_config"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "auto_card_config" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "enabled" boolean NOT NULL DEFAULT (true), "formatName" varchar(80) NOT NULL, "delimiter" varchar(16) NOT NULL DEFAULT ('----'), "fieldsJson" text NOT NULL, "instructions" text NOT NULL, "lowStockThreshold" int NOT NULL DEFAULT (5), "channelId" integer NOT NULL, "productVariantId" integer NOT NULL, "instructionsZh" text, "instructionsEn" text, CONSTRAINT "FK_auto_card_config_variant" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "auto_card_config"("id", "createdAt", "updatedAt", "enabled", "formatName", "delimiter", "fieldsJson", "instructions", "lowStockThreshold", "channelId", "productVariantId", "instructionsZh", "instructionsEn") SELECT "id", "createdAt", "updatedAt", "enabled", "formatName", "delimiter", "fieldsJson", "instructions", "lowStockThreshold", "channelId", "productVariantId", "instructionsZh", "instructionsEn" FROM "temporary_auto_card_config"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_auto_card_config"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_config_channel_variant" ON "auto_card_config" ("channelId", "productVariantId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_sequence"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_fingerprint"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_auto_card_pool_config_state_sequence"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "auto_card_pool_item" RENAME TO "temporary_auto_card_pool_item"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "auto_card_pool_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "state" varchar(16) NOT NULL DEFAULT ('AVAILABLE'), "sequence" int NOT NULL, "encryptedPayload" text NOT NULL, "fingerprint" varchar(64) NOT NULL, "assignedAt" datetime, "disabledReason" text, "configId" integer NOT NULL, "deliveryId" integer, "encryptedRawPayload" text, CONSTRAINT "FK_auto_card_pool_config" FOREIGN KEY ("configId") REFERENCES "auto_card_config" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_auto_card_pool_delivery" FOREIGN KEY ("deliveryId") REFERENCES "auto_card_delivery" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "auto_card_pool_item"("id", "createdAt", "updatedAt", "state", "sequence", "encryptedPayload", "fingerprint", "assignedAt", "disabledReason", "configId", "deliveryId", "encryptedRawPayload") SELECT "id", "createdAt", "updatedAt", "state", "sequence", "encryptedPayload", "fingerprint", "assignedAt", "disabledReason", "configId", "deliveryId", "encryptedRawPayload" FROM "temporary_auto_card_pool_item"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_auto_card_pool_item"`, undefined);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_pool_config_sequence" ON "auto_card_pool_item" ("configId", "sequence") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_auto_card_pool_config_fingerprint" ON "auto_card_pool_item" ("configId", "fingerprint") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_auto_card_pool_config_state_sequence" ON "auto_card_pool_item" ("configId", "state", "sequence") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_0e6f516053cf982b537836e21c"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_e38dca0d82fd64c7cf8aac8b8e"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_6e420052844edf3a5506d863ce"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "product_variant" RENAME TO "temporary_product_variant"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "product_variant" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "sku" varchar NOT NULL, "outOfStockThreshold" integer NOT NULL DEFAULT (0), "useGlobalOutOfStockThreshold" boolean NOT NULL DEFAULT (1), "trackInventory" varchar NOT NULL DEFAULT ('INHERIT'), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "taxCategoryId" integer, "productId" integer, "customFieldsFulfillmenttype" varchar(255) DEFAULT ('physical'), "customFieldsDigitaldeliverymode" varchar(255) DEFAULT ('manual_service'), "customFieldsDigitalstockpolicy" varchar(255) NOT NULL DEFAULT ('limited'), CONSTRAINT "FK_6e420052844edf3a5506d863ce6" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_e38dca0d82fd64c7cf8aac8b8ef" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e6f516053cf982b537836e21cf" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "product_variant"("createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId", "customFieldsFulfillmenttype", "customFieldsDigitaldeliverymode", "customFieldsDigitalstockpolicy") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId", "customFieldsFulfillmenttype", "customFieldsDigitaldeliverymode", "customFieldsDigitalstockpolicy" FROM "temporary_product_variant"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_product_variant"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_0e6f516053cf982b537836e21c" ON "product_variant" ("featuredAssetId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_e38dca0d82fd64c7cf8aac8b8e" ON "product_variant" ("taxCategoryId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_6e420052844edf3a5506d863ce" ON "product_variant" ("productId") `,
            undefined,
        );
    }

    private isSqlite(queryRunner: QueryRunner): boolean {
        return ['sqlite', 'better-sqlite3', 'sqljs'].includes(queryRunner.connection.options.type);
    }
}
