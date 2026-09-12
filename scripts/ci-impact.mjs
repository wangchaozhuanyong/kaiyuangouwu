import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const STATIC_APPS = ['storefront', 'next-admin'];
const SHARED = new Set(['core', 'common', 'testing', 'dev-server']);
const sorted = values => [...new Set(values)].sort();
export const isDocumentation = file =>
    /^(docs\/|\.github\/ISSUE_TEMPLATE\/)/u.test(file) ||
    /(^|\/)(README[^/]*|CHANGELOG[^/]*|AGENTS)\.md$/u.test(file);

export function packageInventory(root = process.cwd()) {
    return readdirSync(resolve(root, 'packages'), { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .flatMap(entry => {
            try {
                const manifest = JSON.parse(
                    readFileSync(resolve(root, 'packages', entry.name, 'package.json')),
                );
                return [{ directory: entry.name, ...manifest }];
            } catch (error) {
                if (error.code === 'ENOENT') return [];
                throw error;
            }
        });
}

// Used by PR checks and the deployment diff. Unknown executable inputs never become static releases.
export function classifyChanges(changedFiles, inventory = [], { full = false } = {}) {
    const files = sorted(changedFiles);
    for (const file of files) {
        assert.ok(file && !file.startsWith('/') && !file.split('/').includes('..'), 'Invalid changed path');
    }
    const executable = files.filter(file => !isDocumentation(file));
    const changedPackages = sorted(executable.flatMap(file => /^packages\/([^/]+)\//u.exec(file)?.[1] ?? []));
    const dependencies =
        full ||
        executable.some(file =>
            /(^|\/)package\.json$|^bun\.(lock|lockb)$|^bunfig\.toml$|^patches\//u.test(file),
        );
    const workflow = executable.some(file =>
        /^(\.github\/(workflows|actions)\/|scripts\/(ci-|release-))/u.test(file),
    );
    const shared =
        full ||
        dependencies ||
        workflow ||
        changedPackages.some(name => SHARED.has(name)) ||
        executable.some(file => /^(tsconfig[^/]*\.json|e2e-common\/|lerna\.json)/u.test(file));
    const byName = new Map(inventory.map(pkg => [pkg.name, pkg.directory]));
    const selected = new Set(shared ? inventory.map(pkg => pkg.directory) : changedPackages);
    // Include downstream packages, while the runner builds only their necessary prerequisites.
    let added;
    do {
        added = false;
        for (const pkg of inventory) {
            const names = Object.keys({
                ...pkg.dependencies,
                ...pkg.devDependencies,
                ...pkg.peerDependencies,
            });
            if (!selected.has(pkg.directory) && names.some(name => selected.has(byName.get(name)))) {
                selected.add(pkg.directory);
                added = true;
            }
        }
    } while (added);
    const frontendOnly =
        executable.length > 0 &&
        executable.every(
            file =>
                STATIC_APPS.some(app => file.startsWith(`packages/${app}/`)) &&
                !/(^|\/)(package\.json|[^/]*config\.[^/]+|\.env[^/]*)$/u.test(file) &&
                !/packages\/storefront\/(two-factor-tool\/|src\/client-plugins\/two-factor\/|src\/assets\/(storefront|brand)\/)/u.test(
                    file,
                ),
        );
    const frontends = sorted([...selected].filter(name => STATIC_APPS.includes(name)));
    const packages = sorted([...selected].filter(name => !STATIC_APPS.includes(name)));
    const known = new Set(inventory.map(pkg => pkg.directory));
    const unknownPackage = inventory.length > 0 && changedPackages.some(name => !known.has(name));
    const unknown =
        executable.some(file => !/^(packages\/|scripts\/|deploy\/|\.github\/|patches\/)/u.test(file)) ||
        unknownPackage;
    const broad = shared || unknown;
    const controls =
        full ||
        workflow ||
        executable.some(file => /^(deploy\/|scripts\/|packages\/dev-server\/scripts\/)/u.test(file));
    const migration =
        full || executable.some(file => /migrations?\/|\.entity\.ts$|check-migration-registry/u.test(file));
    const publishing =
        full ||
        executable.some(file =>
            /storefront-publishing|sync-.*\.(mjs|ts)$|storefront-content-plugin\/|store-management-plugin\//u.test(
                file,
            ),
        );
    const codegen =
        broad ||
        executable.some(
            file =>
                !STATIC_APPS.some(app => file.startsWith(`packages/${app}/`)) &&
                /graphql|api-extensions|schema/u.test(file),
        );
    const e2e = broad || inventory.some(pkg => selected.has(pkg.directory) && pkg.scripts?.e2e);
    const lane = !executable.length ? 'none' : frontendOnly && !full ? 'frontend' : 'runtime';
    return {
        version: 1,
        files,
        changedPackages,
        frontends,
        packages,
        lane,
        full: broad,
        dependencies,
        controls,
        migration,
        publishing,
        codegen,
        e2e,
        dashboard: broad || selected.has('dashboard'),
        icloud: broad || selected.has('icloud-relay-plugin'),
        translation: broad || selected.has('content-translation-plugin'),
        storefrontIntegration:
            broad ||
            changedPackages.some(name =>
                ['store-management-plugin', 'storefront-content-plugin'].includes(name),
            ),
        reasons: [
            !executable.length
                ? 'Only documentation changed; no website deployment.'
                : `Changed packages: ${changedPackages.join(', ') || 'repository/deployment controls'}.`,
            broad
                ? 'Shared inputs or unknown executable paths require broader checks.'
                : 'Checks are limited to affected packages and dependencies.',
            `Deployment route: ${lane}.`,
        ],
    };
}

export function changedPaths(base, target = 'HEAD', root = process.cwd()) {
    for (const revision of [base, target]) assert.match(revision, /^[a-zA-Z0-9_./^~:-]+$/u);
    return execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, target, '--'], {
        cwd: root,
        encoding: 'utf8',
    })
        .split('\0')
        .filter(Boolean);
}

export function inspection(base, target, full = false, root = process.cwd()) {
    return classifyChanges(changedPaths(base, target, root), packageInventory(root), { full });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { values } = parseArgs({
        options: {
            base: { type: 'string' },
            target: { type: 'string', default: 'HEAD' },
            full: { type: 'boolean', default: false },
            output: { type: 'string' },
        },
    });
    assert.ok(values.base, '--base is required; manual runs do not implicitly enable all checks');
    const plan = inspection(values.base, values.target, values.full);
    if (values.output) writeFileSync(values.output, JSON.stringify(plan, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) {
        const outputs = {
            ...plan,
            plan,
            has_packages: plan.full || plan.packages.length > 0,
            has_frontends: plan.frontends.length > 0,
        };
        for (const [key, value] of Object.entries(outputs))
            appendFileSync(
                process.env.GITHUB_OUTPUT,
                `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`,
            );
    }
    if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `## Change scope\n\n${plan.reasons.join('\n\n')}\n\nFrontend: ${plan.frontends.join(', ') || 'skipped'}\n\n` +
                `Backend/library: ${plan.full ? 'shared scope' : plan.packages.join(', ') || 'skipped'}\n\n` +
                `Database matrix: ${plan.e2e ? 'required' : 'skipped'}; codegen: ${plan.codegen ? 'required' : 'skipped'}.\n`,
        );
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
}
