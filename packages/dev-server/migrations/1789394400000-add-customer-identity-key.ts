import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/** Keep legacy identities unresolved until reviewed; never deduplicate or merge accounts here. */
export class AddCustomerIdentityKey1789394400000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        const table = await runner.getTable('user');
        if (!table) throw new Error('User table is required before adding the customer identity namespace');
        const existing = table.columns.find(column => column.name === 'customerIdentifier');
        if (
            existing &&
            (existing.type !== 'varchar' || !existing.isNullable || Number(existing.length || 255) !== 255)
        ) {
            throw new Error('Existing customerIdentifier does not match the nullable customer namespace key');
        }
        if (!existing)
            await runner.addColumn(
                table,
                new TableColumn({
                    name: 'customerIdentifier',
                    type: 'varchar',
                    length: '255',
                    isNullable: true,
                }),
            );
        if (!table.indices.some(index => index.name === 'IDX_user_customer_identifier')) {
            await runner.createIndex(
                'user',
                new TableIndex({
                    name: 'IDX_user_customer_identifier',
                    columnNames: ['customerIdentifier'],
                    isUnique: true,
                }),
            );
        }
    }
    down(): Promise<void> {
        return Promise.reject(new Error('Retain customer identity uniqueness during application rollback'));
    }
}
