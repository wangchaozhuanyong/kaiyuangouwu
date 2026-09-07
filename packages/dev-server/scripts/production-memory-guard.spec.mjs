import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { evaluateMemory, parseArguments, parseMeminfo } = require(
    path.join(repositoryRoot, 'deploy/production-memory-guard.cjs'),
);

void test('production memory guard uses MemAvailable instead of free memory', () => {
    const parsed = parseMeminfo(`
MemTotal:        2048000 kB
MemFree:           64000 kB
MemAvailable:     640000 kB
Buffers:           32000 kB
Cached:           512000 kB
SwapFree:         256000 kB
`);

    assert.deepEqual(parsed, {
        totalKib: 2_048_000,
        availableKib: 640_000,
        swapFreeKib: 256_000,
    });
    assert.equal(evaluateMemory(parsed).safe, true);
});

void test('production memory guard rejects a host below the absolute safety floor', () => {
    const result = evaluateMemory({ totalKib: 2_048_000, availableKib: 300_000, swapFreeKib: 0 });

    assert.equal(result.requiredAvailableKib, 384 * 1024);
    assert.equal(result.safe, false);
});

void test('production memory guard accepts swap as emergency headroom', () => {
    const result = evaluateMemory({
        totalKib: 3_925_000,
        availableKib: 250_000,
        swapFreeKib: 2_097_152,
    });

    assert.equal(result.minimumPhysicalAvailableKib, 192 * 1024);
    assert.equal(result.effectiveHeadroomKib, 2_347_152);
    assert.equal(result.safe, true);
});

void test('production memory guard keeps a physical availability floor even with swap', () => {
    const result = evaluateMemory({
        totalKib: 3_925_000,
        availableKib: 180_000,
        swapFreeKib: 2_097_152,
    });

    assert.equal(result.safe, false);
});

void test('production memory guard scales the safety floor on larger hosts', () => {
    const result = evaluateMemory({ totalKib: 8_388_608, availableKib: 900_000, swapFreeKib: 0 });

    assert.equal(result.requiredAvailableKib, 1_048_576);
    assert.equal(result.safe, false);
});

void test('production memory guard accepts explicit check and report modes', () => {
    assert.deepEqual(parseArguments(['--stage', 'pre-switch', '--check']), {
        stage: 'pre-switch',
        check: true,
    });
    assert.deepEqual(parseArguments(['--stage', 'post-switch', '--report']), {
        stage: 'post-switch',
        check: false,
    });
});
