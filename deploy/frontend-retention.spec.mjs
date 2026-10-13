import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    renameSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { apply, inspect, parseReleaseName, run } = require('./systemd/vendure-frontend-release-retention.cjs');
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = join(project, '.local-validation/frontend-retention');
mkdirSync(temporaryRoot, { recursive: true });
const sha = runId => Number(runId).toString(16).padStart(40, '0');

function fixture(t) {
    const root = mkdtempSync(join(temporaryRoot, 'case-'));
    const options = {
        frontendReleasesDir: join(root, 'frontends'),
        storefrontReleasesDir: join(root, 'legacy-storefronts'),
        runtimeReleasesDir: join(root, 'runtimes'),
        pointers: Object.fromEntries(
            ['storefront', 'next-admin', 'two-factor'].map(name => [name, join(root, `${name}-current`)]),
        ),
        assertLockHeld() {
            return true;
        },
    };
    for (const directory of [
        options.frontendReleasesDir,
        options.storefrontReleasesDir,
        options.runtimeReleasesDir,
    ])
        mkdirSync(directory);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return { root, options };
}

function output(directory, component, manifest) {
    mkdirSync(join(directory, 'assets'), { recursive: true });
    const prefix = component === 'next-admin' ? '/dashboard' : '';
    writeFileSync(join(directory, 'index.html'), `<script src="${prefix}/assets/app.js"></script>`);
    writeFileSync(join(directory, 'assets/app.js'), 'window.verified=true;');
    writeFileSync(
        join(directory, manifest.component ? 'frontend-release.json' : 'storefront-release.json'),
        JSON.stringify(manifest),
    );
}

function staticRelease(
    options,
    runId,
    components = ['storefront', 'next-admin', 'two-factor'],
    legacy = false,
) {
    const sourceSha = sha(runId);
    const name = `${legacy ? 'storefront-fast' : 'frontends'}-${sourceSha}-${runId}-1`;
    const directory = join(legacy ? options.storefrontReleasesDir : options.frontendReleasesDir, name);
    const archiveBytes = Buffer.from(`verified archive ${name}`);
    const manifest = {
        sourceSha,
        backendSha: sha(1),
        artifactSha256: createHash('sha256').update(archiveBytes).digest('hex'),
    };
    const outputs = {};
    for (const component of components) {
        const target = legacy
            ? directory
            : join(directory, component === 'two-factor' ? 'storefront/.two-factor' : component);
        output(
            target,
            component,
            legacy ? { ...manifest, artifact: `${name}.tar.gz` } : { ...manifest, component },
        );
        outputs[component] = target;
    }
    return { directory, outputs, archiveBytes, manifest, name };
}

function runtime(options, runId) {
    const sourceSha = sha(runId);
    const directory = join(options.runtimeReleasesDir, `${sourceSha}-${runId}-1-linux-x64`);
    const outputs = {};
    for (const component of ['storefront', 'next-admin', 'two-factor']) {
        const target = join(
            directory,
            'packages',
            component === 'two-factor' ? 'storefront/dist-two-factor' : `${component}/dist`,
        );
        output(target, component, { sourceSha, backendSha: sourceSha, component, releaseLane: 'runtime' });
        outputs[component] = target;
    }
    writeFileSync(join(directory, 'RUNTIME-METADATA.json'), JSON.stringify({ gitSha: sourceSha }));
    return { directory, outputs };
}

function activate(options, releases) {
    for (const [component, directory] of Object.entries(releases)) {
        if (existsSync(options.pointers[component])) unlinkSync(options.pointers[component]);
        symlinkSync(directory, options.pointers[component]);
    }
}

test('strict frontend naming accepts both existing lanes and rejects unrelated or traversal names', () => {
    assert.equal(parseReleaseName(`frontends-${sha(1)}-120-2`).kind, 'frontends');
    assert.equal(parseReleaseName(`storefront-fast-${sha(1)}-120-2`).kind, 'storefront-fast');
    for (const name of [
        'unknown',
        `frontends-${sha(1)}-120-2.tar.gz`,
        `../frontends-${sha(1)}-120-2`,
        `frontends-${'A'.repeat(40)}-120-2`,
    ])
        assert.equal(parseReleaseName(name), null);
});

