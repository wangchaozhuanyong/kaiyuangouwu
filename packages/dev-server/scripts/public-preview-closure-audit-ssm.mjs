import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { createReadOnlyMysqlAdapter, safeReadOnlyAuditFailure } from './store-isolation-data-preflight.mjs';

// Transport a reviewed, self-contained read-only audit through stdin. No remote files or data are written.
const region = 'ap-northeast-1';
const instance = 'i-041a146558e432cbf';
const runtime = '/var/www/kaiyuangouwu';
const args = process.argv.slice(2);
assert.equal(args.length, 2, 'Usage: node public-preview-closure-audit-ssm.mjs PROFILE OUTPUT_JSON');
const [profile, output] = args;
assert.match(profile, /^[a-zA-Z0-9_-]+$/u);
assert.ok(path.isAbsolute(output), 'Output must be an explicit absolute project path');
const source = await readFile(new URL('./public-preview-closure-audit.mjs', import.meta.url), 'utf8');
const coreStart = source.indexOf('// This audit only SELECTs');
const coreEnd = source.indexOf('\nasync function main()');
assert.ok(coreStart >= 0 && coreEnd > coreStart, 'Audit collector boundaries must be verified');
const core = `import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { realpathSync } from 'node:fs';
const runtimeDirectory = realpathSync('/var/www/kaiyuangouwu-current');
const mysql = createRequire(runtimeDirectory + '/packages/dev-server/package.json')('mysql2/promise');
${createReadOnlyMysqlAdapter.toString()}
${safeReadOnlyAuditFailure.toString()}
${source.slice(coreStart, coreEnd)}`;
assert.ok(
    core.includes('async function createReadOnlyMysqlAdapter'),
    'Transport must contain reviewed adapter',
);
const transport =
    core +
    `
try {
    if (!['mysql','mariadb'].includes(String(process.env.DB ?? 'mysql').toLowerCase()) ||
        !process.env.DB_NAME || !process.env.DB_USERNAME) throw new Error('Unverified database configuration');
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME, timezone: 'Z', multipleStatements: false,
    });
    const adapter = await createReadOnlyMysqlAdapter(connection);
    try {
        const audit = await collectPublicPreviewClosureAudit(adapter);
        audit.runtimeDirectory = runtimeDirectory;
        audit.timestampSerialization = 'MYSQL_DATETIME_AS_UTC';
        audit.capturedAt = new Date().toISOString();
        const body = JSON.stringify(audit);
        console.log('PUBLIC_PREVIEW_AUDIT_SHA256=' + createHash('sha256').update(body).digest('hex'));
        console.log('PUBLIC_PREVIEW_AUDIT_GZIP=' + gzipSync(body).toString('base64'));
    } finally { await adapter.close(); }
} catch(error) { console.error(safeReadOnlyAuditFailure(error)); process.exitCode = 1; }
`;
assert.ok(!transport.includes('PUBLIC_PREVIEW_AUDIT_END'), 'Unsafe transport delimiter');
const command =
    `sudo -H -u ubuntu /usr/bin/node --env-file=${runtime}/packages/dev-server/.env --input-type=module <<'PUBLIC_PREVIEW_AUDIT_END'\n` +
    transport +
    '\nPUBLIC_PREVIEW_AUDIT_END';
const aws = commandArgs =>
    JSON.parse(
        execFileSync(
            'aws',
            [
                ...commandArgs,
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
const submitted = aws([
    'ssm',
    'send-command',
    '--document-name',
    'AWS-RunShellScript',
    '--instance-ids',
    instance,
    '--comment',
    'Public preview read-only closure audit',
    '--parameters',
    JSON.stringify({ commands: [command], executionTimeout: ['120'] }),
]);
const commandId = submitted.Command.CommandId;
assert.match(commandId, /^[a-f0-9-]+$/u);
process.stdout.write('Read-only audit submitted: ' + commandId + '\n');
const deadline = Date.now() + 150_000;
let result;
while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    try {
        result = aws(['ssm', 'get-command-invocation', '--command-id', commandId, '--instance-id', instance]);
    } catch {
        continue;
    }
    if (!['Pending', 'InProgress', 'Delayed'].includes(result.Status)) break;
}
assert.equal(result?.Status, 'Success', 'Read-only audit did not complete successfully');
assert.equal(result.ResponseCode, 0, 'Read-only audit returned an error');
const checksum = result.StandardOutputContent.match(/^PUBLIC_PREVIEW_AUDIT_SHA256=([a-f0-9]{64})$/mu)?.[1];
const payload = result.StandardOutputContent.match(/^PUBLIC_PREVIEW_AUDIT_GZIP=([a-zA-Z0-9+/=]+)$/mu)?.[1];
assert.ok(checksum && payload, 'Audit output was missing or truncated');
const body = gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
assert.equal(createHash('sha256').update(body).digest('hex'), checksum, 'Audit checksum mismatch');
const audit = JSON.parse(body);
audit.evidence = {
    commandId,
    instance,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    snapshotSha256: checksum,
};
await writeFile(output, JSON.stringify(audit, null, 2) + '\n');
process.stdout.write(
    JSON.stringify({
        status: audit.status,
        transitionRows: audit.transition?.length ?? null,
        compensationRows: audit.compensation?.length ?? null,
        output,
    }) + '\n',
);
