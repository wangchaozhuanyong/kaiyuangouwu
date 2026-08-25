import { MigrationInterface, QueryRunner } from 'typeorm';

type TranslationTableDefinition = {
    tableName: string;
    contentColumns: string[];
};

const translationTables: TranslationTableDefinition[] = [
    {
        tableName: 'product_translation',
        contentColumns: ['name', 'slug', 'description'],
    },
    {
        tableName: 'product_variant_translation',
        contentColumns: ['name'],
    },
    {
        tableName: 'product_option_group_translation',
        contentColumns: ['name'],
    },
    {
        tableName: 'product_option_translation',
        contentColumns: ['name'],
    },
    {
        tableName: 'collection_translation',
        contentColumns: ['name', 'slug', 'description'],
    },
    {
        tableName: 'facet_translation',
        contentColumns: ['name'],
    },
    {
        tableName: 'facet_value_translation',
        contentColumns: ['name'],
    },
    {
        tableName: 'promotion_translation',
        contentColumns: ['name', 'description'],
    },
    {
        tableName: 'shipping_method_translation',
        contentColumns: ['name', 'description'],
    },
    {
        tableName: 'payment_method_translation',
        contentColumns: ['name', 'description'],
    },
    {
        tableName: 'region_translation',
        contentColumns: ['name'],
    },
];

const containsHanText = (values: unknown[]): boolean =>
    values.some(value => typeof value === 'string' && /\p{Script=Han}/u.test(value));

export class SeedSimplifiedChineseSourceTranslations1787684400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const definition of translationTables) {
            await this.seedTable(queryRunner, definition);
        }
    }

    public async down(): Promise<void> {
        // Seeded source translations are retained so rollback cannot delete customer-authored content.
    }

    private async seedTable(queryRunner: QueryRunner, definition: TranslationTableDefinition): Promise<void> {
        const table = await queryRunner.getTable(definition.tableName);
        if (!table) return;

        const requiredColumns = [
            'createdAt',
            'updatedAt',
            'languageCode',
            ...definition.contentColumns,
            'baseId',
        ];
        if (requiredColumns.some(column => !table.findColumnByName(column))) return;

        const quotedTable = this.quote(definition.tableName, queryRunner);
        const quotedBaseId = this.quote('baseId', queryRunner);
        const quotedLanguageCode = this.quote('languageCode', queryRunner);
        const sourceLanguage = this.placeholders(queryRunner, 1)[0];
        const selectedColumns = ['baseId', ...definition.contentColumns]
            .map(column => this.quote(column, queryRunner))
            .join(', ');
        const rows = (await queryRunner.query(
            `SELECT ${selectedColumns} FROM ${quotedTable} ` +
                `WHERE ${quotedLanguageCode} = ${sourceLanguage}`,
            ['en'],
        )) as Array<Record<string, unknown>>;

        for (const row of rows) {
            if (!containsHanText(definition.contentColumns.map(column => row[column]))) continue;

            const [targetLanguage, baseId, existingLanguage, missingLanguage] = this.placeholders(
                queryRunner,
                4,
            );
            const insertColumns = requiredColumns.map(column => this.quote(column, queryRunner)).join(', ');
            const copiedColumns = [
                this.quote('createdAt', queryRunner),
                this.quote('updatedAt', queryRunner),
                targetLanguage,
                ...definition.contentColumns.map(column => this.quote(column, queryRunner)),
                quotedBaseId,
            ].join(', ');

            await queryRunner.query(
                `INSERT INTO ${quotedTable} (${insertColumns}) ` +
                    `SELECT ${copiedColumns} FROM ${quotedTable} source ` +
                    `WHERE source.${quotedBaseId} = ${baseId} ` +
                    `AND source.${quotedLanguageCode} = ${existingLanguage} ` +
                    `AND NOT EXISTS (` +
                    `SELECT 1 FROM ${quotedTable} target ` +
                    `WHERE target.${quotedBaseId} = source.${quotedBaseId} ` +
                    `AND target.${quotedLanguageCode} = ${missingLanguage}` +
                    `)`,
                ['zh_Hans', row.baseId, 'en', 'zh_Hans'],
            );
        }
    }

    private quote(identifier: string, queryRunner: QueryRunner): string {
        const quote = ['mysql', 'mariadb'].includes(queryRunner.connection.options.type) ? '`' : '"';
        return `${quote}${identifier}${quote}`;
    }

    private placeholders(queryRunner: QueryRunner, count: number): string[] {
        if (['postgres', 'cockroachdb'].includes(queryRunner.connection.options.type)) {
            return Array.from({ length: count }, (_, index) => `$${index + 1}`);
        }
        return Array.from({ length: count }, () => '?');
    }
}
