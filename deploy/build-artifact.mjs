import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { packageInventory } from '../scripts/ci-impact.mjs';

import { artifactSourceHash, runtimeArtifactRunTrusted } from './artifact-inputs.mjs';

// Include the actual Lerna outputs, including the legacy Angular and job-queue packages.
export const COMPILED_DIRECTORIES = [
    'dist',
    'lib',
    'dist-two-factor',
    'package',
    'client',
    'compiler',
    'cli',
];
const hash = value => createHash('sha256').update(value).digest('hex');
const tree = () => execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
const buildEnvironment = new RegExp(
    '^(NODE_ENV$|VITE_|VENDURE_|DB|SMTP_|DIGITAL_|IMAGE_|CUSTOMER_|TWO_FACTOR_|USDT_|' +
        'STORE_DOMAIN_|STOREFRONT_|SUPERADMIN_|COOKIE_|ORDER_CONFIRMATION_|TZ$)',
    'u',
);
const profile = () =>
    hash(
        JSON.stringify({
            node: process.version,
            platform: `${process.platform}/${process.arch}`,
            bun: execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim(),
            env: Object.fromEntries(
                Object.entries(process.env)
                    .filter(([key]) => buildEnvironment.test(key))
                    .sort(([a], [b]) => a.localeCompare(b)),
            ),
        }),
    );
const outputName = name => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `name=${name}\n`);
    process.stdout.write(`name=${name}\n`);
};
const output = value => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `restored=${value}\n`);
    process.stdout.write(`restored=${value}\n`);
};
export function validateBuildArtifact(metadata, expected, archive, { tests = false } = {}) {
    assert.ok([1, 2].includes(metadata.version));
    if (tests || metadata.version === 1)
        assert.equal(metadata.tree, expected.tree, 'Compiled source tree differs');
    else {
        assert.match(expected.sourceHash, /^[a-f0-9]{64}$/u);
        assert.equal(metadata.sourceHash, expected.sourceHash, 'Compiled build inputs differ');
    }
    assert.equal(metadata.archiveSha256, hash(archive), 'Compiled archive checksum differs');
    if (!tests) {
        assert.equal(metadata.full, true, 'A partial build cannot supply a full runtime');
        assert.equal(metadata.profile, expected.profile, 'Production build environment differs');
    }
}
export const compiledExtractPython = `import pathlib,sys,tarfile
allowed=${JSON.stringify(COMPILED_DIRECTORIES)}
with tarfile.open(sys.argv[1],'r:gz') as archive:
    members=archive.getmembers()
    if sum(m.size for m in members)>2*1024*1024*1024: raise SystemExit('Oversized compiled artifact')
    for m in members:
        p=pathlib.PurePosixPath(m.name)
        if p.is_absolute() or '..' in p.parts or not (m.isfile() or m.isdir()): raise SystemExit('Unsafe compiled archive member')
        if len(p.parts)<3 or p.parts[0]!='packages' or p.parts[2] not in allowed:
            raise SystemExit('Compiled artifact contains source files')
    archive.extractall(sys.argv[2],members=members)
`;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, directory, runId] = process.argv.slice(2);
    mkdirSync(directory, { recursive: true });
    const archive = resolve(directory, 'compiled.tar.gz');
    if (command === 'pack') {
        const paths = packageInventory()
            .flatMap(pkg =>
                COMPILED_DIRECTORIES.map(directoryName => `packages/${pkg.directory}/${directoryName}`),
            )
            .filter(path => existsSync(path));
        assert.ok(paths.length > 0, 'No compiled output');
        assert.equal(
            execFileSync('git', ['ls-files', '-z', '--', ...paths], { encoding: 'utf8' }),
            '',
            'Compiled output must not include tracked source files',
        );
        execFileSync('tar', ['-czf', archive, ...paths]);
        writeFileSync(
            resolve(directory, 'metadata.json'),
            JSON.stringify({
                version: 2,
                tree: tree(),
                sourceHash: artifactSourceHash(),
                profile: profile(),
                full: JSON.parse(process.env.CI_PLAN).full,
                archiveSha256: hash(readFileSync(archive)),
            }) + '\n',
        );
        outputName(`compiled-inputs-${artifactSourceHash()}-${profile()}`);
    } else if (command === 'restore' || command === 'restore-tests') {
        let restored = false;
        if (runId) {
            assert.match(runId, /^\d+$/u);
            const repository = process.env.GITHUB_REPOSITORY;
            assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/u);
            const expected = { tree: tree(), profile: profile(), sourceHash: artifactSourceHash() };
            const api = endpoint => JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8' }));
            const names = [
                `compiled-inputs-${expected.sourceHash}-${expected.profile}`,
                `compiled-${expected.tree}`,
            ];
            function* candidates() {
                yield runId;
                if (command === 'restore-tests') return;
                const runs = api(
                    `repos/${repository}/actions/workflows/production_release.yml/runs?status=completed&per_page=20`,
                ).workflow_runs;
                for (const run of runs) {
                    if (String(run.id) === runId || run.path !== '.github/workflows/production_release.yml')
                        continue;
                    try {
                        if (artifactSourceHash({ ref: run.head_sha }) !== expected.sourceHash) continue;
                    } catch {
                        continue;
                    }
                    const jobs = api(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`).jobs;
                    if (runtimeArtifactRunTrusted(run, repository, jobs)) yield String(run.id);
                }
            }
            for (const candidate of candidates()) {
                const artifacts = api(
                    `repos/${repository}/actions/runs/${candidate}/artifacts?per_page=100`,
                ).artifacts;
                const artifact = artifacts.find(item => !item.expired && names.includes(item.name));
                if (!artifact) continue;
                const download = resolve(directory, candidate);
                mkdirSync(download, { recursive: true });
                execFileSync(
                    'gh',
                    [
                        'run',
                        'download',
                        candidate,
                        '--repo',
                        repository,
                        '--name',
                        artifact.name,
                        '--dir',
                        download,
                    ],
                    { stdio: 'inherit' },
                );
                const metadata = JSON.parse(readFileSync(resolve(download, 'metadata.json'), 'utf8'));
                const archivePath = resolve(download, 'compiled.tar.gz');
                if (command !== 'restore-tests' && (!metadata.full || metadata.profile !== expected.profile))
                    continue;
                validateBuildArtifact(metadata, expected, readFileSync(archivePath), {
                    tests: command === 'restore-tests',
                });
                execFileSync('python3', ['-c', compiledExtractPython, archivePath, process.cwd()]);
                process.stdout.write(`compiled_source_run=${candidate}\n`);
                restored = true;
                break;
            }
        }
        output(restored);
    } else throw new Error('Expected pack, restore or restore-tests');
}
