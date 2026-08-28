import { MigrationInterface, QueryRunner } from 'typeorm';

interface RegionalChannel {
    code: string;
    description: string;
    defaultLanguageCode: string;
    availableLanguageCodes: string;
    defaultCurrencyCode: string;
}

interface SourceChannelRow {
    track_inventory: boolean;
    out_of_stock_threshold: number;
    prices_include_tax: boolean;
    seller_id: string | number | null;
}

interface IdRow {
    id: string | number;
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
        if (!(await queryRunner.hasTable('channel')) || !(await queryRunner.hasTable('zone'))) {
            return;
        }

        const [source] = (await queryRunner.query(
            `
                SELECT
                    ${this.quote('trackInventory', queryRunner)} AS track_inventory,
                    ${this.quote('outOfStockThreshold', queryRunner)} AS out_of_stock_threshold,
                    ${this.quote('pricesIncludeTax', queryRunner)} AS prices_include_tax,
                    ${this.quote('sellerId', queryRunner)} AS seller_id
                FROM ${this.quote('channel', queryRunner)}
                WHERE ${this.quote('code', queryRunner)} = ${this.parameter(1, queryRunner)}
                LIMIT 1
            `,
            ['__default_channel__'],
        )) as SourceChannelRow[];
        const [asia] = (await queryRunner.query(
            `
                SELECT ${this.quote('id', queryRunner)} AS id
                FROM ${this.quote('zone', queryRunner)}
                WHERE ${this.quote('name', queryRunner)} IN (
                    ${this.parameter(1, queryRunner)},
                    ${this.parameter(2, queryRunner)}
                )
                LIMIT 1
            `,
            ['Asia', '亚洲（Asia）'],
        )) as IdRow[];
        if (!source || !asia) return;

        for (const channel of regionalChannels) {
            const [existing] = (await queryRunner.query(
                `
                    SELECT ${this.quote('id', queryRunner)} AS id
                    FROM ${this.quote('channel', queryRunner)}
                    WHERE ${this.quote('code', queryRunner)} = ${this.parameter(1, queryRunner)}
                    LIMIT 1
                `,
                [channel.code],
            )) as IdRow[];
            if (existing) continue;

            const values = [
                new Date(),
                new Date(),
                channel.code,
                channel.code,
                channel.description,
                channel.defaultLanguageCode,
                channel.availableLanguageCodes,
                channel.defaultCurrencyCode,
                channel.defaultCurrencyCode,
                source.track_inventory,
                source.out_of_stock_threshold,
                source.prices_include_tax,
                source.seller_id,
                asia.id,
                asia.id,
            ];
            await queryRunner.query(
                `
                    INSERT INTO ${this.quote('channel', queryRunner)} (
                        ${this.quote('createdAt', queryRunner)},
                        ${this.quote('updatedAt', queryRunner)},
                        ${this.quote('code', queryRunner)},
                        ${this.quote('token', queryRunner)},
                        ${this.quote('description', queryRunner)},
                        ${this.quote('defaultLanguageCode', queryRunner)},
                        ${this.quote('availableLanguageCodes', queryRunner)},
                        ${this.quote('defaultCurrencyCode', queryRunner)},
                        ${this.quote('availableCurrencyCodes', queryRunner)},
                        ${this.quote('trackInventory', queryRunner)},
                        ${this.quote('outOfStockThreshold', queryRunner)},
                        ${this.quote('pricesIncludeTax', queryRunner)},
                        ${this.quote('sellerId', queryRunner)},
                        ${this.quote('defaultTaxZoneId', queryRunner)},
                        ${this.quote('defaultShippingZoneId', queryRunner)}
                    )
                    VALUES (${values
                        .map((_, index) => this.parameter(index + 1, queryRunner))
                        .join(', ')})
                `,
                values,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM ${this.quote('channel', queryRunner)} WHERE ${this.quote(
                'code',
                queryRunner,
            )} IN (${this.parameter(1, queryRunner)}, ${this.parameter(2, queryRunner)})`,
            regionalChannels.map(channel => channel.code),
        );
    }

    private quote(identifier: string, queryRunner: QueryRunner): string {
        const quote = ['mysql', 'mariadb'].includes(queryRunner.connection.options.type) ? '`' : '"';
        return `${quote}${identifier}${quote}`;
    }

    private parameter(index: number, queryRunner: QueryRunner): string {
        return ['postgres', 'cockroachdb'].includes(queryRunner.connection.options.type)
            ? `$${index}`
            : '?';
    }
}
