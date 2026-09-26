import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ command, isPreview }) => ({
    // 本地开发仍使用根路径；生产构建由 Vendure 挂载到 /dashboard/。
    base: command === 'build' || isPreview ? '/dashboard/' : '/',
    plugins: [tailwindcss()],
    resolve: { dedupe: ['react', 'react-dom'] },
    server: {
        host: process.env.HOST || '127.0.0.1',
        port: Number(process.env.PORT) || 5173,
        strictPort: true,
    },
    build: {
        rollupOptions: {
            input: {
                admin: fileURLToPath(new URL('./index.html', import.meta.url)),
                storefrontPreview: fileURLToPath(new URL('./storefront-preview.html', import.meta.url)),
            },
            output: {
                manualChunks: {
                    'react-vendor': ['react', 'react-dom', 'react-router-dom'],
                    'data-vendor': ['@apollo/client', 'graphql'],
                },
            },
        },
    },
}));
