import type { StorybookConfig } from '@storybook/react-vite';

import { extractJSDocPlugin } from './extract-jsdoc-plugin.js';
import { transformJSDocPlugin } from './transform-jsdoc-plugin.js';

function storybookManualChunks(id: string) {
    const normalizedId = id.replace(/\\/g, '/');
    if (normalizedId.includes('/node_modules/@vendure-io/ui/src/components/ui/chart.')) {
        return 'vendor-charts';
    }
    if (normalizedId.includes('/node_modules/@tiptap/') || normalizedId.includes('/node_modules/prosemirror-')) {
        return 'vendor-rich-text';
    }
    if (normalizedId.includes('/node_modules/recharts/') || normalizedId.includes('/node_modules/d3-')) {
        return 'vendor-charts';
    }
    if (
        normalizedId.includes('/node_modules/@base-ui/') ||
        normalizedId.includes('/node_modules/@vendure-io/ui/')
    ) {
        return 'vendor-ui';
    }
    if (normalizedId.includes('/node_modules/@tanstack/')) {
        return 'vendor-tanstack';
    }
    if (
        normalizedId.includes('/node_modules/graphql/') ||
        normalizedId.includes('/node_modules/gql.tada/') ||
        normalizedId.includes('/node_modules/awesome-graphql-client/')
    ) {
        return 'vendor-graphql';
    }
    if (normalizedId.includes('/node_modules/@lingui/')) {
        return 'vendor-i18n';
    }
    if (normalizedId.includes('/node_modules/motion/') || normalizedId.includes('/node_modules/framer-motion/')) {
        return 'vendor-motion';
    }
}

const config: StorybookConfig = {
    stories: ['./stories/Intro.mdx', './stories/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
    staticDirs: ['./assets'],
    addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
    framework: {
        name: '@storybook/react-vite',
        options: {},
    },
    core: {
        builder: '@storybook/builder-vite',
    },
    typescript: {
        // The TypeScript-based extractor cannot analyze the external @vendure-io/ui
        // source files because they are intentionally outside this package's TS project.
        reactDocgen: 'react-docgen',
    },
    async viteFinal(config) {
        return {
            ...config,
            build: {
                ...config.build,
                // Split the largest optional frameworks instead of hiding their size
                // behind a multi-megabyte warning threshold. A post-build script owns
                // the hard raw/gzip budgets used by CI.
                chunkSizeWarningLimit: 1_850,
                rollupOptions: {
                    ...config.build?.rollupOptions,
                    output: {
                        ...(Array.isArray(config.build?.rollupOptions?.output)
                            ? {}
                            : config.build?.rollupOptions?.output),
                        manualChunks: storybookManualChunks,
                    },
                },
            },
            plugins: [
                // Extract JSDoc descriptions from component files and inline into story metadata
                // Must run before other plugins to process withDescription() calls
                extractJSDocPlugin(),
                // Transform JSDoc in component files to remove custom tags (@description, @docsCategory, etc.)
                // for cleaner display in Storybook's auto-generated prop tables
                transformJSDocPlugin(),
                // Storybook already loads this package's Vite config, including the Vendure
                // plugin chain. Reuse it so config loading and translation assets run once.
                ...(config.plugins ?? []),
            ],
        };
    },
};
export default config;
