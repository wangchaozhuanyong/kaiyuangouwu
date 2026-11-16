import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
    root: fileURLToPath(new URL('./mail-query-tool', import.meta.url)),
    publicDir: false,
    plugins: [react()],
    build: {
        outDir: fileURLToPath(new URL('./dist/.mail-tool', import.meta.url)),
        emptyOutDir: true,
        target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
    },
});
