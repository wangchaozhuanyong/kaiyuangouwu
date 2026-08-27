#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { lstatSync, readFileSync, readdirSync, realpathSync, rmSync } = require('node:fs');
const path = require('node:path');

const DEFAULT_RELEASES_DIR = '/var/www/kaiyuangouwu-releases';
const DEFAULT_CURRENT_POINTER = '/var/www/kaiyuangouwu-current';
const DEFAULT_KEEP_COUNT = 3;
const EXPECTED_PM2_PROCESSES = ['vendure-api', 'vendure-worker'];
const RELEASE_NAME_PATTERN = /^(?<sha>[a-f0-9]{40})-(?<runId>[0-9]+)-(?<attempt>[0-9]+)-linux-x64$/u;

function parseReleaseName(name) {
    const match = RELEASE_NAME_PATTERN.exec(name);
    if (!match?.groups) return null;
    return {
        name,
        sha: match.groups.sha,
        runId: BigInt(match.groups.runId),
        attempt: BigInt(match.groups.attempt),
    };
}

function compareReleaseOrder(left, right) {
    if (left.runId !== right.runId) return left.runId < right.runId ? -1 : 1;
    if (left.attempt !== right.attempt) return left.attempt < right.attempt ? -1 : 1;
    return left.name.localeCompare(right.name);
}

function normalizeAbsolutePath(value, label) {
    assert.ok(value, `${label} is required`);
    assert.ok(path.isAbsolute(value), `${label} must be absolute`);
    const normalized = path.normalize(value);
    assert.notEqual(normalized, path.parse(normalized).root, `${label} cannot be a filesystem root`);
    return normalized;
}

function normalizeKeepCount(value) {
    const keepCount = Number(value ?? DEFAULT_KEEP_COUNT);
    assert.ok(Number.isSafeInteger(keepCount), 'Release retention count must be an integer');
    assert.ok(keepCount >= 3 && keepCount <= 10, 'Release retention count must be between 3 and 10');
    return keepCount;
}

function loadPm2Processes(pm2Binary = 'pm2') {
    return JSON.parse(
        execFileSync(pm2Binary, ['jlist'], {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
        }),
    );
}

function assertPm2UsesCurrentRelease(processes, currentRuntime) {
    for (const processName of EXPECTED_PM2_PROCESSES) {
        const managedProcess = processes.find(item => item.name === processName);
        assert.ok(managedProcess, `${processName} is missing from PM2`);
        assert.equal(managedProcess.pm2_env?.status, 'online', `${processName} is not online`);
        const managedWorkingDirectory = normalizeAbsolutePath(
            String(managedProcess.pm2_env?.pm_cwd ?? ''),
            `${processName} PM2 working directory`,
        );
        assert.equal(
            realpathSync(managedWorkingDirectory),
            currentRuntime,
            `${processName} is not running from the current release`,
        );
    }
}

function inspectReleaseState({
    releasesDir = DEFAULT_RELEASES_DIR,
    currentPointer = DEFAULT_CURRENT_POINTER,
    currentShaFile,
    keepCount = DEFAULT_KEEP_COUNT,
    pm2Processes,
}) {
    const configuredReleasesDir = normalizeAbsolutePath(releasesDir, 'VENDURE_RELEASES_DIR');
    const releasesRealPath = realpathSync(configuredReleasesDir);
    const pointerPath = normalizeAbsolutePath(currentPointer, 'VENDURE_CURRENT_RUNTIME_POINTER');
    assert.ok(lstatSync(pointerPath).isSymbolicLink(), 'Current runtime pointer must be a symbolic link');

    const currentRuntime = realpathSync(pointerPath);
    assert.equal(
        path.dirname(currentRuntime),
        releasesRealPath,
        'Current runtime must be a direct child of the releases directory',
    );
    const currentRelease = parseReleaseName(path.basename(currentRuntime));
    assert.ok(currentRelease, 'Current runtime directory name is not a recognized production release');

    const markerPath = normalizeAbsolutePath(
        currentShaFile ?? path.join(releasesRealPath, 'current-sha'),
        'VENDURE_CURRENT_SHA_FILE',
    );
    const markerSha = readFileSync(markerPath, 'utf8').trim();
    assert.match(markerSha, /^[a-f0-9]{40}$/u, 'Current SHA marker is invalid');
    assert.equal(markerSha, currentRelease.sha, 'Current SHA marker does not match the runtime pointer');

    assertPm2UsesCurrentRelease(pm2Processes ?? loadPm2Processes(), currentRuntime);

    const releases = readdirSync(releasesRealPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
            const parsed = parseReleaseName(entry.name);
            if (!parsed) return null;
            const releasePath = path.join(releasesRealPath, entry.name);
            const fileStat = lstatSync(releasePath);
            assert.ok(
                !fileStat.isSymbolicLink(),
                `Release directory cannot be a symbolic link: ${releasePath}`,
            );
            return { ...parsed, path: releasePath };
        })
        .filter(Boolean);

    assert.ok(
        releases.some(release => release.path === currentRuntime),
        'Current runtime is missing from releases',
    );
    const normalizedRetentionCount = normalizeKeepCount(keepCount);
    const rollbackReleases = releases
        .filter(release => compareReleaseOrder(release, currentRelease) < 0)
        .sort((left, right) => compareReleaseOrder(right, left))
        .slice(0, normalizedRetentionCount - 1);
    const keepNames = new Set([currentRelease.name, ...rollbackReleases.map(release => release.name)]);

    const deleteDirectories = releases
        .filter(release => !keepNames.has(release.name))
        .map(release => release.path)
        .sort();
    const deleteArchives = readdirSync(releasesRealPath, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.tar.gz'))
        .map(entry => ({ entry, release: parseReleaseName(entry.name.slice(0, -'.tar.gz'.length)) }))
        .filter(item => item.release && !keepNames.has(item.release.name))
        .map(item => path.join(releasesRealPath, item.entry.name))
        .sort();

    return {
        releasesDir: releasesRealPath,
        currentPointer: pointerPath,
        currentShaFile: markerPath,
        currentRuntime,
        markerSha,
        keepCount: normalizedRetentionCount,
        keepDirectories: [currentRuntime, ...rollbackReleases.map(release => release.path)],
        deleteDirectories,
        deleteArchives,
    };
}

