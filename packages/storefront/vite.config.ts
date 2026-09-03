import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { storefrontManualChunks } from './vite/storefront-manual-chunks.js';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const apiProxyTarget = env.VITE_SHOP_API_PROXY_TARGET || 'http://127.0.0.1:3000';

    return {
        plugins: [TanStackRouterVite({ target: 'react', autoCodeSplitting: true }), tailwindcss(), react()],
        build: {
            target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
            rollupOptions: {
                output: {
                    manualChunks: storefrontManualChunks,
                },
            },
        },
        server: {
            port: 5175,
            strictPort: true,
            proxy: {
                '/shop-api': apiProxyTarget,
                '/storefront-realtime': apiProxyTarget,
                '/assets': apiProxyTarget,
                '/image-generation': apiProxyTarget,
            },
        },
        preview: {
            strictPort: true,
            proxy: {
                '/shop-api': apiProxyTarget,
                '/storefront-realtime': apiProxyTarget,
                '/assets/preview': apiProxyTarget,
                '/image-generation': apiProxyTarget,
            },
        },
    };
});
