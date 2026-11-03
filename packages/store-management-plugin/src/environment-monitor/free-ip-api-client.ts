import { isIP } from 'node:net';

const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const canonical = (ip: string) => (isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip);

/** Fixed geolocation vendor. Match the queried IP before using postal/location or proxy fields. */
export async function readFreeIpApiReport(ip: string): Promise<Record<string, unknown>> {
    if (!isIP(ip)) throw new Error('Invalid lookup address');
    const response = await fetch(`https://free.freeipapi.com/api/v1/json/${encodeURIComponent(ip)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4_000),
        redirect: 'error',
    });
    if (!response.ok) throw new Error('IP location unavailable');
    const body = await response.text();
    if (body.length > 64_000) throw new Error('Invalid IP location response');
    const data: unknown = JSON.parse(body);
    if (
        !record(data) ||
        typeof data.ipAddress !== 'string' ||
        !isIP(data.ipAddress) ||
        canonical(data.ipAddress) !== canonical(ip) ||
        data.ipVersion !== isIP(ip)
    )
        throw new Error('IP location identity mismatch');
    return data;
}
