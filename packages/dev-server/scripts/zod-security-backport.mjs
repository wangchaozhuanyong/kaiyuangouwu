import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import semver from 'semver';

// Backport the upstream size-before-elements repair while preserving the Zod3 API.
export const ZOD_COMPATIBILITY_PATCH = Object.freeze({
    advisory: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5',
    package: 'zod',
    version: '3.25.76',
    path: 'patches/zod@3.25.76.patch',
    sha256: '613cbb26c6b306e3e9e2dfe5268e9078957fb518b3189ff6880e6a3f9c277a53',
    files: {
        'v3/types.cjs': '258b6d818e30b794157fe3a4cd53064f2abf8a1e4e91faa699249df59fb5a58c',
        'v3/types.js': 'a01e9f0a07ddfd522312cf0d8ee10caf9b21ea677cbc8431f731b84c6d778ff3',
        'src/v3/types.ts': 'ad115a1c20a5e7592177e725dce996bbb3df2f6af2a5ec55d34339b30e11bc72',
        'v4/core/schemas.cjs': '3f16773f7c5d515e25963c98aa1cdd5d448e74018d6bef27408137600d29cf16',
        'v4/core/schemas.js': 'f767f3f255ac117e2e51774e88f80f1f1f9f3b4e5396db1b81bb90075ed52d43',
        'src/v4/core/schemas.ts': '851471a0c40d4399bd462927afe88882b4f2a2aa20bf1c4a254bb3e33f520f69',
        'package.json': '70eedbe34fd52385a4ae2f3e5759b19682189f0118ea73a6e7c32c677f61668e',
    },
});

const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export function assertZodSizeBounds(z, embeddedV4 = false) {
    let visits = 0;
    const item = z.string().refine(() => {
        visits++;
        return true;
    });
    const input = Array(1000).fill('fixture');
    for (const schema of [z.array(item).max(2), z.array(item).length(2)]) {
        const result = schema.safeParse(input);
        assert.equal(result.success, false, 'Oversized array was accepted');
        assert.equal(result.error.issues.length, 1, 'Oversized array allocated element issues');
        assert.equal(result.error.issues[0].code, 'too_big');
    }
    const set = z
        .set(item)
        .max(2)
        .safeParse(new Set(['a', 'b', 'c']));
    assert.equal(set.success, false);
    assert.equal(set.error.issues.length, 1);
    if (embeddedV4) {
        const map = z
            .map(item, item)
            .check(z.maxSize(2))
            .safeParse(
                new Map([
                    ['a', 'a'],
                    ['b', 'b'],
                    ['c', 'c'],
                ]),
            );
        assert.equal(map.success, false);
        assert.equal(map.error.issues.length, 1);
    }
    assert.equal(visits, 0, 'Size limit walked elements before rejecting the input');
    assert.deepEqual(
        z
            .object({ name: z.string(), values: z.array(z.number()).max(2) })
            .parse({ name: 'fixture', values: [1, 2] }),
        { name: 'fixture', values: [1, 2] },
    );
    assert.equal(z.array(z.string()).min(2).safeParse(['a']).success, false);
    assert.equal(z.array(z.string()).max(2).safeParse('wrong type').success, false);
}

export function verifyZodCompatibilityPatch(root, options, enumerate) {
    root = realpathSync(root);
    const patch = ZOD_COMPATIBILITY_PATCH;
    const candidates = options?.runtimePackages
        ? options.runtimePackages.filter(item => item.name === 'zod').map(item => path.join(root, item.path))
        : enumerate(root, 'zod');
    const legacy = [];
    // The name-level audit proof is only valid if EVERY installed Zod copy is safe.
    for (const candidate of new Set(candidates)) {
        const resolved = realpathSync(candidate);
        assert.ok(resolved.startsWith(root + path.sep), 'Zod resolves outside the audited tree');
        const manifest = JSON.parse(readFileSync(path.join(resolved, 'package.json'), 'utf8'));
        assert.equal(manifest.name, 'zod');
        if (manifest.version === patch.version) legacy.push({ candidate, resolved });
        else
            assert.ok(
                semver.valid(manifest.version) && semver.gte(manifest.version, '4.6.6'),
                'Unfixed Zod copy remains: ' + manifest.version,
            );
    }
    if (!legacy.length) return null;
    if (options?.requireRegistration !== false) {
        const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
        assert.equal(
            manifest.patchedDependencies?.['zod@3.25.76'],
            patch.path,
            'Zod patch registration differs',
        );
        assert.equal(hash(path.join(root, patch.path)), patch.sha256, 'Zod patch source fingerprint differs');
        const lock = readFileSync(path.join(root, 'bun.lock'), 'utf8');
        const registered = /"patchedDependencies":\s*\{([^}]+)\}/u.exec(lock)?.[1] ?? '';
        assert.match(
            registered,
            /"zod@3\.25\.76":\s*"patches\/zod@3\.25\.76\.patch"/u,
            'Zod patch absent from frozen lock',
        );
    }
    const copies = [];
    for (const { candidate, resolved } of legacy) {
        for (const [file, fingerprint] of Object.entries(patch.files))
            assert.equal(
                hash(path.join(resolved, file)),
                fingerprint,
                'Zod installed fingerprint differs: ' + file,
            );
        const require = createRequire(path.join(resolved, 'package.json'));
        assertZodSizeBounds(require(path.join(resolved, 'v3/index.cjs')).z);
        assertZodSizeBounds(require(path.join(resolved, 'v4/index.cjs')).z, true);
        copies.push({ path: path.relative(root, candidate), files: patch.files });
    }
    return {
        advisory: patch.advisory,
        name: patch.package,
        version: patch.version,
        state: 'VERIFIED_PATCH',
        patchSha256: patch.sha256,
        copies,
    };
}
