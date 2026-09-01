/* eslint-disable max-len -- generated SQLite schema SQL must remain byte-for-byte reviewable */
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aligns the development SQLite schema with the current entity metadata after all earlier migrations.
 * The generated rebuilds copy the same columns in and out; other database engines are untouched.
 */
export class AlignSqliteRuntimeSchema1788278400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!this.isSqlite(queryRunner)) return;

        await queryRunner.query(`DROP INDEX "IDX_catalog_import_row_job_action"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_catalog_import_row_job_number"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_catalog_import_row" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "jobId" integer NOT NULL, "rowNumber" int NOT NULL, "productKey" varchar(64) NOT NULL, "sourceKey" varchar(64) NOT NULL, "rowFingerprint" varchar(64) NOT NULL, "action" varchar(24) NOT NULL, "resolution" varchar(24), "targetProductId" integer, "targetVariantId" integer, "expectedProductUpdatedAt" datetime, "expectedVariantUpdatedAt" datetime, "normalizedData" text NOT NULL, "beforeSnapshot" text, "plannedChanges" text, "appliedSnapshot" text, "message" varchar(500), "appliedAt" datetime, CONSTRAINT "FK_catalog_import_row_job" FOREIGN KEY ("jobId") REFERENCES "catalog_import_job" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_catalog_import_row"("createdAt", "updatedAt", "id", "jobId", "rowNumber", "productKey", "sourceKey", "rowFingerprint", "action", "resolution", "targetProductId", "targetVariantId", "expectedProductUpdatedAt", "expectedVariantUpdatedAt", "normalizedData", "beforeSnapshot", "plannedChanges", "appliedSnapshot", "message", "appliedAt") SELECT "createdAt", "updatedAt", "id", "jobId", "rowNumber", "productKey", "sourceKey", "rowFingerprint", "action", "resolution", "targetProductId", "targetVariantId", "expectedProductUpdatedAt", "expectedVariantUpdatedAt", "normalizedData", "beforeSnapshot", "plannedChanges", "appliedSnapshot", "message", "appliedAt" FROM "catalog_import_row"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "catalog_import_row"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_catalog_import_row" RENAME TO "catalog_import_row"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_catalog_import_row_job_action" ON "catalog_import_row" ("jobId", "action") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_catalog_import_row_job_number" ON "catalog_import_row" ("jobId", "rowNumber") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_catalog_lot_movement_order_line"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_catalog_lot_movement_stock_lot"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_catalog_inventory_lot_movement" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "lotId" integer NOT NULL, "stockMovementId" integer NOT NULL, "orderLineId" integer, "variantId" integer NOT NULL, "stockLocationId" integer NOT NULL, "type" varchar(24) NOT NULL, "quantity" int NOT NULL, "actorId" varchar(64), CONSTRAINT "FK_catalog_lot_movement_location" FOREIGN KEY ("stockLocationId") REFERENCES "stock_location" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_catalog_lot_movement_variant" FOREIGN KEY ("variantId") REFERENCES "product_variant" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_catalog_lot_movement_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_catalog_lot_movement_stock" FOREIGN KEY ("stockMovementId") REFERENCES "stock_movement" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_catalog_lot_movement_lot" FOREIGN KEY ("lotId") REFERENCES "catalog_inventory_lot" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_catalog_inventory_lot_movement"("createdAt", "updatedAt", "id", "lotId", "stockMovementId", "orderLineId", "variantId", "stockLocationId", "type", "quantity", "actorId") SELECT "createdAt", "updatedAt", "id", "lotId", "stockMovementId", "orderLineId", "variantId", "stockLocationId", "type", "quantity", "actorId" FROM "catalog_inventory_lot_movement"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "catalog_inventory_lot_movement"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_catalog_inventory_lot_movement" RENAME TO "catalog_inventory_lot_movement"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_catalog_lot_movement_order_line" ON "catalog_inventory_lot_movement" ("orderLineId", "variantId", "stockLocationId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_catalog_lot_movement_stock_lot" ON "catalog_inventory_lot_movement" ("stockMovementId", "lotId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_private_asset_owner_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_private_asset_expiry"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_private_asset" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "customerId" integer NOT NULL, "kind" varchar(16) NOT NULL, "storageKey" varchar(255) NOT NULL, "originalName" varchar(80) NOT NULL, "mimeType" varchar(64) NOT NULL, "byteSize" integer NOT NULL, "width" integer NOT NULL, "height" integer NOT NULL, "sha256" varchar(64) NOT NULL, "expiresAt" datetime NOT NULL, "deletedAt" datetime, "providerMetadata" text, CONSTRAINT "FK_image_private_asset_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_image_private_asset_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
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
            `CREATE INDEX "IDX_image_private_asset_owner_created" ON "image_private_asset" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_private_asset_expiry" ON "image_private_asset" ("expiresAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_output_state_updated"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_output_job_index"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_output" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "jobId" integer NOT NULL, "outputIndex" integer NOT NULL, "state" varchar(24) NOT NULL DEFAULT ('QUEUED'), "attemptCount" integer NOT NULL DEFAULT (0), "providerIdempotencyKey" varchar(160) NOT NULL, "providerRequestId" varchar(200), "assetId" integer, "errorMessage" varchar(500), "unknownAt" datetime, "completedAt" datetime, "walletSettled" boolean NOT NULL DEFAULT (0), "refundedAt" datetime, "version" integer NOT NULL, "billingMode" varchar(16) NOT NULL DEFAULT ('PENDING'), "chargeAmount" int NOT NULL DEFAULT (0), "failureCode" varchar(48), CONSTRAINT "FK_image_generation_output_asset" FOREIGN KEY ("assetId") REFERENCES "image_private_asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_output_job" FOREIGN KEY ("jobId") REFERENCES "image_generation_job" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_output"("createdAt", "updatedAt", "id", "jobId", "outputIndex", "state", "attemptCount", "providerIdempotencyKey", "providerRequestId", "assetId", "errorMessage", "unknownAt", "completedAt", "walletSettled", "refundedAt", "version", "billingMode", "chargeAmount", "failureCode") SELECT "createdAt", "updatedAt", "id", "jobId", "outputIndex", "state", "attemptCount", "providerIdempotencyKey", "providerRequestId", "assetId", "errorMessage", "unknownAt", "completedAt", "walletSettled", "refundedAt", "version", "billingMode", "chargeAmount", "failureCode" FROM "image_generation_output"`,
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
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_output_job_index" ON "image_generation_output" ("jobId", "outputIndex") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_store_usdt_manual_refund_payment"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_usdt_manual_refund_channel_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_usdt_manual_refund_refund"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_usdt_manual_refund_transaction"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_store_usdt_manual_refund" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "paymentId" integer NOT NULL, "orderId" integer NOT NULL, "refundId" integer NOT NULL, "network" varchar(16) NOT NULL, "transactionId" varchar(64) NOT NULL, "usdtAmountBaseUnits" decimal(30,0) NOT NULL, "fromAddress" varchar(64) NOT NULL, "toAddress" varchar(64) NOT NULL, "blockNumber" int NOT NULL, "blockTimestamp" datetime NOT NULL, "operatorUserId" integer NOT NULL, "reason" varchar(500) NOT NULL, CONSTRAINT "FK_store_usdt_manual_refund_refund" FOREIGN KEY ("refundId") REFERENCES "refund" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_store_usdt_manual_refund_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_store_usdt_manual_refund_payment" FOREIGN KEY ("paymentId") REFERENCES "payment" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_store_usdt_manual_refund_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_store_usdt_manual_refund"("createdAt", "updatedAt", "id", "channelId", "paymentId", "orderId", "refundId", "network", "transactionId", "usdtAmountBaseUnits", "fromAddress", "toAddress", "blockNumber", "blockTimestamp", "operatorUserId", "reason") SELECT "createdAt", "updatedAt", "id", "channelId", "paymentId", "orderId", "refundId", "network", "transactionId", "usdtAmountBaseUnits", "fromAddress", "toAddress", "blockNumber", "blockTimestamp", "operatorUserId", "reason" FROM "store_usdt_manual_refund"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "store_usdt_manual_refund"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_store_usdt_manual_refund" RENAME TO "store_usdt_manual_refund"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_usdt_manual_refund_payment" ON "store_usdt_manual_refund" ("paymentId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_usdt_manual_refund_channel_created" ON "store_usdt_manual_refund" ("channelId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_usdt_manual_refund_refund" ON "store_usdt_manual_refund" ("refundId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_usdt_manual_refund_transaction" ON "store_usdt_manual_refund" ("network", "transactionId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_runtime_queue"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_runtime_status" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "queueName" varchar(64) NOT NULL, "workerId" varchar(96), "status" varchar(24), "heartbeatAt" datetime, "lastReconcileAt" datetime, "activeJobs" int, "lastError" varchar(500))`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_runtime_status"("createdAt", "updatedAt", "id", "queueName", "workerId", "status", "heartbeatAt", "lastReconcileAt", "activeJobs", "lastError") SELECT "createdAt", "updatedAt", "id", "queueName", "workerId", "status", "heartbeatAt", "lastReconcileAt", "activeJobs", "lastError" FROM "image_generation_runtime_status"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_generation_runtime_status"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_generation_runtime_status" RENAME TO "image_generation_runtime_status"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_runtime_queue" ON "image_generation_runtime_status" ("queueName") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_91a19e6613534949a4ce6e76ff"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_product" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "customFieldsFulfillmenttype" varchar(255) DEFAULT ('digital'), "customFieldsRefundpolicy" varchar(255) DEFAULT ('MERCHANT_REVIEW'), "customFieldsManualdeliveryslaminutes" integer DEFAULT (1440), "customFieldsSourcecreatedat" datetime(6), CONSTRAINT "FK_91a19e6613534949a4ce6e76ff8" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_product"("createdAt", "updatedAt", "deletedAt", "enabled", "id", "featuredAssetId", "customFieldsFulfillmenttype", "customFieldsRefundpolicy", "customFieldsManualdeliveryslaminutes", "customFieldsSourcecreatedat") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "id", "featuredAssetId", "customFieldsFulfillmenttype", "customFieldsRefundpolicy", "customFieldsManualdeliveryslaminutes", "customFieldsSourcecreatedat" FROM "product"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "product"`, undefined);
        await queryRunner.query(`ALTER TABLE "temporary_product" RENAME TO "product"`, undefined);
        await queryRunner.query(
            `CREATE INDEX "IDX_91a19e6613534949a4ce6e76ff" ON "product" ("featuredAssetId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_6e420052844edf3a5506d863ce"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_e38dca0d82fd64c7cf8aac8b8e"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_0e6f516053cf982b537836e21c"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_product_variant" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "sku" varchar NOT NULL, "outOfStockThreshold" integer NOT NULL DEFAULT (0), "useGlobalOutOfStockThreshold" boolean NOT NULL DEFAULT (1), "trackInventory" varchar NOT NULL DEFAULT ('INHERIT'), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "taxCategoryId" integer, "productId" integer, "customFieldsFulfillmenttype" varchar(255) DEFAULT ('digital'), "customFieldsDigitaldeliverymode" varchar(255) DEFAULT ('manual_service'), "customFieldsDigitalstockpolicy" varchar(255) DEFAULT ('limited'), "customFieldsBarcode" varchar(255), "customFieldsSpecification" varchar(255), "customFieldsSaleunit" varchar(255), "customFieldsPurchaseunit" varchar(255), "customFieldsPackagequantity" double precision DEFAULT (1), "customFieldsShelflifedays" integer, CONSTRAINT "FK_6e420052844edf3a5506d863ce6" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_e38dca0d82fd64c7cf8aac8b8ef" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e6f516053cf982b537836e21cf" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_product_variant"("createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId", "customFieldsFulfillmenttype", "customFieldsDigitaldeliverymode", "customFieldsDigitalstockpolicy", "customFieldsBarcode", "customFieldsSpecification", "customFieldsSaleunit", "customFieldsPurchaseunit", "customFieldsPackagequantity", "customFieldsShelflifedays") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId", "customFieldsFulfillmenttype", "customFieldsDigitaldeliverymode", "customFieldsDigitalstockpolicy", "customFieldsBarcode", "customFieldsSpecification", "customFieldsSaleunit", "customFieldsPurchaseunit", "customFieldsPackagequantity", "customFieldsShelflifedays" FROM "product_variant"`,
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
        await queryRunner.query(`DROP INDEX "IDX_catalog_supplier_channel_enabled"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_catalog_supplier_channel_name"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_catalog_supplier_channel_code"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_catalog_supplier" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "code" varchar(64) NOT NULL, "name" varchar(255) NOT NULL, "normalizedName" varchar(255) NOT NULL, "enabled" boolean NOT NULL DEFAULT (1), "contactName" varchar(120), "phone" varchar(80), "email" varchar(255), "address" varchar(500), "notes" text, CONSTRAINT "FK_catalog_supplier_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_catalog_supplier"("createdAt", "updatedAt", "id", "channelId", "code", "name", "normalizedName", "enabled", "contactName", "phone", "email", "address", "notes") SELECT "createdAt", "updatedAt", "id", "channelId", "code", "name", "normalizedName", "enabled", "contactName", "phone", "email", "address", "notes" FROM "catalog_supplier"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "catalog_supplier"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_catalog_supplier" RENAME TO "catalog_supplier"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_catalog_supplier_channel_name" ON "catalog_supplier" ("channelId", "normalizedName") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_catalog_supplier_channel_code" ON "catalog_supplier" ("channelId", "code") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_catalog_inventory_lot_expiry"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_catalog_inventory_lot_unique"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_catalog_inventory_lot" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "variantId" integer NOT NULL, "stockLocationId" integer NOT NULL, "lotCode" varchar(80) NOT NULL, "manufacturedAt" datetime, "expiresAt" datetime, "quantityOnHand" integer NOT NULL DEFAULT (0), "purchaseCostMicrounits" bigint, "currencyCode" varchar(3) NOT NULL, "state" varchar(24) NOT NULL DEFAULT ('ACTIVE'), "version" integer NOT NULL, CONSTRAINT "FK_catalog_inventory_lot_location" FOREIGN KEY ("stockLocationId") REFERENCES "stock_location" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_catalog_inventory_lot_variant" FOREIGN KEY ("variantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_catalog_inventory_lot"("createdAt", "updatedAt", "id", "variantId", "stockLocationId", "lotCode", "manufacturedAt", "expiresAt", "quantityOnHand", "purchaseCostMicrounits", "currencyCode", "state", "version") SELECT "createdAt", "updatedAt", "id", "variantId", "stockLocationId", "lotCode", "manufacturedAt", "expiresAt", "quantityOnHand", "purchaseCostMicrounits", "currencyCode", "state", "version" FROM "catalog_inventory_lot"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "catalog_inventory_lot"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_catalog_inventory_lot" RENAME TO "catalog_inventory_lot"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_catalog_inventory_lot_expiry" ON "catalog_inventory_lot" ("stockLocationId", "expiresAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_catalog_inventory_lot_unique" ON "catalog_inventory_lot" ("variantId", "stockLocationId", "lotCode") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_catalog_inventory_policy_variant_location"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_catalog_inventory_policy" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "variantId" integer NOT NULL, "stockLocationId" integer NOT NULL, "minimumStock" integer, "maximumStock" integer, CONSTRAINT "FK_catalog_inventory_policy_location" FOREIGN KEY ("stockLocationId") REFERENCES "stock_location" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_catalog_inventory_policy_variant" FOREIGN KEY ("variantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_catalog_inventory_policy"("createdAt", "updatedAt", "id", "variantId", "stockLocationId", "minimumStock", "maximumStock") SELECT "createdAt", "updatedAt", "id", "variantId", "stockLocationId", "minimumStock", "maximumStock" FROM "catalog_inventory_policy"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "catalog_inventory_policy"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_catalog_inventory_policy" RENAME TO "catalog_inventory_policy"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_catalog_inventory_policy_variant_location" ON "catalog_inventory_policy" ("variantId", "stockLocationId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_catalog_import_row_job_number"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_catalog_import_row_job_action"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_catalog_import_row" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "jobId" integer NOT NULL, "rowNumber" integer NOT NULL, "productKey" varchar(64) NOT NULL, "sourceKey" varchar(64) NOT NULL, "rowFingerprint" varchar(64) NOT NULL, "action" varchar(24) NOT NULL, "resolution" varchar(24), "targetProductId" integer, "targetVariantId" integer, "expectedProductUpdatedAt" datetime, "expectedVariantUpdatedAt" datetime, "normalizedData" text NOT NULL, "beforeSnapshot" text, "plannedChanges" text, "appliedSnapshot" text, "message" varchar(500), "appliedAt" datetime, CONSTRAINT "FK_catalog_import_row_job" FOREIGN KEY ("jobId") REFERENCES "catalog_import_job" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_catalog_import_row"("createdAt", "updatedAt", "id", "jobId", "rowNumber", "productKey", "sourceKey", "rowFingerprint", "action", "resolution", "targetProductId", "targetVariantId", "expectedProductUpdatedAt", "expectedVariantUpdatedAt", "normalizedData", "beforeSnapshot", "plannedChanges", "appliedSnapshot", "message", "appliedAt") SELECT "createdAt", "updatedAt", "id", "jobId", "rowNumber", "productKey", "sourceKey", "rowFingerprint", "action", "resolution", "targetProductId", "targetVariantId", "expectedProductUpdatedAt", "expectedVariantUpdatedAt", "normalizedData", "beforeSnapshot", "plannedChanges", "appliedSnapshot", "message", "appliedAt" FROM "catalog_import_row"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "catalog_import_row"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_catalog_import_row" RENAME TO "catalog_import_row"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_catalog_import_row_job_action" ON "catalog_import_row" ("jobId", "action") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_catalog_import_job_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_catalog_import_job_context_hash"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_catalog_import_job" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "stockLocationId" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, "originalFilename" varchar(255) NOT NULL, "mimeType" varchar(120) NOT NULL, "byteSize" integer NOT NULL, "fileHash" varchar(64) NOT NULL, "state" varchar(24) NOT NULL DEFAULT ('PREVIEW_READY'), "actorId" varchar(64), "totalRows" integer NOT NULL DEFAULT (0), "createdCount" integer NOT NULL DEFAULT (0), "updatedCount" integer NOT NULL DEFAULT (0), "skippedCount" integer NOT NULL DEFAULT (0), "conflictCount" integer NOT NULL DEFAULT (0), "warningCount" integer NOT NULL DEFAULT (0), "errorCount" integer NOT NULL DEFAULT (0), "progress" integer NOT NULL DEFAULT (0), "errorMessage" varchar(500), "startedAt" datetime, "completedAt" datetime, "rolledBackAt" datetime, "version" integer NOT NULL, "sheetName" varchar(255), "detectedHeaders" text, "fieldMapping" text, "clearBlankFields" boolean NOT NULL DEFAULT (0), CONSTRAINT "FK_catalog_import_job_stock_location" FOREIGN KEY ("stockLocationId") REFERENCES "stock_location" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_catalog_import_job_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_catalog_import_job"("createdAt", "updatedAt", "id", "channelId", "stockLocationId", "currencyCode", "originalFilename", "mimeType", "byteSize", "fileHash", "state", "actorId", "totalRows", "createdCount", "updatedCount", "skippedCount", "conflictCount", "warningCount", "errorCount", "progress", "errorMessage", "startedAt", "completedAt", "rolledBackAt", "version", "sheetName", "detectedHeaders", "fieldMapping", "clearBlankFields") SELECT "createdAt", "updatedAt", "id", "channelId", "stockLocationId", "currencyCode", "originalFilename", "mimeType", "byteSize", "fileHash", "state", "actorId", "totalRows", "createdCount", "updatedCount", "skippedCount", "conflictCount", "warningCount", "errorCount", "progress", "errorMessage", "startedAt", "completedAt", "rolledBackAt", "version", "sheetName", "detectedHeaders", "fieldMapping", "clearBlankFields" FROM "catalog_import_job"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "catalog_import_job"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_catalog_import_job" RENAME TO "catalog_import_job"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_catalog_import_job_state_created" ON "catalog_import_job" ("state", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_catalog_import_job_context_hash" ON "catalog_import_job" ("channelId", "stockLocationId", "currencyCode", "fileHash") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_catalog_lot_movement_order_line"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_catalog_lot_movement_stock_lot"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_catalog_inventory_lot_movement" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "lotId" integer NOT NULL, "stockMovementId" integer NOT NULL, "orderLineId" integer, "variantId" integer NOT NULL, "stockLocationId" integer NOT NULL, "type" varchar(24) NOT NULL, "quantity" integer NOT NULL, "actorId" varchar(64), CONSTRAINT "FK_catalog_lot_movement_location" FOREIGN KEY ("stockLocationId") REFERENCES "stock_location" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_catalog_lot_movement_variant" FOREIGN KEY ("variantId") REFERENCES "product_variant" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_catalog_lot_movement_order_line" FOREIGN KEY ("orderLineId") REFERENCES "order_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_catalog_lot_movement_stock" FOREIGN KEY ("stockMovementId") REFERENCES "stock_movement" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_catalog_lot_movement_lot" FOREIGN KEY ("lotId") REFERENCES "catalog_inventory_lot" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_catalog_inventory_lot_movement"("createdAt", "updatedAt", "id", "lotId", "stockMovementId", "orderLineId", "variantId", "stockLocationId", "type", "quantity", "actorId") SELECT "createdAt", "updatedAt", "id", "lotId", "stockMovementId", "orderLineId", "variantId", "stockLocationId", "type", "quantity", "actorId" FROM "catalog_inventory_lot_movement"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "catalog_inventory_lot_movement"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_catalog_inventory_lot_movement" RENAME TO "catalog_inventory_lot_movement"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_catalog_lot_movement_order_line" ON "catalog_inventory_lot_movement" ("orderLineId", "variantId", "stockLocationId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_catalog_lot_movement_stock_lot" ON "catalog_inventory_lot_movement" ("stockMovementId", "lotId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_compliance_audit_channel_created"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_compliance_audit_event" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "actorId" integer, "customerIdSnapshot" varchar(64) NOT NULL, "action" varchar(32) NOT NULL, "reason" varchar(500) NOT NULL, "affectedPromptRecords" integer NOT NULL DEFAULT (0), "affectedJobs" integer NOT NULL DEFAULT (0), "metadata" text, CONSTRAINT "FK_image_compliance_audit_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_compliance_audit_event"("createdAt", "updatedAt", "id", "channelId", "actorId", "customerIdSnapshot", "action", "reason", "affectedPromptRecords", "affectedJobs", "metadata") SELECT "createdAt", "updatedAt", "id", "channelId", "actorId", "customerIdSnapshot", "action", "reason", "affectedPromptRecords", "affectedJobs", "metadata" FROM "image_compliance_audit_event"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_compliance_audit_event"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_compliance_audit_event" RENAME TO "image_compliance_audit_event"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_compliance_audit_channel_created" ON "image_compliance_audit_event" ("channelId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_config_channel"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_config" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "enabled" boolean NOT NULL DEFAULT (0), "promptOptimizationEnabled" boolean NOT NULL DEFAULT (1), "defaultModelCode" varchar(48) NOT NULL DEFAULT ('OPENAI_HIGH_QUALITY'), "termsVersion" varchar(32) NOT NULL DEFAULT ('2026-08-28-audit'), "termsZh" text NOT NULL, "termsEn" text NOT NULL, "promptRateLimitPerMinute" integer NOT NULL DEFAULT (3), "promptDailyFreeLimit" integer NOT NULL DEFAULT (20), "promptDailyFreeUnlimited" boolean NOT NULL DEFAULT (0), "paidPromptOptimizationEnabled" boolean NOT NULL DEFAULT (0), "paidPromptOptimizationPrice" integer NOT NULL DEFAULT (0), "paidPromptOptimizationCurrencyCode" varchar(3) NOT NULL DEFAULT ('CNY'), CONSTRAINT "FK_image_generation_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_config"("createdAt", "updatedAt", "id", "channelId", "enabled", "promptOptimizationEnabled", "defaultModelCode", "termsVersion", "termsZh", "termsEn", "promptRateLimitPerMinute", "promptDailyFreeLimit", "promptDailyFreeUnlimited", "paidPromptOptimizationEnabled", "paidPromptOptimizationPrice", "paidPromptOptimizationCurrencyCode") SELECT "createdAt", "updatedAt", "id", "channelId", "enabled", "promptOptimizationEnabled", "defaultModelCode", "termsVersion", "termsZh", "termsEn", "promptRateLimitPerMinute", "promptDailyFreeLimit", "promptDailyFreeUnlimited", "paidPromptOptimizationEnabled", "paidPromptOptimizationPrice", "paidPromptOptimizationCurrencyCode" FROM "image_generation_config"`,
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
        await queryRunner.query(`DROP INDEX "IDX_image_generation_cost_output_attempt"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_cost_channel_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_cost_model_created"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_cost_event" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "jobIdSnapshot" varchar(64) NOT NULL, "outputIdSnapshot" varchar(64) NOT NULL, "attemptNumber" integer NOT NULL, "modelCodeSnapshot" varchar(48) NOT NULL, "providerScopeSnapshot" varchar(24) NOT NULL, "credentialFingerprint" varchar(64) NOT NULL, "saleUnitPriceSnapshot" integer NOT NULL, "saleCurrencyCode" varchar(3) NOT NULL, "outcome" varchar(24) NOT NULL, "httpStatus" integer, "providerRequestId" varchar(200), "latencyMs" integer NOT NULL, "actualCostMicrounits" integer, "costCurrency" varchar(3), "usage" text, "errorMessage" varchar(500), "credentialCodeSnapshot" varchar(64) NOT NULL DEFAULT (''), "credentialNameSnapshot" varchar(120) NOT NULL DEFAULT (''), "credentialLast4Snapshot" varchar(8) NOT NULL DEFAULT (''), "credentialSelectionReason" varchar(160), "failureCode" varchar(48), "providerStage" varchar(32), CONSTRAINT "FK_image_generation_cost_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_cost_event"("createdAt", "updatedAt", "id", "channelId", "jobIdSnapshot", "outputIdSnapshot", "attemptNumber", "modelCodeSnapshot", "providerScopeSnapshot", "credentialFingerprint", "saleUnitPriceSnapshot", "saleCurrencyCode", "outcome", "httpStatus", "providerRequestId", "latencyMs", "actualCostMicrounits", "costCurrency", "usage", "errorMessage", "credentialCodeSnapshot", "credentialNameSnapshot", "credentialLast4Snapshot", "credentialSelectionReason", "failureCode", "providerStage") SELECT "createdAt", "updatedAt", "id", "channelId", "jobIdSnapshot", "outputIdSnapshot", "attemptNumber", "modelCodeSnapshot", "providerScopeSnapshot", "credentialFingerprint", "saleUnitPriceSnapshot", "saleCurrencyCode", "outcome", "httpStatus", "providerRequestId", "latencyMs", "actualCostMicrounits", "costCurrency", "usage", "errorMessage", "credentialCodeSnapshot", "credentialNameSnapshot", "credentialLast4Snapshot", "credentialSelectionReason", "failureCode", "providerStage" FROM "image_generation_cost_event"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_generation_cost_event"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_generation_cost_event" RENAME TO "image_generation_cost_event"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_generation_cost_channel_created" ON "image_generation_cost_event" ("channelId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_generation_cost_model_created" ON "image_generation_cost_event" ("modelCodeSnapshot", "createdAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_model_config_channel_code"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_model_config_channel_position"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_model_config" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "code" varchar(48) NOT NULL, "enabled" boolean NOT NULL DEFAULT (0), "displayNameZh" varchar(120) NOT NULL, "displayNameEn" varchar(120) NOT NULL, "officialModelId" varchar(160) NOT NULL, "providerModelId" varchar(160) NOT NULL, "protocol" varchar(32) NOT NULL, "unitPrice" integer NOT NULL DEFAULT (0), "currencyCode" varchar(3) NOT NULL, "position" integer NOT NULL DEFAULT (0), "isDefault" boolean NOT NULL DEFAULT (0), "healthStatus" varchar(24) NOT NULL DEFAULT ('UNTESTED'), "descriptionZh" varchar(500) NOT NULL, "descriptionEn" varchar(500) NOT NULL, "healthMessage" varchar(500), "lastTestedAt" datetime, "supportsIdempotency" boolean NOT NULL DEFAULT (0), "consecutiveFailures" integer NOT NULL DEFAULT (0), "unitPrice2K" integer NOT NULL DEFAULT (0), "unitPrice4K" integer NOT NULL DEFAULT (0), "freeImageEnabled" boolean NOT NULL DEFAULT (0), "dailyFreeImageLimit" integer NOT NULL DEFAULT (0), "dailyFreeImageUnlimited" boolean NOT NULL DEFAULT (0), "paidAfterFreeEnabled" boolean NOT NULL DEFAULT (1), "dailyGenerationSafetyLimit" integer NOT NULL DEFAULT (20), CONSTRAINT "FK_image_model_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_model_config"("createdAt", "updatedAt", "id", "channelId", "code", "enabled", "displayNameZh", "displayNameEn", "officialModelId", "providerModelId", "protocol", "unitPrice", "currencyCode", "position", "isDefault", "healthStatus", "descriptionZh", "descriptionEn", "healthMessage", "lastTestedAt", "supportsIdempotency", "consecutiveFailures", "unitPrice2K", "unitPrice4K", "freeImageEnabled", "dailyFreeImageLimit", "dailyFreeImageUnlimited", "paidAfterFreeEnabled", "dailyGenerationSafetyLimit") SELECT "createdAt", "updatedAt", "id", "channelId", "code", "enabled", "displayNameZh", "displayNameEn", "officialModelId", "providerModelId", "protocol", "unitPrice", "currencyCode", "position", "isDefault", "healthStatus", "descriptionZh", "descriptionEn", "healthMessage", "lastTestedAt", "supportsIdempotency", "consecutiveFailures", "unitPrice2K", "unitPrice4K", "freeImageEnabled", "dailyFreeImageLimit", "dailyFreeImageUnlimited", "paidAfterFreeEnabled", "dailyGenerationSafetyLimit" FROM "image_model_config"`,
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
        await queryRunner.query(
            `CREATE INDEX "IDX_image_model_config_channel_position" ON "image_model_config" ("channelId", "position") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_private_asset_owner_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_private_asset_expiry"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_private_asset" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "customerId" integer NOT NULL, "kind" varchar(16) NOT NULL, "storageKey" varchar(255) NOT NULL, "originalName" varchar(80) NOT NULL, "mimeType" varchar(64) NOT NULL, "byteSize" integer NOT NULL, "width" integer NOT NULL, "height" integer NOT NULL, "sha256" varchar(64) NOT NULL, "expiresAt" datetime NOT NULL, "deletedAt" datetime, "providerMetadata" text, CONSTRAINT "FK_image_private_asset_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_image_private_asset_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
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
            `CREATE INDEX "IDX_image_private_asset_owner_created" ON "image_private_asset" ("customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_private_asset_expiry" ON "image_private_asset" ("expiresAt") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_job_state_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_job_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_job_idempotency"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_job" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "customerId" integer NOT NULL, "modelConfigId" integer NOT NULL, "referenceAssetId" integer, "idempotencyKey" varchar(64) NOT NULL, "modelCodeSnapshot" varchar(48) NOT NULL, "modelNameSnapshot" varchar(120) NOT NULL, "officialModelIdSnapshot" varchar(160) NOT NULL, "providerModelIdSnapshot" varchar(160) NOT NULL, "protocolSnapshot" varchar(32) NOT NULL, "originalPrompt" text NOT NULL, "finalPrompt" text NOT NULL, "promptSpec" text, "promptSkillHash" varchar(64) NOT NULL, "referenceMode" varchar(24) NOT NULL DEFAULT ('NONE'), "aspectRatio" varchar(8) NOT NULL, "quantity" integer NOT NULL, "unitPriceSnapshot" integer NOT NULL, "reservedAmount" integer NOT NULL, "capturedAmount" integer NOT NULL DEFAULT (0), "releasedAmount" integer NOT NULL DEFAULT (0), "currencyCode" varchar(3) NOT NULL, "walletUsageId" integer, "state" varchar(24) NOT NULL DEFAULT ('QUEUED'), "termsVersion" varchar(32) NOT NULL, "termsAcceptedAt" datetime NOT NULL, "errorMessage" varchar(500), "completedAt" datetime, "version" integer NOT NULL, "providerScopeSnapshot" varchar(24) NOT NULL, "providerCredentialFingerprint" varchar(64) NOT NULL, "providerIdempotencySupportedSnapshot" boolean NOT NULL DEFAULT (0), "resolution" varchar(2) NOT NULL DEFAULT ('1K'), "providerCredentialCodeSnapshot" varchar(64) NOT NULL DEFAULT (''), "providerCredentialNameSnapshot" varchar(120) NOT NULL DEFAULT (''), "providerCredentialLast4Snapshot" varchar(8) NOT NULL DEFAULT (''), "providerSelectionReason" varchar(160), "expectedChargeAmount" integer NOT NULL DEFAULT (0), "freeQuantityReserved" integer NOT NULL DEFAULT (0), "freeQuantityCaptured" integer NOT NULL DEFAULT (0), "paidQuantityReserved" integer NOT NULL DEFAULT (0), "quotaEventId" integer, "customerDeletedAt" datetime, "pricingSnapshot" text, CONSTRAINT "FK_image_generation_job_reference" FOREIGN KEY ("referenceAssetId") REFERENCES "image_private_asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_job_model" FOREIGN KEY ("modelConfigId") REFERENCES "image_model_config" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_job_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_job_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_job"("createdAt", "updatedAt", "id", "channelId", "customerId", "modelConfigId", "referenceAssetId", "idempotencyKey", "modelCodeSnapshot", "modelNameSnapshot", "officialModelIdSnapshot", "providerModelIdSnapshot", "protocolSnapshot", "originalPrompt", "finalPrompt", "promptSpec", "promptSkillHash", "referenceMode", "aspectRatio", "quantity", "unitPriceSnapshot", "reservedAmount", "capturedAmount", "releasedAmount", "currencyCode", "walletUsageId", "state", "termsVersion", "termsAcceptedAt", "errorMessage", "completedAt", "version", "providerScopeSnapshot", "providerCredentialFingerprint", "providerIdempotencySupportedSnapshot", "resolution", "providerCredentialCodeSnapshot", "providerCredentialNameSnapshot", "providerCredentialLast4Snapshot", "providerSelectionReason", "expectedChargeAmount", "freeQuantityReserved", "freeQuantityCaptured", "paidQuantityReserved", "quotaEventId", "customerDeletedAt", "pricingSnapshot") SELECT "createdAt", "updatedAt", "id", "channelId", "customerId", "modelConfigId", "referenceAssetId", "idempotencyKey", "modelCodeSnapshot", "modelNameSnapshot", "officialModelIdSnapshot", "providerModelIdSnapshot", "protocolSnapshot", "originalPrompt", "finalPrompt", "promptSpec", "promptSkillHash", "referenceMode", "aspectRatio", "quantity", "unitPriceSnapshot", "reservedAmount", "capturedAmount", "releasedAmount", "currencyCode", "walletUsageId", "state", "termsVersion", "termsAcceptedAt", "errorMessage", "completedAt", "version", "providerScopeSnapshot", "providerCredentialFingerprint", "providerIdempotencySupportedSnapshot", "resolution", "providerCredentialCodeSnapshot", "providerCredentialNameSnapshot", "providerCredentialLast4Snapshot", "providerSelectionReason", "expectedChargeAmount", "freeQuantityReserved", "freeQuantityCaptured", "paidQuantityReserved", "quotaEventId", "customerDeletedAt", "pricingSnapshot" FROM "image_generation_job"`,
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
        await queryRunner.query(`DROP INDEX "IDX_image_generation_output_state_updated"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_output_job_index"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_output" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "jobId" integer NOT NULL, "outputIndex" integer NOT NULL, "state" varchar(24) NOT NULL DEFAULT ('QUEUED'), "attemptCount" integer NOT NULL DEFAULT (0), "providerIdempotencyKey" varchar(160) NOT NULL, "providerRequestId" varchar(200), "assetId" integer, "errorMessage" varchar(500), "unknownAt" datetime, "completedAt" datetime, "walletSettled" boolean NOT NULL DEFAULT (0), "refundedAt" datetime, "version" integer NOT NULL, "billingMode" varchar(16) NOT NULL DEFAULT ('PENDING'), "chargeAmount" integer NOT NULL DEFAULT (0), "failureCode" varchar(48), CONSTRAINT "FK_image_generation_output_asset" FOREIGN KEY ("assetId") REFERENCES "image_private_asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_image_generation_output_job" FOREIGN KEY ("jobId") REFERENCES "image_generation_job" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_output"("createdAt", "updatedAt", "id", "jobId", "outputIndex", "state", "attemptCount", "providerIdempotencyKey", "providerRequestId", "assetId", "errorMessage", "unknownAt", "completedAt", "walletSettled", "refundedAt", "version", "billingMode", "chargeAmount", "failureCode") SELECT "createdAt", "updatedAt", "id", "jobId", "outputIndex", "state", "attemptCount", "providerIdempotencyKey", "providerRequestId", "assetId", "errorMessage", "unknownAt", "completedAt", "walletSettled", "refundedAt", "version", "billingMode", "chargeAmount", "failureCode" FROM "image_generation_output"`,
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
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_output_job_index" ON "image_generation_output" ("jobId", "outputIndex") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_dispatch_state_next"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_dispatch_output"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_dispatch" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "outputId" integer NOT NULL, "state" varchar(24) NOT NULL DEFAULT ('PENDING'), "attemptCount" int NOT NULL DEFAULT (0), "nextAttemptAt" datetime NOT NULL, "dispatchedAt" datetime, "lastError" varchar(500), "queueTaskId" varchar(120), "processingStage" varchar(32), "heartbeatAt" datetime, "stagedAssetId" integer)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_dispatch"("createdAt", "updatedAt", "id", "outputId", "state", "attemptCount", "nextAttemptAt", "dispatchedAt", "lastError", "queueTaskId", "processingStage", "heartbeatAt", "stagedAssetId") SELECT "createdAt", "updatedAt", "id", "outputId", "state", "attemptCount", "nextAttemptAt", "dispatchedAt", "lastError", "queueTaskId", "processingStage", "heartbeatAt", "stagedAssetId" FROM "image_generation_dispatch"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_generation_dispatch"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_generation_dispatch" RENAME TO "image_generation_dispatch"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_generation_dispatch_state_next" ON "image_generation_dispatch" ("state", "nextAttemptAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_dispatch_output" ON "image_generation_dispatch" ("outputId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_dispatch_state_next"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_dispatch_output"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_dispatch" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "outputId" integer NOT NULL, "state" varchar(24) NOT NULL DEFAULT ('PENDING'), "attemptCount" integer NOT NULL DEFAULT (0), "nextAttemptAt" datetime NOT NULL, "dispatchedAt" datetime, "lastError" varchar(500), "queueTaskId" varchar(120), "processingStage" varchar(32), "heartbeatAt" datetime, "stagedAssetId" integer, CONSTRAINT "UQ_17a8fe07de6a2cd3025bfdb578d" UNIQUE ("outputId"))`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_dispatch"("createdAt", "updatedAt", "id", "outputId", "state", "attemptCount", "nextAttemptAt", "dispatchedAt", "lastError", "queueTaskId", "processingStage", "heartbeatAt", "stagedAssetId") SELECT "createdAt", "updatedAt", "id", "outputId", "state", "attemptCount", "nextAttemptAt", "dispatchedAt", "lastError", "queueTaskId", "processingStage", "heartbeatAt", "stagedAssetId" FROM "image_generation_dispatch"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_generation_dispatch"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_generation_dispatch" RENAME TO "image_generation_dispatch"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_generation_dispatch_state_next" ON "image_generation_dispatch" ("state", "nextAttemptAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_dispatch_output" ON "image_generation_dispatch" ("outputId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_prompt_optimization_customer_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_prompt_optimization_idempotency"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_prompt_optimization" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "customerId" integer NOT NULL, "inputPrompt" text NOT NULL, "optimizedPrompt" text NOT NULL, "promptSpec" text NOT NULL, "source" varchar(16) NOT NULL, "optimizerModelId" varchar(160), "promptSkillHash" varchar(64) NOT NULL, "recommendedModelCode" varchar(48) NOT NULL, "recommendationReason" varchar(300) NOT NULL, "idempotencyKey" varchar(64), "billingMode" varchar(16) NOT NULL DEFAULT ('FREE'), "chargedAmount" integer NOT NULL DEFAULT (0), "currencyCode" varchar(3) NOT NULL DEFAULT ('CNY'), "walletUsageId" integer, "quotaEventId" integer, "inputTokens" integer, "outputTokens" integer, "totalTokens" integer, "actualCostMicrounits" integer, "costCurrency" varchar(3), "providerRequestId" varchar(200), "credentialCodeSnapshot" varchar(64) NOT NULL DEFAULT (''), "credentialNameSnapshot" varchar(120) NOT NULL DEFAULT (''), "credentialLast4Snapshot" varchar(8) NOT NULL DEFAULT (''), "credentialSelectionReason" varchar(160), "upstreamCallCount" integer NOT NULL DEFAULT (0), "latencyMs" integer NOT NULL DEFAULT (0), "errorMessage" varchar(500), "pricingSnapshot" text, CONSTRAINT "FK_image_prompt_optimization_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_image_prompt_optimization_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_prompt_optimization"("createdAt", "updatedAt", "id", "channelId", "customerId", "inputPrompt", "optimizedPrompt", "promptSpec", "source", "optimizerModelId", "promptSkillHash", "recommendedModelCode", "recommendationReason", "idempotencyKey", "billingMode", "chargedAmount", "currencyCode", "walletUsageId", "quotaEventId", "inputTokens", "outputTokens", "totalTokens", "actualCostMicrounits", "costCurrency", "providerRequestId", "credentialCodeSnapshot", "credentialNameSnapshot", "credentialLast4Snapshot", "credentialSelectionReason", "upstreamCallCount", "latencyMs", "errorMessage", "pricingSnapshot") SELECT "createdAt", "updatedAt", "id", "channelId", "customerId", "inputPrompt", "optimizedPrompt", "promptSpec", "source", "optimizerModelId", "promptSkillHash", "recommendedModelCode", "recommendationReason", "idempotencyKey", "billingMode", "chargedAmount", "currencyCode", "walletUsageId", "quotaEventId", "inputTokens", "outputTokens", "totalTokens", "actualCostMicrounits", "costCurrency", "providerRequestId", "credentialCodeSnapshot", "credentialNameSnapshot", "credentialLast4Snapshot", "credentialSelectionReason", "upstreamCallCount", "latencyMs", "errorMessage", "pricingSnapshot" FROM "image_prompt_optimization"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_prompt_optimization"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_prompt_optimization" RENAME TO "image_prompt_optimization"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_prompt_optimization_customer_created" ON "image_prompt_optimization" ("channelId", "customerId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_prompt_optimization_idempotency" ON "image_prompt_optimization" ("channelId", "customerId", "idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_provider_credential_route"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_provider_credential_code"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_provider_credential" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "scope" varchar(24) NOT NULL DEFAULT ('GLOBAL'), "enabled" boolean NOT NULL DEFAULT (0), "baseUrl" varchar(500) NOT NULL, "encryptedApiKey" text NOT NULL, "apiKeyLast4" varchar(8) NOT NULL DEFAULT (''), "textModelId" varchar(160) NOT NULL DEFAULT (''), "lastTestedAt" datetime, "healthStatus" varchar(24) NOT NULL DEFAULT ('UNTESTED'), "healthMessage" varchar(500), "code" varchar(64) NOT NULL, "name" varchar(120) NOT NULL, "purpose" varchar(24) NOT NULL DEFAULT ('BOTH'), "priority" integer NOT NULL DEFAULT (100), "weight" integer NOT NULL DEFAULT (1), "currentWeight" integer NOT NULL DEFAULT (0), "consecutiveFailures" integer NOT NULL DEFAULT (0), "cooldownUntil" datetime, "lastUsedAt" datetime, "archivedAt" datetime, "orchestrationModelId" varchar(160) NOT NULL DEFAULT (''))`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_provider_credential"("createdAt", "updatedAt", "id", "scope", "enabled", "baseUrl", "encryptedApiKey", "apiKeyLast4", "textModelId", "lastTestedAt", "healthStatus", "healthMessage", "code", "name", "purpose", "priority", "weight", "currentWeight", "consecutiveFailures", "cooldownUntil", "lastUsedAt", "archivedAt", "orchestrationModelId") SELECT "createdAt", "updatedAt", "id", "scope", "enabled", "baseUrl", "encryptedApiKey", "apiKeyLast4", "textModelId", "lastTestedAt", "healthStatus", "healthMessage", "code", "name", "purpose", "priority", "weight", "currentWeight", "consecutiveFailures", "cooldownUntil", "lastUsedAt", "archivedAt", "orchestrationModelId" FROM "image_provider_credential"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_provider_credential"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_provider_credential" RENAME TO "image_provider_credential"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_provider_credential_code" ON "image_provider_credential" ("code") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_usage_quota_bucket_unique"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_usage_quota_bucket" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "customerId" integer NOT NULL, "quotaType" varchar(32) NOT NULL, "modelCode" varchar(48) NOT NULL DEFAULT (''), "windowKey" varchar(32) NOT NULL, "windowStartsAt" datetime NOT NULL, "windowEndsAt" datetime NOT NULL, "limitSnapshot" integer NOT NULL, "unlimited" boolean NOT NULL DEFAULT (0), "reserved" integer NOT NULL DEFAULT (0), "consumed" integer NOT NULL DEFAULT (0), "released" integer NOT NULL DEFAULT (0), "version" integer NOT NULL, CONSTRAINT "FK_image_usage_quota_bucket_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_image_usage_quota_bucket_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_usage_quota_bucket"("createdAt", "updatedAt", "id", "channelId", "customerId", "quotaType", "modelCode", "windowKey", "windowStartsAt", "windowEndsAt", "limitSnapshot", "unlimited", "reserved", "consumed", "released", "version") SELECT "createdAt", "updatedAt", "id", "channelId", "customerId", "quotaType", "modelCode", "windowKey", "windowStartsAt", "windowEndsAt", "limitSnapshot", "unlimited", "reserved", "consumed", "released", "version" FROM "image_usage_quota_bucket"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_usage_quota_bucket"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_usage_quota_bucket" RENAME TO "image_usage_quota_bucket"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_usage_quota_bucket_unique" ON "image_usage_quota_bucket" ("channelId", "customerId", "quotaType", "modelCode", "windowKey") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_usage_quota_event_resource"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_usage_quota_event_idempotency"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_usage_quota_event" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "bucketId" integer NOT NULL, "idempotencyKey" varchar(96) NOT NULL, "resourceType" varchar(32) NOT NULL, "resourceId" varchar(64) NOT NULL, "amount" integer NOT NULL, "consumedAmount" integer NOT NULL DEFAULT (0), "releasedAmount" integer NOT NULL DEFAULT (0), "state" varchar(16) NOT NULL DEFAULT ('RESERVED'), "consumedAt" datetime, "releasedAt" datetime, "metadata" text)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_usage_quota_event"("createdAt", "updatedAt", "id", "bucketId", "idempotencyKey", "resourceType", "resourceId", "amount", "consumedAmount", "releasedAmount", "state", "consumedAt", "releasedAt", "metadata") SELECT "createdAt", "updatedAt", "id", "bucketId", "idempotencyKey", "resourceType", "resourceId", "amount", "consumedAmount", "releasedAmount", "state", "consumedAt", "releasedAt", "metadata" FROM "image_usage_quota_event"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_usage_quota_event"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_usage_quota_event" RENAME TO "image_usage_quota_event"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_usage_quota_event_resource" ON "image_usage_quota_event" ("resourceType", "resourceId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_usage_quota_event_idempotency" ON "image_usage_quota_event" ("idempotencyKey") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_referral_program_config_channel"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_referral_program_config" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "enabled" boolean NOT NULL DEFAULT (0), "rewardRateBps" integer NOT NULL DEFAULT (500), "releaseDelayDays" integer NOT NULL DEFAULT (7), "minimumOrderAmount" integer NOT NULL DEFAULT (0), "maxRewardPerOrder" integer, "allowBalanceSpend" boolean NOT NULL DEFAULT (1), "attributionWindowDays" integer NOT NULL DEFAULT (30), "defaultPosterTemplate" varchar(64) NOT NULL DEFAULT ('BRAND_MINIMAL'), "currencyCode" varchar(3) NOT NULL, CONSTRAINT "FK_referral_program_config_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_referral_program_config"("id", "createdAt", "updatedAt", "channelId", "enabled", "rewardRateBps", "releaseDelayDays", "minimumOrderAmount", "maxRewardPerOrder", "allowBalanceSpend", "attributionWindowDays", "defaultPosterTemplate", "currencyCode") SELECT "id", "createdAt", "updatedAt", "channelId", "enabled", "rewardRateBps", "releaseDelayDays", "minimumOrderAmount", "maxRewardPerOrder", "allowBalanceSpend", "attributionWindowDays", "defaultPosterTemplate", "currencyCode" FROM "referral_program_config"`,
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
        await queryRunner.query(`DROP INDEX "IDX_store_usdt_manual_refund_payment"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_usdt_manual_refund_channel_created"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_usdt_manual_refund_refund"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_store_usdt_manual_refund_transaction"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_store_usdt_manual_refund" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "channelId" integer NOT NULL, "paymentId" integer NOT NULL, "orderId" integer NOT NULL, "refundId" integer NOT NULL, "network" varchar(16) NOT NULL, "transactionId" varchar(64) NOT NULL, "usdtAmountBaseUnits" decimal(30,0) NOT NULL, "fromAddress" varchar(64) NOT NULL, "toAddress" varchar(64) NOT NULL, "blockNumber" integer NOT NULL, "blockTimestamp" datetime NOT NULL, "operatorUserId" integer NOT NULL, "reason" varchar(500) NOT NULL, CONSTRAINT "FK_store_usdt_manual_refund_refund" FOREIGN KEY ("refundId") REFERENCES "refund" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_store_usdt_manual_refund_order" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_store_usdt_manual_refund_payment" FOREIGN KEY ("paymentId") REFERENCES "payment" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_store_usdt_manual_refund_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_store_usdt_manual_refund"("createdAt", "updatedAt", "id", "channelId", "paymentId", "orderId", "refundId", "network", "transactionId", "usdtAmountBaseUnits", "fromAddress", "toAddress", "blockNumber", "blockTimestamp", "operatorUserId", "reason") SELECT "createdAt", "updatedAt", "id", "channelId", "paymentId", "orderId", "refundId", "network", "transactionId", "usdtAmountBaseUnits", "fromAddress", "toAddress", "blockNumber", "blockTimestamp", "operatorUserId", "reason" FROM "store_usdt_manual_refund"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "store_usdt_manual_refund"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_store_usdt_manual_refund" RENAME TO "store_usdt_manual_refund"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_usdt_manual_refund_payment" ON "store_usdt_manual_refund" ("paymentId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_store_usdt_manual_refund_channel_created" ON "store_usdt_manual_refund" ("channelId", "createdAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_usdt_manual_refund_refund" ON "store_usdt_manual_refund" ("refundId") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_store_usdt_manual_refund_transaction" ON "store_usdt_manual_refund" ("network", "transactionId") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_used_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_locked_order"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_customer_status_valid"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_customer_coupon_campaign_customer"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_customer_coupon" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "channelId" integer NOT NULL, "campaignConfigId" integer NOT NULL, "promotionId" integer NOT NULL, "customerId" integer NOT NULL, "status" varchar(24) NOT NULL DEFAULT ('AVAILABLE'), "campaignName" varchar(120) NOT NULL, "campaignKind" varchar(32) NOT NULL, "minimumSpend" integer NOT NULL DEFAULT (0), "discountAmount" integer, "discountRate" float, "claimedAt" datetime NOT NULL, "validFrom" datetime NOT NULL, "validUntil" datetime, "lockedAt" datetime, "lockExpiresAt" datetime, "lockedOrderId" integer, "usedAt" datetime, "usedOrderId" integer, "returnedAt" datetime, "expiredAt" datetime, "revokedAt" datetime, "returnCount" integer NOT NULL DEFAULT (0), "version" integer NOT NULL, "currencyCode" varchar(3) NOT NULL, CONSTRAINT "FK_customer_coupon_used_order" FOREIGN KEY ("usedOrderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_locked_order" FOREIGN KEY ("lockedOrderId") REFERENCES "order" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_customer" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_promotion" FOREIGN KEY ("promotionId") REFERENCES "promotion" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_config" FOREIGN KEY ("campaignConfigId") REFERENCES "store_coupon_campaign_config" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_customer_coupon_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_customer_coupon"("id", "createdAt", "updatedAt", "channelId", "campaignConfigId", "promotionId", "customerId", "status", "campaignName", "campaignKind", "minimumSpend", "discountAmount", "discountRate", "claimedAt", "validFrom", "validUntil", "lockedAt", "lockExpiresAt", "lockedOrderId", "usedAt", "usedOrderId", "returnedAt", "expiredAt", "revokedAt", "returnCount", "version", "currencyCode") SELECT "id", "createdAt", "updatedAt", "channelId", "campaignConfigId", "promotionId", "customerId", "status", "campaignName", "campaignKind", "minimumSpend", "discountAmount", "discountRate", "claimedAt", "validFrom", "validUntil", "lockedAt", "lockExpiresAt", "lockedOrderId", "usedAt", "usedOrderId", "returnedAt", "expiredAt", "revokedAt", "returnCount", "version", "currencyCode" FROM "customer_coupon"`,
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
        await queryRunner.query(`DROP INDEX "IDX_image_generation_runtime_queue"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_runtime_status" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "queueName" varchar(64) NOT NULL, "workerId" varchar(96), "status" varchar(24), "heartbeatAt" datetime, "lastReconcileAt" datetime, "activeJobs" integer, "lastError" varchar(500))`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_runtime_status"("createdAt", "updatedAt", "id", "queueName", "workerId", "status", "heartbeatAt", "lastReconcileAt", "activeJobs", "lastError") SELECT "createdAt", "updatedAt", "id", "queueName", "workerId", "status", "heartbeatAt", "lastReconcileAt", "activeJobs", "lastError" FROM "image_generation_runtime_status"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_generation_runtime_status"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_generation_runtime_status" RENAME TO "image_generation_runtime_status"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_runtime_queue" ON "image_generation_runtime_status" ("queueName") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_catalog_supplier_channel_enabled" ON "catalog_supplier" ("channelId", "enabled") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_catalog_import_row_job_number" ON "catalog_import_row" ("jobId", "rowNumber") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_cost_output_attempt" ON "image_generation_cost_event" ("outputIdSnapshot", "attemptNumber") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_private_asset_storage_key" ON "image_private_asset" ("storageKey") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_provider_credential_route" ON "image_provider_credential" ("scope", "enabled", "priority") `,
            undefined,
        );
        await queryRunner.query(`DROP INDEX "IDX_image_generation_dispatch_state_next"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_image_generation_dispatch_output"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_image_generation_dispatch" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "outputId" integer NOT NULL, "state" varchar(24) NOT NULL DEFAULT ('PENDING'), "attemptCount" integer NOT NULL DEFAULT (0), "nextAttemptAt" datetime NOT NULL, "dispatchedAt" datetime, "lastError" varchar(500), "queueTaskId" varchar(120), "processingStage" varchar(32), "heartbeatAt" datetime, "stagedAssetId" integer, CONSTRAINT "UQ_17a8fe07de6a2cd3025bfdb578d" UNIQUE ("outputId"), CONSTRAINT "FK_image_generation_dispatch_output" FOREIGN KEY ("outputId") REFERENCES "image_generation_output" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_image_dispatch_staged_asset" FOREIGN KEY ("stagedAssetId") REFERENCES "image_private_asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_image_generation_dispatch"("createdAt", "updatedAt", "id", "outputId", "state", "attemptCount", "nextAttemptAt", "dispatchedAt", "lastError", "queueTaskId", "processingStage", "heartbeatAt", "stagedAssetId") SELECT "createdAt", "updatedAt", "id", "outputId", "state", "attemptCount", "nextAttemptAt", "dispatchedAt", "lastError", "queueTaskId", "processingStage", "heartbeatAt", "stagedAssetId" FROM "image_generation_dispatch"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "image_generation_dispatch"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "temporary_image_generation_dispatch" RENAME TO "image_generation_dispatch"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_image_generation_dispatch_state_next" ON "image_generation_dispatch" ("state", "nextAttemptAt") `,
            undefined,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_image_generation_dispatch_output" ON "image_generation_dispatch" ("outputId") `,
            undefined,
        );
    }

    public async down(): Promise<void> {
        // Reverting this generated SQLite alignment would reintroduce schema drift and invalid foreign-key targets.
    }

    private isSqlite(queryRunner: QueryRunner): boolean {
        return ['sqlite', 'better-sqlite3', 'sqljs'].includes(queryRunner.connection.options.type);
    }
}
