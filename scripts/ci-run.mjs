import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { packageInventory, STATIC_APPS } from './ci-impact.mjs';

export function packageCommands(plan, operation, inventory) {
    assert.ok(['build', 'test', 'e2e', 'prepare-tests'].includes(operation));
    if (plan.full)
        return operation === 'prepare-tests' ? [['bunx', 'lerna', 'run', 'ci']] : [['bun', 'run', operation]];
    const selected = inventory.filter(pkg => plan.packages.includes(pkg.directory));
    const script = operation === 'prepare-tests' ? 'build' : operation;
    const packages = selected.filter(pkg => pkg.scripts?.[script]);
    if (!packages.length) return [];
    return [
        [
            'bunx',
            'lerna',
            'run',
            script,
            ...packages.flatMap(pkg => ['--scope', pkg.name]),
            ...(script === 'build' ? ['--include-dependencies'] : []),
        ],
    ];
}

function run(command, cwd = process.cwd(), environment = {}) {
    const result = spawnSync(command[0], command.slice(1), {
        cwd,
        stdio: 'inherit',
        env: { ...process.env, ...environment },
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Failed: ${command.join(' ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [operation, component] = process.argv.slice(2);
    const plan = JSON.parse(process.env.CI_PLAN);
    if (operation === 'frontend') {
        assert.ok(STATIC_APPS.includes(component));
        const cwd = resolve('packages', component);
        const files = plan.files.filter(
            file => file.startsWith(`packages/${component}/`) && existsSync(file),
        );
        const tests = files.filter(file => /\.(spec|test)\.[cm]?[jt]sx?$/u.test(file));
        const sources = files.filter(file => !tests.includes(file) && /\.(css|[cm]?[jt]sx?)$/u.test(file));
        const relative = values => values.map(file => resolve(file));
        const testEnvironment = { NODE_ENV: 'test' };
        if (plan.full || (!tests.length && !sources.length))
            run(['bun', 'run', 'test'], cwd, testEnvironment);
        else {
            if (tests.length) run(['bunx', 'vitest', 'run', ...relative(tests)], cwd, testEnvironment);
            if (sources.length)
                run(
                    ['bunx', 'vitest', 'related', '--run', '--passWithNoTests', ...relative(sources)],
                    cwd,
                    testEnvironment,
                );
        }
        run(['bun', 'run', 'build'], cwd, { NODE_ENV: 'production' });
    } else {
        for (const command of packageCommands(plan, operation, packageInventory())) run(command);
    }
}
