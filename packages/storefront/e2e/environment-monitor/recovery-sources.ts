/** Test-only vendor replacement. Every response is synthetic; unexpected URLs never reach the network. */
export function installRecoverySources() {
    let sourceCalls = 0;
    let proxyAttempts = 0;
    const ip = '8.8.8.8';
    const json = (body: unknown) => new Response(JSON.stringify(body));
    globalThis.fetch = (input, options) => {
        sourceCalls++;
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        if (url === 'https://ip-db.com/mcp') {
            if (typeof options?.body !== 'string')
                return Promise.reject(new Error('Expected JSON request body'));
            const body = JSON.parse(options.body);
            if (body.method === 'initialize')
                return Promise.resolve(json({ result: { protocolVersion: '2025-03-26' } }));
            if (body.method === 'notifications/initialized')
                return Promise.resolve(new Response(null, { status: 202 }));
            if (body.method !== 'tools/call' || body.params?.arguments?.ip !== ip)
                return Promise.reject(new Error('Unexpected synthetic MCP request'));
            return Promise.resolve(
                json({
                    result: {
                        structuredContent: {
                            ip,
                            score: 0,
                            country_code: 'MY',
                            network_type: 'residential',
                            organization: '模拟网络运营商',
                            asn: 64500,
                        },
                    },
                }),
            );
        }
        if (url === `https://ip.guide/${ip}`)
            return Promise.resolve(
                json({
                    ip,
                    location: {
                        country: 'Malaysia',
                        city: '模拟城市',
                        timezone: 'Asia/Kuala_Lumpur',
                        latitude: 3.139,
                        longitude: 101.687,
                    },
                }),
            );
        if (url === `https://ipwho.is/${ip}`)
            return Promise.resolve(
                json({
                    success: true,
                    ip,
                    postal: '00001',
                    country: 'Malaysia',
                    country_code: 'MY',
                    city: '模拟城市',
                    region: '模拟地区',
                    timezone: { id: 'Asia/Kuala_Lumpur' },
                    latitude: 3.139,
                    longitude: 101.687,
                }),
            );
        if (url === `https://free.freeipapi.com/api/v1/json/${ip}`) {
            if (++proxyAttempts === 1) return Promise.reject(new Error('Synthetic first-query proxy outage'));
            return Promise.resolve(json({ ipAddress: ip, ipVersion: 4, zipCode: '00001', isProxy: false }));
        }
        return Promise.reject(new Error('Unexpected synthetic source URL'));
    };
    return () => ({ mode: 'controlled-recovery', sourceCalls, proxyAttempts });
}
