import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import {
    CreateDateColumn,
    DataSource,
    getMetadataArgsStorage,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AdminIncidentEvidence } from '../../operations-dashboard-plugin/src/entities/admin-incident-evidence.entity';
import { AdminNotificationDelivery } from '../../operations-dashboard-plugin/src/entities/admin-notification-delivery.entity';
import { IncidentResponseService } from '../../operations-dashboard-plugin/src/incident-response.service';

import { PreserveIncidentEvidenceMilliseconds1792651200000 } from './1792651200000-preserve-incident-evidence-milliseconds';

PrimaryGeneratedColumn()(AdminIncidentEvidence.prototype, 'id');
CreateDateColumn()(AdminIncidentEvidence.prototype, 'createdAt');
UpdateDateColumn()(AdminIncidentEvidence.prototype, 'updatedAt');

describe.skipIf(process.env.DB !== 'mysql')('native MySQL incident evidence timestamp preservation', () => {
    it('reproduces legacy hash failure and preserves original hashes after precision repair and future writes', async () => {
        const databaseName = `incident_precision_${randomUUID().replaceAll('-', '')}`;
        const options = {
            type: 'mysql' as const,
            host: '127.0.0.1',
            port: Number(process.env.E2E_MYSQL_PORT ?? 13370),
            username: 'root',
            password: 'password',
            timezone: 'Z',
        };
        const admin = await new DataSource({ ...options, database: 'mysql' }).initialize();
        let source: DataSource | undefined;
        let created = false;
        try {
            await admin.query(`CREATE DATABASE ${databaseName}`);
            created = true;
            source = await new DataSource({
                ...options,
                database: databaseName,
                entities: [AdminIncidentEvidence],
                synchronize: true,
            }).initialize();
            const initializedSource = source;
            const runner = initializedSource.createQueryRunner();
            const incident = { id: 7, mode: 'INCIDENT', severity: 'P0' } as AdminNotificationDelivery;
            const repository = () =>
                runner.isTransactionActive
                    ? runner.manager.getRepository(AdminIncidentEvidence)
                    : initializedSource.getRepository(AdminIncidentEvidence);
            const connection = {
                rawConnection: {
                    getRepository: (entity: unknown) =>
                        entity === AdminIncidentEvidence
                            ? repository()
                            : { findOne: () => Promise.resolve(incident), find: () => Promise.resolve([]) },
                },
                getRepository: () => repository(),
            };
            const service = new IncidentResponseService(connection as never, {} as never, {} as never);
            try {
                expect(
                    getMetadataArgsStorage().columns.find(
                        column =>
                            column.target === AdminIncidentEvidence && column.propertyName === 'occurredAt',
                    )?.options.precision,
                ).toBe(3);
                // Recreate the production legacy column, including MySQL's fractional-second rounding.
                await runner.query('ALTER TABLE admin_incident_evidence MODIFY occurredAt DATETIME NOT NULL');
                const original = new Date('2026-10-22T00:00:00.642Z');
                const saved = await service.appendSystemEvidence(
                    null,
                    incident,
                    'CREATED',
                    'Native precision regression fixture',
                    { verified: true },
                    original,
                );
                if (!saved) throw new Error('Fixture evidence must be created');
                expect((await service.incidentDetail(7)).evidence[0].integrityValid).toBe(false);
                const before = await repository().findOneByOrFail({ id: saved.id });
                const migration = new PreserveIncidentEvidenceMilliseconds1792651200000();
                await migration.up(runner);
                await migration.up(runner);
                expect(
                    (await runner.getTable('admin_incident_evidence'))?.findColumnByName('occurredAt')
                        ?.precision,
                ).toBe(3);
                // Expanding storage cannot restore a timestamp that was already rounded.
                expect((await service.incidentDetail(7)).evidence[0].integrityValid).toBe(false);
                await runner.query(
                    'UPDATE admin_incident_evidence SET occurredAt = ?, updatedAt = updatedAt WHERE id = ?',
                    [original, saved.id],
                );
                const repaired = await repository().findOneByOrFail({ id: saved.id });
                expect({ ...repaired, occurredAt: before.occurredAt }).toEqual({ ...before });
                expect(repaired.evidenceHash).toBe(saved.evidenceHash);
                expect((await service.incidentDetail(7)).evidence[0].integrityValid).toBe(true);
                await service.appendSystemEvidence(
                    null,
                    incident,
                    'RECOVERY_OBSERVED',
                    'Future evidence preserves milliseconds',
                    { auditIntegrityValid: true },
                    new Date('2026-10-22T00:00:01.401Z'),
                );
                expect((await service.incidentDetail(7)).evidence.every(item => item.integrityValid)).toBe(
                    true,
                );
                await runner.startTransaction();
                await runner.query('UPDATE admin_incident_evidence SET occurredAt = ? WHERE id = ?', [
                    new Date(original.getTime() + 1),
                    saved.id,
                ]);
                expect((await service.incidentDetail(7)).evidence[0].integrityValid).toBe(false);
                await runner.rollbackTransaction();
                expect((await service.incidentDetail(7)).evidence.every(item => item.integrityValid)).toBe(
                    true,
                );
            } finally {
                if (runner.isTransactionActive) await runner.rollbackTransaction();
                await runner.release();
            }
        } finally {
            if (source?.isInitialized) await source.destroy();
            if (created) await admin.query(`DROP DATABASE ${databaseName}`);
            await admin.destroy();
        }
    }, 30_000);
});
