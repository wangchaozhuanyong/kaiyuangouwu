import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command, isPreview }) => ({
    // 本地开发仍使用根路径；生产构建由 Vendure 挂载到 /dashboard/。
    base: command === 'build' || isPreview ? '/dashboard/' : '/',
    plugins: [tailwindcss()],
}));
