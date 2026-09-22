import { DataSource, QueryRunner, Table } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AddGovernanceAndFraudControl1789696800000 } from './1789696800000-add-governance-and-fraud-control';

describe('governance and fraud control migration', () => {
    it.each(['mysql', 'postgres', 'sqlite'] as const)('uses portable control tables on %s', async type => {
        const created: Table[] = [];
        await new AddGovernanceAndFraudControl1789696800000().up({
            connection: { options: { type } },
            hasTable: vi.fn().mockResolvedValue(false),
            createTable: vi.fn((table: Table) => {
                created.push(table);
                return Promise.resolve();
            }),
        } as unknown as QueryRunner);
        expect(created.map(table => table.name)).toEqual([
            'governed_config_version',
            'governance_approval_request',
            'governance_audit_entry',
            'governance_report_snapshot',
            'fraud_risk_case',
            'fraud_risk_case_event',
            'fraud_risk_appeal',
        ]);
        expect(created[0].findColumnByName('id')?.type).toBe(type === 'mysql' ? 'int' : 'integer');
        expect(created.find(table => table.name === 'fraud_risk_case')?.indices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'UQ_fraud_risk_case_code', isUnique: true }),
                expect.objectContaining({
                    name: 'UQ_fraud_risk_case_subject_digest',
                    isUnique: true,
                }),
            ]),
        );
        expect(
            created.find(table => table.name === 'fraud_risk_appeal')?.findColumnByName('customerId')
                ?.isNullable,
        ).toBe(true);
        expect(created.find(table => table.name === 'fraud_risk_appeal')?.indices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'UQ_fraud_risk_appeal_case', isUnique: true }),
            ]),
        );
    });

    it('is idempotent and preserves evidence on rollback', async () => {
        const database = await new DataSource({
            type: 'sqljs',
            entities: [],
            synchronize: false,
        }).initialize();
        const runner = database.createQueryRunner();
        try {
            await runner.query('CREATE TABLE channel (id INTEGER PRIMARY KEY)');
            const migration = new AddGovernanceAndFraudControl1789696800000();
            await migration.up(runner);
            await migration.up(runner);
            await expect(runner.hasTable('governance_audit_entry')).resolves.toBe(true);
            await expect(runner.hasTable('fraud_risk_case')).resolves.toBe(true);
            await expect(runner.hasTable('fraud_risk_appeal')).resolves.toBe(true);
            await expect(migration.down()).rejects.toThrow('Retain governance approvals');
        } finally {
            await runner.release();
            await database.destroy();
        }
    });
});
