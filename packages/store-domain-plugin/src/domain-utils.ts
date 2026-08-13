import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

const DOMAIN_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export function normalizeDomain(input: string): string {
    let value = input.trim().toLowerCase();
    if (!value) {
        throw new Error('请输入域名');
    }

    if (value.includes('://')) {
        let parsed: URL;
        try {
            parsed = new URL(value);
        } catch {
            throw new Error('域名格式不正确');
        }
        if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
            throw new Error('只填写域名，不要包含路径、参数或账号信息');
        }
        value = parsed.hostname;
    } else {
        value = value.replace(/\.$/, '');
        if (value.startsWith('[') || value.includes('/') || value.includes('?') || value.includes('#')) {
            throw new Error('只填写域名，不要包含路径或参数');
        }
        const portSeparator = value.lastIndexOf(':');
        if (portSeparator > -1) {
            const possiblePort = value.slice(portSeparator + 1);
            if (/^\d+$/.test(possiblePort)) {
                value = value.slice(0, portSeparator);
            }
        }
    }

    const asciiDomain = domainToASCII(value).replace(/\.$/, '');
    if (
        !asciiDomain ||
        asciiDomain.length > 253 ||
        asciiDomain === 'localhost' ||
        asciiDomain.endsWith('.localhost') ||
        isIP(asciiDomain) !== 0 ||
        !asciiDomain.includes('.') ||
        asciiDomain.split('.').some(label => !DOMAIN_LABEL.test(label))
    ) {
        throw new Error('请输入可公开解析的完整域名，例如 shop.example.com');
    }
    return asciiDomain;
}

export function normalizeRequestHost(input: string | undefined): string | undefined {
    if (!input) {
        return;
    }
    const firstHost = input.split(',')[0]?.trim().toLowerCase();
    if (!firstHost) {
        return;
    }
    try {
        const parsed = new URL(`http://${firstHost}`);
        const asciiDomain = domainToASCII(parsed.hostname).replace(/\.$/, '');
        return asciiDomain || undefined;
    } catch {
        return;
    }
}

export function verificationRecordName(domain: string): string {
    return `_vendure-domain-challenge.${domain}`;
}

export function verificationRecordValue(token: string): string {
    return `vendure-domain-verification=${token}`;
}
