import { LanguageCode } from '@vendure/common/lib/generated-types';
import path from 'path';
import { pathToFileURL } from 'url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.mjs';

import { dashboardManualChunks } from './vite/dashboard-manual-chunks.js';
import { vendureDashboardPlugin } from './vite/vite-plugin-vendure-dashboard.js';

/**
 * This config is used for local development
 */
export default ({ mode }: { mode: string }) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

    const adminApiHost = process.env.VITE_ADMIN_API_HOST ?? 'http://localhost';
    const adminApiPort = process.env.VITE_ADMIN_API_PORT ? +process.env.VITE_ADMIN_API_PORT : 'auto';
    const isDashboardE2e = process.env.VENDURE_DASHBOARD_E2E === 'true';

    process.env.IS_LOCAL_DEV = adminApiHost.includes('localhost') ? 'true' : 'false';

    const vendureConfigPath =
        process.env.VENDURE_CONFIG_PATH ??
        (process.env.VITEST
            ? // This should always be used for running the tests
              './sample-vendure-config.ts'
            : // This one might be changed to '../dev-server/dev-config.ts' to test ui extensions
              './sample-vendure-config.ts');

    const generatedTestExcludes = [
        './e2e/**/*',
        './plugin/**/*',
        './dist/**/*',
        './storybook-static/**/*',
        './.temp/**/*',
        '**/node_modules/**/*',
    ];

    return defineConfig({
        optimizeDeps: {
            include: ['lodash/get', 'lodash/isString', 'lodash/isNaN'],
        },
        test: {
            ...sharedTestConfig,
            globals: true,
            exclude: generatedTestExcludes,
            projects: [
                {
                    extends: true,
                    test: {
                        name: 'dashboard-jsdom',
                        environment: 'jsdom',
                        exclude: [...generatedTestExcludes, './vite/tests/**/*'],
                    },
                },
                {
                    extends: true,
                    test: {
                        name: 'dashboard-vite',
                        environment: 'node',
                        include: ['./vite/tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
                    },
                },
            ],
        },
        plugins: [
            vendureDashboardPlugin({
                vendureConfigPath: pathToFileURL(vendureConfigPath),
                api: { host: adminApiHost, port: adminApiPort },
                i18n: isDashboardE2e
                    ? {
                          defaultLanguage: LanguageCode.en,
                          defaultLocale: 'US',
                          availableLanguages: [LanguageCode.en, LanguageCode.de, LanguageCode.zh_Hans],
                          availableLocales: ['US'],
                      }
                    : undefined,
                tempCompilationDir: path.resolve(__dirname, './.temp'),
                // Opt into the pre-built bundle for the bundle-mode e2e run.
                useExperimentalBundle: process.env.VITE_USE_EXPERIMENTAL_BUNDLE === 'true',
            }) as any,
        ],
        build: {
            chunkSizeWarningLimit: 500,
            rollupOptions: {
                output: {
                    manualChunks: dashboardManualChunks,
                },
            },
        },
    });
};
