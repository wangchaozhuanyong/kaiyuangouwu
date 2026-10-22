import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createRuntimeAuditReport, runBunAudit, verifyReportPatches } from './production-runtime-audit.mjs';
import { SECURITY_VENDORS, addSecurityOriginFindings } from './security-vendors.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const origins = Object.fromEntries(
    SECURITY_VENDORS.map((vendor, index) => [
        vendor.original,
        [
            {
                id: index + 1,
                title: 'Known original dependency advisory',
                severity: vendor.severity,
                url: vendor.advisory,
                vulnerable_versions: '<=' + vendor.originalVersion,
            },
        ],
    ]),
);

async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'vendure-security-replacements-'));
    const manifest = {
        overrides: Object.fromEntries(
            SECURITY_VENDORS.map(vendor => [vendor.original, 'file:' + vendor.path]),
        ),
    };
    await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
    await cp(path.join(repository, 'bun.lock'), path.join(root, 'bun.lock'));
    for (const vendor of SECURITY_VENDORS) {
        await cp(path.join(repository, vendor.path), path.join(root, vendor.path), { recursive: true });
        await cp(path.join(repository, vendor.path), path.join(root, 'node_modules', vendor.original), {
            recursive: true,
        });
    }
    const run = (report = {}, originReport = origins) =>
        runBunAudit(root, {
            auditLevel: 'moderate',
            runCommand: () => ({
                status: Object.keys(report).length ? 1 : 0,
                stdout: JSON.stringify(report),
                stderr: '',
            }),
            originAudit: async versions => {
                assert.deepEqual(
                    versions,
                    Object.fromEntries(
                        SECURITY_VENDORS.map(vendor => [vendor.original, [vendor.originalVersion]]),
                    ),
                );
                return originReport;
            },
        });
    return { root, run, manifest, close: () => rm(root, { recursive: true, force: true }) };
}

void test('maintained replacements preserve original advisories and actual runtime identity', async () => {
    const f = await fixture();
    try {
        const assessed = await f.run();
        assert.deepEqual(assessed, origins);
        const proof = verifyReportPatches(assessed, f.root);
        assert.equal(proof.length, 2);
        assert.ok(proof.every(item => item.state === 'VERIFIED_SECURITY_REPLACEMENT'));
        const inventory = SECURITY_VENDORS.map(vendor => ({
            name: vendor.package,
            version: vendor.version,
            path: 'node_modules/' + vendor.original,
        }));
        const result = createRuntimeAuditReport(inventory, origins, {
            failOn: 'moderate',
            verifiedPatches: proof,
        });
        assert.equal(result.report.summary.high, 2);
        assert.equal(result.blockedFindings.length, 0);
        assert.ok(
            result.report.findings.every(item => item.source === 'UPSTREAM_PROVENANCE' && item.replacement),
        );
        const stale = inventory.map(item => ({ ...item, version: '0.0.1' }));
        assert.equal(
            createRuntimeAuditReport(stale, origins, { failOn: 'moderate', verifiedPatches: proof })
                .blockedFindings.length,
            2,
        );
        const originals = SECURITY_VENDORS.map(vendor => ({
            name: vendor.original,
            version: vendor.originalVersion,
            path: 'node_modules/' + vendor.original,
        }));
        assert.equal(
            createRuntimeAuditReport(originals, origins, { failOn: 'moderate', verifiedPatches: proof })
                .blockedFindings.length,
            2,
        );
    } finally {
        await f.close();
    }
});

void test('replacement checks reject changed source, installed bytes, origins, registration and old aliases', async () => {
    const f = await fixture();
    try {
        const vendor = SECURITY_VENDORS[0];
        for (const relative of [vendor.path + '/index.js', 'node_modules/' + vendor.original + '/index.js']) {
            const target = path.join(f.root, relative);
            const original = await readFile(target);
            await writeFile(target, '// corrupted implementation');
            await assert.rejects(f.run(), /fingerprint mismatch/u);
            await writeFile(target, original);
        }
        const origin = path.join(f.root, 'node_modules/' + vendor.original + '/UPSTREAM.json');
        const originBytes = await readFile(origin);
        await writeFile(origin, '{}');
        await assert.rejects(f.run(), /fingerprint mismatch/u);
        await writeFile(origin, originBytes);
        await writeFile(path.join(f.root, 'package.json'), '{}');
        await assert.rejects(f.run(), /registration is missing/u);
        await writeFile(path.join(f.root, 'package.json'), JSON.stringify(f.manifest));
        await writeFile(path.join(f.root, 'bun.lock'), '{}');
        await assert.rejects(f.run(), /lock registration missing/u);
        await cp(path.join(repository, 'bun.lock'), path.join(f.root, 'bun.lock'));
        const old = path.join(f.root, 'node_modules/hidden/node_modules/braces');
        await mkdir(old, { recursive: true });
        await cp(path.join(repository, vendor.path, 'UPSTREAM-PACKAGE.json'), path.join(old, 'package.json'));
        await assert.rejects(f.run(), /Retired original dependency remains/u);
    } finally {
        await f.close();
    }
});

