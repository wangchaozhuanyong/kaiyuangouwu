export function storefrontManualChunks(id: string): string | undefined {
    const normalizedId = id.replace(/\\/g, '/');

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
