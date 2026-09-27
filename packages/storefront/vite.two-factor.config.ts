import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), 'VITE_TWO_FACTOR_');
    const parents = (env.VITE_TWO_FACTOR_PARENT_ORIGINS || '').split(',').filter(Boolean);
    const origin = env.VITE_TWO_FACTOR_ORIGIN || null;
    if (origin) {
        const url = new URL(origin);
        if (url.protocol !== 'https:' || url.origin !== origin || parents.includes(origin))
            throw new Error('Vault origin must be a separate exact HTTPS origin');
    }
    for (const parent of parents) {
        const url = new URL(parent);
        if (url.protocol !== 'https:' || url.origin !== parent)
            throw new Error('Vault parent origins must be exact HTTPS origins');
    }
    return {
        root: path.resolve(__dirname, 'two-factor-tool'),
        envDir: __dirname,
        plugins: [
            tailwindcss(),
            react(),
            {
                name: 'two-factor-release-config',
                generateBundle() {
                    this.emitFile({
                        type: 'asset',
                        fileName: 'build-config.json',
                        source: JSON.stringify({ version: 1, origin, parents }) + '\n',
                    });
                },
            },
        ],
        build: {
            outDir: path.resolve(__dirname, 'dist-two-factor'),
            emptyOutDir: true,
            target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
        },
    };
});
