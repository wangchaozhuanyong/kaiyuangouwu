import { createHash } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runBunAudit } from './production-runtime-audit.mjs';

export async function createBunAuditEvidence({
    auditLevel = 'high',
    commandRunner,
    lockfilePath,
    maxAttempts = 3,
    outputPath,
    repositoryRoot,
    retryDelayMs = 2_000,
}) {
    const resolvedRepositoryRoot = path.resolve(repositoryRoot);
    const resolvedLockfilePath = path.resolve(resolvedRepositoryRoot, lockfilePath);
    const resolvedOutputPath = path.resolve(outputPath);
    const report = await runBunAudit(resolvedRepositoryRoot, {
        auditLevel,
        ...(commandRunner ? { commandRunner } : {}),
        maxAttempts,
        requireSuccessfulExit: true,
        retryDelayMs,
    });
    const lockfileSha256 = createHash('sha256')
        .update(await readFile(resolvedLockfilePath))
        .digest('hex');
    const evidence = { format: 1, lockfileSha256, report };
    await writeFile(resolvedOutputPath, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
    await chmod(resolvedOutputPath, 0o600);
    return evidence;
}

function readArgument(name) {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) {
        throw new Error(`Missing required argument: ${name}`);
    }
    return process.argv[index + 1];
}

async function main() {
    await createBunAuditEvidence({
        auditLevel: readArgument('--audit-level'),
        lockfilePath: readArgument('--lockfile'),
        outputPath: readArgument('--output'),
        repositoryRoot: process.cwd(),
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
