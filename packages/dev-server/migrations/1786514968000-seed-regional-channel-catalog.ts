import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedRegionalChannelCatalog1786514968000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        await this.copyChannelAssignments(queryRunner, 'product_channels_channel', 'productId');
        await this.copyChannelAssignments(
            queryRunner,
            'product_variant_channels_channel',
            'productVariantId',
        );
        await this.copyChannelAssignments(queryRunner, 'asset_channels_channel', 'assetId');
        await this.copyChannelAssignments(queryRunner, 'collection_channels_channel', 'collectionId');
        await this.copyChannelAssignments(queryRunner, 'facet_channels_channel', 'facetId');
        await this.copyChannelAssignments(queryRunner, 'facet_value_channels_channel', 'facetValueId');
        await this.copyChannelAssignments(
            queryRunner,
            'product_option_group_channels_channel',
            'productOptionGroupId',
        );
        await this.copyChannelAssignments(queryRunner, 'product_option_channels_channel', 'productOptionId');
        await this.copyChannelAssignments(queryRunner, 'payment_method_channels_channel', 'paymentMethodId');
        await this.copyChannelAssignments(queryRunner, 'stock_location_channels_channel', 'stockLocationId');
        await this.copyChannelAssignments(queryRunner, 'promotion_channels_channel', 'promotionId');
        await this.copyChannelAssignments(queryRunner, 'role_channels_channel', 'roleId');

        await this.copyPrices(queryRunner, 'cn-mainland', 'CNY');
        await this.copyPrices(queryRunner, 'my-malaysia', 'MYR');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        const channelIds = `(SELECT id FROM channel WHERE code IN ('cn-mainland', 'my-malaysia'))`;
        for (const table of [
            'product_channels_channel',
            'product_variant_channels_channel',
            'asset_channels_channel',
            'collection_channels_channel',
            'facet_channels_channel',
            'facet_value_channels_channel',
            'product_option_group_channels_channel',
            'product_option_channels_channel',
            'payment_method_channels_channel',
            'stock_location_channels_channel',
            'promotion_channels_channel',
            'role_channels_channel',
        ]) {
            await queryRunner.query(`DELETE FROM "${table}" WHERE "channelId" IN ${channelIds}`);
        }
        await queryRunner.query(`
            DELETE FROM "product_variant_price"
            WHERE "channelId" IN ${channelIds}
              AND "currencyCode" IN ('CNY', 'MYR')
        `);
    }

    private async copyChannelAssignments(
        queryRunner: QueryRunner,
        table: string,
        entityIdColumn: string,
    ): Promise<void> {
        const insertIgnore = this.isMysql(queryRunner) ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
        await queryRunner.query(`
            ${insertIgnore} INTO "${table}" ("${entityIdColumn}", "channelId")
            SELECT source."${entityIdColumn}", target.id
            FROM "${table}" source
            JOIN channel source_channel ON source_channel.id = source."channelId"
            CROSS JOIN channel target
            WHERE source_channel.code = '__default_channel__'
              AND target.code IN ('cn-mainland', 'my-malaysia')
        `);
    }

    private async copyPrices(
        queryRunner: QueryRunner,
        targetChannelCode: string,
        currencyCode: string,
    ): Promise<void> {
        await queryRunner.query(
            `
                INSERT INTO "product_variant_price" ("currencyCode", "channelId", "price", "variantId")
                SELECT ?, target.id, source.price, source.variantId
                FROM product_variant_price source
                JOIN channel source_channel ON source_channel.id = source.channelId
                JOIN channel target ON target.code = ?
                WHERE source_channel.code = '__default_channel__'
                  AND source.currencyCode = 'USD'
                  AND NOT EXISTS (
                      SELECT 1 FROM product_variant_price existing
                      WHERE existing.channelId = target.id
                        AND existing.variantId = source.variantId
                        AND existing.currencyCode = ?
                  )
            `,
            [currencyCode, targetChannelCode, currencyCode],
        );
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }

    private async enableAnsiIdentifierQuotes(queryRunner: QueryRunner): Promise<void> {
        if (this.isMysql(queryRunner)) {
            await queryRunner.query(
                `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
            );
        }
    }
}
