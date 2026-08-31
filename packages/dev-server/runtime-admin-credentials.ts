export interface RuntimeAdminCredentials {
    identifier: string;
    password: string;
    cookieSecret: string;
}

const identifierPlaceholderPattern = /^(?:admin|administrator|changeme|example|superadmin|replace[-_].*)$/iu;
const secretPlaceholderPattern =
    /^(?:abc|admin|changeme|example|password|superadmin|vendure-dev|replace[-_])/iu;

export function resolveRuntimeAdminCredentials(
    env: NodeJS.ProcessEnv,
    isProduction: boolean,
): RuntimeAdminCredentials {
    const identifier = env.SUPERADMIN_USERNAME?.trim() || 'superadmin';
    const password = env.SUPERADMIN_PASSWORD?.trim() || 'superadmin';
    const cookieSecret = env.COOKIE_SECRET?.trim() || 'abc';

    if (isProduction) {
        assertProductionIdentifier(identifier);
        assertProductionSecret('SUPERADMIN_PASSWORD', password, 16);
        assertProductionSecret('COOKIE_SECRET', cookieSecret, 32);
    }

    return { identifier, password, cookieSecret };
}

function assertProductionIdentifier(identifier: string): void {
    if (identifierPlaceholderPattern.test(identifier)) {
        throw new Error('SUPERADMIN_USERNAME must use a non-default production identifier');
    }
}

function assertProductionSecret(name: string, value: string, minimumLength: number): void {
    if (value.length < minimumLength || secretPlaceholderPattern.test(value)) {
        throw new Error(
            `${name} must be a non-placeholder production secret of at least ${minimumLength} characters`,
        );
    }
}
