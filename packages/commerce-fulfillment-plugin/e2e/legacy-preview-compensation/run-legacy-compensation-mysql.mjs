import { createConnection } from 'mysql2/promise';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const binary = process.env.ORDER_CLOSURE_MYSQLD;
if (!binary || !path.isAbsolute(binary))
    throw new Error('Set ORDER_CLOSURE_MYSQLD to a local MySQL 8 binary');
const directory = path.join(
    root,
    'docs',
    'public-preview-closure-20261006',
    'authorized-execution-20261007',
    'isolated-mysql-' + randomUUID(),
);
mkdirSync(directory, { recursive: true });
const log = openSync(path.join(directory, 'mysqld.log'), 'a');
const datadir = path.join(directory, 'data');
// Refuse an occupied port without connecting to any existing database.
await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(37406, '127.0.0.1', () => probe.close(resolve));
});
const initialized = spawnSync(binary, ['--no-defaults', '--initialize-insecure', '--datadir=' + datadir], {
    cwd: root,
    stdio: ['ignore', log, log],
    timeout: 60000,
});
if (initialized.status !== 0)
    throw new Error('Isolated MySQL initialization failed; inspect the project log');
const server = spawn(
    binary,
    [
        '--no-defaults',
        '--datadir=' + datadir,
        '--bind-address=127.0.0.1',
        '--port=37406',
        '--mysqlx=OFF',
        '--socket=mysql.sock',
        '--default-time-zone=+00:00',
        '--pid-file=' + path.join(directory, 'mysqld.pid'),
    ],
    { cwd: directory, stdio: ['ignore', log, log] },
);
// The repository's deep macOS path exceeds the Unix socket path length; this relative
// path is resolved only inside the owned project artifact directory.
process.chdir(directory);
const password = randomBytes(32).toString('base64url');
let connection;
let socketPath;
let failedJobs = 0;
const jobs = [];
try {
    for (let count = 0; count < 60; count++) {
        if (server.exitCode !== null) throw new Error('Owned MySQL process exited before startup');
        for (const candidate of ['mysql.sock', 'data/mysql.sock']) {
            try {
                connection = await createConnection({ socketPath: candidate, user: 'root' });
                socketPath = candidate;
                break;
            } catch {
                // MySQL may resolve the relative socket after changing to its owned datadir.
            }
        }
        if (connection) break;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!connection) throw new Error('Owned MySQL startup timed out');
    const [identity] = await connection.query('SELECT @@datadir AS datadir, @@port AS port');
    if (path.resolve(identity[0].datadir) !== datadir || Number(identity[0].port) !== 37406)
        throw new Error('MySQL identity differs from the owned process');
    await connection.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?", [password]);
    await connection.end();
    connection = undefined;
    const baseEnvironment = {
        ...process.env,
        DB: 'mysql',
        ORDER_CLOSURE_MYSQL: '1',
        ORDER_CLOSURE_MYSQL_PASSWORD: password,
    };
    async function runJob(job) {
        if (
            !/^[a-z0-9-]+$/.test(job.id) ||
            !Array.isArray(job.args) ||
            job.args.some(arg => typeof arg !== 'string')
        )
            throw new Error('Invalid isolated test job');
        const cwd = path.resolve(root, job.cwd ?? '.');
        const relative = path.relative(root, cwd);
        if (relative.startsWith('..') || path.isAbsolute(relative))
            throw new Error('Test cwd must remain in this worktree');
        const environment = { ...baseEnvironment };
        for (const [key, value] of Object.entries(job.env ?? {})) {
            if (!['USDT_TEST_DB', 'USDT_TEST_PORT', 'PACKAGE'].includes(key) || typeof value !== 'string')
                throw new Error('Only isolated test fixture flags can be forwarded');
            environment[key] = value;
        }
        const outputPath = path.join(directory, job.id + '.log');
        const output = openSync(outputPath, 'w');
        const test = spawn(
            process.execPath,
            [path.join(root, 'node_modules/vitest/vitest.mjs'), ...job.args],
            {
                cwd,
                env: environment,
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
        for (const stream of [test.stdout, test.stderr]) {
            createInterface({ input: stream }).on('line', line => {
                const sanitized = line.replaceAll(password, '[redacted]');
                writeSync(output, sanitized + '\n');
                process.stdout.write(sanitized + '\n');
            });
        }
        const code = await new Promise((resolve, reject) => {
            test.once('error', reject);
            test.once('close', resolve);
        });
        closeSync(output);
        writeFileSync(
            path.join(directory, job.id + '.json'),
            JSON.stringify(
                {
                    finishedAt: new Date().toISOString(),
                    cwd: relative,
                    args: job.args,
                    exitCode: code,
                    command: [
                        process.execPath,
                        path.join(root, 'node_modules/vitest/vitest.mjs'),
                        ...job.args,
                    ],
                    runnerSha256: createHash('sha256')
                        .update(readFileSync(fileURLToPath(import.meta.url)))
                        .digest('hex'),
                    output: path.relative(root, outputPath),
                    scope: 'owned isolated MySQL; synthetic fixtures',
                },
                null,
                2,
            ),
        );
        process.stdout.write(`Owned MySQL job ${job.id}: ${code === 0 ? 'PASS' : 'FAIL'}\n`);
        jobs.push({ id: job.id, exitCode: code, output: path.relative(root, outputPath) });
        if (code !== 0) failedJobs++;
        return code;
    }
    {
        const readiness = {
            host: '127.0.0.1',
            port: 37406,
            databasePrefix: 'order_closure_',
            datadir,
            socket: path.join(directory, socketPath),
            pid: server.pid,
        };
        writeFileSync(path.join(directory, 'ready.json'), JSON.stringify(readiness, null, 2));
        process.stdout.write(
            `Owned isolated MySQL ready: 127.0.0.1:37406; fresh order_closure_* databases; ${directory}\n`,
        );
        const commands = createInterface({ input: process.stdin, terminal: false });
        for await (const line of commands) {
            if (!line.trim()) continue;
            const job = JSON.parse(line);
            if (job.shutdown === true) {
                commands.close();
                break;
            }
            if (job.readonlyFinal === true) {
                const diagnostic = await createConnection({
                    host: '127.0.0.1',
                    port: 37406,
                    user: 'root',
                    password,
                });
                try {
                    const [diagnosticIdentity] = await diagnostic.query(
                        'SELECT @@datadir AS datadir, @@port AS port',
                    );
                    if (
                        path.resolve(diagnosticIdentity[0].datadir) !== datadir ||
                        Number(diagnosticIdentity[0].port) !== 37406
                    )
                        throw new Error('Owned diagnosticIdentity changed');
                    const [deadlocks] = await diagnostic.query(
                        "SELECT COUNT AS count FROM information_schema.INNODB_METRICS WHERE NAME = 'lock_deadlocks'",
                    );
                    const [waits] = await diagnostic.query(
                        'SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits',
                    );
                    const [transactions] = await diagnostic.query(
                        'SELECT COUNT(*) AS count FROM information_schema.innodb_trx',
                    );
                    const metrics = {
                        capturedAt: new Date().toISOString(),
                        innodbDeadlocks: Number(deadlocks[0]?.count),
                        pendingLockWaits: Number(waits[0]?.count),
                        openTransactions: Number(transactions[0]?.count),
                        sqlParametersIncluded: false,
                        productionWrites: false,
                    };
                    writeFileSync(
                        path.join(directory, 'final-readonly-metrics.json'),
                        JSON.stringify(metrics, null, 2),
                    );
                    if (
                        metrics.innodbDeadlocks !== 0 ||
                        metrics.pendingLockWaits !== 0 ||
                        metrics.openTransactions !== 0
                    )
                        throw new Error('Unresolved owned MySQL transaction or deadlock');
                    process.stdout.write('Owned legacy MySQL final read-only metrics: PASS\n');
                } finally {
                    await diagnostic.end();
                }
                continue;
            }
            await runJob(job);
        }
        process.exitCode = failedJobs === 0 ? 0 : 1;
    }
} finally {
    await connection?.end();
    // Only our child process is stopped. Data and logs stay inside this worktree.
    if (server.exitCode === null) {
        server.kill('SIGTERM');
        await new Promise(resolve => server.once('exit', resolve));
    }
    closeSync(log);
    writeFileSync(
        path.join(directory, 'stopped.json'),
        JSON.stringify(
            {
                stoppedAt: new Date().toISOString(),
                pid: server.pid,
                exitCode: server.exitCode,
                signal: server.signalCode,
                termination: 'Owned child SIGTERM and awaited exit',
                datadirRetained: true,
                datadir,
                port: 37406,
                failedJobs,
                jobs,
                runnerExitCode: process.exitCode ?? 0,
                productionWrites: false,
            },
            null,
            2,
        ),
    );
}
