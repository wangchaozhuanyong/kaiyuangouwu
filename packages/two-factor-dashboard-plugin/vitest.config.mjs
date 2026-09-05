import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { nestTestAliases, sharedTestConfig } from '../../vitest.shared.mjs';

export default defineConfig({
    resolve: { alias: nestTestAliases },
    test: { ...sharedTestConfig, hookTimeout: 120000, testTimeout: 30000, maxWorkers: 1 },
    plugins: [swc.vite({ jsc: { transform: { useDefineForClassFields: false } } })],
});
