import react from '@vitejs/plugin-react';
import { build, defineConfig } from 'vite';

import addressTool from './vite.tax-free-address.config';

/** Bundle the independent document into the same immutable storefront artifact. */
const compileAddressTool = {
    name: 'build-address-tool-companion',
    async closeBundle() {
        await build({ ...addressTool, configFile: false });
    },
};

export default defineConfig({
    plugins: [react(), compileAddressTool],
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
