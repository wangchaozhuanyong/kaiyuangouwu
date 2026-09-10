import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

describe('legacy light utility dark-theme compatibility', () => {
    it('maps every light surface and dark text utility used by the admin source', () => {
        const usages = new Map<string, string[]>();

        for (const path of listSourceFiles(sourceRoot)) {
            const relativePath = path.slice(sourceRoot.length + 1);
            const lines = readFileSync(path, 'utf8').split('\n');

            lines.forEach((line, index) => {
                const hasExplicitDarkSurface = /\bdark:bg-/.test(line);
                const hasExplicitDarkText = /\bdark:text-/.test(line);
                const classNames = [
                    ...(line.match(lightSurfaceClassPattern) ?? []),
                    ...(line.match(darkTextClassPattern) ?? []),
                ];

                for (const className of classNames) {
                    const hasExplicitOverride = className.includes('bg-')
                        ? hasExplicitDarkSurface
                        : hasExplicitDarkText;
                    if (intentionalDarkOverlayClasses.has(className) || hasExplicitOverride) {
                        continue;
                    }
                    const locations = usages.get(className) ?? [];
                    locations.push(`${relativePath}:${index + 1}`);
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
            const relativePath = path.slice(sourceRoot.length + 1);
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
