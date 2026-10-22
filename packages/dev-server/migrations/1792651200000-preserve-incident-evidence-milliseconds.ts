import { MigrationInterface, QueryRunner } from 'typeorm';

const tableName = 'admin_incident_evidence';

export class PreserveIncidentEvidenceMilliseconds1792651200000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        if (!['mysql', 'mariadb', 'aurora-mysql'].includes(String(runner.connection.options.type))) {
            return;
        }
        const table = await runner.getTable(tableName);
        const column = table?.findColumnByName('occurredAt');
        if (!table || !column) {
            throw new Error('Incident evidence timestamp column must exist before preserving milliseconds');
        }
        if (!['datetime', 'timestamp'].includes(column.type)) {
            throw new Error('Unexpected incident evidence timestamp column type');
        }
        if ((column.precision ?? 0) >= 3) return;
        const precise = column.clone();
        precise.precision = 3;
        await runner.changeColumn(table, column, precise);
    }

    down(): Promise<void> {
        return Promise.reject(
            new Error('Retain incident evidence timestamp precision; reducing it would invalidate hashes'),
        );
    }
}
