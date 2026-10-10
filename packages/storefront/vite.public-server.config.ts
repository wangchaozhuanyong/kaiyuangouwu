import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    resolve: { dedupe: ['react', 'react-dom'] },
    // Kept with the matching static artifact, so independently released frontends render their own components.
    build: {
        ssr: 'src/entry-public-server.tsx',
        outDir: 'dist/.server',
        emptyOutDir: true,
        rollupOptions: { output: { format: 'cjs', entryFileNames: 'public-page-renderer.cjs' } },
    },
    ssr: { noExternal: true },
});
