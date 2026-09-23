import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('admin interaction performance contract', () => {
    it('keeps reduced-motion behavior global instead of depending on each feature page', () => {
        const source = readFileSync(path.join(__dirname, 'index.css'), 'utf8');

        expect(source).toMatch(
            /@media \(prefers-reduced-motion: reduce\)[\s\S]*?#root \*[\s\S]*?transition: none !important;/,
        );
    });

    it('keeps the production entry-size gate enabled', () => {
        const source = readFileSync(path.join(__dirname, '../scripts/verify-production-build.mjs'), 'utf8');

        expect(source).toContain('const entryBudgetBytes = 340 * 1024;');
    });

    it('keeps authenticated extension registration out of the login entry', () => {
        const app = readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');
        const shell = readFileSync(path.join(__dirname, 'layouts/AppShell.tsx'), 'utf8');
        const routeModules = readFileSync(path.join(__dirname, 'route-modules.ts'), 'utf8');
        const vite = readFileSync(path.join(__dirname, '../vite.config.ts'), 'utf8');

        expect(app).not.toContain('./extensions/installed-extensions');
        expect(routeModules).toContain("import('./extensions/installed-extensions')");
        expect(shell).toContain('../extensions/installed-extensions');
        expect(vite).not.toContain("'lucide-icons': ['lucide-react']");
    });

    it('provides one shared visual and interaction foundation for admin features', () => {
        const source = readFileSync(path.join(__dirname, 'index.css'), 'utf8');

        for (const token of [
            '--admin-radius-control',
            '--admin-radius-surface',
            '--admin-shadow-surface',
            '--admin-focus',
            '--admin-control-min',
            '--admin-motion-standard',
        ]) {
            expect(source).toContain(token);
        }
    });
});
