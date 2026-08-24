import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { patchStorybookTestTransform } from './storybook-test-compat.mjs';
import dashboardViteConfigFactory from './vite.config.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const previousVitestFlag = process.env.VITEST;

// Vitest 3 does not expose this flag while evaluating a standalone config.
// Keep the mutation scoped to config creation so it cannot leak to other builds.
process.env.VITEST = 'true';

const dashboardViteConfig: { plugins?: readonly unknown[] } = dashboardViteConfigFactory({ mode: 'test' });
const dashboardPlugins = (dashboardViteConfig.plugins ?? [])
    .flat(Infinity)
    .filter(Boolean) as unknown as Plugin[];
const storybookPlugins = (
    await storybookTest({
        configDir: path.join(dirname, '.storybook'),
    })
)
    .flat(Infinity)
    .filter(Boolean);

if (previousVitestFlag === undefined) {
    delete process.env.VITEST;
} else {
    process.env.VITEST = previousVitestFlag;
}

const browserOptimizeDependencies = [
    '@hookform/resolvers/zod',
    '@lingui/core',
    '@vendure-io/ui/hooks/use-mobile',
    'awesome-graphql-client',
    'clsx',
    'date-fns',
    'gql.tada',
    'json-edit-react',
    'loose-envify',
    'loose-envify > js-tokens',
    'motion/react',
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    'react-day-picker/locale/ar',
    'react-day-picker/locale/bg',
    'react-day-picker/locale/cs',
    'react-day-picker/locale/de',
    'react-day-picker/locale/en-US',
    'react-day-picker/locale/es',
    'react-day-picker/locale/fa-IR',
    'react-day-picker/locale/fr',
    'react-day-picker/locale/he',
    'react-day-picker/locale/hr',
    'react-day-picker/locale/hu',
    'react-day-picker/locale/it',
    'react-day-picker/locale/ja',
    'react-day-picker/locale/ko',
    'react-day-picker/locale/nb',
    'react-day-picker/locale/nl',
    'react-day-picker/locale/pl',
    'react-day-picker/locale/pt',
    'react-day-picker/locale/pt-BR',
    'react-day-picker/locale/ro',
    'react-day-picker/locale/ru',
    'react-day-picker/locale/sv',
    'react-day-picker/locale/tr',
    'react-day-picker/locale/uk',
    'react-day-picker/locale/uz',
    'react-day-picker/locale/zh-CN',
    'react-day-picker/locale/zh-TW',
    'strip-literal',
    'strip-literal > js-tokens',
    'tailwind-merge',
    'zod/v3',
];
const browserChannel = process.env.STORYBOOK_BROWSER_CHANNEL === 'chrome' ? 'chrome' : undefined;

const reactSingletonPlugin: Plugin = {
    name: 'storybook:react-singleton',
    enforce: 'post',
    config(config) {
        return {
            optimizeDeps: {
                ...config.optimizeDeps,
                // An interrupted browser run can leave Vite's generated
                // Storybook setup module partially cached. Rebuild it for each
                // isolated quality-gate run instead of reusing stale output.
                force: true,
                include: [
                    ...new Set([...(config.optimizeDeps?.include ?? []), ...browserOptimizeDependencies]),
                ],
            },
            resolve: {
                ...config.resolve,
                dedupe: [...new Set([...(config.resolve?.dedupe ?? []), 'react', 'react-dom'])],
            },
        };
    },
};

patchStorybookTestTransform(storybookPlugins);

export default defineConfig({
    // This is a dedicated config, so the Storybook plugins belong at the root.
    // Vitest 3 does not consistently apply Vite plugins nested in test.projects.
    // Storybook and Vitest currently resolve separate physical Vite type copies
    // under Bun's linker. The runtime plugin contract is the same; keep the
    // compatibility cast at this one boundary instead of spreading `any` through
    // the rest of the configuration.
    plugins: [...dashboardPlugins, react(), ...storybookPlugins, reactSingletonPlugin] as never,
    resolve: {
        dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
        force: true,
        include: browserOptimizeDependencies,
    },
    test: {
        name: 'storybook',
        // GitHub-hosted runners can terminate Chromium when the full Storybook suite opens too
        // many browser workers at once. Keep enough parallelism for speed without exhausting it.
        maxWorkers: process.env.CI ? 2 : undefined,
        exclude: ['**/dist/**', '**/.temp/**', '**/storybook-static/**', '**/node_modules/**'],
        browser: {
            enabled: true,
            headless: true,
            provider: 'playwright',
            instances: [
                {
                    browser: 'chromium',
                    ...(browserChannel && { launch: { channel: browserChannel } }),
                },
            ],
        },
    },
});
