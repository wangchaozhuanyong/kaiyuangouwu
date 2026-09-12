import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { packageInventory } from '../scripts/ci-impact.mjs';

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
const output = value => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `restored=${value}\n`);
    process.stdout.write(`restored=${value}\n`);
};
export function validateBuildArtifact(metadata, expected, archive, { tests = false } = {}) {
    assert.equal(metadata.version, 1);
    assert.equal(metadata.tree, expected.tree, 'Compiled source tree differs');
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
                version: 1,
                tree: tree(),
                profile: profile(),
                full: JSON.parse(process.env.CI_PLAN).full,
                archiveSha256: hash(readFileSync(archive)),
            }) + '\n',
        );
    } else if (command === 'restore' || command === 'restore-tests') {
        let restored = false;
        if (runId) {
            assert.match(runId, /^\d+$/u);
            const repository = process.env.GITHUB_REPOSITORY;
            assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/u);
            const name = `compiled-${tree()}`;
            const artifacts = JSON.parse(
                execFileSync(
                    'gh',
                    ['api', `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`],
                    { encoding: 'utf8' },
                ),
            ).artifacts;
            if (artifacts.some(artifact => artifact.name === name && !artifact.expired)) {
                execFileSync(
                    'gh',
                    ['run', 'download', runId, '--repo', repository, '--name', name, '--dir', directory],
                    { stdio: 'inherit' },
                );
                const metadata = JSON.parse(readFileSync(resolve(directory, 'metadata.json'), 'utf8'));
                // Changed build inputs require a fresh scoped build, never accepting a stale binary.
                if (command === 'restore-tests' || (metadata.full && metadata.profile === profile())) {
                    validateBuildArtifact(
                        metadata,
                        { tree: tree(), profile: profile() },
                        readFileSync(archive),
                        { tests: command === 'restore-tests' },
                    );
                    execFileSync('python3', ['-c', compiledExtractPython, archive, process.cwd()]);
                    restored = true;
                }
            }
        }
        output(restored);
    } else throw new Error('Expected pack, restore or restore-tests');
}
