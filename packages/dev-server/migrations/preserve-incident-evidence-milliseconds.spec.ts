import { QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { PreserveIncidentEvidenceMilliseconds1792651200000 } from './1792651200000-preserve-incident-evidence-milliseconds';

describe('preserve incident evidence milliseconds migration', () => {
    it.each(['mysql', 'mariadb', 'aurora-mysql'])(
        'expands timestamp precision without changing column semantics on %s',
        async type => {
            const table = new Table({
                name: 'admin_incident_evidence',
                columns: [{ name: 'occurredAt', type: 'datetime', isNullable: false, comment: 'evidence' }],
            });
            const changeColumn = vi.fn().mockResolvedValue(undefined);
            await new PreserveIncidentEvidenceMilliseconds1792651200000().up({
                connection: { options: { type } },
                getTable: vi.fn().mockResolvedValue(table),
                changeColumn,
            } as unknown as QueryRunner);
            expect(changeColumn).toHaveBeenCalledWith(
                table,
                table.columns[0],
                expect.objectContaining({
                    name: 'occurredAt',
                    type: 'datetime',
                    precision: 3,
                    isNullable: false,
                    comment: 'evidence',
                }),
            );
            expect(table.columns[0].precision).not.toBe(3);
        },
    );

    it.each([3, 6])('preserves an existing precision of %s', async precision => {
        const table = new Table({
            name: 'admin_incident_evidence',
            columns: [{ name: 'occurredAt', type: 'datetime', precision }],
        });
        const changeColumn = vi.fn();
        await new PreserveIncidentEvidenceMilliseconds1792651200000().up({
            connection: { options: { type: 'mysql' } },
            getTable: vi.fn().mockResolvedValue(table),
            changeColumn,
        } as unknown as QueryRunner);
        expect(changeColumn).not.toHaveBeenCalled();
    });

    it.each(['postgres', 'sqlite', 'sqljs'])('leaves existing date storage unchanged on %s', async type => {
        const getTable = vi.fn();
        await new PreserveIncidentEvidenceMilliseconds1792651200000().up({
            connection: { options: { type } },
            getTable,
        } as unknown as QueryRunner);
        expect(getTable).not.toHaveBeenCalled();
    });

    it('rejects missing evidence storage and refuses precision-losing rollback', async () => {
        const migration = new PreserveIncidentEvidenceMilliseconds1792651200000();
        await expect(
            migration.up({
                connection: { options: { type: 'mysql' } },
                getTable: vi.fn().mockResolvedValue(undefined),
            } as unknown as QueryRunner),
        ).rejects.toThrow('must exist');
        await expect(migration.down()).rejects.toThrow('reducing it would invalidate hashes');
    });
});
