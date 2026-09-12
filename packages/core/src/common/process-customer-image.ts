import { createHash } from 'node:crypto';
import { request } from 'node:http';
import path from 'node:path';

import { UserInputError } from './error/errors';
import { CUSTOMER_IMAGE_LIMITS, CustomerImageKind, normalizeCustomerImage } from './normalize-customer-image';

let inFlight = 0;
const MAX_IN_FLIGHT = 4;

/** Production never falls back to decoding uploads inside the commerce process. */
export async function processCustomerImage(bytes: Buffer, kind: CustomerImageKind): Promise<Buffer> {
    const limit = CUSTOMER_IMAGE_LIMITS[kind];
    if (!limit || !bytes.length || bytes.length > limit.bytes)
        throw new UserInputError('图片为空或超过容量限制');
    const socketPath = process.env.CUSTOMER_IMAGE_PROCESSOR_SOCKET;
    if (!socketPath && process.env.NODE_ENV === 'production') {
        throw new UserInputError('图片安全处理服务未配置，请联系管理员');
    }
    if (socketPath && !path.isAbsolute(socketPath))
        throw new Error('Image processor socket must be absolute');
    if (inFlight >= MAX_IN_FLIGHT) throw new UserInputError('图片处理繁忙，请稍后重试');
    inFlight++;
    try {
        if (!socketPath) return await normalizeCustomerImage(bytes, kind);
        return await processOverSocket(socketPath, bytes, kind);
    } catch {
        throw new UserInputError('图片安全检查未通过或处理服务暂不可用，请稍后重试');
    } finally {
        inFlight--;
    }
}

function processOverSocket(socketPath: string, bytes: Buffer, kind: CustomerImageKind): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const inputDigest = createHash('sha256').update(bytes).digest('hex');
        const req = request(
            {
                socketPath,
                method: 'POST',
                path: `/normalize/${kind}`,
                agent: false,
                headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length },
            },
            response => {
                if (response.statusCode !== 200 || response.headers['x-input-sha256'] !== inputDigest) {
                    reject(new Error('IMAGE_REJECTED'));
                    response.destroy();
                    req.destroy();
                    return;
                }
                let size = 0;
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > CUSTOMER_IMAGE_LIMITS[kind].bytes) {
                        reject(new Error('IMAGE_SIZE'));
                        req.destroy();
                        response.destroy();
                    } else chunks.push(chunk);
                });
                response.on('error', reject);
                response.on('aborted', () => reject(new Error('IMAGE_TRUNCATED')));
                response.on('end', () => {
                    if (!size || size !== Number(response.headers['content-length']))
                        reject(new Error('IMAGE_TRUNCATED'));
                    else resolve(Buffer.concat(chunks));
                });
            },
        );
        const deadline = setTimeout(() => {
            reject(new Error('IMAGE_TIMEOUT'));
            req.destroy();
        }, 30_000);
        req.on('close', () => clearTimeout(deadline));
        req.on('error', reject);
        req.end(bytes);
    });
}
