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
        const lab = await createLab();
        try {
            const caseFile = await createCase(lab);
            const opened = await connectCase(caseFile);
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
            assert.equal(
                report.structure.find(item => item.key === 'unique-order-sales-owner').status,
                'FAIL',
            );
            const serialized = JSON.stringify(report);
            for (const forbidden of ['customerId', 'orderId', 'fileName', 'identifier']) {
                assert.equal(serialized.includes(forbidden), false);
            }
        } finally {
            await stopLab(lab);
        }
    },
);
