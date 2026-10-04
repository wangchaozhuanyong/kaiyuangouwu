import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
    auditStorefrontTypography,
    auditTypographySource,
    packageRoot,
    typeTokens,
} from './check-typography.mjs';

const tokens = typeTokens(readFileSync(path.join(packageRoot, 'src/styles/typography.css'), 'utf8'));
const audit = (source, file = 'src/pages/new-page.tsx') => auditTypographySource(file, source, tokens);

test('all current storefront, shared preview and isolated tool sources follow the contract', () => {
    const result = auditStorefrontTypography();
    assert.ok(result.files > 300);
    assert.deepEqual(result.issues, []);
});

test('new CSS pages cannot introduce raw metrics, shorthand, or override global roles', () => {
    for (const declaration of [
        'font-size: 11px',
        'font: 600 12px/1.5 sans-serif',
        'line-height: 1.4',
        'font-weight: 650',
        'font-family: Arial',
        'letter-spacing: -0.03em',
        '--type-label-size: 12px',
        '--type-page-local-size: 11px',
    ])
        assert.ok(audit(`.new-page { ${declaration}; }`, 'src/pages/new-page.css').length, declaration);
});

test('new JSX pages cannot bypass the contract with Tailwind or inline styles', () => {
    for (const className of [
        'text-xs',
        'lg:text-[11px]',
        'leading-[1.4]',
        'font-bold',
        'tracking-tight',
        '[font-size:12px]',
        '[--type-body-size:11px]',
        'type-unknown',
    ]) {
        assert.ok(audit(`const Page = () => <p className="${className}" />`).length, className);
    }
    for (const value of [
        'fontSize: 11',
        'fontSize: "12px"',
        'fontWeight: selected ? 700 : 500',
        'lineHeight: 1.4',
        '"--type-body-size": "11px"',
    ]) {
        assert.ok(audit(`const Page = () => <p style={{ ${value} }} />`).length, value);
    }
});

test('undefined tokens, missing leading pairs and decorative roles in UI are rejected', () => {
    for (const source of [
        '.new { font-size: var(--type-not-a-role-size); }',
        '.new { font-size: var(--type-label-size); line-height: var(--type-meta-leading); }',
        '.new { font-size: var(--type-artwork-caption-size); line-height: var(--type-artwork-caption-leading); }',
    ])
        assert.ok(audit(source, 'src/pages/new-page.css').length, source);
    assert.ok(audit('const Page = () => <p style={{ fontSize: "var(--type-label-size)" }} />').length);
});

test('shared roles support responsive variants and explicit emphasis', () => {
    assert.deepEqual(
        audit(
            'const Page = () => <p className="type-body lg:type-reading [font-weight:var(--font-weight-semibold)]" />',
        ),
        [],
    );
    assert.deepEqual(
        audit(
            '.new { font-size: var(--type-label-size); line-height: var(--type-label-leading); font-weight: var(--font-weight-medium); }',
            'src/pages/new-page.css',
        ),
        [],
    );
    assert.deepEqual(
        audit(
            'const Page = () => <p style={{ fontSize: "var(--type-label-size)", lineHeight: "var(--type-label-leading)" }} />',
        ),
        [],
    );
});

test('editable controls cannot borrow smaller body or helper roles', () => {
    assert.ok(audit('.settings select { font: inherit; }', 'src/pages/new-page.css').length);
    assert.ok(audit('const Page = () => <input className="type-body" />').length);
    assert.ok(audit('const inputClass = "rounded-lg type-helper";').length);
    assert.ok(
        audit(
            '.settings select { font-size: var(--type-helper-size); line-height: var(--type-helper-leading); }',
            'src/pages/new-page.css',
        ).length,
    );
    assert.deepEqual(audit('const Page = () => <textarea className="type-input" />'), []);
});

test('the canonical entry cannot reduce ordinary text or input below the contract floor', () => {
    assert.ok(audit(':root { --type-input-size: 14px; }', 'src/styles/typography.css').length);
    assert.ok(audit(':root { --type-helper-size: 11px; }', 'src/styles/typography.css').length);
    assert.deepEqual(audit(':root { --type-input-size: 16px; }', 'src/styles/typography.css'), []);
});
