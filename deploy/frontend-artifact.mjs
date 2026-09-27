import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    appendFileSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { STATIC_APPS } from '../scripts/ci-impact.mjs';
import { hasTrustedPullRequest, isTrustedRun } from '../scripts/release-evidence.mjs';

import { artifactSourceHash } from './artifact-inputs.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export const TWO_FACTOR_DIRECTORY = '.two-factor';
const storefrontOutputs = ['dist', 'dist-two-factor'];

// Keep the isolated document outside the public storefront routes. Its own
// origin serves this directory through an independent pointer.
export function stageFrontend(component, directory, root = process.cwd()) {
    assert.ok(STATIC_APPS.includes(component));
    const dist = resolve(root, 'packages', component, 'dist');
    assert.ok(existsSync(resolve(dist, 'index.html')), 'Missing frontend index');
    if (component === 'storefront') {
        const tool = resolve(root, 'packages/storefront/dist-two-factor');
        assert.ok(existsSync(resolve(tool, 'index.html')), 'Missing isolated 2FA index');
        assert.ok(existsSync(resolve(tool, 'build-config.json')), 'Missing isolated 2FA build config');
    }
    cpSync(dist, directory, { recursive: true });
    if (component === 'storefront')
        cpSync(
            resolve(root, 'packages/storefront/dist-two-factor'),
            resolve(directory, TWO_FACTOR_DIRECTORY),
            {
                recursive: true,
            },
        );
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const output = (key, value) => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    process.stdout.write(`${key}=${value}\n`);
};
export function frontendFingerprint({ component, tree, sourceHash, node, bun, platform, environment = {} }) {
    assert.ok(STATIC_APPS.includes(component));
    if (sourceHash) assert.match(sourceHash, /^[a-f0-9]{64}$/u);
    else assert.match(tree, /^[a-f0-9]{40}$/u);
    return hash(
        JSON.stringify({
            component,
            ...(component === 'storefront' ? { outputs: storefrontOutputs } : {}),
            source: sourceHash || tree,
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
    assert.ok([1, 2, 3].includes(metadata.version));
    assert.equal(metadata.fingerprint, expected.fingerprint, 'Frontend build inputs differ');
    assert.equal(metadata.component, expected.component);
    if (expected.outputs) {
        assert.equal(metadata.version, 3, 'Frontend artifact omits isolated 2FA output');
        assert.deepEqual(metadata.outputs, expected.outputs);
    }
    if (metadata.version === 1) assert.equal(metadata.tree, expected.tree);
    else {
        assert.match(expected.sourceHash, /^[a-f0-9]{64}$/u);
        assert.equal(metadata.sourceHash, expected.sourceHash);
    }
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
    const sourceHash = artifactSourceHash({ component });
    const fingerprint = frontendFingerprint({ component, sourceHash, node, bun, platform, environment });
    return {
        component,
        tree,
        sourceHash,
        fingerprint,
        ...(component === 'storefront' ? { outputs: storefrontOutputs } : {}),
    };
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
        const payload = mkdtempSync(resolve(directory, '.payload-'));
        try {
            stageFrontend(component, payload);
            execFileSync('tar', ['-czf', archive, '-C', payload, '.']);
        } finally {
            rmSync(payload, { recursive: true, force: true });
        }
        writeFileSync(
            resolve(directory, 'metadata.json'),
            JSON.stringify({
                version: component === 'storefront' ? 3 : 2,
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
            const api = endpoint => JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8' }));
            function* candidates() {
                yield runId;
                // The exact-tree proof may be a control-only PR with no frontend
                // artifact. Search matching successful frontend inputs, not SHA equality.
                const runs = api(
                    `repos/${repository}/actions/workflows/build_and_test.yml/runs?status=success&per_page=30`,
                ).workflow_runs;
                for (const run of runs) {
                    if (String(run.id) === runId || !isTrustedRun(run, repository)) continue;
                    try {
                        if (artifactSourceHash({ component, ref: run.head_sha }) !== expected.sourceHash)
                            continue;
                    } catch {
                        continue;
                    }
                    if (!hasTrustedPullRequest(run, repository, api)) continue;
                    yield String(run.id);
                }
            }
            for (const candidate of candidates()) {
                const data = api(`repos/${repository}/actions/runs/${candidate}/artifacts?per_page=100`);
                if (!data.artifacts.some(artifact => !artifact.expired && artifact.name === name)) continue;
                const download = resolve(directory, candidate);
                mkdirSync(download, { recursive: true });
                execFileSync(
                    'gh',
                    ['run', 'download', candidate, '--repo', repository, '--name', name, '--dir', download],
                    { stdio: 'inherit' },
                );
                const metadata = JSON.parse(readFileSync(resolve(download, 'metadata.json'), 'utf8'));
                const archive = resolve(download, 'frontend.tar.gz');
                validateFrontendArtifact(metadata, expected, readFileSync(archive));
                rmSync(resolve('packages', component, 'dist'), { recursive: true, force: true });
                execFileSync('python3', [
                    '-c',
                    safeExtractPython,
                    archive,
                    resolve('packages', component, 'dist'),
                ]);
                if (component === 'storefront') {
                    const tool = resolve('packages', component, 'dist', TWO_FACTOR_DIRECTORY);
                    assert.ok(existsSync(resolve(tool, 'index.html')), 'Artifact is missing isolated 2FA');
                    assert.ok(
                        existsSync(resolve(tool, 'build-config.json')),
                        'Artifact is missing 2FA config',
                    );
                    const toolOutput = resolve('packages', component, 'dist-two-factor');
                    rmSync(toolOutput, { recursive: true, force: true });
                    cpSync(tool, toolOutput, { recursive: true });
                }
                output('frontend_source_run', candidate);
                restored = true;
                break;
            }
        }
        output('restored', restored);
    } else if (command === 'stage') stageFrontend(component, directory);
    else throw new Error('Expected pack, restore or stage');
}
