import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairFixedMoneyJson1787806800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.repairTable(queryRunner, 'promotion', {
            conditions: Array.isArray,
            actions: Array.isArray,
        });
        await this.repairTable(queryRunner, 'shipping_method', {
            calculator: value => value != null && typeof value === 'object' && !Array.isArray(value),
        });
    }

    public async down(): Promise<void> {
        // The migration only removes an accidental extra JSON encoding layer.
    }

    private async repairTable(
        queryRunner: QueryRunner,
        tableName: string,
        fields: Record<string, (value: unknown) => boolean>,
    ): Promise<void> {
        if (!(await queryRunner.hasTable(tableName))) return;

        const driver = queryRunner.connection.driver;
        const escape = (identifier: string) => driver.escape(identifier);
        const fieldNames = Object.keys(fields);
        const rows = (await queryRunner.query(
            `SELECT ${[escape('id'), ...fieldNames.map(escape)].join(', ')} FROM ${escape(tableName)}`,
        )) as Array<Record<string, unknown>>;

        for (const row of rows) {
            const repaired = Object.fromEntries(
                fieldNames.flatMap(fieldName => {
                    const value = unwrapDoubleEncodedJson(row[fieldName], fields[fieldName]);
                    return value == null ? [] : [[fieldName, value]];
                }),
            ) as Record<string, string>;
            if (Object.keys(repaired).length === 0) continue;
            await this.updateFields(queryRunner, tableName, row.id, repaired);
        }
    }

    private async updateFields(
        queryRunner: QueryRunner,
        tableName: string,
        id: unknown,
        fields: Record<string, string>,
    ): Promise<void> {
        const driver = queryRunner.connection.driver;
        const escape = (identifier: string) => driver.escape(identifier);
        const entries = Object.entries(fields);
        const assignments = entries.map(
            ([name], index) => `${escape(name)} = ${driver.createParameter(name, index)}`,
        );
        const idParameter = driver.createParameter('id', entries.length);
        await queryRunner.query(
            `UPDATE ${escape(tableName)} SET ${assignments.join(', ')} WHERE ${escape('id')} = ${idParameter}`,
            [...entries.map(([, value]) => value), id],
        );
    }
}

function unwrapDoubleEncodedJson(
    value: unknown,
    isExpectedValue: (value: unknown) => boolean,
): string | null {
    if (typeof value !== 'string') return null;
    const firstParse = safelyParse(value);
    if (typeof firstParse !== 'string') return null;
    const secondParse = safelyParse(firstParse);
    return isExpectedValue(secondParse) ? JSON.stringify(secondParse) : null;
}

function safelyParse(value: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return undefined;
    }
}
