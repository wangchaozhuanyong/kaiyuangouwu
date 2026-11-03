import { isIP } from 'node:net';

const endpoint = 'https://ip-db.com/mcp';
const protocolVersion = '2025-03-26';
const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const canonicalIp = (ip: string) => (isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip);

/** Fixed read-only, keyless MCP tool documented by IP-DB. No generic tools, hostnames or URLs accepted. */
export async function readIpDbReport(ip: string): Promise<Record<string, unknown>> {
    if (!isIP(ip)) throw new Error('Invalid lookup address');
    const signal = AbortSignal.timeout(5_000);
    const send = async (body: Record<string, unknown>, notification = false) => {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                'MCP-Protocol-Version': protocolVersion,
            },
            body: JSON.stringify({ jsonrpc: '2.0', ...body }),
            signal,
            redirect: 'error',
        });
        if (!response.ok) throw new Error('IP data service unavailable');
        if (notification) return undefined;
        const data: unknown = await response.json();
        if (!object(data) || data.error || !object(data.result)) throw new Error('Invalid IP data response');
        return data.result;
    };
    const initialization = await send({
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion,
            capabilities: {},
            clientInfo: { name: 'environment-monitor', version: '1.0.0' },
        },
    });
    if (initialization?.protocolVersion !== protocolVersion) throw new Error('Unsupported IP data protocol');
    await send({ method: 'notifications/initialized' }, true);
    const result = await send({
        id: 2,
        method: 'tools/call',
        params: { name: 'check_ip', arguments: { ip } },
    });
    // Treat free-form tool text and remote instructions as untrusted data. Use only structured fields.
    if (result?.isError || !object(result?.structuredContent)) throw new Error('IP lookup failed');
    const report = result.structuredContent;
    if (typeof report.ip !== 'string' || !isIP(report.ip) || canonicalIp(report.ip) !== canonicalIp(ip))
        throw new Error('IP lookup identity mismatch');
    return report;
}
