import { MigrationInterface, QueryRunner } from 'typeorm';

interface RegionalChannel {
    code: string;
    description: string;
    defaultLanguageCode: string;
    availableLanguageCodes: string;
    defaultCurrencyCode: string;
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

export class AddRegionalChannels1786514500000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const channel of regionalChannels) {
            await queryRunner.query(
                `
                    INSERT INTO channel (
                        createdAt,
                        updatedAt,
                        code,
                        token,
                        description,
                        defaultLanguageCode,
                        availableLanguageCodes,
                        defaultCurrencyCode,
                        availableCurrencyCodes,
                        trackInventory,
                        outOfStockThreshold,
                        pricesIncludeTax,
                        sellerId,
                        defaultTaxZoneId,
                        defaultShippingZoneId
                    )
                    SELECT
                        CURRENT_TIMESTAMP,
                        CURRENT_TIMESTAMP,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        source.trackInventory,
                        source.outOfStockThreshold,
                        source.pricesIncludeTax,
                        source.sellerId,
                        asia.id,
                        asia.id
                    FROM channel source
                    JOIN zone asia ON asia.name IN ('Asia', '亚洲（Asia）')
                    WHERE source.code = '__default_channel__'
                      AND NOT EXISTS (SELECT 1 FROM channel existing WHERE existing.code = ?)
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
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM channel WHERE code IN ('cn-mainland', 'my-malaysia')`);
    }
}
