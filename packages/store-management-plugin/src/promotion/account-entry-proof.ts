import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const accountEntryRoutes = ['verify-account', 'reset-password'] as const;

export type AccountEntryRoute = (typeof accountEntryRoutes)[number];

interface AccountEntryProofPayload {
    version: 1;
    route: AccountEntryRoute;
    host: string;
    tokenHash: string;
    expiresAt: number;
}

export interface CreateAccountEntryProofInput {
    route: AccountEntryRoute;
    host: string;
    token: string;
    signingSecret: string;
    expiresAt: number;
}

export interface ValidateAccountEntryProofInput extends Omit<CreateAccountEntryProofInput, 'expiresAt'> {
    proof: string;
    now?: number;
}

export function isAccountEntryRoute(value: string): value is AccountEntryRoute {
    return accountEntryRoutes.includes(value as AccountEntryRoute);
}

export function createAccountEntryProof(input: CreateAccountEntryProofInput): string {
    const payload: AccountEntryProofPayload = {
        version: 1,
        route: input.route,
        host: normalizeHost(input.host),
        tokenHash: hashToken(input.token),
        expiresAt: input.expiresAt,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${encoded}.${sign(encoded, input.signingSecret)}`;
}

export function validateAccountEntryProof(input: ValidateAccountEntryProofInput): boolean {
    const [encoded, signature, extra] = input.proof.split('.');
    if (!encoded || !signature || extra) return false;

    const expected = sign(encoded, input.signingSecret);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
        return false;
    }

    try {
        const payload = JSON.parse(
            Buffer.from(encoded, 'base64url').toString('utf8'),
        ) as AccountEntryProofPayload;
        return (
            payload.version === 1 &&
            payload.route === input.route &&
            payload.host === normalizeHost(input.host) &&
            payload.tokenHash === hashToken(input.token) &&
            Number.isFinite(payload.expiresAt) &&
            payload.expiresAt > (input.now ?? Date.now())
        );
    } catch {
        return false;
    }
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('base64url');
}

function normalizeHost(host: string): string {
    return host.trim().toLowerCase().replace(/\.$/, '');
}

function sign(encoded: string, signingSecret: string): string {
    return createHmac('sha256', signingSecret).update(encoded).digest('base64url');
}
