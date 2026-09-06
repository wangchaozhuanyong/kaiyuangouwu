import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { nestTestAliases, sharedTestConfig } from '../../vitest.shared.mjs';

export default defineConfig({
    resolve: { alias: nestTestAliases },
    test: { ...sharedTestConfig, include: ['src/**/*.spec.ts'] },
    plugins: [swc.vite({ jsc: { transform: { useDefineForClassFields: false } } })],
});
