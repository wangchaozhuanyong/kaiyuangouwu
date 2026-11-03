export function storefrontManualChunks(id: string): string | undefined {
    const normalizedId = id.replace(/\\/g, '/');

    // A shared routing module stays independently cacheable as optional tools grow.
    // Overall initial-resource budgets continue to include this dependency.
    if (normalizedId.endsWith('/packages/storefront/src/storefront-router.ts')) {
        return 'storefront-routing';
    }

    if (
        normalizedId.includes('/node_modules/react/') ||
        normalizedId.includes('/node_modules/react-dom/') ||
        normalizedId.includes('/node_modules/scheduler/')
    ) {
        return 'vendor-react';
    }

    if (normalizedId.includes('/node_modules/@tanstack/')) {
        return 'vendor-tanstack';
    }

    // Keep the existing content sanitizer shared across entry and lazy public pages.
    if (normalizedId.includes('/node_modules/xss/') || normalizedId.includes('/node_modules/cssfilter/')) {
        return 'vendor-content-sanitizer';
    }
}
