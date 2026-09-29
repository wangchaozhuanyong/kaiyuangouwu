import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzePosterDefaults } from './audit-referral-poster-defaults.mjs';

const expected = { headlineZh: '商品\n服务', titleEn: 'A store' };
const row = (name, value) => `${name}\t${Buffer.from(value).toString('hex').toUpperCase()}`;

test('read-only audit compares every expected default and provides a stable baseline digest', () => {
    const output = [row('titleEn', 'A store'), row('headlineZh', '旧版\n文案')].join('\n');
    const result = analyzePosterDefaults(output, expected);
    assert.equal(result.inspectedColumns, 2);
    assert.equal(result.changedDefaults, 1);
    assert.match(result.baselineSha256, /^[a-f0-9]{64}$/u);
    assert.match(result.targetSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(result.columns, [
        { name: 'headlineZh', current: '旧版\n文案', target: '商品\n服务', changeRequired: true },
        { name: 'titleEn', current: 'A store', target: 'A store', changeRequired: false },
    ]);
    assert.equal(analyzePosterDefaults(output, expected).baselineSha256, result.baselineSha256);
});

test('read-only audit fails when a column is absent or cannot be decoded', () => {
    assert.throws(() => analyzePosterDefaults(row('titleEn', 'A store'), expected), /Expected 2/u);
    assert.throws(
        () => analyzePosterDefaults('headlineZh\tNOT_HEX\ntitleEn\t4142', expected),
        /Invalid default encoding/u,
    );
});

test('read-only audit preserves an empty existing default', () => {
    const result = analyzePosterDefaults('headlineZh\t\ntitleEn\t412073746F7265\n', expected);
    assert.equal(result.columns[0].current, '');
    assert.equal(result.changedDefaults, 1);
});
