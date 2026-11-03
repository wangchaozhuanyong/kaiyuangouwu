export interface BrowserNetworkAddresses {
    ipv4: string | null;
    ipv6: string | null;
}

const ipv4 = (value: string) =>
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) &&
    value.split('.').every(part => String(Number(part)) === part && Number(part) <= 255);
const ipv6 = (value: string) => {
    if (!value.includes(':') || !/^[\da-f:]+$/i.test(value)) return false;
    try {
        return new URL(`https://[${value}]/`).hostname.startsWith('[');
    } catch {
        return false;
    }
};

/** Observe the browser's egress, never the API server's. Manual runs only; no cookies or fingerprint. */
export async function readBrowserNetworkAddresses(signal?: AbortSignal): Promise<BrowserNetworkAddresses> {
    if (typeof window === 'undefined') return { ipv4: null, ipv6: null };
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(3_500);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const read = async (url: string): Promise<string | null> => {
        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: requestSignal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
            redirect: 'error',
        });
        if (!response.ok) throw new Error('Public IP observation unavailable');
        const body = await response.text();
        if (body.length > 512) throw new Error('Invalid public IP response');
        const data: unknown = JSON.parse(body);
        const value = data && typeof data === 'object' && 'ip' in data ? data.ip : null;
        return typeof value === 'string' && (ipv4(value) || ipv6(value)) ? value : null;
    };
    const [v4, dual] = await Promise.allSettled([
        read('https://api.ipify.org?format=json'),
        read('https://api64.ipify.org?format=json'),
    ]);
    signal?.throwIfAborted();
    const v4Value = v4.status === 'fulfilled' ? v4.value : null;
    const dualValue = dual.status === 'fulfilled' ? dual.value : null;
    return {
        ipv4: v4Value && ipv4(v4Value) ? v4Value : dualValue && ipv4(dualValue) ? dualValue : null,
        ipv6: dualValue && ipv6(dualValue) ? dualValue : null,
    };
}
