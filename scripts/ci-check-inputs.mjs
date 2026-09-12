import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { DATABASES, isDocumentation } from './ci-impact.mjs';

const unique = values => [...new Set(values)].sort();
const digest = value => createHash('sha256').update(value).digest('hex');
const sharedInput = file =>
    /^(package\.json|bun\.(lock|lockb)|bunfig\.toml|lerna\.json|tsconfig[^/]*\.json|patches\/|\.github\/actions\/setup\/)/u.test(
        file,
    );
const controlInput = file => /^(deploy\/|scripts\/|\.github\/|packages\/dev-server\/scripts\/)/u.test(file);
const jobsForFlag = {
    dependencies: ['dependency-audit'],
    codegen: ['codegen'],
    dashboard: ['dashboard-i18n', 'dashboard-storybook', 'dashboard-e2e'],
    publishing: ['quality-gates'],
    controls: ['quality-gates'],
    migration: ['quality-gates'],
    architecture: ['quality-gates'],
};

export function checkRequirements(plan, inventory) {
    assert.ok(
        Array.isArray(plan.files) && Array.isArray(plan.packages) && Array.isArray(plan.frontends),
        'Invalid CI evidence plan',
    );
    for (const file of [...plan.files, ...(plan.lintFiles ?? [])])
        assert.ok(
            typeof file === 'string' && file && !file.startsWith('/') && !file.split('/').includes('..'),
            'Invalid evidence path',
        );
    const checks = [];
    for (const name of plan.packages ?? []) {
        const pkg = inventory.find(item => item.directory === name);
        assert.ok(pkg, `Unknown CI package ${name}`);
        const flags = [];
        if (name === 'icloud-relay-plugin' && plan.icloud) flags.push('icloud');
        if (name === 'content-translation-plugin' && plan.translation) flags.push('translation');
        if (name === 'dev-server' && plan.migration) flags.push('migration');
        if (name === 'storefront-content-plugin' && plan.storefrontIntegration)
            flags.push('storefrontIntegration');
        const databases = pkg.scripts?.e2e ? (plan.databases ?? (plan.e2e ? DATABASES : [])) : [];
        checks.push({ id: `backend:${name}`, kind: 'backend', packages: [name], databases, flags });
    }
    for (const name of plan.frontends ?? [])
        checks.push({
            id: `frontend:${name}`,
            kind: 'frontend',
            packages: [name],
            wholePackage:
                plan.full === true ||
                plan.frontendFull === true ||
                !plan.files.some(
                    file => file.startsWith(`packages/${name}/`) && /\.(css|[cm]?[jt]sx?)$/u.test(file),
                ),
            files: plan.files.filter(file => file.startsWith(`packages/${name}/`)),
        });
    for (const flag of Object.keys(jobsForFlag))
        if (
            plan[flag] ||
            (flag === 'architecture' &&
                plan.architecture === undefined &&
                plan.version === 1 &&
                plan.files.some(file => !isDocumentation(file)))
        )
            checks.push({ id: flag, kind: flag, packages: [] });
    for (const file of plan.lintFiles ?? plan.files.filter(changedFile => !isDocumentation(changedFile)))
        checks.push({
            id: `quality:${file}`,
            kind: 'quality',
            file,
            packages: /^packages\/([^/]+)\//u.exec(file)?.slice(1) ?? [],
        });
    return checks;
}

export function requiredJobs(check, full = false) {
    if (check.kind === 'backend') return ['build', 'unit-tests', ...check.databases.map(db => `e2e-${db}`)];
    if (check.kind === 'frontend') return full ? ['build', 'unit-tests'] : ['frontend'];
    if (check.kind === 'quality') return ['quality-gates'];
    if (check.kind === 'dashboard' && full) return [...jobsForFlag.dashboard, 'dashboard-storybook-windows'];
    return jobsForFlag[check.kind];
}

function dependencies(names, inventory) {
    const byName = new Map(inventory.map(pkg => [pkg.name, pkg]));
    const selected = new Set(names);
    for (const name of selected) {
        const pkg = inventory.find(item => item.directory === name);
        if (!pkg) continue;
        for (const dependency of Object.keys({
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.peerDependencies,
        }))
            if (byName.has(dependency)) selected.add(byName.get(dependency).directory);
    }
    return unique([...selected]);
}

// Conditions/needs select checks; execution steps, services, environments and toolchains define their inputs.
// Keeping these separate permits a routing fix without pretending changed test commands are equivalent.
export function jobRecipe(workflow, id) {
    const start = workflow.indexOf(`\n    ${id}:\n`);
    assert.ok(start >= 0, `Missing CI job recipe ${id}`);
    const body = workflow.slice(start + 1).split(/\n(?=    [\w-]+:\n)/u)[0];
    const lines = body.split('\n');
    let included = false;
    return lines
        .filter(line => {
            if (/^        \S/u.test(line))
                included =
                    /^        (env|services|strategy|steps|uses|with|runs-on|container|defaults):/u.test(
                        line,
                    );
            return included && !/^\s*#/u.test(line);
        })
        .join('\n')
        .trimEnd();
}

