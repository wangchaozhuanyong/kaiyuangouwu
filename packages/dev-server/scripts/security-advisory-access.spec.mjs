import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { SECURITY_VENDORS, addSecurityOriginFindings } from './security-vendors.mjs';

const vendor = SECURITY_VENDORS[0];
const verified = [{ state: 'VERIFIED_SECURITY_REPLACEMENT', sourceSha256: vendor.sourceSha256 }];
const withdrawn = {
    html_url: vendor.advisory,
    ghsa_id: vendor.advisory.split('/').at(-1),
    severity: vendor.severity,
    withdrawn_at: '2026-10-23T12:53:02Z',
    vulnerabilities: [
        { package: { ecosystem: 'npm', name: vendor.original }, vulnerable_version_range: '<=3.0.3' },
    ],
};

function transport(t, respond) {
    t.mock.method(https, 'request', (options, callback) => {
        const request = new EventEmitter();
        request.end = () => {
            process.nextTick(() => {
                const response = new PassThrough();
                const result = respond(options);
                response.statusCode = result.status;
                callback(response);
                response.end(JSON.stringify(result.body));
                request.emit('close');
            });
        };
        request.destroy = error => request.emit('error', error);
        return request;
    });
}

test('origin audit uses the existing CI token only for the official GitHub advisory request', async t => {
    const previous = process.env.GH_TOKEN;
    process.env.GH_TOKEN = 'synthetic-advisory-token';
    t.after(() => {
        if (previous === undefined) delete process.env.GH_TOKEN;
        else process.env.GH_TOKEN = previous;
    });
    const requests = [];
    transport(t, options => {
        requests.push(options);
        return { status: 200, body: options.hostname === 'registry.npmjs.org' ? {} : withdrawn };
    });
    await addSecurityOriginFindings({}, verified);
    assert.deepEqual(
        requests.map(item => item.hostname),
        ['registry.npmjs.org', 'api.github.com'],
    );
    assert.equal(requests[0].headers.authorization, undefined);
    assert.equal(requests[1].headers.authorization, 'Bearer synthetic-advisory-token');
});

test('origin registry errors retain the HTTP status and endpoint without provider bodies or tokens', async t => {
    transport(t, () => ({ status: 503, body: { error: 'sensitive-provider-detail' } }));
    await assert.rejects(addSecurityOriginFindings({}, verified), error => {
        assert.match(error.message, /HTTP 503.*registry\.npmjs\.org/u);
        assert.doesNotMatch(error.message, /sensitive-provider-detail|Bearer/u);
        return true;
    });
});

for (const name of ['Audit monorepo dependencies', 'Build and verify production runtime']) {
    test(`${name} passes the existing restricted CI token into the actual audit invocation`, async () => {
        const workflow = await readFile(
            new URL('../../../.github/workflows/build_production_runtime.yml', import.meta.url),
            'utf8',
        );
        const block = workflow.split(`            - name: ${name}\n`)[1]?.split('\n            - name:')[0];
        assert.ok(block, 'Missing actual runtime audit step');
        const environment = block.split('              env:\n')[1]?.split('              run:')[0];
        assert.ok(environment?.split('\n').some(line => line.trim() === 'GH_TOKEN: ${{ github.token }}'));
    });
}
