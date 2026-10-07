import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
    canonicalCompensationJson,
    compensationFingerprint,
    LEGACY_COMPENSATION_LINE_RISK_TABLES,
    LEGACY_COMPENSATION_RISK_TABLES,
    LEGACY_COMPENSATION_SCOPE,
} from './public-preview-legacy-compensation.mjs';
import { createReadOnlyMysqlAdapter, safeReadOnlyAuditFailure } from './store-isolation-data-preflight.mjs';

// Pure SELECT evidence transport. It cannot open a Vendure injector or call the compensation executor.
const [profile, output] = process.argv.slice(2);
assert.equal(profile, 'vendure-prod');
assert.ok(path.isAbsolute(output), 'Explicit absolute project output required');
const source = await readFile(
    new URL('./public-preview-legacy-compensation-readonly.mjs', import.meta.url),
    'utf8',
);
const start = source.indexOf('const schema =');
assert.ok(start > 0, 'Reviewed collector boundary missing');
const collector = source.slice(start).replace(/^export async function /mu, 'async function ');
assert.ok(
    !collector.includes('createLegacyCompensationExecutor'),
    'No execution provider may enter the transport',
);
const transport = `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { realpathSync } from 'node:fs';
const LEGACY_COMPENSATION_SCOPE = ${JSON.stringify(LEGACY_COMPENSATION_SCOPE)};
const LEGACY_COMPENSATION_RISK_TABLES = ${JSON.stringify(LEGACY_COMPENSATION_RISK_TABLES)};
const LEGACY_COMPENSATION_LINE_RISK_TABLES = ${JSON.stringify(LEGACY_COMPENSATION_LINE_RISK_TABLES)};
${canonicalCompensationJson.toString()}
const compensationFingerprint = ${compensationFingerprint.toString()};
${createReadOnlyMysqlAdapter.toString()}
${safeReadOnlyAuditFailure.toString()}
${collector}
try {
    const runtimeDirectory = realpathSync('/var/www/kaiyuangouwu-current');
    const mysql = createRequire(runtimeDirectory + '/packages/dev-server/package.json')('mysql2/promise');
    if (!['mysql','mariadb'].includes(String(process.env.DB ?? 'mysql').toLowerCase()) ||
        !process.env.DB_NAME || !process.env.DB_USERNAME) throw new Error('UNVERIFIED_DATABASE');
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME, timezone: 'Z', multipleStatements: false,
    });
    const adapter = await createReadOnlyMysqlAdapter(connection);
    try {
        const audit = await collectLegacyCompensationReadOnlyEvidence(adapter);
        audit.runtimeDirectory = runtimeDirectory;
        audit.timestampSerialization = 'MYSQL_DATETIME_AS_UTC';
        audit.capturedAt = new Date().toISOString();
        const body = JSON.stringify(audit);
        console.log('LEGACY_READONLY_SHA256=' + createHash('sha256').update(body).digest('hex'));
        console.log('LEGACY_READONLY_GZIP=' + gzipSync(body).toString('base64'));
    } finally { await adapter.close(); }
} catch(error) { console.error(safeReadOnlyAuditFailure(error)); process.exitCode = 1; }
`;
const region = 'ap-northeast-1';
const instance = 'i-041a146558e432cbf';
const aws = args =>
    JSON.parse(
        execFileSync(
            'aws',
            [
                ...args,
                '--profile',
                profile,
                '--region',
                region,
                '--output',
                'json',
                '--cli-read-timeout',
                '30',
            ],
            { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
        ),
    );
const command =
    "sudo -H -u ubuntu /usr/bin/node --env-file=/var/www/kaiyuangouwu/packages/dev-server/.env --input-type=module <<'LEGACY_READONLY_END'\n" +
    transport +
    '\nLEGACY_READONLY_END';
const submitted = aws([
    'ssm',
    'send-command',
    '--document-name',
    'AWS-RunShellScript',
    '--instance-ids',
    instance,
    '--comment',
    'Original six preview orders read-only risk evidence',
    '--parameters',
    JSON.stringify({ commands: [command], executionTimeout: ['120'] }),
]);
const commandId = submitted.Command.CommandId;
process.stdout.write(`Targeted read-only evidence submitted: ${commandId}\n`);
let result;
const deadline = Date.now() + 150_000;
while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    try {
        result = aws(['ssm', 'get-command-invocation', '--command-id', commandId, '--instance-id', instance]);
    } catch {
        continue;
    }
    if (!['Pending', 'InProgress', 'Delayed'].includes(result.Status)) break;
}
assert.equal(result?.Status, 'Success', 'Read-only transport failed');
assert.equal(result.ResponseCode, 0, 'Read-only collector failed; no writes performed');
const checksum = result.StandardOutputContent.match(/^LEGACY_READONLY_SHA256=([a-f0-9]{64})$/mu)?.[1];
const payload = result.StandardOutputContent.match(/^LEGACY_READONLY_GZIP=([a-zA-Z0-9+/=]+)$/mu)?.[1];
assert.ok(checksum && payload, 'Evidence output missing or truncated');
const body = gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
assert.equal(createHash('sha256').update(body).digest('hex'), checksum);
const audit = JSON.parse(body);
audit.evidence = {
    commandId,
    instance,
    collectorSha256: createHash('sha256').update(source).digest('hex'),
    transportSha256: createHash('sha256').update(transport).digest('hex'),
    snapshotSha256: checksum,
};
await writeFile(output, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
process.stdout.write(
    JSON.stringify({
        status: audit.status,
        orders: audit.orders?.length ?? null,
        missing: audit.missing ?? [],
        productionWriteAllowed: audit.productionWriteAllowed,
        output,
    }) + '\n',
);