test('retention keeps each active pointer and two independent histories instead of assuming all components travel together', t => {
    const { options } = fixture(t);
    const releases = [1, 2, 3, 4].map(id => staticRelease(options, id));
    const admin = staticRelease(options, 5, ['next-admin']);
    const storefront = staticRelease(options, 6, ['storefront', 'two-factor']);
    activate(options, { ...storefront.outputs, ...admin.outputs });
    const plan = inspect(options);
    assert.deepEqual(plan.rollbackDirectories['next-admin'], [releases[3].directory, releases[2].directory]);
    assert.deepEqual(plan.rollbackDirectories.storefront, [releases[3].directory, releases[2].directory]);
    assert.deepEqual(
        plan.deleteDirectories,
        releases
            .slice(0, 2)
            .map(item => item.directory)
            .sort(),
    );
    assert.ok(plan.keepDirectories.includes(admin.directory));
    assert.ok(plan.keepDirectories.includes(storefront.directory));
});

test('runtime pointers are protected read-only while histories merge across both static roots', t => {
    const { options } = fixture(t);
    const full = runtime(options, 10);
    activate(options, full.outputs);
    const mixed = staticRelease(options, 5);
    const admin = staticRelease(options, 6, ['next-admin']);
    const sf = staticRelease(options, 7, ['storefront', 'two-factor']);
    const legacy = staticRelease(options, 8, ['storefront'], true);
    const plan = inspect(options);
    assert.deepEqual(plan.rollbackDirectories.storefront, [legacy.directory, sf.directory]);
    assert.deepEqual(plan.rollbackDirectories['next-admin'], [admin.directory, mixed.directory]);
    assert.deepEqual(plan.rollbackDirectories['two-factor'], [sf.directory, mixed.directory]);
    assert.deepEqual(plan.deleteDirectories, []);
    assert.ok(plan.keepDirectories.includes(full.directory));
});

test('current storefront-fast release and separately current vault/admin each retain their own histories', t => {
    const { options } = fixture(t);
    const full = runtime(options, 10);
    const legacy = staticRelease(options, 11, ['storefront'], true);
    const older = staticRelease(options, 1, ['storefront'], true);
    const middle = staticRelease(options, 2, ['storefront'], true);
    const latest = staticRelease(options, 3, ['storefront'], true);
    activate(options, { ...full.outputs, storefront: legacy.directory });
    const plan = inspect(options);
    assert.deepEqual(plan.rollbackDirectories.storefront, [latest.directory, middle.directory]);
    assert.deepEqual(plan.deleteDirectories, [older.directory]);
    apply(plan, options);
    assert.ok(existsSync(legacy.directory));
    assert.ok(existsSync(full.directory));
    assert.ok(!existsSync(older.directory));
});

test('explicit in-flight candidate and source protection survive normal retention', t => {
    const { options } = fixture(t);
    activate(options, runtime(options, 10).outputs);
    for (const id of [1, 2, 3, 4]) staticRelease(options, id);
    const inFlight = staticRelease(options, 11, ['next-admin']);
    const bySource = staticRelease(options, 12, ['storefront', 'two-factor']);
    options.protectedDirectories = [inFlight.directory];
    options.protectedSourceShas = [bySource.manifest.sourceSha];
    const plan = inspect(options);
    assert.ok(plan.keepDirectories.includes(inFlight.directory));
    assert.ok(plan.keepDirectories.includes(bySource.directory));
    assert.throws(
        () => inspect({ ...options, protectedDirectories: ['/unrelated/candidate'] }),
        /recognized direct child/u,
    );
});

