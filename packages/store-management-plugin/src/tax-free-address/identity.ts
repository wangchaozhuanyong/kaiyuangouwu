import type { Request } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const COOKIE = '__Host-tax_address_browser';
const YEAR = 365 * 24 * 60 * 60;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export const validRequestId = (value: unknown): value is string =>
    typeof value === 'string' && uuid.test(value);
const sign = (body: string, secret: string) =>
    createHmac('sha256', secret)
        .update('tax-address-browser:v1:' + body)
        .digest('hex');

/** Dedicated signed HttpOnly identity; never trusts a caller-supplied localStorage ID. */
export function browserIdentity(
    req: Pick<Request, 'headers' | 'res'>,
    secret: string,
    create = false,
    now = Date.now(),
): string {
    if (!secret || secret.length < 16) throw new AddressToolError('UNAVAILABLE');
    const cookies = req.headers.cookie ?? '';
    const value = cookies
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(COOKIE + '='))
        ?.slice(COOKIE.length + 1);
    if (value && value.length < 200) {
        const [id, expiry, signature, extra] = value.split('.');
        const body = id + '.' + expiry;
        const expected = sign(body, secret);
        if (
            !extra &&
            uuid.test(id) &&
            /^\d{13}$/.test(expiry) &&
            Number(expiry) > now &&
            /^[a-f0-9]{64}$/.test(signature ?? '') &&
            timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        )
            return id;
    }
    if (!create) throw new AddressToolError('BROWSER_REQUIRED');
    const newId = randomUUID();
    const newBody = newId + '.' + (now + YEAR * 1000);
    if (!req.res) throw new AddressToolError('UNAVAILABLE');
    req.res.setHeader(
        'Set-Cookie',
        `${COOKIE}=${newBody}.${sign(newBody, secret)}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Strict; Secure`,
    );
    return newId;
}

export class AddressToolError extends Error {
    constructor(readonly code: string) {
        super('TAX_ADDRESS_' + code);
    }
}