void test('private replacements cannot conceal future, escalated or missing upstream advisories', async () => {
    const f = await fixture();
    try {
        for (const changed of [{ severity: 'critical' }, { url: 'https://example.invalid/new-advisory' }]) {
            const other = structuredClone(origins);
            other.braces.push({ ...other.braces[0], id: 100, ...changed });
            await assert.rejects(f.run({}, other), /policy failed/u);
        }
        for (const invalid of [{}, [], { braces: 'invalid' }]) {
            await assert.rejects(f.run({}, invalid), /advisory|identity/u);
        }
        const proof = verifyReportPatches({}, f.root);
        await assert.rejects(
            addSecurityOriginFindings({}, proof, {
                requestAudit: async () => {
                    throw new Error('Registry unavailable');
                },
            }),
            /Registry unavailable/u,
        );
        const changedProof = proof.map(item => ({ ...item, sourceSha256: '0'.repeat(64) }));
        const inventory = SECURITY_VENDORS.map(vendor => ({
            name: vendor.package,
            version: vendor.version,
            path: 'node_modules/' + vendor.original,
        }));
        assert.equal(
            createRuntimeAuditReport(inventory, origins, { failOn: 'high', verifiedPatches: changedProof })
                .blockedFindings.length,
            2,
        );
    } finally {
        await f.close();
    }
});

void test('argparse replacement runs the actual Rush command provider without sprintf-js', () => {
    const source = `
        const { createRequire } = require('node:module');
        const req = createRequire(require.resolve('@rushstack/ts-command-line/package.json'));
        if (req('argparse/package.json').version !== '2.0.1') throw new Error('Old parser still resolves');
        const { CommandLineParser } = req('@rushstack/ts-command-line');
        class Parser extends CommandLineParser {
            constructor() {
                super({ toolFilename: 'security-fixture', toolDescription: 'Synthetic parser compatibility check' });
                this.value = this.defineStringParameter({ parameterLongName: '--fixture', argumentName: 'VALUE', description: 'Synthetic fixture' });
            }
            async onExecuteAsync() { if (this.value.value !== 'passed') throw new Error('Parsed value mismatch'); }
        }
        const parser = new Parser();
        parser.executeAsync(['--fixture', 'passed']).then(() => {
            if (parser.value.value !== 'passed') throw new Error('Parsed value mismatch');
            process.stdout.write('PARSER_COMPATIBILITY_PASS');
        })
            .catch(() => { process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['-e', source], {
        cwd: repository,
        encoding: 'utf8',
        timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PARSER_COMPATIBILITY_PASS/u);
});

void test('actual API Extractor help survives the parser upgrade and compatibility patch', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const manifestPath = req.resolve('@microsoft/api-extractor/package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bin = path.resolve(path.dirname(manifestPath), manifest.bin['api-extractor']);
    const result = spawnSync(process.execPath, [bin, '--help'], {
        cwd: repository,
        encoding: 'utf8',
        timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /api-extractor/u);
    assert.match(result.stdout, /run/u);
    assert.doesNotMatch(result.stderr, /Cannot assign|TypeError/u);
});

void test('parser help and invalid-value paths keep their normal outcomes', () => {
    const script = args => `
        const { CommandLineParser } = require('@rushstack/ts-command-line');
        class Parser extends CommandLineParser {
            constructor() {
                super({ toolFilename: 'security-fixture', toolDescription: 'Synthetic parser check' });
                this.defineStringParameter({ parameterLongName: '--fixture', argumentName: 'VALUE', description: 'Synthetic fixture' });
                this.defineIntegerParameter({ parameterLongName: '--count', argumentName: 'COUNT', description: 'Synthetic count' });
            }
        }
        new Parser().executeAsync(${JSON.stringify(args)}).catch(() => { process.exitCode = 1; });
    `;
    const help = spawnSync(process.execPath, ['-e', script(['--help'])], {
        cwd: repository,
        encoding: 'utf8',
        timeout: 15000,
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--fixture/u);
    assert.match(help.stdout, /--count/u);
    const invalid = spawnSync(process.execPath, ['-e', script(['--count', 'not-an-integer'])], {
        cwd: repository,
        encoding: 'utf8',
        timeout: 15000,
    });
    // Original argparse 1.0.10 also exits 2 for invalid values; preserve its contract.
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /count|integer/u);
    assert.doesNotMatch(invalid.stderr, /Cannot assign|TypeError/u);
});

void test('API Extractor produces a real declaration rollup using the new parser', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const manifestPath = req.resolve('@microsoft/api-extractor/package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bin = path.resolve(path.dirname(manifestPath), manifest.bin['api-extractor']);
    const root = await mkdtemp(path.join(tmpdir(), 'vendure-declaration-retirement-'));
    try {
        await writeFile(
            path.join(root, 'package.json'),
            JSON.stringify({ name: '@vendure-test/declaration-compat', version: '0.0.0' }),
        );
        await writeFile(
            path.join(root, 'index.d.ts'),
            '/** @public */\nexport interface CheckedValue { readonly label: string; }\n',
        );
        await writeFile(
            path.join(root, 'tsconfig.json'),
            JSON.stringify({
                compilerOptions: { strict: true, target: 'ES2022', module: 'CommonJS', types: [] },
                files: ['./index.d.ts'],
            }),
        );
        const config = path.join(root, 'api-extractor.json');
        await writeFile(
            config,
            JSON.stringify({
                projectFolder: root,
                mainEntryPointFilePath: '<projectFolder>/index.d.ts',
                compiler: { tsconfigFilePath: '<projectFolder>/tsconfig.json' },
                apiReport: { enabled: false },
                docModel: { enabled: false },
                dtsRollup: { enabled: true, untrimmedFilePath: '<projectFolder>/public.d.ts' },
            }),
        );
        const result = spawnSync(process.execPath, [bin, 'run', '--local', '--config', config], {
            cwd: root,
            encoding: 'utf8',
            timeout: 30000,
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const output = await readFile(path.join(root, 'public.d.ts'), 'utf8');
        assert.match(output, /export\s+declare\s+interface\s+CheckedValue/u);
        assert.match(output, /readonly label: string/u);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
