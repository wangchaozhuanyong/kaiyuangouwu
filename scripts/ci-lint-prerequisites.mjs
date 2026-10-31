import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { packageInventory, STATIC_APPS } from './ci-impact.mjs';

export function lintPrerequisiteCommand(plan, inventory) {
    const files = plan.lintFiles ?? plan.files;
    assert.ok(Array.isArray(files), 'CI lint files must be an array');
    const selected = new Set(['common', 'core']);
    for (const file of files) {
        assert.ok(
            typeof file === 'string' && file && !file.startsWith('/') && !file.split('/').includes('..'),
            'Invalid CI lint path',
        );
        const directory = /^packages\/([^/]+)\//u.exec(file)?.[1];
        if (!directory || STATIC_APPS.includes(directory)) continue;
        const pkg = inventory.find(item => item.directory === directory);
        assert.ok(pkg, 'Unknown lint package: ' + directory);
        if (pkg.scripts?.build) selected.add(directory);
    }
    const packages = [...selected].sort().map(directory => {
        const pkg = inventory.find(item => item.directory === directory);
        assert.ok(pkg?.scripts?.build, 'Missing lint prerequisite: ' + directory);
        return pkg;
    });
    return [
        'bunx',
        'lerna',
        'run',
        'build',
        ...packages.flatMap(pkg => ['--scope', pkg.name]),
        '--include-dependencies',
    ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const command = lintPrerequisiteCommand(JSON.parse(process.env.CI_PLAN), packageInventory());
    const result = spawnSync(command[0], command.slice(1), {
        stdio: 'inherit',
        env: { ...process.env, NX_WORKSPACE_ROOT_PATH: process.cwd() },
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Lint prerequisite build failed');
}
