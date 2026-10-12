import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('production API and Worker start with V8 heap budgets below their RSS restart guards', () => {
    const result = spawnSync(
        process.execPath,
        [
            '-e',
            `
        const { spawnSync } = require('node:child_process');
        const { apps } = require('./deploy/ecosystem.production.config.cjs');
        const budgets = ['vendure-api', 'vendure-worker'].map(name => {
            const app = apps.find(app => app.name === name);
            const probe = spawnSync(app.interpreter, [...(app.node_args ?? []), '-e',
                'console.log(require("node:v8").getHeapStatistics().heap_size_limit)'
            ], { encoding: 'utf8' });
            if (probe.status !== 0) throw new Error(probe.stderr);
            return { name, heapLimitBytes: Number(probe.stdout), restartLimit: app.max_memory_restart };
        });
        console.log(JSON.stringify(budgets));
    `,
        ],
        {
            cwd: repositoryRoot,
            env: { ...process.env, VENDURE_RUNTIME_DIR: '/tmp/vendure-memory-fixture' },
            encoding: 'utf8',
        },
    );
    assert.equal(result.status, 0, result.stderr);
    const budgets = JSON.parse(result.stdout);
    assert.deepEqual(
        budgets.map(budget => budget.name),
        ['vendure-api', 'vendure-worker'],
    );
    const mib = 1024 * 1024;
    // Validate the effective V8 limit, including its young generation, not only the flag text.
    for (const { name, heapLimitBytes, restartLimit } of budgets) {
        assert.ok(heapLimitBytes >= 384 * mib && heapLimitBytes <= 448 * mib, `${name}: ${heapLimitBytes}`);
        assert.equal(restartLimit, '768M');
        assert.ok(768 * mib - heapLimitBytes >= 320 * mib, `${name}: native allocations need RSS headroom`);
    }
});
