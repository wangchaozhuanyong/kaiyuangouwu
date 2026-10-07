import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

import { storefrontManualChunks } from './vite/storefront-manual-chunks.js';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const apiProxyTarget = env.VITE_SHOP_API_PROXY_TARGET || 'http://127.0.0.1:3000';

    return {
        plugins: [
            {
                name: 'public-page-early-entry',
                buildStart() {
                    if (mode !== 'test')
                        this.emitFile({
                            type: 'chunk',
                            id: fileURLToPath(new URL('./src/public-page-bootstrap.ts', import.meta.url)),
                            name: 'public-page-bootstrap',
                        });
                },
                transformIndexHtml: {
                    order: 'post',
                    handler(_html, context) {
                        const chunk = Object.values(context.bundle ?? {}).find(
                            item => item.type === 'chunk' && item.name === 'public-page-bootstrap',
                        );
                        return [
                            {
                                tag: 'script',
                                attrs: {
                                    type: 'module',
                                    async: true,
                                    src: chunk ? '/' + chunk.fileName : '/src/public-page-bootstrap.ts',
                                },
                                injectTo: 'head',
                            },
                        ];
                    },
                },
            },
            TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
            tailwindcss(),
            react(),
        ],
        resolve: {
            dedupe: ['react', 'react-dom'],
        },
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
                '/_storefront/page-data': {
                    target: apiProxyTarget,
                    rewrite: path => path.replace('/_storefront/', '/storefront/'),
                },
                '/storefront-realtime': apiProxyTarget,
                '/assets': apiProxyTarget,
                '/image-generation': apiProxyTarget,
                '/after-sales/evidence': apiProxyTarget,
                '/digital-delivery': apiProxyTarget,
            },
        },
        preview: {
            strictPort: true,
            proxy: {
                '/shop-api': apiProxyTarget,
                '/_storefront/page-data': {
                    target: apiProxyTarget,
                    rewrite: path => path.replace('/_storefront/', '/storefront/'),
                },
                '/storefront-realtime': apiProxyTarget,
                '/assets/preview': apiProxyTarget,
                '/image-generation': apiProxyTarget,
                '/after-sales/evidence': apiProxyTarget,
                '/digital-delivery': apiProxyTarget,
            },
        },
    };
});
