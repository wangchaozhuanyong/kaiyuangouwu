import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ciFixtureOptions } from './platform-governance-ci-fixture.mjs';

test('only explicit CI fixture opt-in with a declared high port is accepted', () => {
    const env = { CI: 'true', PLATFORM_GOVERNANCE_CI_MYSQL: '1', E2E_MYSQL_PORT: '33552' };
    assert.equal(ciFixtureOptions(env).host, '127.0.0.1');
    for (const changed of [
        { CI: '' },
        { PLATFORM_GOVERNANCE_CI_MYSQL: '' },
        { E2E_MYSQL_PORT: '' },
        { E2E_MYSQL_PORT: '330' },
        { E2E_MYSQL_PORT: '65536' },
    ])
        assert.throws(() => ciFixtureOptions({ ...env, ...changed }));
});