function assertDeletionTarget(target, releasesDir, expectedType) {
    assert.equal(path.dirname(target), releasesDir, `Deletion target escaped releases directory: ${target}`);
    const basename = path.basename(target);
    const releaseName = expectedType === 'archive' ? basename.slice(0, -'.tar.gz'.length) : basename;
    assert.ok(parseReleaseName(releaseName), `Deletion target has an invalid release name: ${target}`);
    const fileStat = lstatSync(target);
    assert.ok(!fileStat.isSymbolicLink(), `Refusing to delete a symbolic link: ${target}`);
    assert.equal(
        expectedType === 'archive' ? fileStat.isFile() : fileStat.isDirectory(),
        true,
        `Deletion target has an unexpected type: ${target}`,
    );
}

function applyRetentionPlan(plan) {
    for (const target of plan.deleteDirectories) {
        assertDeletionTarget(target, plan.releasesDir, 'directory');
    }
    for (const target of plan.deleteArchives) {
        assertDeletionTarget(target, plan.releasesDir, 'archive');
    }
    for (const target of plan.deleteDirectories) rmSync(target, { recursive: true, force: false });
    for (const target of plan.deleteArchives) rmSync(target, { force: false });
}

function parseArguments(arguments_) {
    let apply = false;
    for (const argument of arguments_) {
        if (argument === '--apply') apply = true;
        else if (argument === '--dry-run') apply = false;
        else throw new Error(`Unknown argument: ${argument}`);
    }
    return { apply };
}

function run({ arguments_ = process.argv.slice(2), environment = process.env, pm2Processes } = {}) {
    const { apply } = parseArguments(arguments_);
    if (apply) {
        assert.equal(
            environment.VENDURE_ALLOW_PRODUCTION_RELEASE_PRUNE,
            '1',
            'Production release deletion requires VENDURE_ALLOW_PRODUCTION_RELEASE_PRUNE=1',
        );
    }
    const configuration = {
        releasesDir: environment.VENDURE_RELEASES_DIR ?? DEFAULT_RELEASES_DIR,
        currentPointer: environment.VENDURE_CURRENT_RUNTIME_POINTER ?? DEFAULT_CURRENT_POINTER,
        currentShaFile: environment.VENDURE_CURRENT_SHA_FILE,
        keepCount: environment.VENDURE_RELEASE_RETENTION_COUNT ?? DEFAULT_KEEP_COUNT,
        pm2Processes,
    };
    const plan = inspectReleaseState(configuration);
    if (apply) {
        const revalidatedPlan = inspectReleaseState(configuration);
        assert.deepEqual(revalidatedPlan, plan, 'Release state changed during retention planning');
        applyRetentionPlan(plan);
    }
    return { mode: apply ? 'apply' : 'dry-run', ...plan };
}

if (require.main === module) {
    try {
        process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    applyRetentionPlan,
    assertPm2UsesCurrentRelease,
    compareReleaseOrder,
    inspectReleaseState,
    normalizeKeepCount,
    parseArguments,
    parseReleaseName,
    run,
};
