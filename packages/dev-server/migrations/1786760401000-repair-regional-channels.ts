import { MigrationInterface, QueryRunner } from 'typeorm';

interface RegionalChannel {
    code: string;
    description: string;
    defaultLanguageCode: string;
    availableLanguageCodes: string;
    defaultCurrencyCode: string;
}

interface ChannelAssignment {
    table: string;
    entityIdColumn: string;
}

const regionalChannels: RegionalChannel[] = [
    {
        code: 'cn-mainland',
        description: '中国大陆店铺',
        defaultLanguageCode: 'zh_Hans',
        availableLanguageCodes: 'zh_Hans,en',
        defaultCurrencyCode: 'CNY',
    },
    {
        code: 'my-malaysia',
        description: 'Malaysia Store',
        defaultLanguageCode: 'en',
        availableLanguageCodes: 'en,zh_Hans',
        defaultCurrencyCode: 'MYR',
    },
];

const channelAssignments: ChannelAssignment[] = [
    { table: 'product_channels_channel', entityIdColumn: 'productId' },
    { table: 'product_variant_channels_channel', entityIdColumn: 'productVariantId' },
    { table: 'asset_channels_channel', entityIdColumn: 'assetId' },
    { table: 'collection_channels_channel', entityIdColumn: 'collectionId' },
    { table: 'facet_channels_channel', entityIdColumn: 'facetId' },
    { table: 'facet_value_channels_channel', entityIdColumn: 'facetValueId' },
    {
        table: 'product_option_group_channels_channel',
        entityIdColumn: 'productOptionGroupId',
    },
    { table: 'product_option_channels_channel', entityIdColumn: 'productOptionId' },
    { table: 'payment_method_channels_channel', entityIdColumn: 'paymentMethodId' },
    { table: 'shipping_method_channels_channel', entityIdColumn: 'shippingMethodId' },
    { table: 'stock_location_channels_channel', entityIdColumn: 'stockLocationId' },
    { table: 'promotion_channels_channel', entityIdColumn: 'promotionId' },
    { table: 'role_channels_channel', entityIdColumn: 'roleId' },
];

export class RepairRegionalChannels1786760401000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);

        for (const channel of regionalChannels) {
            await this.createChannel(queryRunner, channel);
        }

        for (const assignment of channelAssignments) {
            await this.copyChannelAssignments(queryRunner, assignment);
        }

        await this.copyPrices(queryRunner, 'cn-mainland', 'CNY');
        await this.copyPrices(queryRunner, 'my-malaysia', 'MYR');
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // This repair is intentionally non-reversible so rollback cannot delete later merchant data.
    }

    private async createChannel(queryRunner: QueryRunner, channel: RegionalChannel): Promise<void> {
        const parameters = this.placeholders(queryRunner, 8);
        await queryRunner.query(
            `
                INSERT INTO "channel" (
                    "createdAt",
                    "updatedAt",
                    "code",
                    "token",
                    "description",
                    "defaultLanguageCode",
                    "availableLanguageCodes",
                    "defaultCurrencyCode",
                    "availableCurrencyCodes",
                    "trackInventory",
                    "outOfStockThreshold",
                    "pricesIncludeTax",
                    "sellerId",
                    "defaultTaxZoneId",
                    "defaultShippingZoneId"
                )
                SELECT
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP,
                    ${parameters[0]},
                    ${parameters[1]},
                    ${parameters[2]},
                    ${parameters[3]},
                    ${parameters[4]},
                    ${parameters[5]},
                    ${parameters[6]},
                    source."trackInventory",
                    source."outOfStockThreshold",
                    source."pricesIncludeTax",
                    source."sellerId",
                    source."defaultTaxZoneId",
                    source."defaultShippingZoneId"
                FROM "channel" source
                WHERE source."code" = '__default_channel__'
                  AND NOT EXISTS (
                      SELECT 1 FROM "channel" existing WHERE existing."code" = ${parameters[7]}
                  )
            `,
            [
                channel.code,
                channel.code,
                channel.description,
                channel.defaultLanguageCode,
                channel.availableLanguageCodes,
                channel.defaultCurrencyCode,
                channel.defaultCurrencyCode,
                channel.code,
            ],
        );
    }

    private async copyChannelAssignments(
        queryRunner: QueryRunner,
        assignment: ChannelAssignment,
    ): Promise<void> {
        const { table, entityIdColumn } = assignment;
        await queryRunner.query(`
            INSERT INTO "${table}" ("${entityIdColumn}", "channelId")
            SELECT source."${entityIdColumn}", target."id"
            FROM "${table}" source
            JOIN "channel" source_channel ON source_channel."id" = source."channelId"
            CROSS JOIN "channel" target
            WHERE source_channel."code" = '__default_channel__'
              AND target."code" IN ('cn-mainland', 'my-malaysia')
              AND NOT EXISTS (
                  SELECT 1
                  FROM "${table}" existing
                  WHERE existing."${entityIdColumn}" = source."${entityIdColumn}"
                    AND existing."channelId" = target."id"
              )
        `);
    }

    private async copyPrices(
        queryRunner: QueryRunner,
        targetChannelCode: string,
        currencyCode: string,
    ): Promise<void> {
        const [currencyParameter, channelParameter, existingCurrencyParameter] = this.placeholders(
            queryRunner,
            3,
        );
        await queryRunner.query(
            `
                INSERT INTO "product_variant_price" (
                    "currencyCode",
                    "channelId",
                    "price",
                    "variantId"
                )
                SELECT ${currencyParameter}, target."id", source."price", source."variantId"
                FROM "product_variant_price" source
                JOIN "channel" source_channel ON source_channel."id" = source."channelId"
                JOIN "channel" target ON target."code" = ${channelParameter}
                WHERE source_channel."code" = '__default_channel__'
                  AND source."currencyCode" = 'USD'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM "product_variant_price" existing
                      WHERE existing."channelId" = target."id"
                        AND existing."variantId" = source."variantId"
                        AND existing."currencyCode" = ${existingCurrencyParameter}
                  )
            `,
            [currencyCode, targetChannelCode, currencyCode],
        );
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }

    private placeholders(queryRunner: QueryRunner, count: number): string[] {
        if (['postgres', 'cockroachdb'].includes(queryRunner.connection.options.type)) {
            return Array.from({ length: count }, (_, index) => `$${index + 1}`);
        }
        return Array.from({ length: count }, () => '?');
    }

    private async enableAnsiIdentifierQuotes(queryRunner: QueryRunner): Promise<void> {
        if (this.isMysql(queryRunner)) {
            await queryRunner.query(
                `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
            );
        }
    }
}
