import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Disposable synthetic database only. This runner never loads runtime configuration or dotenv files.
const exec = promisify(execFile);
const project = await realpath(fileURLToPath(new URL('../../../', import.meta.url)));
const readinessRoot = path.join(project, 'tmp/seo-geo-readiness');
const purpose = 'vendure-seo-mysql-readiness-v1';
const image = 'sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb';
assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'Ambient Docker overrides rejected');
const endpoint = (
    await exec('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
).stdout.trim();
assert.ok(endpoint.startsWith('unix:///'), 'Only local Docker is permitted');
const docker = async (...args) =>
    (await exec('docker', ['--host', endpoint, ...args], { timeout: 60_000 })).stdout.trim();
assert.equal(await docker('image', 'inspect', image, '--format', '{{.Id}}'), image);
await mkdir(readinessRoot, { recursive: true });
const runId = randomBytes(8).toString('hex');
const directory = path.join(readinessRoot, `mysql-${runId}`);
const datadir = path.join(directory, 'data');
await mkdir(datadir, { recursive: true, mode: 0o700 });
const containerId = await docker(
    'run',
    '--detach',
    '--pull=never',
    '--restart=no',
    '--network=none',
    '--name',
    `vendure-seo-readiness-${runId}`,
    '--label',
    `codex.vendure.seo=${runId}`,
    '--label',
    `codex.vendure.seo.purpose=${purpose}`,
    '--mount',
    `type=bind,source=${datadir},target=/var/lib/mysql`,
    '--env',
    'MYSQL_ALLOW_EMPTY_PASSWORD=yes',
    image,
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_unicode_ci',
);
const descriptor = {
    purpose,
    project,
    runId,
    directory,
    datadir,
    containerId,
    image,
    endpoint,
    database: `seo_readiness_${runId}`,
};
const descriptorFile = path.join(directory, 'lab.json');
await writeFile(descriptorFile, `${JSON.stringify(descriptor, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
let passed = false;
try {
    let ready = false;
    for (let attempt = 0; attempt < 45; attempt++) {
        try {
            // The image's temporary initialization server only listens on a socket. Require final TCP readiness.
            await docker(
                'exec',
                containerId,
                'mysql',
                '--user=root',
                '--host=127.0.0.1',
                '--protocol=TCP',
                '--execute',
                'SELECT 1',
            );
            ready = true;
            break;
        } catch {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    assert.ok(ready, 'Owned MySQL startup timed out');
    await docker(
        'exec',
        containerId,
        'mysql',
        '--user=root',
        '--host=127.0.0.1',
        '--protocol=TCP',
        '--execute',
        `CREATE DATABASE \`${descriptor.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    const result = await exec(
        path.join(project, 'node_modules/.bin/vitest'),
        ['run', 'src/seo/storefront-seo.mysql.spec.ts'],
        {
            cwd: path.join(project, 'packages/store-management-plugin'),
            env: { ...process.env, SEO_MYSQL_LAB_FILE: descriptorFile },
            timeout: 120_000,
            maxBuffer: 2 * 1024 * 1024,
        },
    );
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    passed = true;
} catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    process.exitCode = 1;
    process.stderr.write(`${error.message}\n`);
} finally {
    const [container] = JSON.parse(await docker('inspect', containerId));
    assert.equal(container.Config.Labels['codex.vendure.seo'], runId);
    assert.equal(container.Config.Labels['codex.vendure.seo.purpose'], purpose);
    await docker('stop', '--timeout', '10', containerId);
    await writeFile(
        path.join(directory, 'result.json'),
        `${JSON.stringify({ passed, containerStopped: true, syntheticDataRetained: true, descriptorFile }, null, 2)}\n`,
        { mode: 0o600 },
    );
    process.stdout.write(`MySQL readiness result: ${path.join(directory, 'result.json')}\n`);
}