test('unknown content, missing or mismatched manifests, symlink directories and external business data are preserved', t => {
    const { root, options } = fixture(t);
    activate(options, runtime(options, 10).outputs);
    for (const id of [4, 5]) staticRelease(options, id);
    const bad = staticRelease(options, 1);
    writeFileSync(
        join(bad.outputs.storefront, 'frontend-release.json'),
        JSON.stringify({ ...bad.manifest, sourceSha: sha(99), component: 'storefront' }),
    );
    const missing = staticRelease(options, 2);
    unlinkSync(join(missing.outputs['next-admin'], 'frontend-release.json'));
    const extra = staticRelease(options, 3);
    mkdirSync(join(extra.directory, 'merchant-data'));
    const outside = join(root, 'user-data');
    mkdirSync(outside);
    writeFileSync(join(outside, 'customer.json'), 'preserve');
    const link = join(options.frontendReleasesDir, `frontends-${sha(0)}-0-1`);
    symlinkSync(outside, link);
    mkdirSync(join(options.frontendReleasesDir, '.incoming-active'));
    const plan = inspect(options);
    assert.deepEqual(plan.deleteDirectories, []);
    assert.equal(plan.preservedEntries.length, 5);
    apply(plan, options);
    assert.equal(readFileSync(join(outside, 'customer.json'), 'utf8'), 'preserve');
    assert.ok(existsSync(link));
});

test('nested symlinks and missing entry assets make a release ineligible for rollback or deletion', t => {
    const { root, options } = fixture(t);
    activate(options, runtime(options, 10).outputs);
    for (const id of [4, 5]) staticRelease(options, id);
    const linked = staticRelease(options, 1);
    symlinkSync(root, join(linked.outputs.storefront, 'assets/foreign'));
    const incomplete = staticRelease(options, 2);
    unlinkSync(join(incomplete.outputs['next-admin'], 'assets/app.js'));
    const plan = inspect(options);
    assert.deepEqual(plan.deleteDirectories, []);
    assert.deepEqual(
        plan.preservedEntries.map(entry => entry.reason),
        ['unverified-release-output', 'unverified-release-output'],
    );
});

test('archives and checksum sidecars are removed only when matching a proven unprotected release', t => {
    const { options } = fixture(t);
    activate(options, runtime(options, 10).outputs);
    for (const id of [4, 5]) staticRelease(options, id);
    const old = staticRelease(options, 1);
    const archive = `${old.directory}.tar.gz`;
    writeFileSync(archive, old.archiveBytes);
    writeFileSync(`${archive}.sha256`, `${old.manifest.artifactSha256}  ${old.name}.tar.gz\n`);
    writeFileSync(`${old.directory}.sha256`, `${old.manifest.artifactSha256}  different-file.tar.gz\n`);
    const orphan = join(options.frontendReleasesDir, `frontends-${sha(0)}-0-1.tar.gz`);
    writeFileSync(orphan, 'no verified directory');
    const plan = inspect(options);
    assert.deepEqual(
        plan.deleteFiles.map(file => file.path),
        [archive, `${archive}.sha256`],
    );
    const result = apply(plan, options);
    assert.deepEqual(result.removedDirectories, [old.directory]);
    assert.ok(!existsSync(archive));
    assert.ok(!existsSync(`${archive}.sha256`));
    assert.ok(existsSync(`${old.directory}.sha256`));
    assert.ok(existsSync(orphan));
});

test('any missing, broken, unmanaged or invalid current pointer fails the entire plan closed', t => {
    for (const mutate of [
        options => unlinkSync(options.pointers.storefront),
        options => {
            unlinkSync(options.pointers['next-admin']);
            symlinkSync('/missing-output', options.pointers['next-admin']);
        },
        (options, current) =>
            writeFileSync(join(current.outputs['two-factor'], 'frontend-release.json'), '{}'),
        (options, current) => {
            unlinkSync(options.pointers.storefront);
            symlinkSync(dirname(current.directory), options.pointers.storefront);
        },
    ]) {
        const { options } = fixture(t);
        const current = runtime(options, 10);
        activate(options, current.outputs);
        mutate(options, current);
        assert.throws(() => inspect(options));
    }
});

test('an uninitialized isolated vault is allowed, but its available static histories remain retained', t => {
    const { options } = fixture(t);
    const current = runtime(options, 10);
    activate(options, {
        storefront: current.outputs.storefront,
        'next-admin': current.outputs['next-admin'],
    });
    const first = staticRelease(options, 1);
    const second = staticRelease(options, 2);
    const third = staticRelease(options, 3);
    const plan = inspect(options);
    assert.deepEqual(plan.rollbackDirectories['two-factor'], [third.directory, second.directory]);
    assert.deepEqual(plan.deleteDirectories, [first.directory]);
});

