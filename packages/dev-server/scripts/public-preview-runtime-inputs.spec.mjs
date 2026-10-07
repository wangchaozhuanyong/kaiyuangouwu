import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import {
    PUBLIC_PREVIEW_CLOSEOUT_RUNTIME_FILES,
    repositoryRoot,
    REQUIRED_RUNTIME_FILES,
    writePublicPreviewProtectionManifest,
} from './production-runtime-artifact.mjs';
import {
    PROTECTION_MANIFEST_FILE,
    REQUIRED_PROTECTION_PAIRS,
    validateProtectionManifest,
} from './public-preview-production-verification.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('immutable runtime requires every managed closeout module and guarded source', async () => {
    assert.equal(PUBLIC_PREVIEW_CLOSEOUT_RUNTIME_FILES.length, 6);
    for (const file of PUBLIC_PREVIEW_CLOSEOUT_RUNTIME_FILES) {
        assert.ok(REQUIRED_RUNTIME_FILES.includes(file), 'Operational module omitted from runtime integrity');
        await access(path.join(repositoryRoot, file));
    }
    for (const { source } of REQUIRED_PROTECTION_PAIRS)
        assert.ok(REQUIRED_RUNTIME_FILES.includes(source), 'Reviewed source omitted from integrity');
    assert.ok(REQUIRED_RUNTIME_FILES.includes(PROTECTION_MANIFEST_FILE));
});

test('artifact binds the actual reviewed source and current compiled production modules', async () => {
    const parent = path.join(repositoryRoot, 'docs/public-preview-standalone-20261007/verification-fixtures');
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'artifact-'));
    const sha = 'b'.repeat(40);
    try {
        for (const { compiled } of REQUIRED_PROTECTION_PAIRS) {
            const destination = path.join(root, compiled);
            await mkdir(path.dirname(destination), { recursive: true });
            await cp(path.join(repositoryRoot, compiled), destination);
        }
        await writePublicPreviewProtectionManifest(root, sha);
        const manifest = validateProtectionManifest(
            JSON.parse(await readFile(path.join(root, PROTECTION_MANIFEST_FILE), 'utf8')),
            sha,
        );
        for (const row of manifest.files) {
            assert.equal(row.sourceSha256, digest(await readFile(path.join(repositoryRoot, row.source))));
            assert.equal(row.sourceSha256, digest(await readFile(path.join(root, row.source))));
            assert.equal(row.compiledSha256, digest(await readFile(path.join(repositoryRoot, row.compiled))));
        }
    } finally {
        await rm(root, { recursive: true });
    }
});
