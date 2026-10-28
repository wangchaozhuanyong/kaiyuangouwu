import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

export const compressionModes = ['auto', 'off', 'gzip', 'br'];

export function negotiatedEncoding(acceptEncoding = '', mode = 'auto') {
    if (mode === 'off') return null;
    const weights = new Map(
        String(acceptEncoding)
            .toLowerCase()
            .split(',')
            .map(part => {
                const [name, ...parameters] = part.trim().split(';');
                const qualityParameter = parameters.find(parameter => parameter.trim().startsWith('q='));
                const q = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
                return [name, Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0];
            }),
    );
    const quality = name => weights.get(name) ?? weights.get('*') ?? 0;
    return (
        ['br', 'gzip']
            .filter(name => (mode === 'auto' || mode === name) && quality(name) > 0)
            .sort((a, b) => quality(b) - quality(a))[0] ?? null
    );
}

/** Finite local fixture responses only; never installed on other preview servers or SSE services. */
export function installTextCompression(request, response, mode = 'auto') {
    if (!compressionModes.includes(mode)) throw new Error('Unknown compression mode');
    if (mode === 'off') return;
    const writeHead = response.writeHead.bind(response);
    const end = response.end.bind(response);
    const chunks = [];
    const callbacks = [];
    let ended = false;
    response.writeHead = (status, reason, headers) => {
        response.statusCode = status;
        if (typeof reason === 'string') response.statusMessage = reason;
        else headers = reason;
        if (Array.isArray(headers)) {
            for (let index = 0; index < headers.length; index += 2)
                response.setHeader(headers[index], headers[index + 1]);
        } else for (const [name, value] of Object.entries(headers ?? {})) response.setHeader(name, value);
        return response;
    };
    response.write = (chunk, encoding, callback) => {
        if (ended) throw new Error('Write after local fixture response ended');
        if (typeof encoding === 'function') {
            callback = encoding;
            encoding = undefined;
        }
        if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        if (callback) callbacks.push(callback);
        return true;
    };
    response.end = (chunk, encoding, callback) => {
        if (typeof chunk === 'function') {
            callback = chunk;
            chunk = undefined;
        }
        if (typeof encoding === 'function') {
            callback = encoding;
            encoding = undefined;
        }
        if (chunk != null) response.write(chunk, encoding);
        ended = true;
        let body = Buffer.concat(chunks);
        const type = String(response.getHeader('content-type') ?? '');
        const compressible =
            /^(?:text\/(?:html|css|javascript)|application\/(?:javascript|x-javascript))(?:;|$)/iu.test(type);
        const hasBody = ![204, 304].includes(response.statusCode) && body.length > 0;
        if (compressible && hasBody && !response.hasHeader('content-encoding')) {
            const vary = String(response.getHeader('vary') ?? '')
                .split(',')
                .map(value => value.trim())
                .filter(Boolean);
            if (!vary.some(value => value.toLowerCase() === 'accept-encoding') && !vary.includes('*'))
                vary.push('Accept-Encoding');
            response.setHeader('Vary', vary.join(', '));
            const selectedEncoding = negotiatedEncoding(request.headers['accept-encoding'], mode);
            if (selectedEncoding) {
                body =
                    selectedEncoding === 'br'
                        ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
                        : gzipSync(body);
                response.setHeader('Content-Encoding', selectedEncoding);
                response.setHeader('Content-Length', body.length);
            }
        }
        // Restore before native end invokes implicit headers. Byte length always describes wire bytes.
        response.writeHead = writeHead;
        return end(body, () => {
            for (const done of callbacks) done();
            callback?.();
        });
    };
}
