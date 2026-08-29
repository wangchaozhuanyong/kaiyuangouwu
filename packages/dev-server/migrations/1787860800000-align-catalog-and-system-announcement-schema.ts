import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const productSourceCreatedAtColumn = 'customFieldsSourcecreatedat';
const obsoleteAnnouncementColumn = 'targetMode';

/**
 * Removes the two schema drifts reported by TypeORM on the production MySQL database.
 *
 * The source-created-at column was introduced by the catalog workbench migration without
 * MySQL fractional-second precision. The custom-field metadata expects datetime(6), so we
 * align the existing column in place. The old announcement targetMode field no longer has
 * an entity or API owner and is therefore removed when it is still present.
 */
export class AlignCatalogAndSystemAnnouncementSchema1787860800000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (this.isMysql(queryRunner)) {
            await this.alignProductSourceCreatedAt(queryRunner);
        }

        const announcement = await queryRunner.getTable('system_announcement');
        const obsoleteColumn = announcement?.findColumnByName(obsoleteAnnouncementColumn);
        if (announcement && obsoleteColumn) {
            await queryRunner.dropColumn(announcement, obsoleteColumn);
        }
    }

    public async down(): Promise<void> {
        // The forward migration only changes metadata and removes an obsolete, unowned
        // column. Re-adding that column would recreate schema drift and cannot restore
        // values that no application code can interpret, so rollback is intentionally a no-op.
    }

    private async alignProductSourceCreatedAt(queryRunner: QueryRunner): Promise<void> {
        const product = await queryRunner.getTable('product');
        const current = product?.findColumnByName(productSourceCreatedAtColumn);
        if (!product || !current) return;

        const expected = current.clone();
        expected.type = 'datetime';
        expected.precision = 6;
        // TypeORM represents a datetime column's length as an empty string on MySQL.
        // Keep that canonical value so an already-correct column is left untouched.
        expected.length = '';
        expected.isNullable = true;
        expected.default = undefined;
        expected.onUpdate = undefined;

        if (this.columnsMatch(current, expected)) return;
        await queryRunner.changeColumn(product, current, expected);
    }

    private columnsMatch(current: TableColumn, expected: TableColumn): boolean {
        return (
            current.type === expected.type &&
            current.precision === expected.precision &&
            current.length === expected.length &&
            current.isNullable === expected.isNullable &&
            this.normalizeDefault(current.default) === this.normalizeDefault(expected.default) &&
            this.normalizeDefault(current.onUpdate) === this.normalizeDefault(expected.onUpdate)
        );
    }

    private normalizeDefault(value: string | number | boolean | null | undefined): string | undefined {
        if (value == null) return undefined;
        return String(value)
            .replace(/^\((.*)\)$/u, '$1')
            .trim();
    }

    private isMysql(queryRunner: QueryRunner): boolean {
        return ['mysql', 'mariadb'].includes(queryRunner.connection.options.type);
    }
}
