import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isVerifiedFinding } from './production-runtime-audit.mjs';
import {
    assertZodSizeBounds,
    verifyZodCompatibilityPatch,
    ZOD_COMPATIBILITY_PATCH,
} from './zod-security-backport.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const legacy = path.dirname(
    createRequire(require.resolve('@tanstack/router-generator')).resolve('zod/package.json'),
);

async function fixture() {
    const temp = path.join(repository, '.audit-tmp');
    await mkdir(temp, { recursive: true });
    const root = await mkdtemp(path.join(temp, 'zod-bound-check-'));
    const copy = path.join(root, 'node_modules/legacy');
    await cp(legacy, copy, { recursive: true, dereference: true });
    await mkdir(path.join(root, 'patches'), { recursive: true });
    await cp(
        path.join(repository, ZOD_COMPATIBILITY_PATCH.path),
        path.join(root, ZOD_COMPATIBILITY_PATCH.path),
    );
    await cp(path.join(repository, 'bun.lock'), path.join(root, 'bun.lock'));
    const manifest = { patchedDependencies: { 'zod@3.25.76': ZOD_COMPATIBILITY_PATCH.path } };
    await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
    const run = (paths = [copy], options = {}) => verifyZodCompatibilityPatch(root, options, () => paths);
    return { root, copy, manifest, run, close: () => rm(root, { recursive: true, force: true }) };
}

for (const format of ['cjs', 'js']) {
    void test(`bundled mini entry rejects bounds before traversing elements: ${format}`, async () => {
        const target = path.join(legacy, 'v4/mini/index.' + format);
        const z = format === 'cjs' ? require(target) : await import(pathToFileURL(target).href);
        let visits = 0;
        const item = z.string().check(
            z.check(() => {
                visits++;
            }),
        );
        const schema = z.array(item).check(z.maxLength(2));
        const result = z.safeParse(schema, Array(1000).fill('x'));
        assert.equal(result.success, false);
        assert.equal(result.error.issues.length, 1);
        assert.equal(visits, 0);
        assert.deepEqual(z.parse(schema, ['a', 'b']), ['a', 'b']);
    });
    for (const api of ['v3', 'v4']) {
        void test(`Zod compatibility bounds and normal parsing: ${api} ${format}`, async () => {
            const target = path.join(legacy, api, 'index.' + format);
            const z = format === 'cjs' ? require(target).z : (await import(pathToFileURL(target).href)).z;
            assertZodSizeBounds(z, api === 'v4');
            let parsed = 0;
            const result = await z
                .array(
                    z.string().refine(async () => {
                        parsed++;
                        return true;
                    }),
                )
                .max(2)
                .safeParseAsync(Array(1000).fill('x'));
            assert.equal(result.success, false);
            assert.equal(result.error.issues.length, 1);
            assert.equal(parsed, 0, 'Async oversized validation walked elements');
            assert.deepEqual(
                await z
                    .array(z.string().refine(async () => true))
                    .max(2)
                    .parseAsync(['a', 'b']),
                ['a', 'b'],
            );
            assert.equal(
                z.array(z.string()).max(2, 'bounded-message').safeParse(['a', 'b', 'c']).error.issues[0]
                    .message,
                'bounded-message',
            );
        });
    }
}

void test('frozen registration, exact source and installed behavior produce a version-specific proof', async () => {
    const f = await fixture();
    try {
        const proof = f.run();
        assert.equal(proof.state, 'VERIFIED_PATCH');
        assert.equal(proof.version, '3.25.76');
        const advisory = { url: ZOD_COMPATIBILITY_PATCH.advisory, severity: 'high' };
        assert.equal(isVerifiedFinding('zod', advisory, [proof]), true);
        assert.equal(isVerifiedFinding('zod', { ...advisory, version: '4.4.3' }, [proof]), false);
        assert.equal(
            isVerifiedFinding(
                'zod',
                { ...advisory, url: 'https://github.com/advisories/GHSA-other-other-other' },
                [proof],
            ),
            false,
        );
    } finally {
        await f.close();
    }
});

void test('an unsafe modern copy cannot hide behind the legacy proof', async () => {
    const f = await fixture();
    try {
        const extra = path.join(f.root, 'node_modules/unsafe-modern');
        await mkdir(extra, { recursive: true });
        await writeFile(path.join(extra, 'package.json'), JSON.stringify({ name: 'zod', version: '4.4.3' }));
        assert.throws(() => f.run([f.copy, extra]), /Unfixed Zod copy remains/u);
    } finally {
        await f.close();
    }
});

for (const file of [
    'v3/types.cjs',
    'v3/types.js',
    'src/v3/types.ts',
    'v4/core/schemas.cjs',
    'v4/core/schemas.js',
    'src/v4/core/schemas.ts',
]) {
    void test(`tampered installed entry fails closed: ${file}`, async () => {
        const f = await fixture();
        try {
            const target = path.join(f.copy, file);
            await writeFile(target, (await readFile(target, 'utf8')) + '\n// changed\n');
            assert.throws(() => f.run(), /installed fingerprint differs/u);
        } finally {
            await f.close();
        }
    });
}
void test('missing registration, changed patch and missing frozen lock each fail closed', async () => {
    const f = await fixture();
    try {
        await writeFile(path.join(f.root, 'package.json'), '{}');
        assert.throws(() => f.run(), /registration differs/u);
        await writeFile(path.join(f.root, 'package.json'), JSON.stringify(f.manifest));
        const patch = path.join(f.root, ZOD_COMPATIBILITY_PATCH.path);
        const original = await readFile(patch);
        await writeFile(patch, 'invalid');
        assert.throws(() => f.run(), /source fingerprint differs/u);
        await writeFile(patch, original);
        await writeFile(path.join(f.root, 'bun.lock'), '{}');
        assert.throws(() => f.run(), /absent from frozen lock/u);
    } finally {
        await f.close();
    }
});
void test('a modern-only runtime needs no legacy exemption', async () => {
    const f = await fixture();
    try {
        const extra = path.join(f.root, 'node_modules/modern');
        await mkdir(extra, { recursive: true });
        await writeFile(path.join(extra, 'package.json'), JSON.stringify({ name: 'zod', version: '4.6.6' }));
        assert.equal(
            f.run([], { runtimePackages: [{ name: 'zod', version: '4.6.6', path: 'node_modules/modern' }] }),
            null,
        );
    } finally {
        await f.close();
    }
});
