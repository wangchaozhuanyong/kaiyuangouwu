import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Plugin } from 'vite';

const inlinedWoff2Pattern = /url\((?:['"])?data:font\/woff2;base64,([A-Za-z0-9+/=]+)(?:['"])?\)/g;

/**
 * Vite always inlines assets in library mode. That turns every unicode font
 * subset into part of the eagerly downloaded dashboard stylesheet. Extract
 * WOFF2 payloads after bundling so browsers can request only the subsets used
 * by the current locale.
 */
export function extractInlinedFontAssetsPlugin(): Plugin {
    return {
        name: 'vendure:extract-inlined-font-assets',
        apply: 'build',
        enforce: 'post',
        generateBundle(_outputOptions, bundle) {
            const emittedFonts = new Map<string, string>();

            for (const output of Object.values(bundle)) {
                if (output.type !== 'asset' || !output.fileName.endsWith('.css')) {
                    continue;
                }

                const source =
                    typeof output.source === 'string'
                        ? output.source
                        : Buffer.from(output.source).toString('utf8');

                output.source = source.replace(inlinedWoff2Pattern, (_match, base64: string) => {
                    const font = Buffer.from(base64, 'base64');
                    const digest = createHash('sha256').update(font).digest('hex').slice(0, 12);
                    const fileName = `assets/fonts/dashboard-font-${digest}.woff2`;

                    if (!emittedFonts.has(digest)) {
                        this.emitFile({
                            type: 'asset',
                            fileName,
                            source: font,
                        });
                        emittedFonts.set(digest, fileName);
                    }

                    const relativePath = path.posix.relative(path.posix.dirname(output.fileName), fileName);
                    const cssUrl = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
                    return `url(${cssUrl})`;
                });
            }
        },
    };
}
