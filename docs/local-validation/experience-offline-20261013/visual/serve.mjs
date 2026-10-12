import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../../../../packages/storefront', import.meta.url));
const server = await createServer({
    configFile: false,
    root,
    plugins: [tailwindcss(), react()],
    resolve: { dedupe: ['react', 'react-dom'] },
    server: {
        host: '127.0.0.1',
        port: 5296,
        strictPort: true,
        fs: { allow: [fileURLToPath(new URL('../../../..', import.meta.url))] },
    },
});
await server.listen();
server.printUrls();
