import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const apiProxyTarget = env.VITE_SHOP_API_PROXY_TARGET || 'http://127.0.0.1:3000';
    const apiProxy = { target: apiProxyTarget, changeOrigin: true };

    return {
        plugins: [TanStackRouterVite({ target: 'react', autoCodeSplitting: true }), tailwindcss(), react()],
        build: {
            target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
        },
        server: {
            port: 5175,
            strictPort: true,
            proxy: {
                '/shop-api': apiProxy,
                '/storefront-realtime': apiProxy,
                '/assets': apiProxy,
                '/image-generation': apiProxy,
            },
        },
        preview: {
            strictPort: true,
            proxy: {
                '/shop-api': apiProxy,
                '/storefront-realtime': apiProxy,
                '/image-generation': apiProxy,
            },
        },
    };
});