export function createInputReader(root = process.cwd()) {
    const trees = new Map();
    const texts = new Map();
    const treeIds = new Map();
    const git = args =>
        execFileSync('git', args, {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    return {
        tree(ref) {
            if (!treeIds.has(ref)) treeIds.set(ref, git(['rev-parse', `${ref}^{tree}`]).trim());
            return treeIds.get(ref);
        },
        entries(ref) {
            if (!trees.has(ref))
                trees.set(
                    ref,
                    git(['ls-tree', '-r', '-z', ref])
                        .split('\0')
                        .filter(Boolean)
                        .map(line => {
                            const [metadata, path] = line.split('\t');
                            return { path, metadata };
                        }),
                );
            return trees.get(ref);
        },
        text(ref, path) {
            const key = `${ref}:${path}`;
            if (!texts.has(key)) texts.set(key, git(['show', key]));
            return texts.get(key);
        },
    };
}

export function checkFingerprint(ref, check, inventory, reader) {
    let names = check.packages;
    if (check.kind === 'dashboard') names = ['dashboard', 'core'];
    if (check.flags?.includes('translation')) names = [...names, 'storefront-content-plugin', 'dev-server'];
    if (check.flags?.includes('storefrontIntegration'))
        names = [...names, 'storefront', 'store-management-plugin', 'dev-server'];
    const prefixes = dependencies(names, inventory).map(name => `packages/${name}/`);
    const entries = reader
        .entries(ref)
        .filter(({ path }) => {
            if (isDocumentation(path)) return false;
            if (
                ['backend', 'frontend'].includes(check.kind) &&
                /^packages\/dev-server\/scripts\/.*\.spec\.mjs$/u.test(path)
            )
                return false;
            if (sharedInput(path)) return true;
            if (check.kind === 'architecture')
                return path.startsWith('packages/') || path.startsWith('scripts/architecture-debt');
            if (check.kind === 'migration')
                return /migrations?\/|\.entity\.ts$|check-migration-registry/u.test(path);
            if (check.kind === 'controls') return controlInput(path);
            if (check.kind === 'dependencies')
                return /(^|\/)package\.json$|production-runtime-audit/u.test(path);
            if (check.kind === 'codegen')
                return /^(packages\/|scripts\/codegen\/|\.github\/workflows\/codegen\.yml)/u.test(path);
            if (check.kind === 'publishing')
                return /publishing|sync-|storefront-content-plugin\/|store-management-plugin\//u.test(path);
            if (prefixes.some(prefix => path.startsWith(prefix))) return true;
            if (check.kind === 'quality')
                return path === check.file || /eslint|prettier|^scripts\/lint-check\.mjs$/u.test(path);
            return (
                ['scripts/ci-run.mjs', 'deploy/build-artifact.mjs'].includes(path) ||
                path.startsWith('e2e-common/')
            );
        })
        .map(({ path, metadata }) => `${metadata}\t${path}`);
    const workflow = reader.text(ref, '.github/workflows/build_and_test.yml');
    const jobs = check.kind === 'frontend' ? ['frontend', 'build', 'unit-tests'] : requiredJobs(check, false);
    const recipes = jobs.map(id => jobRecipe(workflow, id));
    const globals = [...workflow.matchAll(/^(?:env|defaults):\n(?:[ \t].*\n|\n)*/gmu)].map(match =>
        match[0].trimEnd(),
    );
    // These runners import only packageInventory from the scope module. Routing policy is not a test input.
    const inventoryFunction = reader
        .text(ref, 'scripts/ci-impact.mjs')
        .match(/export function packageInventory\([\s\S]*?\n\}/u)?.[0];
    assert.ok(inventoryFunction, 'Missing package inventory implementation');
    return digest(JSON.stringify({ version: 1, id: check.id, entries, recipes, globals, inventoryFunction }));
}

export function checkCovered(proof, required, inventory) {
    if (![1, 2].includes(proof?.version)) return false;
    const source = checkRequirements(proof, inventory).find(check => check.id === required.id);
    if (!source) return false;
    if (required.kind === 'backend')
        return (
            required.databases.every(db => source.databases.includes(db)) &&
            required.flags.every(flag => source.flags.includes(flag))
        );
    if (required.kind === 'frontend')
        return (
            source.wholePackage ||
            (!required.wholePackage && required.files.every(file => source.files.includes(file)))
        );
    return true;
}

export function missingPlan(plan, missing) {
    const ids = new Set(missing.map(check => check.id));
    const packages = plan.packages.filter(name => ids.has(`backend:${name}`));
    const frontends = plan.frontends.filter(name => ids.has(`frontend:${name}`));
    const flag = name => ids.has(name);
    const lintFiles = missing.filter(check => check.kind === 'quality').map(check => check.file);
    return {
        ...plan,
        full: plan.full,
        packages,
        frontends,
        lintFiles,
        dependencies: flag('dependencies'),
        codegen: flag('codegen'),
        dashboard: flag('dashboard'),
        controls: flag('controls'),
        publishing: flag('publishing'),
        architecture: flag('architecture'),
        e2e: missing.some(check => check.kind === 'backend' && check.databases.length > 0),
        databases: unique(missing.flatMap(check => check.databases ?? [])),
        icloud: packages.includes('icloud-relay-plugin') && plan.icloud,
        translation: packages.includes('content-translation-plugin') && plan.translation,
        migration: flag('migration') || missing.some(check => check.flags?.includes('migration')),
        storefrontIntegration: packages.includes('storefront-content-plugin') && plan.storefrontIntegration,
        reasons: [
            ...plan.reasons,
            `${missing.length} missing check groups; validated input matches are reused.`,
        ],
    };
}
