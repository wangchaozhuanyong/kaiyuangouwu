import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { processCustomerImage } from './process-customer-image';

afterEach(() => vi.unstubAllEnvs());
describe('customer image processor boundary', () => {
    it('does not decode inside the commerce process when production processor is missing', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('CUSTOMER_IMAGE_PROCESSOR_SOCKET', '');
        await expect(processCustomerImage(Buffer.from('synthetic'), 'avatar')).rejects.toThrow('服务未配置');
    });
    it('does not fall back when the processor is unavailable', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('CUSTOMER_IMAGE_PROCESSOR_SOCKET', '/nonexistent-vendure-socket');
        const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
            .png()
            .toBuffer();
        await expect(processCustomerImage(bytes, 'avatar')).rejects.toThrow('安全检查未通过');
    });
    it('rejects a response for different input bytes', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'vp-'));
        const socket = path.join(root, 's');
        const server = createServer((request, response) => {
            request.resume();
            response.writeHead(200, { 'X-Input-SHA256': 'wrong', 'Content-Length': 1 }).end('x');
        });
        server.listen(socket);
        await once(server, 'listening');
        vi.stubEnv('CUSTOMER_IMAGE_PROCESSOR_SOCKET', socket);
        try {
            await expect(processCustomerImage(Buffer.from('synthetic'), 'avatar')).rejects.toThrow(
                '安全检查未通过',
            );
        } finally {
            server.close();
            await once(server, 'close');
            await rm(root, { recursive: true, force: true });
        }
    });
});
