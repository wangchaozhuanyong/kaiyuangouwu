const MIN_SECRET_LENGTH = 8;
const MAX_SECRET_LENGTH = 256;

export class InvalidTwoFactorSecretError extends Error {
    constructor(message = 'The 2FA secret is not valid Base32') {
        super(message);
        this.name = 'InvalidTwoFactorSecretError';
    }
}

export function normalizeBase32Secret(value: string): string {
    const normalized = value
        .trim()
        .replace(/[\s-]+/g, '')
        .replace(/=+$/g, '')
        .toUpperCase();
    if (
        normalized.length < MIN_SECRET_LENGTH ||
        normalized.length > MAX_SECRET_LENGTH ||
        !/^[A-Z2-7]+$/.test(normalized)
    ) {
        throw new InvalidTwoFactorSecretError();
    }
    return normalized;
}
