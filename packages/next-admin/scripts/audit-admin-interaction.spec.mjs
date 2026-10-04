import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditAdminInteraction } from './audit-admin-interaction.mjs';

const packageRoot = path.resolve(import.meta.dirname, '..');
// Fixtures belong to this package's existing ignored QA output, never to its live src.
const fixtureParent = path.join(packageRoot, 'e2e/admin-layout/results');
const ownedFixtures = [];
afterEach(() => {
    for (const directory of ownedFixtures.splice(0)) rmSync(directory, { recursive: true });
});

function fixture(files = {}) {
    mkdirSync(fixtureParent, { recursive: true });
    const directory = mkdtempSync(path.join(fixtureParent, 'rule-gate-'));
    ownedFixtures.push(directory);
    const sourceRoot = path.join(directory, 'src');
    const sourceFiles = {
        'apollo.ts': 'export const adminMutationFeedbackLink = true;',
        'main.tsx': 'export const main = <AdminFeedbackCenter />;',
        'features/new-business/Feature.tsx': `
            import { useAdminQuery } from '../../hooks/use-admin-query';
            import { AdminButton } from '../../components/AdminControls';
            export function Feature() {
                const result = useAdminQuery(DOCUMENT);
                return <AdminButton refreshPage>刷新</AdminButton>;
            }
        `,
        ...files,
    };
    for (const [relative, source] of Object.entries(sourceFiles)) {
        const file = path.join(sourceRoot, relative);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, source);
    }
    const policyFile = path.join(sourceRoot, 'runtime/admin-resource-events.ts');
    mkdirSync(path.dirname(policyFile), { recursive: true });
    copyFileSync(path.join(packageRoot, 'src/runtime/admin-resource-events.ts'), policyFile);
    return { directory, sourceRoot };
}

function runExistingCheck(directory) {
    const scriptsRoot = path.join(directory, 'scripts');
    mkdirSync(scriptsRoot);
    for (const name of ['audit-operation-feedback.mjs', 'audit-admin-interaction.mjs'])
        copyFileSync(path.join(import.meta.dirname, name), path.join(scriptsRoot, name));
    return spawnSync(process.execPath, [path.join(scriptsRoot, 'audit-operation-feedback.mjs')], {
        cwd: directory,
        encoding: 'utf8',
    });
}

describe('Admin mandatory architecture gate', () => {
    it('accepts shared integration in a newly named production directory', () => {
        const { sourceRoot } = fixture({
            'features/new-business/write.ts':
                'const UPDATE = gql`mutation UpdateProduct { updateProduct(input: { id: "fixture" }) { id } }`;',
        });
        const report = auditAdminInteraction(sourceRoot);
        expect(report.violations).toEqual([]);
        expect(report.coverage).toMatchObject({
            managedQueryFiles: 1,
            managedQueryCalls: 1,
            sharedControls: 1,
            pageRefreshButtons: 1,
            mappedMutations: 1,
        });
    });

    it.each(['useQuery', 'useLazyQuery', 'useSuspenseQuery', 'useBackgroundQuery', 'useLoadableQuery'])(
        'rejects the directly imported Apollo %s hook, including an import alias',
        hook => {
            const { sourceRoot } = fixture({
                'features/new-business/read.mts': `import { ${hook} as customRead } from '@apollo/client/react';`,
            });
            expect(auditAdminInteraction(sourceRoot).violations).toEqual([
                'features/new-business/read.mts:1 业务查询必须使用 use-admin-query',
            ]);
        },
    );

    it.each(['Apollo.useQuery(DOCUMENT)', '(Apollo.useQuery as any)(DOCUMENT)'])(
        'rejects namespace hook calls: %s',
        call => {
            const { sourceRoot } = fixture({
                'features/new-business/read.ts': `import * as Apollo from '@apollo/client/react';\n${call};`,
            });
            expect(auditAdminInteraction(sourceRoot).violations[0]).toContain(
                'features/new-business/read.ts:2 业务查询必须使用 use-admin-query',
            );
        },
    );

    it.each(['button', 'input', 'select', 'textarea'])('rejects a native %s in new JSX source', tag => {
        const { sourceRoot } = fixture({ 'features/new-business/control.jsx': `const field = <${tag} />;` });
        expect(auditAdminInteraction(sourceRoot).violations).toEqual([
            'features/new-business/control.jsx:1 交互控件必须使用 AdminControls',
        ]);
    });

    it.each(['setInterval', 'window.setInterval', 'globalThis.setInterval'])(
        'rejects an independent timer: %s',
        timer => {
            const { sourceRoot } = fixture({ 'features/new-business/timer.ts': `${timer}(() => {}, 1000);` });
            expect(auditAdminInteraction(sourceRoot).violations).toEqual([
                'features/new-business/timer.ts:1 页面计时必须使用 useActiveInterval',
            ]);
        },
    );

    it.each(['location.reload', 'window.location.reload'])('rejects a page reload: %s', reload => {
        const { sourceRoot } = fixture({ 'features/new-business/refresh.ts': `${reload}();` });
        expect(auditAdminInteraction(sourceRoot).violations[0]).toContain('页面刷新不得使用 location.reload');
    });

    it('rejects a new write missing its production resource-domain mapping', () => {
        const { sourceRoot } = fixture({
            'features/new-business/write.ts': 'const WRITE = gql`mutation Unknown { archiveWidget { id } }`;',
        });
        expect(auditAdminInteraction(sourceRoot).violations).toEqual([
            'features/new-business/write.ts:1 写入缺少资源域：archiveWidget',
        ]);
    });

    it('keeps implementation exceptions narrow and excludes ordinary test fixtures', () => {
        const { sourceRoot } = fixture({
            'App.tsx': "import { useQuery } from '@apollo/client/react';",
            'layouts/AppShell.tsx': "import { useQuery } from '@apollo/client/react';",
            'hooks/use-admin-query.ts': "import { useLazyQuery } from '@apollo/client/react';",
            'hooks/use-page-activity.ts': 'setInterval(() => {}, 1000);',
            'components/AdminControls.tsx': 'const button = <button />;',
            'features/new-business/control.spec.tsx': 'const button = <button />;',
            '__tests__/fixture.tsx': 'const button = <button />;',
            'test/fixture.tsx': 'const button = <button />;',
            'features/new-business/another-wrapper.tsx': 'const button = <button />;',
        });
        expect(auditAdminInteraction(sourceRoot).violations).toEqual([
            'features/new-business/another-wrapper.tsx:1 交互控件必须使用 AdminControls',
        ]);
    });

    it('runs the architecture gate through the existing operation-feedback check', () => {
        const { directory } = fixture();
        const result = runExistingCheck(directory);
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('Admin operation feedback audit passed');
        expect(result.stdout).toContain('Admin loading/refresh/interaction audit passed');
    });

    it('fails the existing check before compilation when a new feature bypasses shared controls', () => {
        const { directory } = fixture({ 'features/new-business/Forbidden.tsx': 'const field = <input />;' });
        const result = runExistingCheck(directory);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
            'features/new-business/Forbidden.tsx:1 交互控件必须使用 AdminControls',
        );
        expect(result.stdout).not.toContain('audit passed');
    });
});
