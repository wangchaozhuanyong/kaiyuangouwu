import { createConnection } from 'mysql2/promise';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const binary = process.env.ORDER_CLOSURE_MYSQLD;
if (!binary || !path.isAbsolute(binary))
    throw new Error('Set ORDER_CLOSURE_MYSQLD to a local MySQL 8 binary');
const directory = path.join(root, 'reports', 'order-closure-mysql', String(Date.now()));
mkdirSync(directory, { recursive: true });
const log = openSync(path.join(directory, 'mysqld.log'), 'a');
const datadir = path.join(directory, 'data');
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
    { cwd: root, stdio: ['ignore', log, log] },
);
const password = randomBytes(32).toString('base64url');
let connection;
try {
    for (let count = 0; count < 60; count++) {
        if (server.exitCode !== null) throw new Error('Owned MySQL process exited before startup');
        try {
            connection = await createConnection({ host: '127.0.0.1', port: 37406, user: 'root' });
            break;
        } catch {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    if (!connection) throw new Error('Owned MySQL startup timed out');
    await connection.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?", [password]);
    await connection.end();
    connection = undefined;
    const outputPath = path.join(directory, 'api-tests.log');
    const output = openSync(outputPath, 'w');
    const test = spawn(
        'bunx',
        [
            'vitest',
            'run',
            '--config',
            'packages/commerce-fulfillment-plugin/e2e/order-closure.vitest.config.mjs',
            ...process.argv.slice(2),
        ],
        {
            cwd: root,
            env: {
                ...process.env,
                PACKAGE: 'commerce-fulfillment-plugin',
                DB: 'mysql',
                ORDER_CLOSURE_MYSQL: '1',
                ORDER_CLOSURE_MYSQL_PASSWORD: password,
            },
            stdio: ['ignore', output, output],
        },
    );
    const code = await new Promise(resolve => test.once('exit', resolve));
    closeSync(output);
    copyFileSync(outputPath, path.join(root, 'reports/order-closure-publish-mysql-api.log'));
    writeFileSync(
        path.join(directory, 'run.json'),
        JSON.stringify(
            {
                finishedAt: new Date().toISOString(),
                filters: process.argv.slice(2),
                exitCode: code,
                output: path.relative(root, outputPath),
                scope: 'owned isolated MySQL, synthetic payment handlers',
            },
            null,
            2,
        ),
    );
    process.exitCode = code === 0 ? 0 : 1;
    process.stdout.write(
        format('Isolated MySQL API tests:', code === 0 ? 'PASS' : 'FAIL', path.relative(root, outputPath)) +
            '\n',
    );
} finally {
    await connection?.end();
    // Only our child process is stopped. Data and logs stay inside this worktree.
    if (server.exitCode === null) {
        server.kill('SIGTERM');
        await new Promise(resolve => server.once('exit', resolve));
    }
}
