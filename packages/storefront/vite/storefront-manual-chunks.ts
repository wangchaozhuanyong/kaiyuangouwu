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
}
