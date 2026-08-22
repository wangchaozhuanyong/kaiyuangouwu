import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const dashboardRoot = fileURLToPath(new URL('../..', import.meta.url));
const uiRoot = fileURLToPath(new URL('../../src/lib/components/ui', import.meta.url));

const shadowedUpstreamComponents = {
    'alert-dialog': '8504f2bdb76fe08c772214ee37fae163f4fed1c3037e41ac3d4613b99110855f',
    badge: 'eda229522dddc715f9e4d93d3dde967f1f680703bc0f2af71e02a477f6f8aed5',
    button: '0c08bb875d038bd24a2e2c854a496ae038500d909df5ca32501cbbfcdc89e3d4',
    collapsible: 'ead4349ff7b01d696ef89294a81d18ee1d3f732321398896462c834ab9b9e065',
    combobox: '6873670e2ab7132ae368ba57b65430423c315068e2666f8e356eae889d666cf6',
    dialog: '59c29d70a8f88968109449a1821185796cc64397cee00a7cb9c7f439c0cccd5f',
    'dropdown-menu': '74413b6f71c3e25e9041afdf8a9e93c644a70e8fea09bb684a785a7e3b7790d0',
    input: '8115c01bbb917b56a124376365c181c7dff860fb3953c41e17304a2bdec934bd',
    select: '023b17f57a3cbda42c1c5bca00cc6ade026939445daf13b7518976c555e30289',
    sheet: '7bbed36fa5611f237478d3d9040ce945066f7fbee6ee440fec4f8c1e1483f418',
    sidebar: '6c7329927e28609255b939cc34ef85bae671935c36f9de61f303b6c28ec57c7d',
} as const;

function sha256(source: string) {
    return createHash('sha256').update(source).digest('hex');
}

function extractInputClassContract(source: string) {
    const classContract = source.match(/className=\{cn\(\s*["']([^"']+)["']/)?.[1];
    if (!classContract) {
        throw new Error('Could not find the input class contract');
    }
    return classContract;
}

describe('design system coverage', () => {
    it('keeps a colocated Storybook story for every base UI component', async () => {
        const [componentFiles, storyFiles] = await Promise.all([
            fg('*.tsx', {
                cwd: uiRoot,
                onlyFiles: true,
                ignore: ['*.stories.tsx', '*.spec.tsx', '*.test.tsx'],
            }),
            fg('*.stories.tsx', { cwd: uiRoot, onlyFiles: true }),
        ]);
        const storyNames = new Set(storyFiles.map(file => file.replace(/\.stories\.tsx$/, '')));
        const missingStories = componentFiles
            .map(file => file.replace(/\.tsx$/, ''))
            .filter(componentName => !storyNames.has(componentName));

        expect(componentFiles).toHaveLength(58);
        expect(missingStories).toEqual([]);
    });

    it('keeps manual prop documentation for critical upstream re-exports', async () => {
        const documentedStories = ['avatar', 'button-group', 'combobox', 'field', 'input-group', 'native-select', 'sidebar'];
        const missingArgTypes: string[] = [];

        for (const component of documentedStories) {
            const source = await readFile(`${uiRoot}/${component}.stories.tsx`, 'utf8');
            if (!source.includes('argTypes:')) {
                missingArgTypes.push(component);
            }
        }

        expect(missingArgTypes).toEqual([]);
    });
});

describe('local UI wrapper drift', () => {
    it.each(Object.entries(shadowedUpstreamComponents))(
        'requires an explicit review when the upstream %s source changes',
        async (component, expectedHash) => {
            const sharedPath = require.resolve(`@vendure-io/ui/components/ui/${component}`);
            const sharedSource = await readFile(sharedPath, 'utf8');
            expect(sha256(sharedSource)).toBe(expectedHash);
        },
    );

    it('keeps the local react-hook-form input classes aligned with @vendure-io/ui', async () => {
        const localInputPath = fileURLToPath(
            new URL('../../src/lib/components/ui/input.tsx', import.meta.url),
        );
        const sharedInputPath = require.resolve('@vendure-io/ui/components/ui/input');
        const [localInput, sharedInput] = await Promise.all([
            readFile(localInputPath, 'utf8'),
            readFile(sharedInputPath, 'utf8'),
        ]);

        expect(extractInputClassContract(localInput)).toBe(extractInputClassContract(sharedInput));
    });
});

describe('design token and motion guardrails', () => {
    it('does not use raw palette utility classes in production dashboard source', async () => {
        const sourceFiles = await fg('src/**/*.{ts,tsx}', {
            cwd: dashboardRoot,
            absolute: true,
            ignore: ['**/*.stories.tsx', '**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
        });
        const rawPalette =
            /\b(?:bg|text|border)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?\b/g;
        const violations: string[] = [];

        for (const sourcePath of sourceFiles) {
            const source = await readFile(sourcePath, 'utf8');
            for (const match of source.matchAll(rawPalette)) {
                violations.push(`${sourcePath.replace(`${dashboardRoot}/`, '')}: ${match[0]}`);
            }
        }

        expect(violations).toEqual([]);
    });

    it('keeps reduced-motion and forced-colors fallbacks in the application stylesheet', async () => {
        const styles = await readFile(`${dashboardRoot}/src/app/styles.css`, 'utf8');
        expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
        expect(styles).toContain('@media (forced-colors: active)');
        expect(styles).toContain('outline: 2px solid CanvasText');
    });
});
