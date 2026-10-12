import { defineConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.mts';

export default defineConfig({
    // Lerna already schedules package suites in parallel. Match the shared CI
    // worker limit so SQL timing does not compete with this package's other files.
    test: sharedTestConfig,
});
