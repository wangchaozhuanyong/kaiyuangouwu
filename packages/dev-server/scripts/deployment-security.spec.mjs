import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

void test('production Nginx routes protected downloads and hardens both APIs', async () => {
    const config = await readFile(path.join(repositoryRoot, 'deploy/nginx/damatong.conf'), 'utf8');

    assert.match(config, /location \^~ \/digital-delivery\//u);
    assert.match(config, /limit_req_zone \$binary_remote_addr zone=vendure_shop_api/u);
    assert.match(config, /limit_req_zone \$binary_remote_addr zone=vendure_admin_api/u);
    assert.match(config, /Strict-Transport-Security/u);
    assert.match(config, /Content-Security-Policy/u);
    assert.match(config, /Permissions-Policy/u);
});
