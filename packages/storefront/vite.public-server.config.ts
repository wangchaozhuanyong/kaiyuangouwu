import react from '@vitejs/plugin-react';
import { build, defineConfig } from 'vite';

import mailTool from './vite.mail-query.config';
import addressTool from './vite.tax-free-address.config';

/** Bundle the independent documents into the same immutable storefront artifact. */
const compileStandaloneTools = {
    name: 'build-standalone-tool-companions',
    async closeBundle() {
        await build({ ...addressTool, configFile: false });
        await build({ ...mailTool, configFile: false });
    },
};

export default defineConfig({
    plugins: [react(), compileStandaloneTools],
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
