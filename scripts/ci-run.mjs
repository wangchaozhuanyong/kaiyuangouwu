import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
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

export function frontendTestCommands(tests, sources, cwd) {
    const paths = files => files.map(file => resolve(file));
    const nodeTests = tests.filter(file => /\bfrom\s*['"]node:test['"]/u.test(readFileSync(file, 'utf8')));
    const vitestTests = tests.filter(file => !nodeTests.includes(file));
    const exclusions = nodeTests.flatMap(file => [
        '--exclude',
        relative(cwd, resolve(file)).replaceAll('\\', '/'),
    ]);
    return [
        ...(nodeTests.length ? [['node', '--test', ...paths(nodeTests)]] : []),
        ...(vitestTests.length ? [['bunx', 'vitest', 'run', ...paths(vitestTests)]] : []),
        ...(sources.length
            ? [['bunx', 'vitest', 'related', '--run', '--passWithNoTests', ...exclusions, ...paths(sources)]]
            : []),
    ];
}

function run(command, cwd = process.cwd(), environment = {}) {
    const result = spawnSync(command[0], command.slice(1), {
        cwd,
        stdio: 'inherit',
        // A nested Git worktree must build its own workspace, even when installed Nx resolves a parent root.
        env: { ...process.env, NX_WORKSPACE_ROOT_PATH: process.cwd(), ...environment },
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
        const testEnvironment = { NODE_ENV: 'test' };
        if (plan.full || (!tests.length && !sources.length))
            run(['bun', 'run', 'test'], cwd, testEnvironment);
        else
            for (const command of frontendTestCommands(tests, sources, cwd))
                run(command, cwd, testEnvironment);
        run(['bun', 'run', 'build'], cwd, { NODE_ENV: 'production' });
    } else {
        for (const command of packageCommands(plan, operation, packageInventory())) run(command);
    }
}
