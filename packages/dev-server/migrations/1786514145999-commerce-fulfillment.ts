/* eslint-disable max-len */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommerceFulfillment1786514145999 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "IDX_239cfca2a55b98b90b6bef2e44"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_9f065453910ea77d4be8e92618"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_77be94ce9ec650446617946227"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_cbcd22193eda94668e84d33f18"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_dc9ac68b47da7b62249886affb"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_6901d8715f5ebadd764466f7bd"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_order_line" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "quantity" integer NOT NULL, "orderPlacedQuantity" integer NOT NULL DEFAULT (0), "listPriceIncludesTax" boolean NOT NULL, "adjustments" text NOT NULL, "taxLines" text NOT NULL, "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sellerChannelId" integer, "shippingLineId" integer, "productVariantId" integer NOT NULL, "taxCategoryId" integer, "initialListPrice" integer, "listPrice" integer NOT NULL, "featuredAssetId" integer, "orderId" integer, "customFieldsFulfillmenttypesnapshot" varchar(255) DEFAULT ('physical'), CONSTRAINT "FK_239cfca2a55b98b90b6bef2e44f" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_9f065453910ea77d4be8e92618f" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_77be94ce9ec6504466179462275" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_cbcd22193eda94668e84d33f185" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_dc9ac68b47da7b62249886affba" FOREIGN KEY ("shippingLineId") REFERENCES "shipping_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_6901d8715f5ebadd764466f7bde" FOREIGN KEY ("sellerChannelId") REFERENCES "channel" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_order_line"("createdAt", "updatedAt", "quantity", "orderPlacedQuantity", "listPriceIncludesTax", "adjustments", "taxLines", "id", "sellerChannelId", "shippingLineId", "productVariantId", "taxCategoryId", "initialListPrice", "listPrice", "featuredAssetId", "orderId") SELECT "createdAt", "updatedAt", "quantity", "orderPlacedQuantity", "listPriceIncludesTax", "adjustments", "taxLines", "id", "sellerChannelId", "shippingLineId", "productVariantId", "taxCategoryId", "initialListPrice", "listPrice", "featuredAssetId", "orderId" FROM "order_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "order_line"`, undefined);
        await queryRunner.query(`ALTER TABLE "temporary_order_line" RENAME TO "order_line"`, undefined);
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
        await queryRunner.query(`DROP INDEX "IDX_6e420052844edf3a5506d863ce"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_e38dca0d82fd64c7cf8aac8b8e"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_0e6f516053cf982b537836e21c"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "temporary_product_variant" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "sku" varchar NOT NULL, "outOfStockThreshold" integer NOT NULL DEFAULT (0), "useGlobalOutOfStockThreshold" boolean NOT NULL DEFAULT (1), "trackInventory" varchar NOT NULL DEFAULT ('INHERIT'), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "taxCategoryId" integer, "productId" integer, "customFieldsFulfillmenttype" varchar(255) DEFAULT ('physical'), CONSTRAINT "FK_6e420052844edf3a5506d863ce6" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_e38dca0d82fd64c7cf8aac8b8ef" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e6f516053cf982b537836e21cf" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_product_variant"("createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId" FROM "product_variant"`,
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
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "IDX_0e6f516053cf982b537836e21c"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_e38dca0d82fd64c7cf8aac8b8e"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_6e420052844edf3a5506d863ce"`, undefined);
        await queryRunner.query(
            `ALTER TABLE "product_variant" RENAME TO "temporary_product_variant"`,
            undefined,
        );
        await queryRunner.query(
            `CREATE TABLE "product_variant" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "deletedAt" datetime, "enabled" boolean NOT NULL DEFAULT (1), "sku" varchar NOT NULL, "outOfStockThreshold" integer NOT NULL DEFAULT (0), "useGlobalOutOfStockThreshold" boolean NOT NULL DEFAULT (1), "trackInventory" varchar NOT NULL DEFAULT ('INHERIT'), "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "featuredAssetId" integer, "taxCategoryId" integer, "productId" integer, CONSTRAINT "FK_6e420052844edf3a5506d863ce6" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_e38dca0d82fd64c7cf8aac8b8ef" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e6f516053cf982b537836e21cf" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "product_variant"("createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId") SELECT "createdAt", "updatedAt", "deletedAt", "enabled", "sku", "outOfStockThreshold", "useGlobalOutOfStockThreshold", "trackInventory", "id", "featuredAssetId", "taxCategoryId", "productId" FROM "temporary_product_variant"`,
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
        await queryRunner.query(`DROP INDEX "IDX_6901d8715f5ebadd764466f7bd"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_dc9ac68b47da7b62249886affb"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_cbcd22193eda94668e84d33f18"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_77be94ce9ec650446617946227"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_9f065453910ea77d4be8e92618"`, undefined);
        await queryRunner.query(`DROP INDEX "IDX_239cfca2a55b98b90b6bef2e44"`, undefined);
        await queryRunner.query(`ALTER TABLE "order_line" RENAME TO "temporary_order_line"`, undefined);
        await queryRunner.query(
            `CREATE TABLE "order_line" ("createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "quantity" integer NOT NULL, "orderPlacedQuantity" integer NOT NULL DEFAULT (0), "listPriceIncludesTax" boolean NOT NULL, "adjustments" text NOT NULL, "taxLines" text NOT NULL, "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sellerChannelId" integer, "shippingLineId" integer, "productVariantId" integer NOT NULL, "taxCategoryId" integer, "initialListPrice" integer, "listPrice" integer NOT NULL, "featuredAssetId" integer, "orderId" integer, CONSTRAINT "FK_239cfca2a55b98b90b6bef2e44f" FOREIGN KEY ("orderId") REFERENCES "order" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_9f065453910ea77d4be8e92618f" FOREIGN KEY ("featuredAssetId") REFERENCES "asset" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_77be94ce9ec6504466179462275" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_cbcd22193eda94668e84d33f185" FOREIGN KEY ("productVariantId") REFERENCES "product_variant" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_dc9ac68b47da7b62249886affba" FOREIGN KEY ("shippingLineId") REFERENCES "shipping_line" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_6901d8715f5ebadd764466f7bde" FOREIGN KEY ("sellerChannelId") REFERENCES "channel" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`,
            undefined,
        );
        await queryRunner.query(
            `INSERT INTO "order_line"("createdAt", "updatedAt", "quantity", "orderPlacedQuantity", "listPriceIncludesTax", "adjustments", "taxLines", "id", "sellerChannelId", "shippingLineId", "productVariantId", "taxCategoryId", "initialListPrice", "listPrice", "featuredAssetId", "orderId") SELECT "createdAt", "updatedAt", "quantity", "orderPlacedQuantity", "listPriceIncludesTax", "adjustments", "taxLines", "id", "sellerChannelId", "shippingLineId", "productVariantId", "taxCategoryId", "initialListPrice", "listPrice", "featuredAssetId", "orderId" FROM "temporary_order_line"`,
            undefined,
        );
        await queryRunner.query(`DROP TABLE "temporary_order_line"`, undefined);
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
    }
}
