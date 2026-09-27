import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import adminConfig from '../../vite.config';

export default defineConfig(environment =>
    mergeConfig(adminConfig(environment), {
        plugins: [
            {
                name: 'isolated-parity-images',
                configureServer(server) {
                    server.middlewares.use(async (request, response, next) => {
                        const url = new URL(request.url ?? '/', 'http://localhost');
                        if (url.pathname === '/' && url.searchParams.has('parityClient')) {
                            response.setHeader('content-type', 'text/html');
                            response.end(
                                await server.transformIndexHtml(
                                    '/',
                                    '<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/e2e/carousel/reference.tsx"></script></body></html>',
                                ),
                            );
                            return;
                        }
                        if (
                            process.env.PREVIEW_USE_BUILD === '1' &&
                            (url.pathname === '/storefront-preview.html' ||
                                url.pathname.startsWith('/dashboard/assets/'))
                        ) {
                            const relative =
                                url.pathname === '/storefront-preview.html'
                                    ? 'storefront-preview.html'
                                    : url.pathname.slice('/dashboard/'.length);
                            if (relative.includes('..')) return next();
                            try {
                                response.setHeader(
                                    'content-type',
                                    relative.endsWith('.html')
                                        ? 'text/html'
                                        : relative.endsWith('.css')
                                          ? 'text/css'
                                          : 'application/javascript',
                                );
                                response.end(
                                    await readFile(
                                        fileURLToPath(new URL('../../dist/' + relative, import.meta.url)),
                                    ),
                                );
                            } catch (error) {
                                next(error);
                            }
                            return;
                        }
                        next();
                    });
                    server.middlewares.use((request, response, next) => {
                        if (
                            ['/assets/fixture-carousel.svg', '/assets/replacement-carousel.svg'].includes(
                                request.url?.split('?')[0] ?? '',
                            )
                        ) {
                            response.setHeader('content-type', 'image/svg+xml');
                            response.end(
                                `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="520"><rect width="1600" height="520" fill="${request.url?.includes('replacement') ? '#445a78' : '#bccbb5'}"/><rect x="940" y="70" width="340" height="390" rx="24" fill="#eef1e4"/><circle cx="260" cy="160" r="70" fill="#e8c38e"/></svg>`,
                            );
                        } else next();
                    });
                },
            },
        ],
    }),
);
