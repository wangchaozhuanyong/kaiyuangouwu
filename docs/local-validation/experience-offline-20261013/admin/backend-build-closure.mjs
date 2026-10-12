import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const output = join(root, 'docs/local-validation/experience-offline-20261013/admin/ci-closure');
const workflow = parse(readFileSync(join(root, '.github/workflows/build_and_test.yml'), 'utf8'));
const step = Object.values(workflow.jobs)
    .flatMap(job => job.steps ?? [])
    .find(item => item.name === 'Build affected packages and preserve compiled output');
if (!step?.env || !String(step.run).includes('ci-run.mjs build'))
    throw new Error('Missing canonical CI build environment');
mkdirSync(output, { recursive: true });
const emptyEnvironment = join(output, 'empty.env');
writeFileSync(emptyEnvironment, '# Isolated public build-check environment; no production values.\n');
const environment = Object.fromEntries(
    ['PATH', 'HOME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT']
        .filter(key => process.env[key] != null)
        .map(key => [key, process.env[key]]),
);
for (const [key, value] of Object.entries(step.env)) {
    environment[key] = String(value).startsWith('/tmp/vendure-build-')
        ? join(output, 'runtime-staging', String(value).slice('/tmp/vendure-build-'.length))
        : String(value);
}
environment.DOTENV_CONFIG_PATH = emptyEnvironment;
environment.NX_WORKSPACE_ROOT_PATH = root;
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const hashes = directory =>
    [
        ...new Set([
            ...execFileSync('git', ['ls-files', '-z', '--', 'packages/' + directory], {
                cwd: root,
                encoding: 'utf8',
            }).split('\0'),
            ...execFileSync(
                'git',
                ['ls-files', '--others', '--exclude-standard', '-z', '--', 'packages/' + directory],
                { cwd: root, encoding: 'utf8' },
            ).split('\0'),
            'tsconfig.json',
            'bun.lock',
            '.github/workflows/build_and_test.yml',
        ]),
    ]
        .filter(path => path && existsSync(join(root, path)))
        .map(path => ({ path: join(root, path), sha256: digest(join(root, path)) }));
const executions = [];
const packages = process.argv.slice(2);
if (!packages.length || packages.some(name => !/^[a-z][a-z0-9-]*$/u.test(name)))
    throw new Error('Pass explicit package directories');
const runtimeCommands = {
    'dev-server-server-types': ['bunx', 'tsc', '--project', 'tsconfig.server.json', '--noEmit'],
    'dev-server-worker-types': ['bunx', 'tsc', '--project', 'tsconfig.worker.json', '--noEmit'],
    'dev-server-server': ['node', '../cli/dist/cli.js', 'build', 'server', '--no-progress'],
    'dev-server-worker': ['node', '../cli/dist/cli.js', 'build', 'worker', '--no-progress'],
};
for (const target of packages) {
    const directory = target.startsWith('dev-server-') ? 'dev-server' : target;
    const cwd = join(root, 'packages', directory);
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    if (!manifest.scripts?.build) throw new Error('No package build: ' + directory);
    const inputs = hashes(directory);
    const log = join(output, target + '-build.log');
    const descriptor = openSync(log, 'w');
    const startedAt = new Date().toISOString();
    const command = runtimeCommands[target] ?? ['bun', 'run', 'build'];
    const result = spawnSync(command[0], command.slice(1), {
        cwd,
        env: environment,
        stdio: ['ignore', descriptor, descriptor],
    });
    closeSync(descriptor);
    const changedInputs = inputs
        .filter(input => digest(input.path) !== input.sha256)
        .map(input => input.path);
    const entry = {
        directory,
        target,
        command,
        script: runtimeCommands[target]
            ? target.endsWith('-types')
                ? manifest.scripts.typecheck
                : manifest.scripts['build:' + target.slice('dev-server-'.length)]
            : manifest.scripts.build,
        cwd,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: result.status,
        log,
        inputs,
        changedInputs,
        error: result.error?.message,
    };
    executions.push(entry);
    writeFileSync(join(output, target + '-build.json'), JSON.stringify(entry, null, 2));
    process.stdout.write(
        JSON.stringify({ directory, target, exitCode: result.status, changedInputs }) + '\n',
    );
    if (result.status !== 0 || changedInputs.length) {
        process.exitCode = 1;
        break;
    }
}
writeFileSync(
    join(output, 'backend-build-' + packages[0] + '-receipt.json'),
    JSON.stringify(
        {
            at: new Date().toISOString(),
            workflow: '.github/workflows/build_and_test.yml',
            scope: 'isolated canonical public CI build-check values; no server startup or external actions',
            executions,
        },
        null,
        2,
    ),
);