test('apply requires the production lock and rejects pointer, output or inventory changes before deleting', t => {
    for (const mutate of [
        options => mkdirSync(join(options.frontendReleasesDir, 'unknown-arrived')),
        (options, old) => writeFileSync(join(old.outputs.storefront, 'assets/app.js'), 'updated output'),
        options => activate(options, staticRelease(options, 11).outputs),
    ]) {
        const { options } = fixture(t);
        activate(options, runtime(options, 10).outputs);
        const old = staticRelease(options, 1);
        for (const id of [4, 5]) staticRelease(options, id);
        const plan = inspect(options);
        assert.throws(
            () => apply(plan, { ...options, assertLockHeld: undefined }),
            /production deployment lock/u,
        );
        mutate(options, old);
        assert.throws(() => apply(plan, options), /changed before retention/u);
        assert.ok(existsSync(old.directory));
    }
});

test('an exclusive lock lost after planning prevents deletion', t => {
    const { options } = fixture(t);
    activate(options, runtime(options, 10).outputs);
    const old = staticRelease(options, 1);
    for (const id of [4, 5]) staticRelease(options, id);
    const plan = inspect(options);
    let calls = 0;
    options.assertLockHeld = () => {
        if (++calls > 1) throw new Error('production lock lost');
    };
    assert.throws(() => apply(plan, options), /production lock lost/u);
    assert.ok(existsSync(old.directory));
});

test('a candidate replaced with an external symlink after inspection cannot delete the external tree', t => {
    const { root, options } = fixture(t);
    activate(options, runtime(options, 10).outputs);
    const old = staticRelease(options, 1);
    for (const id of [4, 5]) staticRelease(options, id);
    const plan = inspect(options);
    const external = join(root, 'business-data');
    mkdirSync(external);
    writeFileSync(join(external, 'merchant.json'), 'keep');
    renameSync(old.directory, `${old.directory}.preserved`);
    symlinkSync(external, old.directory);
    assert.throws(() => apply(plan, options), /changed before retention/u);
    assert.equal(readFileSync(join(external, 'merchant.json'), 'utf8'), 'keep');
});

test('a pointer switched between deletions stops retention before deleting its newly active output', t => {
    const { options } = fixture(t);
    activate(options, runtime(options, 10).outputs);
    const first = staticRelease(options, 1);
    const newlyActive = staticRelease(options, 2);
    for (const id of [4, 5]) staticRelease(options, id);
    const plan = inspect(options);
    let calls = 0;
    options.assertLockHeld = () => {
        if (++calls === 3) activate(options, newlyActive.outputs);
    };
    assert.throws(() => apply(plan, options), /pointers changed during retention/u);
    assert.ok(!existsSync(first.directory));
    assert.ok(existsSync(newlyActive.directory));
});

test('CLI model uses existing prune authorization and passes explicit candidate/source protection', t => {
    const { options } = fixture(t);
    activate(options, runtime(options, 10).outputs);
    const protectedRelease = staticRelease(options, 11);
    assert.throws(
        () => run({ arguments_: ['--apply'], environment: {}, options }),
        /existing production release prune authorization/u,
    );
    const plan = run({
        arguments_: [
            '--dry-run',
            '--protect-directory',
            protectedRelease.directory,
            '--protect-source',
            sha(11),
        ],
        options,
    });
    assert.equal(plan.mode, 'dry-run');
    assert.deepEqual(plan.protectedSourceShas, [sha(11)]);
    assert.deepEqual(plan.deleteDirectories, []);
});

