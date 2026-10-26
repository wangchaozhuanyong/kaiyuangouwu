// Build only the requested b5a831f frontend source into this project's report directory.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile } from 'vite';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const frontend = path.join(repo, 'packages/storefront');
const output = path.join(repo, 'reports/coupon-first-frame-20261026/baseline-dist');
process.chdir(frontend);
const changed = execFileSync('git', ['diff', '--name-only', 'b5a831f', '--'], { cwd: repo, encoding: 'utf8' })
    .trim()
    .split('\n');
const originals = new Map(
    changed
        .filter(
            file =>
                !execFileSync('git', ['diff', '--name-only', '--diff-filter=A', 'b5a831f', '--', file], {
                    cwd: repo,
                    encoding: 'utf8',
                }).trim(),
        )
        .filter(file => /\.(?:ts|tsx|mjs)$/.test(file))
        .map(file => [
            path.join(repo, file),
            execFileSync('git', ['show', 'b5a831f:' + file], { cwd: repo, encoding: 'utf8' }),
        ]),
);
const baseline = {
    name: 'original-b5a831f-source',
    enforce: 'pre',
    load(id) {
        return originals.get(id.split('?')[0]);
    },
};
for (const [name, target] of [
    ['vite.config.ts', output],
    ['vite.public-server.config.ts', output + '/.server'],
]) {
    const loaded = await loadConfigFromFile(
        { command: 'build', mode: 'production' },
        path.join(frontend, name),
    );
    if (!loaded) throw new Error('Missing baseline build configuration');
    await build({
        ...loaded.config,
        configFile: false,
        root: frontend,
        plugins: [baseline, ...(loaded.config.plugins ?? [])],
        build: { ...loaded.config.build, outDir: target },
    });
}
