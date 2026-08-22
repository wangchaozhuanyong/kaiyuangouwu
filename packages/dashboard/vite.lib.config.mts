import { lingui } from '@lingui/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

import { dashboardBundleExternals } from './vite/lib-externals.js';
import { extractInlinedFontAssetsPlugin } from './vite/vite-plugin-extract-font-assets.js';
import { themeVariablesPlugin } from './vite/vite-plugin-theme.js';

/**
 * Library build config for the spike (#4719) investigating whether
 * `@vendure/dashboard` can ship as a pre-built ESM bundle instead of
 * TypeScript source.
 *
 * This config is NOT used by `build:standalone` (the existing prod-app
 * build) — it produces a single `dist/lib/index.js` ESM bundle suitable
 * for consumer projects to import via `@vendure/dashboard`.
 *
 * Run with: `vite build --config vite.lib.config.mts`
 *
 * Minimal first pass:
 *  - bundle as much as possible
 *  - keep react/react-dom + lingui externals so consumer provides them
 *  - keep `virtual:*` ids unresolved so the consumer's vite plugins
 *    can still inject their runtime values
 */
// Ensure the Lingui CLI uses the dashboard's own config when run from this dir.
process.env.LINGUI_CONFIG = path.resolve(import.meta.dirname, './lingui.config.js');

function dashboardManualChunks(id: string) {
    const normalizedId = id.replace(/\\/g, '/');
    if (
        normalizedId.includes('/packages/dashboard/src/lib/components/data-table/') ||
        normalizedId.includes('/packages/dashboard/src/lib/framework/form-engine/') ||
        normalizedId.includes('/packages/dashboard/src/lib/components/shared/rich-text-editor/')
    ) {
        // These subsystems import one another, so keep them in one coherent
        // application chunk while separating them from the lazy route shell.
        return 'dashboard-framework';
    }
    if (normalizedId.includes('/node_modules/@vendure-io/ui/src/components/ui/chart.')) {
        return 'vendor-charts';
    }
    if (
        normalizedId.includes('/node_modules/@tiptap/') ||
        normalizedId.includes('/node_modules/prosemirror-')
    ) {
        return 'vendor-rich-text';
    }
    if (normalizedId.includes('/node_modules/recharts/') || normalizedId.includes('/node_modules/d3-')) {
        return 'vendor-charts';
    }
    if (normalizedId.includes('/node_modules/react-day-picker/')) {
        return 'vendor-calendar';
    }
    if (
        normalizedId.includes('/node_modules/date-fns/') ||
        normalizedId.includes('/node_modules/@date-fns/')
    ) {
        return 'vendor-date-fns';
    }
    if (normalizedId.includes('/node_modules/lucide-react/')) {
        return 'vendor-icons';
    }
    if (normalizedId.includes('/node_modules/react-resizable-panels/')) {
        return 'vendor-panels';
    }
    if (normalizedId.includes('/node_modules/embla-carousel')) {
        return 'vendor-carousel';
    }
    if (
        normalizedId.includes('/node_modules/cmdk/') ||
        normalizedId.includes('/node_modules/input-otp/') ||
        normalizedId.includes('/node_modules/vaul/')
    ) {
        return 'vendor-controls';
    }
    if (
        normalizedId.includes('/node_modules/graphql/') ||
        normalizedId.includes('/node_modules/gql.tada/') ||
        normalizedId.includes('/node_modules/awesome-graphql-client/')
    ) {
        return 'vendor-graphql';
    }
    if (normalizedId.includes('/node_modules/@base-ui/')) {
        return 'vendor-base-ui';
    }
    if (normalizedId.includes('/node_modules/@vendure-io/ui/')) {
        return 'vendor-vendure-ui';
    }
    if (normalizedId.includes('/node_modules/@tanstack/')) {
        return 'vendor-tanstack';
    }
    if (
        normalizedId.includes('/node_modules/motion/') ||
        normalizedId.includes('/node_modules/framer-motion/')
    ) {
        return 'vendor-motion';
    }
}

export default defineConfig({
    plugins: [
        themeVariablesPlugin({}),
        tailwindcss(),
        react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }),
        lingui(),
        extractInlinedFontAssetsPlugin(),
    ],
    resolve: {
        alias: {
            '@/vdb': path.resolve(import.meta.dirname, './src/lib'),
            '@/graphql': path.resolve(import.meta.dirname, './src/lib/graphql'),
        },
    },
    build: {
        outDir: path.resolve(import.meta.dirname, './dist/bundle'),
        emptyOutDir: true,
        // Skip sourcemaps in the published bundle: they would inflate the
        // npm tarball by ~5-10x with no end-user benefit (sourcemaps are only
        // useful for developers of the dashboard itself, who work from source).
        sourcemap: false,
        minify: false,
        // Keep JavaScript readable for extension debugging, while ensuring the
        // published stylesheet is not penalized by unminified Tailwind output.
        cssMinify: 'esbuild',
        lib: {
            entry: {
                // Library entry — extension authors import from here via `@vendure/dashboard`
                lib: path.resolve(import.meta.dirname, './src/lib/index.ts'),
                // App entry — bootstraps the dashboard UI (used by index.html)
                main: path.resolve(import.meta.dirname, './src/app/main.tsx'),
            },
            formats: ['es'],
            fileName: name => `${name}.js`,
        },
        rollupOptions: {
            // Single source of truth shared with the duplication audit
            // (vite/tests/bundle-singleton.spec.ts). See vite/lib-externals.ts.
            external: dashboardBundleExternals,
            output: {
                // Predictable entry names so index.html can reference them
                entryFileNames: '[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: '[name][extname]',
                manualChunks: dashboardManualChunks,
            },
        },
    },
});
