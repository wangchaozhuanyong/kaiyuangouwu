import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('production API starts with a V8 heap budget below the RSS restart guard', () => {
    const result = spawnSync(
        process.execPath,
        [
            '-e',
            `
        const { spawnSync } = require('node:child_process');
        const { apps } = require('./deploy/ecosystem.production.config.cjs');
        const api = apps.find(app => app.name === 'vendure-api');
        const probe = spawnSync(api.interpreter, [...api.node_args, '-e',
            'console.log(require("node:v8").getHeapStatistics().heap_size_limit)'
        ], { encoding: 'utf8' });
        if (probe.status !== 0) throw new Error(probe.stderr);
        console.log(JSON.stringify({
            heapLimitBytes: Number(probe.stdout),
            restartLimit: api.max_memory_restart,
            workerNodeArgs: apps.find(app => app.name === 'vendure-worker').node_args ?? []
        }));
    `,
        ],
        {
            cwd: repositoryRoot,
            env: { ...process.env, VENDURE_RUNTIME_DIR: '/tmp/vendure-memory-fixture' },
            encoding: 'utf8',
        },
    );
    assert.equal(result.status, 0, result.stderr);
    const { heapLimitBytes, restartLimit, workerNodeArgs } = JSON.parse(result.stdout);
    const mib = 1024 * 1024;
    // Validate the effective V8 limit, including its young generation, not only the flag text.
    assert.ok(heapLimitBytes >= 384 * mib && heapLimitBytes <= 448 * mib, String(heapLimitBytes));
    assert.equal(restartLimit, '768M');
    assert.ok(768 * mib - heapLimitBytes >= 320 * mib, 'native allocations need RSS headroom');
    assert.deepEqual(workerNodeArgs, []);
});
