import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['email-templates.spec.ts', 'migrations/**/*.spec.ts', 'runtime-admin-credentials.spec.ts'],
        environment: 'node',
    },
});
