import { isIP } from 'node:net';

interface StorefrontRequestAddress {
    ip?: string;
    socket?: {
        remoteAddress?: string | null;
    };
}

export function storefrontClientIp(req: StorefrontRequestAddress | undefined): string | null {
    return normalizeIpAddress(req?.ip) ?? normalizeIpAddress(req?.socket?.remoteAddress);
}

function normalizeIpAddress(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    if (!normalized) return null;
    const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
    return isIP(ipv4) ? ipv4.toLowerCase() : null;
}
