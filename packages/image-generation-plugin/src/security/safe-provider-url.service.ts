import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export interface PinnedProviderUrl {
    url: URL;
    address: string;
    family: number;
}

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
        return (await this.resolveForRequest(rawUrl, allowHttp)).url;
    }

    async resolveForRequest(
        rawUrl: string,
        allowHttp = process.env.NODE_ENV !== 'production',
    ): Promise<PinnedProviderUrl> {
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
        const hostname = url.hostname
            .toLowerCase()
            .replace(/\.$/u, '')
            .replace(/^\[|\]$/gu, '');
        if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
            throw new Error('中转站地址不能指向本机或内网');
        }
        const addresses = isIP(hostname)
            ? [{ address: hostname, family: isIP(hostname) }]
            : await lookup(hostname, { all: true, verbatim: true });
        if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
            throw new Error('中转站地址解析到了本机、内网或云元数据地址');
        }
        return { url, address: addresses[0].address, family: addresses[0].family };
    }

    async resolveRemoteImage(rawUrl: string): Promise<{ url: URL; address: string; family: number }> {
        const target = await this.resolveForRequest(rawUrl);
        const { url } = target;
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
        return target;
    }

    endpoint(baseUrl: URL, pathname: string): URL {
        const normalizedBase = new URL(baseUrl.toString());
        normalizedBase.pathname = `${normalizedBase.pathname.replace(/\/$/u, '')}/${pathname.replace(/^\//u, '')}`;
        normalizedBase.search = '';
        return normalizedBase;
    }
}

const privateAddresses = new BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['127.0.0.0', 8],
    ['100.64.0.0', 10],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 16],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 3],
] as const)
    privateAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
    ['::', 96],
    ['fe80::', 10],
    ['fc00::', 7],
    ['ff00::', 8],
] as const)
    privateAddresses.addSubnet(address, prefix, 'ipv6');

export function isPrivateAddress(address: string): boolean {
    const family = isIP(address);
    // BlockList also checks IPv4-mapped IPv6 against the IPv4 subnets.
    return !family || privateAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
