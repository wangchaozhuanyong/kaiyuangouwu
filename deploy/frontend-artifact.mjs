import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { STATIC_APPS } from '../scripts/ci-impact.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const output = (key, value) => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    process.stdout.write(`${key}=${value}\n`);
};
export function frontendFingerprint({ component, tree, node, bun, platform, environment = {} }) {
    assert.ok(STATIC_APPS.includes(component));
    assert.match(tree, /^[a-f0-9]{40}$/u);
    return hash(
        JSON.stringify({
            component,
            tree,
            node,
            bun,
            platform,
            environment: Object.fromEntries(
                Object.entries(environment).sort(([a], [b]) => a.localeCompare(b)),
            ),
        }),
    );
}
export function validateFrontendArtifact(metadata, expected, archive) {
    assert.equal(metadata.version, 1);
    assert.equal(metadata.fingerprint, expected.fingerprint, 'Frontend build inputs differ');
    assert.equal(metadata.component, expected.component);
    assert.equal(metadata.tree, expected.tree);
    assert.equal(metadata.archiveSha256, hash(archive), 'Frontend archive checksum differs');
    assert.match(metadata.sourceSha, /^[a-f0-9]{40}$/u);
}
function inputs(component) {
    assert.ok(STATIC_APPS.includes(component));
    const tree = git('rev-parse', 'HEAD^{tree}');
    const node = process.version;
    const bun = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim();
    assert.equal(node, 'v24.19.0');
    assert.equal(bun, '1.3.14');
    const platform = `${process.platform}/${process.arch}`;
    assert.equal(platform, 'linux/x64', 'Deployable frontend artifacts must be built on Linux x64');
    const environment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.startsWith('VITE_') || key === 'NODE_ENV'),
    );
    const fingerprint = frontendFingerprint({ component, tree, node, bun, platform, environment });
    return { component, tree, fingerprint };
}

export const safeExtractPython = `import pathlib,sys,tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members=archive.getmembers()
    if sum(m.size for m in members) > 512*1024*1024:
        raise SystemExit('Frontend archive exceeds size budget')
    for member in members:
        p=pathlib.PurePosixPath(member.name)
        if p.is_absolute() or '..' in p.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe frontend archive member')
    archive.extractall(sys.argv[2], members=members)
`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, component, directory, runId] = process.argv.slice(2);
    const expected = inputs(component);
    const name = `frontend-${component}-${expected.fingerprint}`;
    mkdirSync(directory, { recursive: true });
    if (command === 'pack') {
        const archive = resolve(directory, 'frontend.tar.gz');
        const dist = resolve('packages', component, 'dist');
        assert.ok(existsSync(resolve(dist, 'index.html')));
        execFileSync('tar', ['-czf', archive, '-C', dist, '.']);
        writeFileSync(
            resolve(directory, 'metadata.json'),
            JSON.stringify({
                version: 1,
                ...expected,
                sourceSha: git('rev-parse', 'HEAD'),
                archiveSha256: hash(readFileSync(archive)),
            }) + '\n',
        );
        output('name', name);
    } else if (command === 'restore') {
        let restored = false;
        if (runId) {
            assert.match(runId, /^\d+$/u);
            const repository = process.env.GITHUB_REPOSITORY;
            assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/u);
            const data = JSON.parse(
                execFileSync(
                    'gh',
                    ['api', `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`],
                    { encoding: 'utf8' },
                ),
            );
            if (data.artifacts.some(artifact => !artifact.expired && artifact.name === name)) {
                execFileSync(
                    'gh',
                    ['run', 'download', runId, '--repo', repository, '--name', name, '--dir', directory],
                    { stdio: 'inherit' },
                );
                const metadata = JSON.parse(readFileSync(resolve(directory, 'metadata.json'), 'utf8'));
                const archive = resolve(directory, 'frontend.tar.gz');
                validateFrontendArtifact(metadata, expected, readFileSync(archive));
                execFileSync('python3', [
                    '-c',
                    safeExtractPython,
                    archive,
                    resolve('packages', component, 'dist'),
                ]);
                restored = true;
            }
        }
        output('restored', restored);
    } else throw new Error('Expected pack or restore');
}
