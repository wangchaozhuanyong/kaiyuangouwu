import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['migrations/**/*.spec.ts'],
        environment: 'node',
    },
});
