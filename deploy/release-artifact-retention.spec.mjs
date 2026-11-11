import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewReleaseStorage } from './release-artifact-retention.mjs';

const sha = 'a'.repeat(40);
const protectedSha = 'b'.repeat(40);
const otherSha = 'c'.repeat(40);
const now = Date.parse('2026-11-12T10:00:00Z');
const closed = '2026-11-01T00:00:00Z';
const makeKey = (revision, runId) =>
    'deployments/' + revision + '/frontends-' + revision + '-' + runId + '-1.tar.gz';
const makeVersion = (key, overrides = {}) => ({
    Key: key,
    VersionId: 'exact-version',
    StorageClass: 'STANDARD',
    Size: 10,
    LastModified: closed,
    IsLatest: false,
    ...overrides,
});

test('counts versions hidden by delete markers as stored bytes without proposing a delete', () => {
    const key = makeKey(sha, '42');
    const report = reviewReleaseStorage(
        {
            Versions: [makeVersion(key), makeVersion('files/backup.tar.gz', { Size: 9999 })],
            DeleteMarkers: [{ Key: key, VersionId: 'marker', IsLatest: true }],
        },
        undefined,
        now,
    );
    assert.deepEqual(report.storage, { 'deleted-key/STANDARD': { versions: 1, bytes: 10 } });
    assert.equal(report.currentDeleteMarkers, 1);
    assert.deepEqual(report.candidates, []);
});

test('proposes only exact old versions from reviewed terminal runs outside the protected revisions', () => {
    const versions = [
        makeVersion(makeKey(sha, '42')),
        makeVersion(makeKey(protectedSha, '43')),
        makeVersion(makeKey(otherSha, '44')),
        makeVersion(makeKey(sha, '42'), { VersionId: 'recent', LastModified: '2026-11-11T00:00:00Z' }),
        makeVersion(makeKey(sha, '42'), { VersionId: 'null' }),
    ];
    const report = reviewReleaseStorage(
        { Versions: versions },
        {
            protectedShas: [protectedSha],
            closedRuns: [
                { sha, runId: '42', closedAt: closed, status: 'failure' },
                { sha: protectedSha, runId: '43', closedAt: closed, status: 'temporary' },
            ],
        },
        now,
    );
    assert.deepEqual(report.candidates, [
        { key: makeKey(sha, '42'), versionId: 'exact-version', storageClass: 'STANDARD', bytes: 10 },
    ]);
    assert.match(report.candidateSha256, /^[a-f0-9]{64}$/u);
});

test('rejects partial inventories and plans with no protected release evidence', () => {
    assert.throws(() => reviewReleaseStorage({ IsTruncated: true }), /Complete version/u);
    assert.throws(
        () => reviewReleaseStorage({ Versions: [] }, { protectedShas: [], closedRuns: [] }),
        /running, rollback and in-flight/u,
    );
});
