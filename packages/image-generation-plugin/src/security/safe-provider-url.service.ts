import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set([
    'localhost',
    'localhost.localdomain',
    'metadata.google.internal',
    'metadata.aws.internal',
    '169.254.169.254',
]);

@Injectable()
export class SafeProviderUrlService {
    async validate(rawUrl: string, allowHttp = process.env.NODE_ENV !== 'production'): Promise<URL> {
        let url: URL;
        try {
            url = new URL(rawUrl);
        } catch {
            throw new Error('中转站地址格式无效');
        }
        if (
            (!allowHttp && url.protocol !== 'https:') ||
            (allowHttp && !['http:', 'https:'].includes(url.protocol))
        ) {
            throw new Error('生产环境的中转站地址必须使用 HTTPS');
        }
        if (url.username || url.password || url.hash) throw new Error('中转站地址不能包含账号、密码或片段');
        const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
        if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
            throw new Error('中转站地址不能指向本机或内网');
        }
        const addresses = isIP(hostname)
            ? [{ address: hostname }]
            : await lookup(hostname, { all: true, verbatim: true });
        if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
            throw new Error('中转站地址解析到了本机、内网或云元数据地址');
        }
        return url;
    }

    async resolveRemoteImage(rawUrl: string): Promise<{ url: URL; address: string; family: number }> {
        const url = await this.validate(rawUrl);
        const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
        const allowlist = new Set(
            (process.env.IMAGE_GENERATION_REMOTE_IMAGE_HOSTS ?? '')
                .split(',')
                .map(value => value.trim().toLowerCase().replace(/\.$/u, ''))
                .filter(Boolean),
        );
        if (!allowlist.has(hostname)) {
            throw new Error('中转站远程图片域名不在 IMAGE_GENERATION_REMOTE_IMAGE_HOSTS 白名单中');
        }
        const addresses = isIP(hostname)
            ? [{ address: hostname, family: isIP(hostname) }]
            : await lookup(hostname, { all: true, verbatim: true });
        const selected = addresses.find(item => !isPrivateAddress(item.address));
        if (!selected || addresses.some(item => isPrivateAddress(item.address))) {
            throw new Error('中转站图片地址解析到了本机、内网或云元数据地址');
        }
        return { url, address: selected.address, family: selected.family };
    }

    endpoint(baseUrl: URL, pathname: string): URL {
        const normalizedBase = new URL(baseUrl.toString());
        normalizedBase.pathname = `${normalizedBase.pathname.replace(/\/$/u, '')}/${pathname.replace(/^\//u, '')}`;
        normalizedBase.search = '';
        return normalizedBase;
    }
}

export function isPrivateAddress(address: string): boolean {
    const normalized = address.toLowerCase();
    if (normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:')) return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
    const ipv4 = mapped ?? (isIP(normalized) === 4 ? normalized : undefined);
    if (!ipv4) return false;
    const [a, b] = ipv4.split('.').map(Number);
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 0) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
    );
}
