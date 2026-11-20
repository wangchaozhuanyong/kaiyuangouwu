import react from '@vitejs/plugin-react';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../recharge-tool/', import.meta.url));
const args = process.argv.slice(2);
assert.ok(
    args.length === 0 || (args.length === 1 && args[0] === '--release'),
    'Unknown recharge build option',
);
const output = args.length ? '../dist/.recharge-tool/' : '../dist-recharge-tool/';
const outDir = fileURLToPath(new URL(output, import.meta.url));
const storefrontGallery = fileURLToPath(new URL('../src/storefront-images.ts', import.meta.url));
const omitStorefrontMedia = '\0recharge:unused-storefront-media';

await build({
    root,
    configFile: false,
    publicDir: false,
    envFile: false,
    plugins: [
        react(),
        {
            name: 'standalone-recharge-media',
            enforce: 'pre',
            resolveId(source, importer) {
                // Shared presentation components import a catalog of optional storefront illustrations.
                // Only the service mark belongs to this site's anonymous, independently published bundle.
                if (importer === storefrontGallery && /\.(?:webp|png|jpe?g|svg)(?:\?.*)?$/.test(source))
                    return omitStorefrontMedia;
            },
            load(id) {
                if (id === omitStorefrontMedia) return 'export default "";';
            },
            generateBundle: {
                order: 'post',
                handler(_, bundle) {
                    // Vite also emits assets discovered in dynamic storefront routes that Rollup removes.
                    // Serve only files referenced by this entry's finished HTML, styles or code.
                    const references = Object.values(bundle)
                        .map(file =>
                            file.type === 'chunk'
                                ? file.code
                                : /\.(?:html|css)$/.test(file.fileName)
                                  ? String(file.source)
                                  : '',
                        )
                        .join('\n');
                    for (const [name, file] of Object.entries(bundle)) {
                        if (
                            file.type === 'asset' &&
                            name.startsWith('assets/') &&
                            !references.includes(basename(name))
                        )
                            delete bundle[name];
                    }
                },
            },
        },
    ],
    build: {
        outDir,
        emptyOutDir: true,
        target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
    },
});