test('repeated mixed frontend releases remain bounded while preserving each current output and two usable rollbacks', t => {
    const { options } = fixture(t);
    const components = ['storefront', 'next-admin', 'two-factor'];
    const history = Object.fromEntries(components.map(component => [component, []]));
    const sequence = [['storefront', 'two-factor'], ['next-admin'], components];
    const retainedCounts = [];
    let peakStagedDirectories = 0;
    let lockOwner;
    let lockCheckCalls = 0;
    let expectedLockCheckCalls = 0;
    const caller = Symbol('fixture production deployment owner');
    const withProductionLock = action => {
        assert.equal(lockOwner, undefined, 'Another release holds the caller lock');
        lockOwner = caller;
        try {
            return action();
        } finally {
            lockOwner = undefined;
        }
    };
    options.assertLockHeld = () => {
        assert.equal(lockOwner, caller, 'Retention escaped the caller production lock');
        lockCheckCalls++;
    };
    const publish = (runId, selected) => {
        const release = staticRelease(options, runId, selected);
        activate(options, release.outputs);
        for (const component of selected) history[component].push(release.directory);
        return release;
    };
    withProductionLock(() => {
        // Start with a current output and two complete historical outputs so
        // every later alternating release must preserve two real rollbacks.
        for (const runId of [1, 2, 3]) publish(runId, components);
    });
    for (let index = 0; index < 24; index++) {
        withProductionLock(() => {
            publish(index + 4, sequence[index % sequence.length]);
            const plan = inspect(options);
            peakStagedDirectories = Math.max(peakStagedDirectories, plan.candidates.length);
            expectedLockCheckCalls += 1 + plan.deleteDirectories.length + plan.deleteFiles.length;
            apply(plan, options);
            const retained = inspect(options);
            assert.deepEqual(retained.deleteDirectories, [], 'Retention failed to converge');
            retainedCounts.push(retained.candidates.length);
            // Storefront and its vault travel together; Admin may advance
            // independently. The union of three versions for each lane is at
            // most six directories, regardless of the number of releases.
            assert.ok(
                retained.candidates.length <= 6,
                'Published directories grew beyond the rollback bound',
            );
            for (const component of components) {
                const expectedCurrent = history[component].at(-1);
                const expectedRollbacks = history[component].slice(-3, -1).reverse();
                const pointer = retained.pointers.find(item => item.component === component);
                assert.equal(pointer.releaseDirectory, expectedCurrent);
                assert.deepEqual(retained.rollbackDirectories[component], expectedRollbacks);
                for (const directory of [expectedCurrent, ...expectedRollbacks]) {
                    const candidate = retained.candidates.find(item => item.directory === directory);
                    const outputEvidence = candidate?.components.find(item => item.component === component);
                    assert.ok(outputEvidence, `${component} current or rollback output was deleted`);
                    assert.match(
                        readFileSync(join(outputEvidence.directory, 'index.html'), 'utf8'),
                        /assets\/app\.js/u,
                    );
                    assert.equal(
                        readFileSync(join(outputEvidence.directory, 'assets/app.js'), 'utf8'),
                        'window.verified=true;',
                    );
                    assert.equal(outputEvidence.marker.value.sourceSha, candidate.sha);
                }
            }
        });
        assert.equal(lockOwner, undefined, 'Caller failed to release its lock');
    }
    const summary = {
        simulatedReleases: 24,
        initialVersions: 3,
        totalVersionsCreated: 27,
        peakStagedDirectories,
        maximumRetainedDirectories: Math.max(...retainedCounts),
        finalRetainedDirectories: retainedCounts.at(-1),
        retainedDirectoryCounts: retainedCounts,
        rollbackCountPerComponent: 2,
        lockCheckCalls,
    };
    assert.equal(summary.maximumRetainedDirectories, 5);
    assert.equal(summary.finalRetainedDirectories, 4);
    assert.equal(lockCheckCalls, expectedLockCheckCalls);
    const evidenceFile = join(temporaryRoot, `repeated-release-evidence-${Date.now()}-${process.pid}.json`);
    writeFileSync(evidenceFile, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
    t.diagnostic(`Repeated-release evidence: ${evidenceFile}`);
    t.diagnostic(
        `27 total versions: peak staged ${peakStagedDirectories}, ` +
            `maximum retained ${summary.maximumRetainedDirectories}, final retained ${summary.finalRetainedDirectories}`,
    );
});
