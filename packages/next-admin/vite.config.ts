import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command, isPreview }) => ({
    // 本地开发仍使用根路径；生产构建由 Vendure 挂载到 /dashboard/。
    base: command === 'build' || isPreview ? '/dashboard/' : '/',
    plugins: [tailwindcss()],
    server: {
        host: process.env.HOST || '127.0.0.1',
        port: Number(process.env.PORT) || 5173,
        strictPort: true,
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    'react-vendor': ['react', 'react-dom', 'react-router-dom'],
                    'data-vendor': ['@apollo/client', 'graphql'],
                    'lucide-icons': ['lucide-react'],
                },
            },
        },
    },
}));
