import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const themeStylesheet = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

const lightSurfaceClassPattern =
    /(?<![\w:-])(?:(?:disabled|group-hover|hover):)?bg-(?:white(?:\/\d+)?|(?:slate|gray|zinc|neutral|stone)-(?:50|100|200|300)(?:\/\d+)?|(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200)(?:\/\d+)?)(?![\w/-])/g;
const darkTextClassPattern =
    /(?<![\w:-])(?:(?:focus|group-hover|hover):)?text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:600|700|800|900|950)(?![\w/-])/g;

// These translucent whites are deliberate overlays on permanently dark navigation or gradient surfaces.
const intentionalDarkOverlayClasses = new Set([
    'bg-white/5',
    'bg-white/10',
    'bg-white/15',
    'hover:bg-white/5',
]);

function listSourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return listSourceFiles(path);
        }
        if (!['.ts', '.tsx'].includes(extname(entry.name)) || entry.name.includes('.spec.')) {
            return [];
        }
        return [path];
    });
}

function hasCompatibilitySelector(className: string): boolean {
    const normalizedStylesheet = themeStylesheet.replaceAll('\\:', ':').replaceAll('\\/', '/');
    const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\.${escapedClassName}(?=[\\s,:)>])`).test(normalizedStylesheet);
}

// Read complete literals, not physical lines: formatting a className over two
// lines must not hide its dark variant, nor let a neighbouring element provide it.
function sourceStyleLiterals(content: string, path: string) {
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    const literals: Array<{ text: string; line: number }> = [];
    function visit(node: ts.Node) {
        if (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node)) {
            literals.push({
                text: node.text,
                line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            });
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return literals;
}

describe('legacy light utility dark-theme compatibility', () => {
    it('keeps multiline style literals together without merging neighbouring elements', () => {
        const literals = sourceStyleLiterals(
            '<><button className="bg-white/60\n dark:bg-black/15" /><span className="bg-white/60" /></>',
            'fixture.tsx',
        );
        expect(literals).toEqual([
            { text: 'bg-white/60\n dark:bg-black/15', line: 1 },
            { text: 'bg-white/60', line: 2 },
        ]);
    });

    it('maps every light surface and dark text utility used by the admin source', () => {
        const usages = new Map<string, string[]>();

        for (const path of listSourceFiles(sourceRoot)) {
            const relativePath = relative(sourceRoot, path);
            const literals = sourceStyleLiterals(readFileSync(path, 'utf8'), path);

            literals.forEach(({ text, line }) => {
                const hasExplicitDarkSurface = /\bdark:bg-/.test(text);
                const hasExplicitDarkText = /\bdark:text-/.test(text);
                const classNames = [
                    ...(text.match(lightSurfaceClassPattern) ?? []),
                    ...(text.match(darkTextClassPattern) ?? []),
                ];

                for (const className of classNames) {
                    const hasExplicitOverride = className.includes('bg-')
                        ? hasExplicitDarkSurface
                        : hasExplicitDarkText;
                    if (intentionalDarkOverlayClasses.has(className) || hasExplicitOverride) {
                        continue;
                    }
                    const locations = usages.get(className) ?? [];
                    locations.push(`${relativePath}:${line}`);
                    usages.set(className, locations);
                }
            });
        }

        const unmapped = [...usages.entries()]
            .filter(([className]) => !hasCompatibilitySelector(className))
            .map(([className, locations]) => `${className} -> ${locations.join(', ')}`)
            .sort();

        expect(
            unmapped,
            'Light utility classes must be added to the dark compatibility layer or given a matching explicit dark:* override.',
        ).toEqual([]);
    });

    it('maps descendant combinator surface utilities to admin surface in dark mode', () => {
        expect(themeStylesheet).toContain(".dark :where([class*='[&>']:where([class*=':bg-white']) > *)");
        expect(themeStylesheet).toContain('.dark .\\[\\&\\>article\\]\\:bg-white > article');
    });

    it('ensures no source file relies on unmapped descendant background utilities', () => {
        const arbitraryBgPattern = /\[&[^\]]+\]:bg-[^\s"'`]+/g;
        const unmappedArbitrary: string[] = [];

        for (const path of listSourceFiles(sourceRoot)) {
            const relativePath = relative(sourceRoot, path);
            const content = readFileSync(path, 'utf8');
            const matches = content.match(arbitraryBgPattern);
            if (matches) {
                unmappedArbitrary.push(`${relativePath}: ${matches.join(', ')}`);
            }
        }

        expect(
            unmappedArbitrary,
            'Components must declare their own surface backgrounds directly (e.g. bg-white) instead of relying on fragile descendant combinators.',
        ).toEqual([]);
    });
});
