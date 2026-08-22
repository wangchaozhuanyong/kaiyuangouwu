import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeAuditReport, matchRuntimeAdvisories } from './production-runtime-audit.mjs';

const packages = [
    { name: 'safe-package', path: 'node_modules/safe-package', version: '2.0.0' },
    { name: 'vulnerable-package', path: 'node_modules/vulnerable-package', version: '1.2.3' },
];
const audit = {
    'safe-package': [
        {
            id: 1,
            severity: 'high',
            title: 'Patched in 2.0.0',
            url: 'https://example.com/1',
            vulnerable_versions: '<2.0.0',
        },
    ],
    'vulnerable-package': [
        {
            id: 2,
            severity: 'high',
            title: 'Affected before 1.3.0',
            url: 'https://example.com/2',
            vulnerable_versions: '<1.3.0',
        },
    ],
};

void test('runtime audit matches advisory ranges against exact artifact versions', () => {
    assert.deepEqual(matchRuntimeAdvisories(packages, audit), [
        {
            id: '2',
            name: 'vulnerable-package',
            path: 'node_modules/vulnerable-package',
            severity: 'high',
            title: 'Affected before 1.3.0',
            url: 'https://example.com/2',
            version: '1.2.3',
            vulnerableVersions: '<1.3.0',
        },
    ]);
});

void test('runtime audit policy can report High findings while blocking Critical by default', () => {
    const { blockedFindings, report } = createRuntimeAuditReport(packages, audit);

    assert.equal(blockedFindings.length, 0);
    assert.deepEqual(report.summary, { critical: 0, high: 1, low: 0, moderate: 0, total: 1 });
});

void test('runtime audit policy can be tightened to block High findings', () => {
    const { blockedFindings } = createRuntimeAuditReport(packages, audit, { failOn: 'high' });

    assert.equal(blockedFindings.length, 1);
});
