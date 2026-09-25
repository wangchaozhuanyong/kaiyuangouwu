import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: [
            'email-templates.spec.ts',
            'customer-image-config.spec.ts',
            'order-confirmation-email.spec.ts',
            'migrations/**/*.spec.ts',
            'runtime-admin-credentials.spec.ts',
            'storefront-*-authentication-strategy.spec.ts',
        ],
        environment: 'node',
    },
});
