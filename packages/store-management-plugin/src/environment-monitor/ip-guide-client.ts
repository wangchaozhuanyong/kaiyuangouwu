import { isIP } from 'node:net';

const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const canonical = (ip: string) => (isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip);

/** Fixed public-IP enrichment endpoint. It never receives browser signals or credentials. */
export async function readIpGuideReport(ip: string): Promise<Record<string, unknown>> {
    if (!isIP(ip)) throw new Error('Invalid lookup address');
    const response = await fetch(`https://ip.guide/${encodeURIComponent(ip)}`, {
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
        typeof data.ip !== 'string' ||
        !isIP(data.ip) ||
        canonical(data.ip) !== canonical(ip) ||
        !record(data.location)
    )
        throw new Error('IP location identity mismatch');
    return data;
}
