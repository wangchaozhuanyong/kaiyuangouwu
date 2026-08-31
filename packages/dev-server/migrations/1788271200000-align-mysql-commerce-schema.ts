import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignMysqlCommerceSchema1788271200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) return;

        await queryRunner.query(
            "ALTER TABLE `product` CHANGE `customFieldsFulfillmenttype` `customFieldsFulfillmenttype` varchar(255) NULL DEFAULT 'digital'",
        );
        await queryRunner.query(
            "ALTER TABLE `product` CHANGE `customFieldsRefundpolicy` `customFieldsRefundpolicy` varchar(255) NULL DEFAULT 'MERCHANT_REVIEW'",
        );
        await queryRunner.query(
            "ALTER TABLE `product` CHANGE `customFieldsManualdeliveryslaminutes` `customFieldsManualdeliveryslaminutes` int NULL DEFAULT '1440'",
        );
        await queryRunner.query(
            "ALTER TABLE `order_line` CHANGE `customFieldsRefundpolicysnapshot` `customFieldsRefundpolicysnapshot` varchar(255) NULL DEFAULT 'MERCHANT_REVIEW'",
        );
        await queryRunner.query(
            "ALTER TABLE `order_line` CHANGE `customFieldsManualdeliveryslaminutessnapshot` `customFieldsManualdeliveryslaminutessnapshot` int NULL DEFAULT '1440'",
        );
        await queryRunner.query(
            "ALTER TABLE `product_variant` CHANGE `customFieldsFulfillmenttype` `customFieldsFulfillmenttype` varchar(255) NULL DEFAULT 'digital'",
        );
        await queryRunner.query(
            "ALTER TABLE `product_variant` CHANGE `customFieldsDigitalstockpolicy` `customFieldsDigitalstockpolicy` varchar(255) NULL DEFAULT 'limited'",
        );
        await queryRunner.query(
            "ALTER TABLE `channel` CHANGE `customFieldsCommercemode` `customFieldsCommercemode` varchar(255) NULL DEFAULT 'DIGITAL_ONLY'",
        );
        await queryRunner.query(
            'ALTER TABLE `product_packaging_rule` CHANGE `enabled` `enabled` tinyint NOT NULL DEFAULT 1',
        );
        await queryRunner.query(
            'ALTER TABLE `product_packaging_rule` CHANGE `autoUnpack` `autoUnpack` tinyint NOT NULL DEFAULT 1',
        );
        await queryRunner.query(
            'DROP INDEX `IDX_customer_delivery_email_default` ON `customer_delivery_email`',
        );
        await queryRunner.query(
            'ALTER TABLE `customer_delivery_email` CHANGE `isDefault` `isDefault` tinyint NOT NULL DEFAULT 0',
        );
        await queryRunner.query(
            "ALTER TABLE `image_provider_credential` CHANGE `textModelId` `textModelId` varchar(160) NOT NULL DEFAULT ''",
        );
        await queryRunner.query(
            'CREATE INDEX `IDX_customer_delivery_email_default` ON `customer_delivery_email` (`channelId`, `customerId`, `isDefault`)',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (!this.isMysql(queryRunner)) return;

        await queryRunner.query(
            "UPDATE `product` SET `customFieldsFulfillmenttype` = 'digital' WHERE `customFieldsFulfillmenttype` IS NULL",
        );
        await queryRunner.query(
            "UPDATE `product` SET `customFieldsRefundpolicy` = 'MERCHANT_REVIEW' WHERE `customFieldsRefundpolicy` IS NULL",
        );
        await queryRunner.query(
            'UPDATE `product` SET `customFieldsManualdeliveryslaminutes` = 1440 WHERE `customFieldsManualdeliveryslaminutes` IS NULL',
        );
        await queryRunner.query(
            "UPDATE `order_line` SET `customFieldsRefundpolicysnapshot` = 'MERCHANT_REVIEW' WHERE `customFieldsRefundpolicysnapshot` IS NULL",
        );
        await queryRunner.query(
            'UPDATE `order_line` SET `customFieldsManualdeliveryslaminutessnapshot` = 1440 WHERE `customFieldsManualdeliveryslaminutessnapshot` IS NULL',
        );
        await queryRunner.query(
            "UPDATE `product_variant` SET `customFieldsDigitalstockpolicy` = 'limited' WHERE `customFieldsDigitalstockpolicy` IS NULL",
        );
        await queryRunner.query(
            "UPDATE `channel` SET `customFieldsCommercemode` = 'DIGITAL_ONLY' WHERE `customFieldsCommercemode` IS NULL",
        );
        await queryRunner.query(
            "ALTER TABLE `product` CHANGE `customFieldsFulfillmenttype` `customFieldsFulfillmenttype` varchar(255) NOT NULL DEFAULT 'digital'",
        );
        await queryRunner.query(
            "ALTER TABLE `product` CHANGE `customFieldsRefundpolicy` `customFieldsRefundpolicy` varchar(255) NOT NULL DEFAULT 'MERCHANT_REVIEW'",
        );
        await queryRunner.query(
            "ALTER TABLE `product` CHANGE `customFieldsManualdeliveryslaminutes` `customFieldsManualdeliveryslaminutes` int NOT NULL DEFAULT '1440'",
        );
        await queryRunner.query(
            "ALTER TABLE `order_line` CHANGE `customFieldsRefundpolicysnapshot` `customFieldsRefundpolicysnapshot` varchar(255) NOT NULL DEFAULT 'MERCHANT_REVIEW'",
        );
        await queryRunner.query(
            "ALTER TABLE `order_line` CHANGE `customFieldsManualdeliveryslaminutessnapshot` `customFieldsManualdeliveryslaminutessnapshot` int NOT NULL DEFAULT '1440'",
        );
        await queryRunner.query(
            "ALTER TABLE `product_variant` CHANGE `customFieldsFulfillmenttype` `customFieldsFulfillmenttype` varchar(255) NULL DEFAULT 'physical'",
        );
        await queryRunner.query(
            "ALTER TABLE `product_variant` CHANGE `customFieldsDigitalstockpolicy` `customFieldsDigitalstockpolicy` varchar(255) NOT NULL DEFAULT 'limited'",
        );
        await queryRunner.query(
            "ALTER TABLE `channel` CHANGE `customFieldsCommercemode` `customFieldsCommercemode` varchar(255) NOT NULL DEFAULT 'DIGITAL_ONLY'",
        );
        await queryRunner.query(
            'ALTER TABLE `product_packaging_rule` CHANGE `enabled` `enabled` tinyint(1) NOT NULL DEFAULT 1',
        );
        await queryRunner.query(
            'ALTER TABLE `product_packaging_rule` CHANGE `autoUnpack` `autoUnpack` tinyint(1) NOT NULL DEFAULT 1',
        );
        await queryRunner.query(
            'DROP INDEX `IDX_customer_delivery_email_default` ON `customer_delivery_email`',
        );
        await queryRunner.query(
            'ALTER TABLE `customer_delivery_email` CHANGE `isDefault` `isDefault` tinyint(1) NOT NULL DEFAULT 0',
        );
        await queryRunner.query(
            'ALTER TABLE `image_provider_credential` CHANGE `textModelId` `textModelId` varchar(160) NOT NULL',
        );
        await queryRunner.query(
            'CREATE INDEX `IDX_customer_delivery_email_default` ON `customer_delivery_email` (`channelId`, `customerId`, `isDefault`)',
        );
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }
}
