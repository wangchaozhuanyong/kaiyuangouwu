import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['migrations/**/*.spec.ts', 'runtime-admin-credentials.spec.ts'],
        environment: 'node',
    },
});
