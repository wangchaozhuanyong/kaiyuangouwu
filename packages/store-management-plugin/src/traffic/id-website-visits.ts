import { createHmac } from 'node:crypto';

const ingestPath = '/api/id-business-v2/workspace-website-monitor/visits/ingest';
const validHost = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u;
let inFlight = 0;

/** Reuse the consent-gated visit and share only a stable, site-scoped IP token. */
export async function forwardIdWebsiteVisit(
    host: string | undefined,
    ip: string,
    eventId: string,
): Promise<void> {
    const normalizedHost = host?.trim().toLowerCase().split(':')[0];
    const allowedHosts = process.env.ID_WEBSITE_VISIT_HOSTS?.split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
    const destination = process.env.ID_WEBSITE_VISIT_INGEST_URL;
    const secret = process.env.ID_WEBSITE_VISIT_SIGNING_KEY;
    if (
        !normalizedHost ||
        !validHost.test(normalizedHost) ||
        (allowedHosts?.length && !allowedHosts.includes(normalizedHost)) ||
        !destination ||
        !secret ||
        !/^[a-f0-9]{64}$/u.test(secret) ||
        inFlight >= 32
    )
        return;
    if (!URL.canParse(destination)) return;
    const url = new URL(destination);
    if (
        url.protocol !== 'https:' ||
        url.pathname !== ingestPath ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    )
        return;

    const key = Buffer.from(secret, 'hex');
    const ipToken = createHmac('sha256', key)
        .update(JSON.stringify(['ip-v1', normalizedHost, ip]))
        .digest('hex');
    const occurredAt = new Date().toISOString();
    const body = JSON.stringify({ eventId, host: normalizedHost, ipToken, occurredAt });
    const signature = createHmac('sha256', key)
        .update(JSON.stringify([eventId, normalizedHost, ipToken, occurredAt]))
        .digest('hex');
    inFlight++;
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    redirect: 'error',
                    signal: AbortSignal.timeout(3000),
                    headers: { 'Content-Type': 'application/json', 'x-website-visit-signature': signature },
                    body,
                });
                await response.body?.cancel();
                if (response.status < 500) return;
            } catch {
                // Collection is independent of the storefront response.
            }
        }
    } finally {
        inFlight--;
    }
}
