import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const releasePrefix = 'deployments/';
const sevenDays = 7 * 86400000;
const shaPattern = /^[a-f0-9]{40}$/u;
const archivePattern =
    /^deployments\/([a-f0-9]{40})\/(?:frontends-|nginx-)?([a-f0-9]{40})-([0-9]+)-[0-9]+(?:-linux-x64)?\.tar\.gz(?:\.sha256)?$/u;

export function reviewReleaseStorage(inventory, releaseRecords, now = Date.now()) {
    assert.ok(
        inventory &&
            !inventory.IsTruncated &&
            !inventory.NextToken &&
            !inventory.NextKeyMarker &&
            !inventory.NextVersionIdMarker,
        'Complete version and delete-marker inventory is required',
    );
    const versions = inventory.Versions ?? [];
    const markers = inventory.DeleteMarkers ?? [];
    assert.ok(Array.isArray(versions) && Array.isArray(markers), 'Invalid version inventory');
    assert.ok(Number.isFinite(now), 'Invalid review time');

    const protectedShas = new Set(releaseRecords?.protectedShas ?? []);
    const closedRuns = new Map();
    if (releaseRecords) {
        assert.ok(
            Array.isArray(releaseRecords.protectedShas) && protectedShas.size > 0,
            'Supply the running, rollback and in-flight revisions from the release ledger',
        );
        assert.ok(
            [...protectedShas].every(sha => shaPattern.test(sha)),
            'Invalid protected revision',
        );
        assert.ok(Array.isArray(releaseRecords.closedRuns), 'Supply the reviewed failed or temporary runs');
        for (const run of releaseRecords.closedRuns) {
            assert.match(run.sha, shaPattern);
            assert.match(run.runId, /^[0-9]+$/u);
            assert.ok(['failure', 'temporary'].includes(run.status), 'Run has no eligible terminal state');
            const closed = Date.parse(run.closedAt);
            assert.ok(Number.isFinite(closed) && closed <= now, 'Invalid run close time');
            const identity = run.sha + '/' + run.runId;
            assert.ok(!closedRuns.has(identity), 'Duplicate release ledger entry');
            closedRuns.set(identity, closed);
        }
    }

    const deletedKeys = new Set(
        markers
            .filter(marker => marker.IsLatest && marker.Key.startsWith(releasePrefix))
            .map(marker => marker.Key),
    );
    const storage = {};
    const candidates = [];
    for (const version of versions) {
        if (!version.Key.startsWith(releasePrefix)) continue;
        const { Key: key, VersionId: versionId, Size: bytes, StorageClass: storageClass } = version;
        assert.ok(Number.isSafeInteger(bytes) && bytes >= 0, 'Invalid object size');
        assert.match(storageClass, /^[A-Z0-9_]+$/u);
        const state = version.IsLatest ? 'current' : deletedKeys.has(key) ? 'deleted-key' : 'superseded';
        const group = (storage[state + '/' + storageClass] ??= { versions: 0, bytes: 0 });
        group.versions++;
        group.bytes += bytes;

        const match = archivePattern.exec(key);
        if (!match || match[1] !== match[2] || protectedShas.has(match[1])) continue;
        const closedAt = closedRuns.get(match[1] + '/' + match[3]);
        const uploadedAt = Date.parse(version.LastModified);
        if (
            closedAt === undefined ||
            !Number.isFinite(uploadedAt) ||
            now - Math.max(uploadedAt, closedAt) < sevenDays ||
            typeof versionId !== 'string' ||
            !versionId ||
            versionId === 'null'
        )
            continue;
        // A current delete marker is never a substitute for identifying the exact billable version.
        candidates.push({ key, versionId, storageClass, bytes });
    }
    candidates.sort((a, b) => a.key.localeCompare(b.key) || a.versionId.localeCompare(b.versionId));
    const candidateSha256 = createHash('sha256').update(JSON.stringify(candidates)).digest('hex');
    return {
        mode: releaseRecords ? 'read-only-retention-plan' : 'read-only-inventory',
        storage,
        currentDeleteMarkers: deletedKeys.size,
        protectedRevisionCount: protectedShas.size,
        candidates,
        candidateSha256,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [, , inventoryFile, releaseRecordsFile] = process.argv;
    assert.ok(
        inventoryFile,
        'Usage: release-artifact-retention.mjs <inventory.json|-> [release-records.json]',
    );
    const inventory = JSON.parse(readFileSync(inventoryFile === '-' ? 0 : inventoryFile, 'utf8'));
    const records = releaseRecordsFile ? JSON.parse(readFileSync(releaseRecordsFile, 'utf8')) : undefined;
    process.stdout.write(JSON.stringify(reviewReleaseStorage(inventory, records), null, 2) + '\n');
}
