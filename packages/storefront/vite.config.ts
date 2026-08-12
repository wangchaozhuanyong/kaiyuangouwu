import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5175,
        strictPort: false,
        proxy: {
            '/shop-api': 'http://127.0.0.1:3002',
            '/assets': 'http://127.0.0.1:3002',
        },
    },
});
