import { createHmac, timingSafeEqual } from 'node:crypto';

import { storefrontClientIp } from './storefront-client-ip';

export const STOREFRONT_VISITOR_COOKIE = 'storefront_visitor';

const VISITOR_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const AUTOMATED_USER_AGENT_PARTS = [
    'bot',
    'crawler',
    'spider',
    'slurp',
    'headlesschrome',
    'lighthouse',
    'pagespeed',
    'pingdom',
    'uptimerobot',
    'statuscake',
    'curl',
    'wget',
    'python-requests',
    'go-http-client',
    'facebookexternalhit',
    'whatsapp',
    'telegrambot',
    'discordbot',
];
const AUTOMATED_USER_AGENT = new RegExp(`(?:${AUTOMATED_USER_AGENT_PARTS.join('|')})`, 'iu');

interface StorefrontVisitorRequest {
    headers?: Record<string, string | string[] | undefined>;
    ip?: string;
    secure?: boolean;
    socket?: {
        remoteAddress?: string | null;
    };
}

interface VisitorCookiePayload {
    v: 1;
    id: string;
    channelId: string;
    exp: number;
}

export interface StorefrontVisitorIdentity {
    kind: 'DEVICE' | 'FINGERPRINT';
    keyMaterial: string;
    visitorId: string | null;
    clientIp: string | null;
    setCookie: string | null;
}

export function resolveStorefrontVisitorIdentity(input: {
    req: StorefrontVisitorRequest | undefined;
    channelId: string;
    visitorId?: string | null;
    signingSecret: string;
    now?: number;
}): StorefrontVisitorIdentity | null {
    const { req, channelId, signingSecret } = input;
    if (isLikelyAutomatedStorefrontRequest(req)) return null;

    const now = input.now ?? Date.now();
    const cookieVisitorId = readSignedVisitorCookie(req, channelId, signingSecret, now);
    const clientVisitorId = normalizeStorefrontVisitorId(input.visitorId);
    const visitorId = cookieVisitorId ?? clientVisitorId;
    const clientIp = storefrontClientIp(req);

    if (visitorId) {
        return {
            kind: 'DEVICE',
            keyMaterial: `device:${visitorId}`,
            visitorId,
            clientIp,
            setCookie: cookieVisitorId
                ? null
                : createVisitorCookie(req, visitorId, channelId, signingSecret, now),
        };
    }

    const fingerprint = storefrontFallbackFingerprint(req, clientIp);
    return fingerprint
        ? {
              kind: 'FINGERPRINT',
              keyMaterial: `fingerprint:${fingerprint}`,
              visitorId: null,
              clientIp,
              setCookie: null,
          }
        : null;
}

export function normalizeStorefrontVisitorId(value?: string | null): string | null {
    const normalized = (value ?? '').trim();
    return /^[A-Za-z0-9_-]{16,128}$/.test(normalized) ? normalized : null;
}

export function isLikelyAutomatedStorefrontRequest(req: StorefrontVisitorRequest | undefined): boolean {
    const userAgent = requestHeader(req, 'user-agent');
    return !userAgent || AUTOMATED_USER_AGENT.test(userAgent);
}

function storefrontFallbackFingerprint(
    req: StorefrontVisitorRequest | undefined,
    clientIp: string | null,
): string | null {
    if (!clientIp) return null;
    const userAgent = requestHeader(req, 'user-agent');
    if (!userAgent) return null;
    return [
        clientIp,
        userAgent.slice(0, 512),
        requestHeader(req, 'sec-ch-ua').slice(0, 256),
        requestHeader(req, 'sec-ch-ua-mobile').slice(0, 32),
        requestHeader(req, 'sec-ch-ua-platform').slice(0, 64),
    ].join('|');
}

function createVisitorCookie(
    req: StorefrontVisitorRequest | undefined,
    visitorId: string,
    channelId: string,
    signingSecret: string,
    now: number,
): string {
    const payload: VisitorCookiePayload = {
        v: 1,
        id: visitorId,
        channelId,
        exp: now + VISITOR_COOKIE_MAX_AGE_SECONDS * 1_000,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = sign(encoded, signingSecret);
    const secure = requestIsSecure(req) ? '; Secure' : '';
    return `${STOREFRONT_VISITOR_COOKIE}=${encoded}.${signature}; Path=/; Max-Age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

function readSignedVisitorCookie(
    req: StorefrontVisitorRequest | undefined,
    channelId: string,
    signingSecret: string,
    now: number,
): string | null {
    const token = readCookie(req, STOREFRONT_VISITOR_COOKIE);
    if (!token) return null;
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra) return null;
    const expected = sign(encoded, signingSecret);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
        return null;
    }
    try {
        const payload = JSON.parse(
            Buffer.from(encoded, 'base64url').toString('utf8'),
        ) as VisitorCookiePayload;
        return payload.v === 1 &&
            payload.channelId === channelId &&
            payload.exp > now &&
            normalizeStorefrontVisitorId(payload.id)
            ? payload.id
            : null;
    } catch {
        return null;
    }
}

function readCookie(req: StorefrontVisitorRequest | undefined, name: string): string | undefined {
    for (const part of requestHeader(req, 'cookie').split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0) continue;
        if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
    }
}

function requestHeader(req: StorefrontVisitorRequest | undefined, name: string): string {
    const value = req?.headers?.[name];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function requestIsSecure(req: StorefrontVisitorRequest | undefined): boolean {
    return req?.secure === true || requestHeader(req, 'x-forwarded-proto').split(',')[0]?.trim() === 'https';
}

function sign(value: string, signingSecret: string): string {
    return createHmac('sha256', signingSecret).update(value).digest('base64url');
}
