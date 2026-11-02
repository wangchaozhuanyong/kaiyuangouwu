import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

/** Bound both transfer bytes and expanded bytes; never parse compressed bytes as text. */
export function decodeSourceResponse(bytes: Buffer, encoding: unknown, limit: number): Buffer {
    if (bytes.length > limit) throw new Error('来源响应超过大小限制');
    const kind = (typeof encoding === 'string' ? encoding : '').trim().toLowerCase();
    if (!bytes.length || !kind || kind === 'identity') return bytes;
    try {
        if (kind === 'gzip' || kind === 'x-gzip') return gunzipSync(bytes, { maxOutputLength: limit });
        if (kind === 'br') return brotliDecompressSync(bytes, { maxOutputLength: limit });
        if (kind === 'deflate') return inflateSync(bytes, { maxOutputLength: limit });
    } catch {
        throw new Error('来源压缩内容无效或解压后过大');
    }
    throw new Error('来源使用了不支持的压缩方式');
}
