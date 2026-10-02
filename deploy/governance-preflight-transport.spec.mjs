import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

const transport = createRequire(import.meta.url)('./governance-preflight-transport.cjs');

test('a plan above the SSM output limit is returned intact, verifies every chunk and clears its transport', t => {
    const parent = path.resolve('artifacts/platform-governance/transport-fixtures');
    mkdirSync(parent, { recursive: true });
    const directory = mkdtempSync(path.join(parent, 'chunk-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const plan = { mode: 'READ_ONLY', productionApply: false, ids: randomBytes(60000).toString('hex') };
    const compressed = gzipSync(Buffer.from(JSON.stringify(plan))).toString('base64');
    assert.ok(compressed.length > 24000);
    const manifest = transport.persist(directory, compressed);
    const chunks = Array.from({ length: manifest.partCount }, (_, part) =>
        transport.readPart(directory, manifest.sha256, part),
    );
    assert.ok(chunks.every(chunk => JSON.stringify(chunk).length < 14000));
    assert.equal(chunks.map(chunk => chunk.content).join(''), compressed);
    assert.throws(() => transport.readPart(directory, '0'.repeat(64), 0), /snapshot changed/u);
    assert.throws(() => transport.readPart(directory, manifest.sha256, manifest.partCount));
    assert.throws(() => transport.persist(directory, compressed));
    assert.throws(() => transport.cleanup(directory, manifest.sha256));
    // Run the actual Python assembler with a fixed synthetic SSM invoker, including a corrupted chunk.
    const input = {
        Output: JSON.stringify({
            audit: { snapshotHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex') },
            planTransport: { ...manifest, directory: '/tmp/vendure-production-operations.fixture' },
        }),
    };
    writeFileSync(path.join(directory, 'fixture.json'), JSON.stringify({ input, chunks, plan }));
    const script = [
        'import importlib.util,json,sys',
        "spec=importlib.util.spec_from_file_location('collector','deploy/collect-governance-preflight.py')",
        'm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)',
        'f=json.load(open(sys.argv[1]))',
        'calls=[]',
        'def invoke(command):',
        ' calls.append(command)',
        " if ' cleanup ' in command: return 'GOVERNANCE_TRANSPORT_CLEANED\\n'",
        " return json.dumps(f['chunks'][int(command.split()[-1])])",
        "assert m.collect(f['input'],invoke)==f['plan']",
        "assert ' cleanup ' in calls[-1]",
        "f['chunks'][0]['content']='bad'",
        "try: m.collect(f['input'],invoke);raise RuntimeError('accepted corruption')",
        'except AssertionError: pass',
        "assert ' cleanup ' in calls[-1]",
    ].join('\n');
    execFileSync('python3', ['-c', script, path.join(directory, 'fixture.json')], {
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
});

test('transport refuses a symlink and an oversized file before reading it', t => {
    const parent = path.resolve('artifacts/platform-governance/transport-fixtures');
    mkdirSync(parent, { recursive: true });
    const directory = mkdtempSync(path.join(parent, 'reject-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const target = path.join(directory, 'target');
    writeFileSync(target, 'YWJj', { mode: 0o600 });
    const file = path.join(directory, 'governance-plan.base64');
    symlinkSync(target, file);
    assert.throws(() => transport.readPart(directory, '0'.repeat(64), 0));
    rmSync(file);
    writeFileSync(file, 'A'.repeat(512001), { mode: 0o600 });
    assert.throws(() => transport.readPart(directory, '0'.repeat(64), 0));
    assert.equal(readFileSync(target, 'utf8'), 'YWJj');
});
