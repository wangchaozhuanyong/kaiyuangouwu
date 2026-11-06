import assert from 'node:assert/strict';
import test from 'node:test';

import { collectStoreAutonomyAudit } from './store-autonomy-data-audit.mjs';
import { createReadOnlyMysqlAdapter } from './store-isolation-data-preflight.mjs';
import { connectCase, createCase, createLab, mysqlInventory, stopLab } from './store-isolation-mysql-lab.mjs';
import { digest } from './store-isolation-rehearsal.mjs';

test(
    'owned MySQL consistent snapshot remains byte-for-byte unchanged after aggregate isolation audit',
    { timeout: 120000 },
    async () => {
        const lab = await createLab({ subnet: 'synthetic-auto' });
        try {
            const caseFile = await createCase(lab);
            const opened = await connectCase(caseFile);
            await opened.connection.query(`ALTER TABLE icloud_primary_account
                ADD COLUMN status VARCHAR(32),
                ADD COLUMN imapHost VARCHAR(255) COLLATE utf8mb4_0900_ai_ci,
                ADD COLUMN imapPort INT`);
            await opened.connection.query(`UPDATE icloud_primary_account
                SET status = 'ACTIVE', imapHost = ' IMAP.MAIL.ME.COM ', imapPort = 993`);
            await opened.connection.query(`INSERT INTO icloud_primary_account (id, status, imapHost, imapPort)
                VALUES (2, 'ACTIVE', 'imap.mail.mé.com', 993)`);
            await opened.connection.query('INSERT INTO administrator (id, userId) VALUES (1, 91)');
            await opened.connection.query(`CREATE TABLE admin_two_factor_credential (
                userId INT PRIMARY KEY, enabledAt DATETIME, encryptedSecret TEXT
            ) ENGINE=InnoDB`);
            await opened.connection.query(`INSERT INTO admin_two_factor_credential VALUES
                (91, '2026-11-01 00:00:00', 'mysql-factor-canary')`);
            const before = digest(await mysqlInventory(opened.connection));
            const adapter = await createReadOnlyMysqlAdapter(opened.connection);
            let report;
            try {
                report = await collectStoreAutonomyAudit(adapter, { auditKey: 'mysql-fixture-key' });
            } finally {
                await adapter.close();
            }
            const verified = await connectCase(caseFile);
            try {
                assert.equal(digest(await mysqlInventory(verified.connection)), before);
            } finally {
                await verified.connection.end();
            }
            assert.equal(report.mode, 'read-only-consistent-snapshot');
            assert.equal(report.verdict, 'NO_GO');
            assert.deepEqual(report.securityReadiness, {
                icloudImap: { status: 'COMPLETE', activeAccounts: 2, incompatibleEndpoints: 1 },
                administratorMfa: { status: 'COMPLETE', activeAdministrators: 1, enrolledAdministrators: 1 },
            });
            assert.equal(
                report.structure.find(item => item.key === 'unique-order-sales-owner').status,
                'FAIL',
            );
            const serialized = JSON.stringify(report);
            for (const forbidden of [
                'customerId',
                'orderId',
                'fileName',
                'identifier',
                'mysql-factor-canary',
                'imap.mail.mé.com',
            ]) {
                assert.equal(serialized.includes(forbidden), false);
            }
        } finally {
            await stopLab(lab);
        }
    },
);
