import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const apiProxyTarget = env.VITE_SHOP_API_PROXY_TARGET || 'http://127.0.0.1:3000';

    return {
        plugins: [react()],
        server: {
            port: 5175,
            strictPort: true,
            proxy: {
                '/shop-api': apiProxyTarget,
                '/assets': apiProxyTarget,
            },
        },
        preview: {
            strictPort: true,
            proxy: {
                '/shop-api': apiProxyTarget,
            },
        },
    };
});
