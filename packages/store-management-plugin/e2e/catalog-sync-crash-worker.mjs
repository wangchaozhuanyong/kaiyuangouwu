import assert from 'node:assert/strict';

import { connectCase } from '../../dev-server/scripts/store-isolation-mysql-lab.mjs';

// Fault injector only: its connection is fenced by the owned, non-production lab manifest.
const [caseFile, database, ruleId, cursor] = process.argv.slice(2);
assert.match(database, /^service_[a-zA-Z0-9_-]+$/u);
assert.match(ruleId, /^\d+$/u);
assert.match(cursor, /^\d+$/u);
const { connection } = await connectCase(caseFile);
await connection.query(`USE \`${database}\``);
const [result] = await connection.execute(
    'UPDATE catalog_sync_rule SET leaseUntil = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 60 SECOND), ' +
        'leaseToken = ?, state = ?, `cursor` = ?, runGeneration = generation, generation = generation + 1 ' +
        'WHERE id = ? AND enabled = 1 AND leaseToken IS NULL',
    ['22222222-2222-4222-8222-222222222222', 'RUNNING', Number(cursor), Number(ruleId)],
);
assert.equal(result.affectedRows, 1);
process.stdout.write('SYNTHETIC_LEASE_READY\n');
setInterval(() => undefined, 1000);
