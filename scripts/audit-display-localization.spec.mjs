import assert from 'node:assert/strict';
import test from 'node:test';

import { auditDisplayProject, auditDisplaySource } from './audit-display-localization.mjs';

test('rejects direct keys, unknown-key fallbacks and untranslated copy', () => {
    const source = `
        const statusLabel = (state: string) => labels[state] ?? state;
        const View = () => <><h2>Plugin management</h2><div>{definition.code}</div>
            <span>{unknown.state}</span><button aria-label={operation.code} />
            <span>{asset.width ? '图片' : asset.type}</span><p>{job.errorMessage}</p></>;
    `;
    const findings = auditDisplaySource(source, 'packages/next-admin/src/new-feature.tsx');
    assert.equal(findings.filter(item => item.rule === 'raw-label-fallback').length, 1);
    assert.equal(findings.filter(item => item.rule === 'raw-system-text').length, 5);
    assert.equal(findings.filter(item => item.rule === 'unlocalized-ui-copy').length, 1);
});
test('allows lookup inputs, business references, explicit diagnostics and English language branches', () => {
    const source = `
        const View = () => <><span>{getSystemLabel(record.state, labels)}</span>
            <div key={definition.code} data-code={definition.code} />
            <input value={definition.code} /><span>{order.code}</span><span>USDT</span>
            <span>响应状态 {attempt.httpStatus}</span>
            <td data-business-reference="inventory-operation">{operation.code}</td>
            <details data-technical-details><summary>查看技术信息</summary>{definition.code}</details>
            {language === 'en' ? <span>Plugin management</span> : <span>插件管理</span>}
        </>;
    `;
    assert.deepEqual(auditDisplaySource(source, 'packages/next-admin/src/example.tsx'), []);
});
test('parses angle-bracket TypeScript assertions without inventing JSX violations', () => {
    assert.deepEqual(
        auditDisplaySource('const status = <number>response.status;', 'packages/next-admin/src/api.ts'),
        [],
    );
});
test('rejects untranslated string expressions, including accessible labels', () => {
    const source = `const View = () => <><span>{'Plugin management'}</span>
        <button aria-label={'Remove plugin'} />
        <span>{language === 'en' ? 'Plugin management' : '插件管理'}</span></>;`;
    const findings = auditDisplaySource(source, 'packages/next-admin/src/example.tsx');
    assert.equal(findings.length, 2);
    assert.ok(findings.every(item => item.rule === 'unlocalized-ui-copy'));
});
test('protects future status fields and named system codes', () => {
    const source = `const View = () => <><span>{record.futureDeliveryStatus}</span>
        <span>{plugin.pluginCode}</span><span>{record.reasonCode}</span></>;`;
    const findings = auditDisplaySource(source, 'packages/storefront/src/new-feature.tsx');
    assert.equal(findings.length, 3);
    assert.ok(findings.every(item => item.rule === 'raw-system-text'));
});
test('the checked-in display sources obey the contract', () => {
    assert.deepEqual(auditDisplayProject().findings, []);
});
